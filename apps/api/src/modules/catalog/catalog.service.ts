import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * القوائم المرجعية: قراءة للجميع، تعديل للأدمن.
 * الحذف تعطيلٌ دائماً — الحذف الحقيقي يكسر الزيارات القديمة.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** كل ما تحتاجه شاشة تسجيل الزيارة في طلب واحد */
  async bootstrap() {
    const [products, provinces, specialities, classes, promoSuggestions] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, code: true, shortName: true, nameAr: true, categoryId: true },
        orderBy: { sortOrder: 'asc' },   // الأكثر استخداماً أولاً — B12 في الأعلى
      }),
      this.prisma.province.findMany({
        where: { isActive: true },
        include: { areas: { where: { isActive: true }, orderBy: { nameAr: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.speciality.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.customerClass.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.promoMaterialSuggestion.findMany({
        orderBy: { usageCount: 'desc' }, take: 30, select: { text: true },
      }),
    ]);

    return {
      products,
      provinces,
      specialities,
      classes,
      promoSuggestions: promoSuggestions.map((p) => p.text),
      // ينبّه الواجهة أن التارغيت غير مضبوط بعد
      classesReady: classes.every((c) => c.monthlyTarget > 0),
    };
  }

  // ── المنتجات ────────────────────────────────────────────────────

  listProducts(includeInactive = false) {
    return this.prisma.product.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      include: { category: true, aliases: { select: { alias: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async upsertProduct(userId: number, data: {
    id?: number; code: string; nameFull: string; shortName: string;
    nameAr?: string; categoryId?: number; sortOrder?: number; isActive?: boolean;
  }) {
    const before = data.id
      ? await this.prisma.product.findUnique({ where: { id: data.id } })
      : null;

    const product = data.id
      ? await this.prisma.product.update({ where: { id: data.id }, data })
      : await this.prisma.product.create({ data });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: data.id ? 'update' : 'create',
        entityType: 'product', entityId: String(product.id),
        before: before as any, after: product as any,
      },
    });
    return product;
  }

  /**
   * لا حذف حقيقي: تعطيل. المنتج يختفي من قوائم المندوبين
   * ويبقى في تقارير السنوات السابقة.
   */
  async deactivateProduct(userId: number, id: number) {
    const used = await this.prisma.visitProduct.count({ where: { productId: id } });
    const product = await this.prisma.product.update({
      where: { id }, data: { isActive: false },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: 'deactivate', entityType: 'product', entityId: String(id),
        after: { usedInVisits: used } as any,
      },
    });
    return { product, usedInVisits: used };
  }

  async addAlias(productId: number, alias: string) {
    const normalized = PrismaService.normalize(alias);
    if (!normalized) throw new BadRequestException('الاسم البديل فارغ');

    const clash = await this.prisma.productAlias.findUnique({ where: { normalized } });
    if (clash && clash.productId !== productId) {
      const other = await this.prisma.product.findUnique({ where: { id: clash.productId } });
      throw new BadRequestException(`هذا الاسم مستخدم للمنتج: ${other?.shortName}`);
    }
    return this.prisma.productAlias.upsert({
      where: { normalized },
      update: { productId, alias },
      create: { productId, alias, normalized },
    });
  }

  // ── الجغرافيا ───────────────────────────────────────────────────

  async upsertProvince(userId: number, data: { id?: number; nameAr: string; nameEn: string; sortOrder?: number; isActive?: boolean }) {
    const p = data.id
      ? await this.prisma.province.update({ where: { id: data.id }, data })
      : await this.prisma.province.create({ data });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: data.id ? 'update' : 'create', entityType: 'province', entityId: String(p.id), after: p as any },
    });
    return p;
  }

  async upsertArea(userId: number, data: { id?: number; provinceId: number; nameAr: string; nameEn?: string; isActive?: boolean }) {
    const a = data.id
      ? await this.prisma.area.update({ where: { id: data.id }, data })
      : await this.prisma.area.create({ data });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: data.id ? 'update' : 'create', entityType: 'area', entityId: String(a.id), after: a as any },
    });
    return a;
  }

  /** دمج منطقتين مكرّرتين — ينقل العملاء ثم يعطّل المصدر */
  async mergeAreas(userId: number, sourceId: number, targetId: number) {
    if (sourceId === targetId) throw new BadRequestException('لا يمكن دمج المنطقة مع نفسها');

    const [source, target] = await Promise.all([
      this.prisma.area.findUnique({ where: { id: sourceId } }),
      this.prisma.area.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) throw new NotFoundException('إحدى المنطقتين غير موجودة');

    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.customer.updateMany({
        where: { areaId: sourceId },
        data: { areaId: targetId, provinceId: target.provinceId },
      });
      await tx.userTerritory.deleteMany({ where: { areaId: sourceId } });
      await tx.area.update({ where: { id: sourceId }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          actorId: userId, action: 'merge', entityType: 'area', entityId: String(sourceId),
          after: { mergedInto: targetId, customersMoved: moved.count } as any,
        },
      });
      return { customersMoved: moved.count, source: source.nameAr, target: target.nameAr };
    });
  }

  // ── التصنيفات ───────────────────────────────────────────────────

  listClasses() {
    return this.prisma.customerClass.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /**
   * ضبط تارغيت التصنيفات — الجدول الذي ينتظره النظام.
   * حتى تُملأ، تقارير التغطية وتحقيق التارغيت معطّلة.
   */
  async setClassTargets(userId: number, targets: { code: string; monthlyTarget: number }[]) {
    const results: Awaited<ReturnType<typeof this.prisma.customerClass.update>>[] = [];
    for (const t of targets) {
      if (!Number.isInteger(t.monthlyTarget) || t.monthlyTarget < 0 || t.monthlyTarget > 31) {
        throw new BadRequestException(`تارغيت غير صالح للتصنيف ${t.code}: يجب أن يكون بين 0 و31`);
      }
      const before = await this.prisma.customerClass.findUnique({ where: { code: t.code } });
      if (!before) throw new NotFoundException(`التصنيف غير موجود: ${t.code}`);

      results.push(await this.prisma.customerClass.update({
        where: { code: t.code },
        data: { monthlyTarget: t.monthlyTarget },
      }));

      await this.prisma.auditLog.create({
        data: {
          actorId: userId, action: 'update', entityType: 'customer_class', entityId: t.code,
          before: { monthlyTarget: before.monthlyTarget } as any,
          after: { monthlyTarget: t.monthlyTarget } as any,
        },
      });
    }
    return results;
  }

  // ── الاختصاصات ──────────────────────────────────────────────────

  async upsertSpeciality(userId: number, data: { id?: number; nameEn: string; nameAr?: string; sortOrder?: number; isActive?: boolean }) {
    const s = data.id
      ? await this.prisma.speciality.update({ where: { id: data.id }, data })
      : await this.prisma.speciality.create({ data });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: data.id ? 'update' : 'create', entityType: 'speciality', entityId: String(s.id), after: s as any },
    });
    return s;
  }
}
