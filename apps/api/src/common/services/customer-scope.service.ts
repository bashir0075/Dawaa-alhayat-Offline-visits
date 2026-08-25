import { Injectable, ForbiddenException } from '@nestjs/common';
import { CustomerType } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';

/**
 * أي نوع عميل يحق للمستخدم التعامل معه.
 * ────────────────────────────────────────────────────────────────
 * قاعدة العمل: Sales صيدليات فقط · Promotion أطباء فقط.
 *
 * مصدر الحقيقة عمود `departments.allowed_customer_type` — بيانات
 * لا كود، فالأدمن يغيّرها من اللوحة بلا نشر جديد. القسم بلا قيمة
 * (Marketing · HR · بلا قسم) يرى النوعين.
 *
 * super_admin و admin يريان النوعين دائماً: مسؤوليتهما إشرافية
 * على القسمين معاً، وقصرهما على قسمهما الاسمي يمنعهما من الإدارة.
 */
@Injectable()
export class CustomerScopeService {
  // القسم لا يتغيّر إلا نادراً، فالتخزين المؤقت يوفّر استعلاماً في كل زيارة
  private cache = new Map<number, { types: CustomerType[]; expires: number }>();
  private readonly TTL = 60_000;

  private static readonly ALL: CustomerType[] = [CustomerType.doctor, CustomerType.pharmacy];

  constructor(private readonly prisma: PrismaService) {}

  async allowedTypes(user: AuthUser): Promise<CustomerType[]> {
    if (user.roleKey === 'super_admin' || user.roleKey === 'admin') {
      return CustomerScopeService.ALL;
    }
    if (!user.departmentId) return CustomerScopeService.ALL;

    const hit = this.cache.get(user.departmentId);
    if (hit && hit.expires > Date.now()) return hit.types;

    const dep = await this.prisma.department.findUnique({
      where: { id: user.departmentId },
      select: { allowedCustomerType: true },
    });

    const types = dep?.allowedCustomerType
      ? [dep.allowedCustomerType]
      : CustomerScopeService.ALL;

    this.cache.set(user.departmentId, { types, expires: Date.now() + this.TTL });
    return types;
  }

  /** يرفع 403 إن كان النوع خارج نطاق قسم المستخدم */
  async assertAllowed(user: AuthUser, type: CustomerType): Promise<void> {
    const allowed = await this.allowedTypes(user);
    if (allowed.includes(type)) return;

    const label = type === CustomerType.doctor ? 'الأطباء' : 'الصيدليات';
    const mine = allowed
      .map((t) => (t === CustomerType.doctor ? 'الأطباء' : 'الصيدليات'))
      .join(' و');

    throw new ForbiddenException(
      `قسمك لا يتعامل مع ${label} — المسموح لك: ${mine}`,
    );
  }

  /** بعد تغيير إعدادات قسم من اللوحة */
  clearCache() {
    this.cache.clear();
  }
}
