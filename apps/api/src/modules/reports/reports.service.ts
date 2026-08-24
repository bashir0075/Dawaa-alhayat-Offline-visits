import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../../common/services/scope.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

export interface ReportRange {
  from: string;   // YYYY-MM-DD
  to: string;
  userId?: number;
  provinceId?: number;
  customerType?: 'doctor' | 'pharmacy';
}

export interface ReportMeta {
  key: string;
  titleAr: string;
  titleEn: string;
  description: string;
  requiresTargets: boolean;
}

export const REPORTS: ReportMeta[] = [
  { key: 'visits_detail',    titleAr: 'الزيارات التفصيلي',      titleEn: 'Visits Detail',        description: 'كل الزيارات بكل الأعمدة — أساس جدول Pivot', requiresTargets: false },
  { key: 'coverage',         titleAr: 'تغطية القائمة',          titleEn: 'List Coverage',        description: 'كم عميلاً من قائمة المندوب زاره، ومن لم يُزَر', requiresTargets: false },
  { key: 'target',           titleAr: 'تحقيق التارغيت',         titleEn: 'Target Achievement',   description: 'المخطط مقابل المنفّذ لكل مندوب', requiresTargets: true },
  { key: 'frequency_class',  titleAr: 'التكرار حسب التصنيف',     titleEn: 'Frequency by Class',   description: 'هل أطباء A يُزارون أكثر من C فعلاً؟', requiresTargets: false },
  { key: 'products',         titleAr: 'المنتجات',               titleEn: 'Products',             description: 'كم مرة قُدِّم كل منتج، حسب المنطقة والاختصاص', requiresTargets: false },
  { key: 'samples',          titleAr: 'النماذج المجانية',        titleEn: 'Free Samples',         description: 'الكميات لكل مندوب ومنتج وشهر — رقابة مالية', requiresTargets: false },
  { key: 'promo',            titleAr: 'المواد الدعائية',         titleEn: 'Promo Materials',      description: 'ما قُدّم ومن قدّمه', requiresTargets: false },
  { key: 'hierarchy',        titleAr: 'الأداء الهرمي',          titleEn: 'Hierarchy Performance', description: 'إجمالي كل قائد فريق ثم مدير منطقة ثم القسم', requiresTargets: false },
  { key: 'out_of_list',      titleAr: 'خارج القائمة',           titleEn: 'Out of List',          description: 'عملاء جدد مكتشفون وطلبات معلّقة', requiresTargets: false },
  { key: 'alerts',           titleAr: 'الإنذارات',              titleEn: 'Alerts',               description: 'مندوب متوقف · تواريخ شاذة · تكرار مشبوه', requiresTargets: false },
  { key: 'monthly_trend',    titleAr: 'الاتجاه الشهري',         titleEn: 'Monthly Trend',        description: 'مقارنة شهرية وربعية', requiresTargets: false },
];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private parseDate(s: string, label: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.trim() ?? '')) {
      throw new BadRequestException(`${label} يجب أن يكون بصيغة YYYY-MM-DD`);
    }
    return new Date(`${s}T00:00:00.000Z`);
  }

  /** شرط SQL خام يقيّد النتائج بنطاق المستخدم */
  private async scopeSql(user: AuthUser, range: ReportRange) {
    const ids = await this.scope.visibleUserIds(user, 'reports');

    if (range.userId && ids !== null && !ids.includes(range.userId)) {
      throw new BadRequestException('هذا المستخدم خارج نطاقك');
    }

    const effective = range.userId ? [range.userId] : ids;
    return effective === null
      ? Prisma.empty
      : Prisma.sql`AND v.user_id IN (${Prisma.join(effective)})`;
  }

  private dateSql(range: ReportRange) {
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    return Prisma.sql`AND v.visit_date BETWEEN ${from} AND ${to}`;
  }

  private filtersSql(range: ReportRange) {
    return Prisma.sql`
      ${range.provinceId ? Prisma.sql`AND c.province_id = ${range.provinceId}` : Prisma.empty}
      ${range.customerType ? Prisma.sql`AND v.customer_type = ${range.customerType}::"CustomerType"` : Prisma.empty}
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ١ · الزيارات التفصيلي — أساس جدول Pivot
  // ════════════════════════════════════════════════════════════════

  async visitsDetail(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        v.visit_no              AS "رقم الزيارة",
        v.visit_date            AS "تاريخ الزيارة",
        TO_CHAR(v.visit_date, 'YYYY-MM')  AS "الشهر",
        TO_CHAR(v.recorded_at AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI') AS "وقت التسجيل",
        v.snap_user_name        AS "المندوب",
        v.snap_department       AS "القسم",
        v.snap_position         AS "المنصب",
        v.snap_manager_name     AS "المدير المباشر",
        v.snap_customer_code    AS "كود العميل",
        v.snap_customer_name    AS "اسم العميل",
        CASE v.customer_type WHEN 'doctor' THEN 'طبيب' ELSE 'صيدلية' END AS "النوع",
        CASE v.visit_type WHEN 'in_list' THEN 'داخل القائمة' ELSE 'خارج القائمة' END AS "نوع الزيارة",
        v.snap_speciality       AS "الاختصاص",
        v.snap_hospital         AS "المشفى",
        v.snap_work_time        AS "الدوام",
        v.snap_province         AS "المحافظة",
        v.snap_area             AS "المنطقة",
        v.snap_street           AS "الشارع",
        v.snap_class_code       AS "التصنيف",
        v.snap_class_letter     AS "الفئة",
        v.snap_monthly_target   AS "التارغيت الشهري",
        pm.short_name           AS "المنتج الأساسي",
        pr.reminders            AS "المنتجات التذكيرية",
        ps.samples              AS "النماذج المجانية",
        v.sample_quantity       AS "عدد النماذج",
        CASE WHEN v.promo_given THEN 'نعم' ELSE 'لا' END AS "مادة دعائية",
        v.promo_text            AS "نوع المادة",
        v.visit_reason          AS "سبب الزيارة",
        v.notes                 AS "الملاحظات",
        CASE v.source WHEN 'web' THEN 'ويب' WHEN 'mobile' THEN 'جوال' ELSE 'استيراد' END AS "المصدر"
      FROM visits v
      LEFT JOIN customers c ON c.id = v.customer_id
      LEFT JOIN LATERAL (
        SELECT p.short_name FROM visit_products vp
        JOIN products p ON p.id = vp.product_id
        WHERE vp.visit_id = v.id AND vp.role = 'main' LIMIT 1
      ) pm ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(p.short_name, ' + ' ORDER BY p.sort_order) AS reminders
        FROM visit_products vp JOIN products p ON p.id = vp.product_id
        WHERE vp.visit_id = v.id AND vp.role = 'reminder'
      ) pr ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(p.short_name, ' + ' ORDER BY p.sort_order) AS samples
        FROM visit_products vp JOIN products p ON p.id = vp.product_id
        WHERE vp.visit_id = v.id AND vp.role = 'sample'
      ) ps ON TRUE
      WHERE v.deleted_at IS NULL
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      ORDER BY v.visit_date DESC, v.id DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٢ · تغطية القائمة — أهم مؤشر في العمل الطبي
  // ════════════════════════════════════════════════════════════════

  async coverage(user: AuthUser, range: ReportRange) {
    const ids = await this.scope.visibleUserIds(user, 'reports');
    const effective = range.userId ? [range.userId] : ids;
    const userSql = effective === null ? Prisma.empty : Prisma.sql`AND u.id IN (${Prisma.join(effective)})`;
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');

    return this.prisma.$queryRaw<any[]>`
      WITH assigned AS (
        SELECT ca.user_id, ca.customer_id
        FROM customer_assignments ca
        JOIN customers c ON c.id = ca.customer_id
        WHERE ca.is_active
          AND c.deleted_at IS NULL
          AND c.status = 'approved'
          ${range.customerType ? Prisma.sql`AND c.customer_type = ${range.customerType}::"CustomerType"` : Prisma.empty}
          ${range.provinceId ? Prisma.sql`AND c.province_id = ${range.provinceId}` : Prisma.empty}
      ),
      visited AS (
        SELECT DISTINCT v.user_id, v.customer_id
        FROM visits v
        WHERE v.deleted_at IS NULL AND v.visit_date BETWEEN ${from} AND ${to}
      )
      SELECT
        u.id                                          AS "معرف",
        COALESCE(u.full_name_ar, u.full_name_en)      AS "المندوب",
        d.name_en                                     AS "القسم",
        COALESCE(m.full_name_ar, m.full_name_en)      AS "المدير",
        COUNT(a.customer_id)::int                     AS "حجم القائمة",
        COUNT(vi.customer_id)::int                    AS "عملاء تمت زيارتهم",
        (COUNT(a.customer_id) - COUNT(vi.customer_id))::int AS "لم تتم زيارتهم",
        CASE WHEN COUNT(a.customer_id) = 0 THEN 0
             ELSE ROUND(COUNT(vi.customer_id) * 100.0 / COUNT(a.customer_id), 1)
        END                                           AS "نسبة التغطية %"
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN users m       ON m.id = u.manager_id
      LEFT JOIN assigned a    ON a.user_id = u.id
      LEFT JOIN visited vi    ON vi.user_id = u.id AND vi.customer_id = a.customer_id
      WHERE u.deleted_at IS NULL AND u.is_active
        ${userSql}
      GROUP BY u.id, u.full_name_ar, u.full_name_en, d.name_en, m.full_name_ar, m.full_name_en
      HAVING COUNT(a.customer_id) > 0
      ORDER BY "نسبة التغطية %" ASC
    `;
  }

  /** العملاء الذين لم تتم زيارتهم إطلاقاً في الفترة — ورقة مرافقة للتغطية */
  async uncoveredCustomers(user: AuthUser, range: ReportRange) {
    const ids = await this.scope.visibleUserIds(user, 'reports');
    const effective = range.userId ? [range.userId] : ids;
    const userSql = effective === null ? Prisma.empty : Prisma.sql`AND ca.user_id IN (${Prisma.join(effective)})`;
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');

    return this.prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(u.full_name_ar, u.full_name_en) AS "المندوب",
        c.code        AS "كود العميل",
        c.name_ar     AS "اسم العميل",
        s.name_en     AS "الاختصاص",
        p.name_ar     AS "المحافظة",
        a.name_ar     AS "المنطقة",
        cc.code       AS "التصنيف",
        cc.monthly_target AS "التارغيت",
        (SELECT MAX(v2.visit_date) FROM visits v2
          WHERE v2.customer_id = c.id AND v2.deleted_at IS NULL) AS "آخر زيارة"
      FROM customer_assignments ca
      JOIN customers c  ON c.id = ca.customer_id
      JOIN users u      ON u.id = ca.user_id
      LEFT JOIN specialities s     ON s.id  = c.speciality_id
      LEFT JOIN provinces p        ON p.id  = c.province_id
      LEFT JOIN areas a            ON a.id  = c.area_id
      LEFT JOIN customer_classes cc ON cc.id = c.class_id
      WHERE ca.is_active AND c.deleted_at IS NULL AND c.status = 'approved'
        ${userSql}
        ${range.provinceId ? Prisma.sql`AND c.province_id = ${range.provinceId}` : Prisma.empty}
        ${range.customerType ? Prisma.sql`AND c.customer_type = ${range.customerType}::"CustomerType"` : Prisma.empty}
        AND NOT EXISTS (
          SELECT 1 FROM visits v
          WHERE v.customer_id = c.id AND v.user_id = ca.user_id
            AND v.deleted_at IS NULL AND v.visit_date BETWEEN ${from} AND ${to}
        )
      ORDER BY u.full_name_en, cc.sort_order NULLS LAST, c.name_ar
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٣ · تحقيق التارغيت
  // ════════════════════════════════════════════════════════════════

  async targetAchievement(user: AuthUser, range: ReportRange) {
    const ready = await this.prisma.customerClass.count({ where: { monthlyTarget: { gt: 0 } } });
    if (ready === 0) {
      throw new BadRequestException(
        'تارغيت التصنيفات غير مضبوط. اضبط A1…C2 من إعدادات القوائم أولاً',
      );
    }

    const ids = await this.scope.visibleUserIds(user, 'reports');
    const effective = range.userId ? [range.userId] : ids;
    const userSql = effective === null ? Prisma.empty : Prisma.sql`AND ca.user_id IN (${Prisma.join(effective)})`;
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');

    // عدد الأشهر في الفترة — التارغيت شهري فيُضرب بها
    const months = Prisma.sql`
      GREATEST(1, (DATE_PART('year', ${to}::date) - DATE_PART('year', ${from}::date)) * 12
                + (DATE_PART('month', ${to}::date) - DATE_PART('month', ${from}::date)) + 1)
    `;

    return this.prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(u.full_name_ar, u.full_name_en)   AS "المندوب",
        d.name_en                                   AS "القسم",
        COALESCE(m.full_name_ar, m.full_name_en)    AS "المدير",
        COUNT(DISTINCT c.id)::int                   AS "عدد العملاء",
        SUM(cc.monthly_target * ${months})::int     AS "التارغيت المخطط",
        COALESCE(SUM(vc.cnt), 0)::int               AS "الزيارات المنفّذة",
        CASE WHEN SUM(cc.monthly_target * ${months}) = 0 THEN 0
             ELSE ROUND(COALESCE(SUM(vc.cnt), 0) * 100.0 / SUM(cc.monthly_target * ${months}), 1)
        END                                         AS "نسبة التحقيق %"
      FROM customer_assignments ca
      JOIN customers c  ON c.id = ca.customer_id AND c.deleted_at IS NULL AND c.status = 'approved'
      JOIN customer_classes cc ON cc.id = c.class_id AND cc.monthly_target > 0
      JOIN users u      ON u.id = ca.user_id AND u.is_active AND u.deleted_at IS NULL
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN users m       ON m.id = u.manager_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM visits v
        WHERE v.customer_id = c.id AND v.user_id = ca.user_id
          AND v.deleted_at IS NULL AND v.visit_date BETWEEN ${from} AND ${to}
      ) vc ON TRUE
      WHERE ca.is_active
        ${userSql}
        ${range.provinceId ? Prisma.sql`AND c.province_id = ${range.provinceId}` : Prisma.empty}
      GROUP BY u.id, u.full_name_ar, u.full_name_en, d.name_en, m.full_name_ar, m.full_name_en
      ORDER BY "نسبة التحقيق %" ASC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٤ · التكرار حسب التصنيف
  // ════════════════════════════════════════════════════════════════

  async frequencyByClass(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(v.snap_class_code, 'بلا تصنيف')  AS "التصنيف",
        v.snap_class_letter                        AS "الفئة",
        MAX(v.snap_monthly_target)                 AS "التارغيت الشهري",
        COUNT(DISTINCT v.customer_id)::int         AS "عدد العملاء",
        COUNT(*)::int                              AS "عدد الزيارات",
        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT v.customer_id), 0), 2) AS "متوسط الزيارات للعميل"
      FROM visits v
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.deleted_at IS NULL
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY v.snap_class_code, v.snap_class_letter
      ORDER BY v.snap_class_code NULLS LAST
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٥ · المنتجات
  // ════════════════════════════════════════════════════════════════

  async products(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        p.code                AS "الكود",
        p.short_name          AS "المنتج",
        p.name_ar             AS "الاسم العربي",
        pc.name_ar            AS "الفئة",
        COUNT(*) FILTER (WHERE vp.role = 'main')::int     AS "أساسي",
        COUNT(*) FILTER (WHERE vp.role = 'reminder')::int AS "تذكيري",
        COUNT(*) FILTER (WHERE vp.role = 'sample')::int   AS "نموذج مجاني",
        COUNT(*)::int                                      AS "الإجمالي",
        COUNT(DISTINCT v.customer_id)::int                 AS "عدد العملاء",
        COUNT(DISTINCT v.user_id)::int                     AS "عدد المندوبين"
      FROM visit_products vp
      JOIN visits v   ON v.id = vp.visit_id AND v.deleted_at IS NULL
      JOIN products p ON p.id = vp.product_id
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE TRUE
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY p.id, p.code, p.short_name, p.name_ar, pc.name_ar, p.sort_order
      ORDER BY "الإجمالي" DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٦ · النماذج المجانية — رقابة مالية
  // ════════════════════════════════════════════════════════════════

  async samples(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        v.snap_user_name                   AS "المندوب",
        v.snap_manager_name                AS "المدير",
        TO_CHAR(v.visit_date, 'YYYY-MM')   AS "الشهر",
        p.short_name                       AS "المنتج",
        COUNT(*)::int                      AS "عدد المرات",
        COALESCE(SUM(v.sample_quantity), 0)::int AS "إجمالي الكمية",
        ROUND(AVG(v.sample_quantity), 1)   AS "متوسط الكمية",
        MAX(v.sample_quantity)             AS "أعلى كمية"
      FROM visits v
      JOIN visit_products vp ON vp.visit_id = v.id AND vp.role = 'sample'
      JOIN products p        ON p.id = vp.product_id
      LEFT JOIN customers c  ON c.id = v.customer_id
      WHERE v.deleted_at IS NULL
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY v.snap_user_name, v.snap_manager_name, TO_CHAR(v.visit_date, 'YYYY-MM'), p.short_name
      ORDER BY "إجمالي الكمية" DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٧ · المواد الدعائية
  // ════════════════════════════════════════════════════════════════

  async promo(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(NULLIF(TRIM(v.promo_text), ''), 'غير محدّد') AS "المادة",
        COUNT(*)::int                       AS "عدد المرات",
        COUNT(DISTINCT v.user_id)::int      AS "عدد المندوبين",
        COUNT(DISTINCT v.customer_id)::int  AS "عدد العملاء",
        MIN(v.visit_date)                   AS "أول استخدام",
        MAX(v.visit_date)                   AS "آخر استخدام"
      FROM visits v
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.deleted_at IS NULL AND v.promo_given
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY COALESCE(NULLIF(TRIM(v.promo_text), ''), 'غير محدّد')
      ORDER BY "عدد المرات" DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٨ · الأداء الهرمي
  // ════════════════════════════════════════════════════════════════

  async hierarchy(user: AuthUser, range: ReportRange) {
    const ids = await this.scope.visibleUserIds(user, 'reports');
    const rootSql = ids === null
      ? Prisma.sql`WHERE u.manager_id IS NULL AND u.deleted_at IS NULL`
      : Prisma.sql`WHERE u.id IN (${Prisma.join(ids)}) AND u.deleted_at IS NULL`;
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');

    // لكل مستخدم: زياراته + زيارات كل من تحته بأي عمق
    return this.prisma.$queryRaw<any[]>`
      WITH RECURSIVE tree AS (
        SELECT u.id AS root_id, u.id AS member_id, 0 AS depth
        FROM users u
        ${rootSql}
        UNION ALL
        SELECT t.root_id, c.id, t.depth + 1
        FROM tree t
        JOIN users c ON c.manager_id = t.member_id AND c.deleted_at IS NULL
      )
      SELECT
        COALESCE(u.full_name_ar, u.full_name_en)  AS "المسؤول",
        pos.name_en                                AS "المنصب",
        d.name_en                                  AS "القسم",
        (COUNT(DISTINCT t.member_id) - 1)::int     AS "حجم الفريق",
        COUNT(v.id)::int                           AS "إجمالي الزيارات",
        COUNT(DISTINCT v.customer_id)::int         AS "عملاء مختلفون",
        COUNT(DISTINCT v.user_id)::int             AS "مندوبون نشطون",
        ROUND(COUNT(v.id)::numeric / NULLIF(COUNT(DISTINCT t.member_id) - 1, 0), 1) AS "متوسط الزيارات للفرد"
      FROM tree t
      JOIN users u ON u.id = t.root_id
      LEFT JOIN positions pos  ON pos.id = u.position_id
      LEFT JOIN departments d  ON d.id = u.department_id
      LEFT JOIN visits v ON v.user_id = t.member_id
                        AND v.deleted_at IS NULL
                        AND v.visit_date BETWEEN ${from} AND ${to}
      GROUP BY u.id, u.full_name_ar, u.full_name_en, pos.name_en, pos.level, d.name_en
      HAVING COUNT(DISTINCT t.member_id) > 1
      ORDER BY pos.level DESC NULLS LAST, "إجمالي الزيارات" DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ٩ · خارج القائمة
  // ════════════════════════════════════════════════════════════════

  async outOfList(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        c.code       AS "كود العميل",
        c.name_ar    AS "اسم العميل",
        CASE c.customer_type WHEN 'doctor' THEN 'طبيب' ELSE 'صيدلية' END AS "النوع",
        s.name_en    AS "الاختصاص",
        p.name_ar    AS "المحافظة",
        a.name_ar    AS "المنطقة",
        CASE c.status
          WHEN 'pending'  THEN 'بانتظار الموافقة'
          WHEN 'approved' THEN 'معتمد'
          WHEN 'rejected' THEN 'مرفوض'
          ELSE 'غير نشط' END AS "الحالة",
        v.snap_user_name AS "اكتشفه",
        MIN(v.visit_date) AS "أول زيارة",
        COUNT(*)::int     AS "عدد الزيارات",
        STRING_AGG(DISTINCT v.visit_reason, ' | ') AS "أسباب الزيارة"
      FROM visits v
      JOIN customers c ON c.id = v.customer_id
      LEFT JOIN specialities s ON s.id = c.speciality_id
      LEFT JOIN provinces p    ON p.id = c.province_id
      LEFT JOIN areas a        ON a.id = c.area_id
      WHERE v.deleted_at IS NULL AND v.visit_type = 'out_list'
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY c.id, c.code, c.name_ar, c.customer_type, c.status,
               s.name_en, p.name_ar, a.name_ar, v.snap_user_name
      ORDER BY c.status, MIN(v.visit_date) DESC
    `;
  }

  // ════════════════════════════════════════════════════════════════
  //  ١٠ · الإنذارات — يكشف التقصير والتلاعب
  // ════════════════════════════════════════════════════════════════

  async alerts(user: AuthUser, range: ReportRange) {
    const ids = await this.scope.visibleUserIds(user, 'reports');
    const userSql = ids === null ? Prisma.empty : Prisma.sql`AND u.id IN (${Prisma.join(ids)})`;
    const scopeSql = await this.scopeSql(user, range);
    const from = this.parseDate(range.from, 'تاريخ البداية');
    const to = this.parseDate(range.to, 'تاريخ النهاية');

    const [inactive, sameDay, bulkEntry] = await Promise.all([
      // مندوب لم يسجّل منذ 3 أيام أو أكثر
      this.prisma.$queryRaw<any[]>`
        SELECT
          'مندوب متوقف' AS "نوع الإنذار",
          COALESCE(u.full_name_ar, u.full_name_en) AS "المندوب",
          COALESCE(m.full_name_ar, m.full_name_en) AS "المدير",
          COALESCE(MAX(v.visit_date)::text, 'لا زيارات إطلاقاً') AS "التفصيل",
          COALESCE(CURRENT_DATE - MAX(v.visit_date), 9999)::int  AS "القيمة"
        FROM users u
        LEFT JOIN users m ON m.id = u.manager_id
        LEFT JOIN visits v ON v.user_id = u.id AND v.deleted_at IS NULL
        JOIN positions pos ON pos.id = u.position_id AND pos.level = 0
        WHERE u.is_active AND u.deleted_at IS NULL
          ${userSql}
        GROUP BY u.id, u.full_name_ar, u.full_name_en, m.full_name_ar, m.full_name_en
        HAVING COALESCE(CURRENT_DATE - MAX(v.visit_date), 9999) >= 3
        ORDER BY "القيمة" DESC
      `,
      // أكثر من 25 زيارة في يوم واحد — غير واقعي ميدانياً
      this.prisma.$queryRaw<any[]>`
        SELECT
          'عدد زيارات مرتفع في يوم' AS "نوع الإنذار",
          v.snap_user_name           AS "المندوب",
          v.snap_manager_name        AS "المدير",
          v.visit_date::text         AS "التفصيل",
          COUNT(*)::int              AS "القيمة"
        FROM visits v
        LEFT JOIN customers c ON c.id = v.customer_id
        WHERE v.deleted_at IS NULL
          ${this.dateSql(range)}
          ${scopeSql}
        GROUP BY v.snap_user_name, v.snap_manager_name, v.visit_date
        HAVING COUNT(*) > 25
        ORDER BY COUNT(*) DESC
      `,
      // زيارات كثيرة سُجّلت في دفعة واحدة خلال 10 دقائق
      this.prisma.$queryRaw<any[]>`
        SELECT
          'تسجيل دفعة واحدة' AS "نوع الإنذار",
          v.snap_user_name    AS "المندوب",
          v.snap_manager_name AS "المدير",
          TO_CHAR(DATE_TRUNC('hour', v.recorded_at AT TIME ZONE 'Asia/Baghdad'), 'YYYY-MM-DD HH24:00') AS "التفصيل",
          COUNT(*)::int       AS "القيمة"
        FROM visits v
        LEFT JOIN customers c ON c.id = v.customer_id
        WHERE v.deleted_at IS NULL
          ${this.dateSql(range)}
          ${scopeSql}
        GROUP BY v.snap_user_name, v.snap_manager_name,
                 DATE_TRUNC('hour', v.recorded_at AT TIME ZONE 'Asia/Baghdad')
        HAVING COUNT(*) > 20
        ORDER BY COUNT(*) DESC
      `,
    ]);

    return [...inactive, ...sameDay, ...bulkEntry];
  }

  // ════════════════════════════════════════════════════════════════
  //  ١١ · الاتجاه الشهري
  // ════════════════════════════════════════════════════════════════

  async monthlyTrend(user: AuthUser, range: ReportRange) {
    const scopeSql = await this.scopeSql(user, range);

    return this.prisma.$queryRaw<any[]>`
      SELECT
        TO_CHAR(v.visit_date, 'YYYY-MM')   AS "الشهر",
        COUNT(*)::int                       AS "الزيارات",
        COUNT(DISTINCT v.user_id)::int      AS "مندوبون نشطون",
        COUNT(DISTINCT v.customer_id)::int  AS "عملاء مختلفون",
        COUNT(*) FILTER (WHERE v.visit_type = 'in_list')::int  AS "داخل القائمة",
        COUNT(*) FILTER (WHERE v.visit_type = 'out_list')::int AS "خارج القائمة",
        COALESCE(SUM(v.sample_quantity), 0)::int               AS "النماذج المجانية",
        COUNT(*) FILTER (WHERE v.promo_given)::int             AS "مواد دعائية",
        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT v.user_id), 0), 1) AS "متوسط للمندوب"
      FROM visits v
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.deleted_at IS NULL
        ${this.dateSql(range)}
        ${scopeSql}
        ${this.filtersSql(range)}
      GROUP BY TO_CHAR(v.visit_date, 'YYYY-MM')
      ORDER BY 1
    `;
  }

  // ════════════════════════════════════════════════════════════════

  async run(user: AuthUser, key: string, range: ReportRange): Promise<any[]> {
    switch (key) {
      case 'visits_detail':   return this.visitsDetail(user, range);
      case 'coverage':        return this.coverage(user, range);
      case 'target':          return this.targetAchievement(user, range);
      case 'frequency_class': return this.frequencyByClass(user, range);
      case 'products':        return this.products(user, range);
      case 'samples':         return this.samples(user, range);
      case 'promo':           return this.promo(user, range);
      case 'hierarchy':       return this.hierarchy(user, range);
      case 'out_of_list':     return this.outOfList(user, range);
      case 'alerts':          return this.alerts(user, range);
      case 'monthly_trend':   return this.monthlyTrend(user, range);
      default:
        throw new BadRequestException(`تقرير غير معروف: ${key}`);
    }
  }
}
