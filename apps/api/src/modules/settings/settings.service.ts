import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * إعدادات النظام — يغيّرها الأدمن من اللوحة بلا نشر جديد.
 * مخزّنة في الذاكرة لمدة قصيرة لأنها تُقرأ في كل تسجيل زيارة.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: any; expires: number }>();
  private readonly TTL = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T = any>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;

    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const value = row ? (row.value as T) : fallback;
    this.cache.set(key, { value, expires: Date.now() + this.TTL });
    return value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const v = await this.get<any>(key, fallback);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const v = await this.get<any>(key, fallback);
    return typeof v === 'boolean' ? v : v === 'true' || v === 1;
  }

  async set(key: string, value: any, userId: number) {
    const before = await this.prisma.appSetting.findUnique({ where: { key } });

    const row = await this.prisma.appSetting.upsert({
      where: { key },
      update: { value, updatedById: userId },
      create: { key, value, updatedById: userId },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: 'update', entityType: 'app_setting', entityId: key,
        before: before ? { value: before.value } as any : undefined,
        after: { value } as any,
      },
    });

    this.cache.delete(key);
    return row;
  }

  async list() {
    return this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /** بعد تغيير جماعي — يجبر إعادة القراءة من قاعدة البيانات */
  clearCache() {
    this.cache.clear();
  }
}
