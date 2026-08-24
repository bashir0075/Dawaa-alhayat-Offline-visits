import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * يقرّر أي بيانات يراها المستخدم.
 * ────────────────────────────────────────────────────────────────
 * قاعدة واحدة تُطبّق على الزيارات والعملاء والتقارير معاً، فلا
 * تتسرّب بيانات من مسار نسي فحص الصلاحية.
 *
 *   *.view_all   → الكل
 *   *.view_team  → هو + كل التابعين له بأي عمق
 *   *.view_own   → هو فقط
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * معرّفات المستخدمين المسموح للطالب رؤية بياناتهم.
   * `null` تعني «الكل» — لا تُضِف شرط userId إطلاقاً.
   */
  async visibleUserIds(user: AuthUser, domain: 'visits' | 'customers' | 'reports'): Promise<number[] | null> {
    if (user.roleKey === 'super_admin') return null;
    if (user.permissions.includes(`${domain}.view_all`)) return null;
    if (user.permissions.includes(`${domain}.view_team`)) {
      return this.prisma.getSubordinateIds(user.id, true);
    }
    if (user.permissions.includes(`${domain}.view_own`)) return [user.id];
    throw new ForbiddenException('لا تملك صلاحية عرض هذه البيانات');
  }

  /** شرط Prisma جاهز للدمج في where */
  async userFilter(user: AuthUser, domain: 'visits' | 'customers' | 'reports') {
    const ids = await this.visibleUserIds(user, domain);
    return ids === null ? {} : { userId: { in: ids } };
  }

  /** هل يستطيع الطالب رؤية بيانات هذا المستخدم بعينه؟ */
  async canSeeUser(user: AuthUser, targetUserId: number, domain: 'visits' | 'customers' | 'reports') {
    const ids = await this.visibleUserIds(user, domain);
    return ids === null || ids.includes(targetUserId);
  }

  /**
   * العملاء المرئيون: المسنَدون للمستخدمين ضمن نطاقه.
   * العميل قد يكون مسنَداً لعدة مندوبين عبر الزمن، لذا نفحص
   * الإسناد النشط فقط.
   */
  async customerFilter(user: AuthUser) {
    const ids = await this.visibleUserIds(user, 'customers');
    if (ids === null) return {};
    return {
      OR: [
        { assignments: { some: { userId: { in: ids }, isActive: true } } },
        { createdById: { in: ids } },   // عميل أنشأه ولم يُسنَد بعد
      ],
    };
  }
}
