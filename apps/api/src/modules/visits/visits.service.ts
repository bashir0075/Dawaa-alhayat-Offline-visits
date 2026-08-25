import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  CustomerType, VisitType, VisitSource, ProductRole, CustomerSource, Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../../common/services/scope.service';
import { CustomerScopeService } from '../../common/services/customer-scope.service';
import { CustomersService, type CustomerInput } from '../customers/customers.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

export interface VisitProductInput {
  productId: number;
  role: ProductRole;
  quantity?: number;
}

export interface CreateVisitInput {
  visitType: VisitType;
  customerType: CustomerType;
  /** لزيارة داخل القائمة */
  customerId?: number;
  /** لزيارة خارج القائمة — يُنشأ العميل تلقائياً */
  newCustomer?: CustomerInput;
  visitDate: string;
  visitReason?: string;
  products: VisitProductInput[];
  sampleQuantity?: number;
  promoGiven?: boolean;
  promoText?: string;
  notes?: string;
  source?: VisitSource;
}

export interface VisitWarning {
  code: string;
  severity: 'info' | 'warning';
  message: string;
}

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly customerScope: CustomerScopeService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  التحقق
  // ────────────────────────────────────────────────────────────────

  /** يوم واحد بتوقيت بغداد بلا وقت — يمنع انزلاق التاريخ عبر المناطق الزمنية */
  private parseVisitDate(input: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input?.trim() ?? '');
    if (!m) throw new BadRequestException('تاريخ الزيارة يجب أن يكون بصيغة YYYY-MM-DD');
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3]) {
      throw new BadRequestException('تاريخ الزيارة غير صالح');
    }
    return d;
  }

  private today(): Date {
    // بداية اليوم بتوقيت بغداد (UTC+3) معبَّراً عنها كتاريخ UTC
    const now = new Date(Date.now() + 3 * 3_600_000);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private async validateDate(visitDate: Date) {
    const today = this.today();
    const allowFuture = await this.settings.getBool('visit.allow_future_date', false);
    const maxBackdate = await this.settings.getNumber('visit.max_backdate_days', 30);

    if (!allowFuture && visitDate > today) {
      throw new BadRequestException('لا يمكن تسجيل زيارة بتاريخ مستقبلي');
    }
    const daysBack = Math.round((today.getTime() - visitDate.getTime()) / 86_400_000);
    if (daysBack > maxBackdate) {
      throw new BadRequestException(
        `لا يمكن تسجيل زيارة أقدم من ${maxBackdate} يوماً. اطلب من الأدمن استيرادها`,
      );
    }
  }

  private async validateProducts(products: VisitProductInput[]) {
    if (!products?.length) throw new BadRequestException('يجب اختيار منتج أساسي واحد على الأقل');

    const main = products.filter((p) => p.role === ProductRole.main);
    if (main.length !== 1) throw new BadRequestException('يجب اختيار منتج أساسي واحد بالضبط');

    const maxReminder = await this.settings.getNumber('visit.max_reminder_products', 3);
    const maxSample = await this.settings.getNumber('visit.max_sample_products', 3);

    const reminders = products.filter((p) => p.role === ProductRole.reminder);
    const samples = products.filter((p) => p.role === ProductRole.sample);
    if (reminders.length > maxReminder) {
      throw new BadRequestException(`أقصى عدد منتجات تذكيرية هو ${maxReminder}`);
    }
    if (samples.length > maxSample) {
      throw new BadRequestException(`أقصى عدد نماذج مجانية هو ${maxSample}`);
    }

    // منتج واحد لا يتكرر بنفس الدور (القيد الفريد في قاعدة البيانات
    // سيرفضه، لكن رسالة عربية أوضح من خطأ P2002)
    const seen = new Set<string>();
    for (const p of products) {
      const key = `${p.productId}:${p.role}`;
      if (seen.has(key)) throw new BadRequestException('لا يمكن تكرار المنتج نفسه بالدور نفسه');
      seen.add(key);
    }

    const ids = [...new Set(products.map((p) => p.productId))];
    const found = await this.prisma.product.count({
      where: { id: { in: ids }, isActive: true, deletedAt: null },
    });
    if (found !== ids.length) {
      throw new BadRequestException('أحد المنتجات المختارة غير موجود أو معطّل');
    }
  }

  /**
   * تحذيرات شاشة المراجعة — لا تمنع الحفظ، لكنها تظهر للمندوب
   * قبل التأكيد النهائي. بما أن التعديل ممنوع بعد الحفظ، هذه
   * فرصته الوحيدة لاكتشاف الخطأ.
   */
  async previewWarnings(user: AuthUser, input: CreateVisitInput): Promise<VisitWarning[]> {
    await this.customerScope.assertAllowed(user, input.customerType);

    const warnings: VisitWarning[] = [];
    const visitDate = this.parseVisitDate(input.visitDate);

    if (input.customerId) {
      const warnDays = await this.settings.getNumber('visit.duplicate_warn_days', 3);
      const since = new Date(visitDate.getTime() - warnDays * 86_400_000);

      const recent = await this.prisma.visit.findFirst({
        where: {
          userId: user.id,
          customerId: input.customerId,
          deletedAt: null,
          visitDate: { gte: since, lte: visitDate },
        },
        orderBy: { visitDate: 'desc' },
        select: { visitDate: true, visitNo: true },
      });

      if (recent) {
        const days = Math.round((visitDate.getTime() - recent.visitDate.getTime()) / 86_400_000);
        warnings.push({
          code: 'recent_visit',
          severity: 'warning',
          message: days === 0
            ? `سجّلت زيارة لهذا العميل بالتاريخ نفسه (${recent.visitNo})`
            : `زرت هذا العميل قبل ${days} يوم فقط (${recent.visitNo}) — هل هذه زيارة جديدة فعلاً؟`,
        });
      }
    }

    const daysBack = Math.round((this.today().getTime() - visitDate.getTime()) / 86_400_000);
    if (daysBack > 7) {
      warnings.push({
        code: 'old_date',
        severity: 'warning',
        message: `تسجّل زيارة قديمة عمرها ${daysBack} يوماً — تأكّد من التاريخ`,
      });
    }

    // كمية عيّنات شاذة مقارنة بمعدّل المندوب نفسه
    if (input.sampleQuantity && input.sampleQuantity > 0) {
      const agg = await this.prisma.visit.aggregate({
        where: { userId: user.id, deletedAt: null, sampleQuantity: { gt: 0 } },
        _avg: { sampleQuantity: true },
        _count: true,
      });
      const avg = agg._avg.sampleQuantity ?? 0;
      if (agg._count >= 10 && avg > 0 && input.sampleQuantity > avg * 3) {
        warnings.push({
          code: 'high_samples',
          severity: 'warning',
          message: `عدد النماذج ${input.sampleQuantity} — أعلى بكثير من معدّلك (${avg.toFixed(1)})`,
        });
      }
    }

    if (input.visitType === VisitType.out_list) {
      warnings.push({
        code: 'creates_customer',
        severity: 'info',
        message: 'سيُضاف هذا العميل لقائمتك تلقائياً بانتظار موافقة مديرك',
      });
    }

    return warnings;
  }

  // ────────────────────────────────────────────────────────────────
  //  الإنشاء
  // ────────────────────────────────────────────────────────────────

  private async nextVisitNo(tx: Prisma.TransactionClient, year: number): Promise<string> {
    const prefix = `V-${year}-`;
    const rows = await tx.$queryRaw<{ max: string | null }[]>`
      SELECT MAX(visit_no) AS max FROM visits WHERE visit_no LIKE ${prefix + '%'}
    `;
    const last = rows[0]?.max;
    const n = last ? parseInt(last.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(n).padStart(6, '0')}`;
  }

  async create(user: AuthUser, input: CreateVisitInput) {
    // Sales صيدليات فقط · Promotion أطباء فقط — يُفحص على الخادم
    // لا في الواجهة وحدها، وإلا كفى تعديل الطلب لتجاوز القاعدة.
    await this.customerScope.assertAllowed(user, input.customerType);

    const visitDate = this.parseVisitDate(input.visitDate);
    await this.validateDate(visitDate);
    await this.validateProducts(input.products);

    let customerId = input.customerId;

    // زيارة خارج القائمة: ينشئ العميل أولاً بحالة "بانتظار الموافقة"
    if (input.visitType === VisitType.out_list) {
      if (!input.newCustomer) {
        throw new BadRequestException('بيانات العميل مطلوبة للزيارة خارج القائمة');
      }
      if (!input.visitReason?.trim()) {
        throw new BadRequestException('سبب الزيارة مطلوب للزيارة خارج القائمة');
      }
      const { customer } = await this.customers.create(
        user,
        { ...input.newCustomer, customerType: input.customerType },
        CustomerSource.from_out_visit,
      );
      customerId = customer.id;
    } else {
      if (!customerId) throw new BadRequestException('يجب اختيار عميل من القائمة');
      const assigned = await this.prisma.customerAssignment.findFirst({
        where: { customerId, userId: user.id, isActive: true },
      });
      if (!assigned) {
        throw new ForbiddenException('هذا العميل ليس في قائمتك — سجّلها كزيارة خارج القائمة');
      }
    }

    const customer = await this.customers.findForSnapshot(customerId!);

    // اللقطة: بيانات المندوب لحظة التسجيل
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: true, position: true, manager: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const visitNo = await this.nextVisitNo(tx, visitDate.getUTCFullYear());

      const visit = await tx.visit.create({
        data: {
          visitNo,
          userId: user.id,
          customerId: customer.id,
          visitType: input.visitType,
          customerType: input.customerType,
          visitDate,
          visitReason: input.visitReason?.trim() || null,
          sampleQuantity: input.sampleQuantity ?? null,
          promoGiven: input.promoGiven ?? false,
          promoText: input.promoGiven ? input.promoText?.trim() || null : null,
          notes: input.notes?.trim() || null,
          source: input.source ?? VisitSource.web,
          isLocked: true,

          // ── اللقطة المجمّدة ──
          snapCustomerCode: customer.code,
          snapCustomerName: customer.nameAr,
          snapSpeciality: customer.speciality?.nameEn ?? null,
          snapHospital: customer.hospital,
          snapWorkTime: customer.workTime,
          snapProvince: customer.province?.nameAr ?? null,
          snapArea: customer.area?.nameAr ?? null,
          snapStreet: customer.street,
          snapClassCode: customer.customerClass?.code ?? null,
          snapClassLetter: customer.customerClass?.classLetter ?? null,
          snapMonthlyTarget: customer.customerClass?.monthlyTarget ?? null,
          snapUserName: me.fullNameAr || me.fullNameEn,
          snapDepartment: me.department?.nameEn ?? null,
          snapPosition: me.position?.nameEn ?? null,
          snapManagerName: me.manager ? me.manager.fullNameAr || me.manager.fullNameEn : null,

          products: {
            create: input.products.map((p) => ({
              productId: p.productId,
              role: p.role,
              quantity: p.quantity ?? null,
            })),
          },
        },
        include: { products: { include: { product: true } } },
      });

      // قاموس المواد الدعائية ينمو من الاستخدام الفعلي
      if (input.promoGiven && input.promoText?.trim()) {
        const text = input.promoText.trim();
        await tx.promoMaterialSuggestion.upsert({
          where: { text },
          update: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
          create: { text, normalized: PrismaService.normalize(text) },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id, action: 'create', entityType: 'visit',
          entityId: String(visit.id), after: { visitNo, customerId: customer.id } as any,
        },
      });

      return visit;
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  القراءة
  // ────────────────────────────────────────────────────────────────

  async list(user: AuthUser, opts: {
    from?: string; to?: string; userId?: number; customerId?: number;
    visitType?: VisitType; customerType?: CustomerType;
    page?: number; pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(opts.pageSize ?? 50, 200);
    const scopeFilter = await this.scope.userFilter(user, 'visits');

    if (opts.userId && !(await this.scope.canSeeUser(user, opts.userId, 'visits'))) {
      throw new ForbiddenException('لا تملك صلاحية عرض زيارات هذا المستخدم');
    }

    const where: Prisma.VisitWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(opts.userId && { userId: opts.userId }),
      ...(opts.customerId && { customerId: opts.customerId }),
      ...(opts.visitType && { visitType: opts.visitType }),
      ...(opts.customerType && { customerType: opts.customerType }),
      ...((opts.from || opts.to) && {
        visitDate: {
          ...(opts.from && { gte: this.parseVisitDate(opts.from) }),
          ...(opts.to && { lte: this.parseVisitDate(opts.to) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        include: {
          products: { include: { product: { select: { code: true, shortName: true, nameAr: true } } } },
          user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        },
        orderBy: [{ visitDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.visit.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findOne(user: AuthUser, id: number) {
    const scopeFilter = await this.scope.userFilter(user, 'visits');
    const visit = await this.prisma.visit.findFirst({
      where: { id, deletedAt: null, ...scopeFilter },
      include: {
        products: { include: { product: true } },
        user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        customer: true,
        corrections: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!visit) throw new NotFoundException('الزيارة غير موجودة أو خارج نطاقك');
    return visit;
  }

  // ────────────────────────────────────────────────────────────────
  //  التصحيح — المندوب لا يعدّل، بل يطلب
  // ────────────────────────────────────────────────────────────────

  private static readonly CORRECTABLE = new Set([
    'visitDate', 'sampleQuantity', 'promoText', 'notes', 'visitReason',
  ]);

  async requestCorrection(user: AuthUser, visitId: number, input: {
    fieldName: string; newValue: string; reason: string;
  }) {
    const visit = await this.findOne(user, visitId);

    if (visit.userId !== user.id && user.roleKey !== 'super_admin') {
      throw new ForbiddenException('يمكنك طلب تصحيح زياراتك فقط');
    }
    if (!VisitsService.CORRECTABLE.has(input.fieldName)) {
      throw new BadRequestException(`لا يمكن طلب تصحيح الحقل: ${input.fieldName}`);
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException('سبب التصحيح مطلوب');
    }

    const duplicate = await this.prisma.correctionRequest.findFirst({
      where: { visitId, fieldName: input.fieldName, status: 'pending' },
    });
    if (duplicate) throw new BadRequestException('يوجد طلب تصحيح معلّق لهذا الحقل');

    return this.prisma.correctionRequest.create({
      data: {
        visitId,
        requestedById: user.id,
        fieldName: input.fieldName,
        oldValue: String((visit as any)[input.fieldName] ?? ''),
        newValue: input.newValue,
        reason: input.reason.trim(),
      },
    });
  }

  async reviewCorrection(user: AuthUser, id: number, approve: boolean, note?: string) {
    const req = await this.prisma.correctionRequest.findUnique({
      where: { id },
      include: { visit: true },
    });
    if (!req) throw new NotFoundException('الطلب غير موجود');
    if (req.status !== 'pending') throw new BadRequestException('الطلب مراجَع مسبقاً');
    if (!(await this.scope.canSeeUser(user, req.requestedById, 'visits'))) {
      throw new ForbiddenException('هذا الطلب خارج نطاقك');
    }
    if (req.requestedById === user.id && user.roleKey !== 'super_admin') {
      throw new ForbiddenException('لا يمكنك الموافقة على طلبك');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.correctionRequest.update({
        where: { id },
        data: {
          status: approve ? 'approved' : 'rejected',
          reviewedById: user.id, reviewedAt: new Date(), reviewNote: note,
        },
      });

      if (approve) {
        const value: any = req.fieldName === 'visitDate'
          ? this.parseVisitDate(req.newValue!)
          : req.fieldName === 'sampleQuantity'
            ? Number(req.newValue)
            : req.newValue;

        await tx.visit.update({ where: { id: req.visitId }, data: { [req.fieldName]: value } });

        await tx.auditLog.create({
          data: {
            actorId: user.id, action: 'update', entityType: 'visit', entityId: String(req.visitId),
            before: { [req.fieldName]: req.oldValue } as any,
            after: { [req.fieldName]: req.newValue } as any,
          },
        });
      }

      await tx.notification.create({
        data: {
          userId: req.requestedById,
          type: 'correction_reviewed',
          titleAr: approve ? 'تمت الموافقة على التصحيح' : 'رُفض طلب التصحيح',
          body: note ?? undefined,
          link: `/visits/${req.visitId}`,
        },
      });

      return updated;
    });
  }
}
