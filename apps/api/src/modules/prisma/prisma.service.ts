import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('قاعدة البيانات متصلة');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * تطبيع النص للبحث المتسامح مع الأخطاء الإملائية العربية.
   * يجب أن يطابق تماماً دالة normalize في prisma/seed.mjs
   * وإلا فلن تتطابق الأسماء المخزّنة مع نص البحث.
   */
  static normalize(s: string | null | undefined): string {
    if (!s) return '';
    return String(s)
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ـ/g, '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * كل معرّفات المستخدمين التابعين لمدير — بأي عمق.
   * يُستخدم في صلاحيات "عرض فريقي" وتقارير الأداء الهرمي.
   */
  async getSubordinateIds(managerId: number, includeSelf = true): Promise<number[]> {
    const rows = await this.$queryRaw<{ id: number }[]>`
      WITH RECURSIVE team AS (
        SELECT id FROM users WHERE id = ${managerId}
        UNION ALL
        SELECT u.id FROM users u
        INNER JOIN team t ON u.manager_id = t.id
        WHERE u.deleted_at IS NULL
      )
      SELECT id FROM team
    `;
    const ids = rows.map((r) => r.id);
    return includeSelf ? ids : ids.filter((id) => id !== managerId);
  }
}
