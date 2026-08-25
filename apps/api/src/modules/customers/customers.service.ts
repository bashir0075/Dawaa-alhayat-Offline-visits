import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomerType, CustomerStatus, CustomerSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../../common/services/scope.service';
import { CustomerScopeService } from '../../common/services/customer-scope.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

export interface CustomerInput {
  customerType: CustomerType;
  nameAr: string;
  specialityId?: number;
  hospital?: string;
  workTime?: 'a' | 'p';
  provinceId?: number;
  areaId?: number;
  street?: string;
  phone?: string;
  classId?: number;
}

/** الحقول التي تُجمَّد في الزيارة — تُقرأ مرة واحدة عند الحفظ */
const SNAPSHOT_INCLUDE = {
  speciality: true,
  province: true,
  area: true,
  customerClass: true,
} as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly customerScope: CustomerScopeService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  توليد الأكواد
  // ────────────────────────────────────────────────────────────────

  /**
   * DR-00001 / PH-00001
   * داخل معاملة مع قفل صريح — وإلا أنتج مندوبان يسجّلان في اللحظة
   * نفسها الكودَ نفسه ثم فشل أحدهما على قيد التفرّد.
   */
  private async nextCode(tx: Prisma.TransactionClient, type: CustomerType): Promise<string> {
    const prefix = type === CustomerType.doctor ? 'DR' : 'PH';
    const rows = await tx.$queryRaw<{ max: string | null }[]>`
      SELECT MAX(code) AS max FROM customers WHERE code LIKE ${prefix + '-%'}
    `;
    const last = rows[0]?.max;
    const n = last ? parseInt(last.slice(3), 10) + 1 : 1;
    return `${prefix}-${String(n).padStart(5, '0')}`;
  }

  // ────────────────────────────────────────────────────────────────
  //  البحث
  // ────────────────────────────────────────────────────────────────

  /**
   * بحث متسامح مع الأخطاء الإملائية العربية.
   * يبحث داخل نطاق المستخدم فقط — المندوب لا يرى قوائم غيره.
   *
   * الترتيب: تطابق تام ← يبدأ بـ ← تشابه trigram
   */
  async search(user: AuthUser, opts: {
    q: string;
    customerType?: CustomerType;
    onlyMine?: boolean;
    limit?: number;
  }) {
    const q = PrismaService.normalize(opts.q);
    if (q.length < 2) return [];

    // قسم المستخدم يحدّ النتائج: مندوب Sales لا يرى طبيباً إطلاقاً
    const allowedTypes = await this.customerScope.allowedTypes(user);
    if (opts.customerType && !allowedTypes.includes(opts.customerType)) return [];
    const typeFilter = opts.customerType ? [opts.customerType] : allowedTypes;

    const limit = Math.min(opts.limit ?? 20, 50);
    const scopeIds = await this.scope.visibleUserIds(user, 'customers');
    const mineOnly = opts.onlyMine ?? true;
    const userIds = mineOnly ? [user.id] : scopeIds;

    // pg_trgm: % هو عامل التشابه، similarity() ترتّب النتائج
    return this.prisma.$queryRaw<any[]>`
      SELECT
        c.id, c.code, c.name_ar AS "nameAr", c.customer_type AS "customerType",
        c.status, c.hospital, c.street, c.work_time AS "workTime",
        s.name_en AS speciality, p.name_ar AS province, a.name_ar AS area,
        cc.code AS "classCode", cc.monthly_target AS "monthlyTarget",
        similarity(c.normalized_name, ${q}) AS score,
        EXISTS (
          SELECT 1 FROM customer_assignments ca
          WHERE ca.customer_id = c.id AND ca.user_id = ${user.id} AND ca.is_active
        ) AS "inMyList"
      FROM customers c
      LEFT JOIN specialities s     ON s.id  = c.speciality_id
      LEFT JOIN provinces p        ON p.id  = c.province_id
      LEFT JOIN areas a            ON a.id  = c.area_id
      LEFT JOIN customer_classes cc ON cc.id = c.class_id
      WHERE c.deleted_at IS NULL
        AND c.status IN ('approved', 'pending')
        AND (c.normalized_name % ${q} OR c.normalized_name ILIKE ${'%' + q + '%'})
        AND c.customer_type IN (${Prisma.join(typeFilter.map((t) => Prisma.sql`${t}::"CustomerType"`))})
        ${userIds === null ? Prisma.empty : Prisma.sql`
          AND EXISTS (
            SELECT 1 FROM customer_assignments ca2
            WHERE ca2.customer_id = c.id AND ca2.is_active
              AND ca2.user_id IN (${Prisma.join(userIds)})
          )`}
      ORDER BY
        (c.normalized_name = ${q}) DESC,
        (c.normalized_name LIKE ${q + '%'}) DESC,
        score DESC,
        c.name_ar
      LIMIT ${limit}
    `;
  }

  // ────────────────────────────────────────────────────────────────
  //  الإنشاء
  // ────────────────────────────────────────────────────────────────

  /**
   * ينشئ عميلاً بحالة "بانتظار الموافقة" ويُسنده لمنشئه فوراً.
   * الإسناد قبل الموافقة مقصود: المندوب يسجّل زيارته اليوم ولا ينتظر مديره.
   */
  async create(user: AuthUser, input: CustomerInput, source: CustomerSource = CustomerSource.added_in_app) {
    await this.customerScope.assertAllowed(user, input.customerType);

    const nameAr = input.nameAr?.trim();
    if (!nameAr || nameAr.length < 2) {
      throw new BadRequestException('اسم العميل مطلوب');
    }

    const normalized = PrismaService.normalize(nameAr);

    // تحذير من التكرار — لا نمنعه لأن تشابه الأسماء وارد فعلاً
    const similar = await this.prisma.$queryRaw<{ id: number; code: string; nameAr: string; score: number }[]>`
      SELECT id, code, name_ar AS "nameAr", similarity(normalized_name, ${normalized}) AS score
      FROM customers
      WHERE deleted_at IS NULL
        AND customer_type = ${input.customerType}::"CustomerType"
        AND normalized_name % ${normalized}
      ORDER BY score DESC LIMIT 5
    `;

    const customer = await this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx, input.customerType);

      const created = await tx.customer.create({
        data: {
          code,
          customerType: input.customerType,
          nameAr,
          normalizedName: normalized,
          specialityId: input.customerType === CustomerType.doctor ? input.specialityId : null,
          hospital: input.customerType === CustomerType.doctor ? input.hospital : null,
          workTime: input.customerType === CustomerType.doctor ? input.workTime : null,
          provinceId: input.provinceId,
          areaId: input.areaId,
          street: input.street,
          phone: input.phone,
          classId: input.classId,
          status: CustomerStatus.pending,
          source,
          createdById: user.id,
        },
        include: SNAPSHOT_INCLUDE,
      });

      await tx.customerAssignment.create({
        data: { customerId: created.id, userId: user.id, createdById: user.id },
      });

      // طلب موافقة يصل لمدير المنشئ
      await tx.customerChangeRequest.create({
        data: {
          customerId: created.id,
          requestType: 'add',
          payload: input as any,
          requestedById: user.id,
          reason: source === CustomerSource.from_out_visit
            ? 'أُنشئ تلقائياً من زيارة خارج القائمة'
            : 'إضافة يدوية من التطبيق',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id, action: 'create', entityType: 'customer',
          entityId: String(created.id), after: created as any,
        },
      });

      return created;
    });

    return { customer, similarWarning: similar.filter((s) => s.id !== customer.id) };
  }

  // ────────────────────────────────────────────────────────────────
  //  القراءة
  // ────────────────────────────────────────────────────────────────

  /** سجل العميل كاملاً — يُستخدم لبناء لقطة الزيارة */
  async findForSnapshot(customerId: number) {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      include: SNAPSHOT_INCLUDE,
    });
    if (!c) throw new NotFoundException('العميل غير موجود');
    return c;
  }

  async findOne(user: AuthUser, id: number) {
    const filter = await this.scope.customerFilter(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, ...filter },
      include: {
        ...SNAPSHOT_INCLUDE,
        assignments: {
          where: { isActive: true },
          include: { user: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
        },
        _count: { select: { visits: { where: { deletedAt: null } } } },
      },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود أو خارج نطاقك');
    return customer;
  }

  /** قائمة المندوب — العملاء المسنَدون له */
  async myList(user: AuthUser, opts: { customerType?: CustomerType; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(opts.pageSize ?? 50, 200);

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      assignments: { some: { userId: user.id, isActive: true } },
      ...(opts.customerType && { customerType: opts.customerType }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: SNAPSHOT_INCLUDE,
        orderBy: [{ status: 'asc' }, { nameAr: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  // ────────────────────────────────────────────────────────────────
  //  الموافقات
  // ────────────────────────────────────────────────────────────────

  /** طلبات ضمن نطاق المراجِع فقط — المدير لا يوافق على طلبات فريق آخر */
  async pendingRequests(user: AuthUser) {
    const ids = await this.scope.visibleUserIds(user, 'customers');
    return this.prisma.customerChangeRequest.findMany({
      where: {
        status: 'pending',
        ...(ids === null ? {} : { requestedById: { in: ids } }),
      },
      include: {
        customer: { include: SNAPSHOT_INCLUDE },
        requestedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(user: AuthUser, requestId: number, approve: boolean, note?: string) {
    const req = await this.prisma.customerChangeRequest.findUnique({
      where: { id: requestId },
      include: { customer: true },
    });
    if (!req) throw new NotFoundException('الطلب غير موجود');
    if (req.status !== 'pending') throw new BadRequestException('الطلب مراجَع مسبقاً');

    if (!(await this.scope.canSeeUser(user, req.requestedById, 'customers'))) {
      throw new ForbiddenException('هذا الطلب خارج نطاقك');
    }
    if (req.requestedById === user.id && user.roleKey !== 'super_admin') {
      throw new ForbiddenException('لا يمكنك الموافقة على طلبك');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerChangeRequest.update({
        where: { id: requestId },
        data: {
          status: approve ? 'approved' : 'rejected',
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });

      if (req.customerId) {
        if (req.requestType === 'add') {
          await tx.customer.update({
            where: { id: req.customerId },
            data: approve
              ? { status: CustomerStatus.approved, approvedById: user.id, approvedAt: new Date() }
              : { status: CustomerStatus.rejected, rejectionReason: note },
          });
        } else if (req.requestType === 'remove' && approve) {
          // لا حذف حقيقي: تعطيل + إنهاء الإسناد. الزيارات القديمة تبقى سليمة.
          await tx.customer.update({
            where: { id: req.customerId },
            data: { status: CustomerStatus.inactive },
          });
          await tx.customerAssignment.updateMany({
            where: { customerId: req.customerId, isActive: true },
            data: { isActive: false, toDate: new Date() },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: approve ? 'approve' : 'reject',
          entityType: 'customer_change_request',
          entityId: String(requestId),
          after: { status: updated.status, note } as any,
        },
      });

      await tx.notification.create({
        data: {
          userId: req.requestedById,
          type: 'customer_request_reviewed',
          titleAr: approve ? 'تمت الموافقة على طلبك' : 'رُفض طلبك',
          body: note ?? undefined,
          link: `/customers/${req.customerId}`,
        },
      });

      return updated;
    });
  }
}
