/**
 * زرع قاعدة البيانات
 * ────────────────────────────────────────────────────────────────
 * idempotent — يمكن تشغيله مراراً بلا تكرار (upsert لكل شيء)
 *
 * تشغيل:  npm run prisma:seed        (من apps/api)
 *         SEED_USERS=0 npm run prisma:seed   ← بلا مستخدمين
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const SEED_USERS = process.env.SEED_USERS !== '0';
const USERS_JSON = path.resolve(__dirname, '../../../data/output/users.json');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data', f), 'utf8'));
const lookups = read('lookups.json');
const products = read('products.json');

/** تطبيع النص للبحث: يوحّد الألف والهاء والياء ويزيل التشكيل */
export function normalize(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD')                    // يفكّ الحروف المركّبة (İ ← i + نقطة)
    .replace(/\p{M}+/gu, '')             // يزيل كل العلامات: تشكيل عربي + علامات لاتينية
    .toLowerCase()
    .replace(/[آأإٱ]/g, 'ا')  // آ أ إ ٱ ← ا
    .replace(/ة/g, 'ه')                        // ة ← ه
    .replace(/ى/g, 'ي')                        // ى ← ي
    .replace(/ـ/g, '')                              // التطويل
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))  // ٠-٩ ← 0-9
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ════════════════════════════════════════════════════════════════
//  كتالوج الأذونات
// ════════════════════════════════════════════════════════════════
const PERMISSIONS = [
  ['visits.create',            'visits',    'تسجيل زيارة',                    'Create visit'],
  ['visits.view_own',          'visits',    'عرض زياراتي',                    'View own visits'],
  ['visits.view_team',         'visits',    'عرض زيارات الفريق',              'View team visits'],
  ['visits.view_all',          'visits',    'عرض كل الزيارات',                'View all visits'],
  ['visits.edit',              'visits',    'تعديل زيارة محفوظة',             'Edit locked visit'],
  ['visits.delete',            'visits',    'حذف زيارة',                      'Delete visit'],
  ['visits.import',            'visits',    'استيراد زيارات من Excel',        'Import visits'],
  ['corrections.request',      'visits',    'طلب تصحيح زيارة',                'Request correction'],
  ['corrections.approve',      'visits',    'الموافقة على طلبات التصحيح',      'Approve corrections'],

  ['customers.view_own',       'customers', 'عرض قائمتي',                     'View own list'],
  ['customers.view_team',      'customers', 'عرض قوائم الفريق',               'View team lists'],
  ['customers.view_all',       'customers', 'عرض كل العملاء',                 'View all customers'],
  ['customers.create',         'customers', 'إضافة عميل',                     'Create customer'],
  ['customers.edit',           'customers', 'تعديل عميل',                     'Edit customer'],
  ['customers.delete',         'customers', 'حذف عميل',                       'Delete customer'],
  ['customers.approve',        'customers', 'الموافقة على طلبات العملاء',      'Approve customer requests'],
  ['customers.assign',         'customers', 'إسناد عميل لمندوب',              'Assign customer'],
  ['customers.import',         'customers', 'استيراد عملاء من Excel',          'Import customers'],

  ['reports.view_own',         'reports',   'تقاريري',                        'Own reports'],
  ['reports.view_team',        'reports',   'تقارير الفريق',                  'Team reports'],
  ['reports.view_all',         'reports',   'كل التقارير',                    'All reports'],
  ['reports.export',           'reports',   'تصدير Excel',                    'Export Excel'],

  ['users.view',               'users',     'عرض المستخدمين',                 'View users'],
  ['users.create',             'users',     'إنشاء مستخدم',                   'Create user'],
  ['users.edit',               'users',     'تعديل مستخدم',                   'Edit user'],
  ['users.deactivate',         'users',     'تعطيل مستخدم',                   'Deactivate user'],
  ['users.reset_password',     'users',     'تصفير كلمة مرور',                'Reset password'],
  ['users.manage_permissions', 'users',     'إدارة الصلاحيات',                'Manage permissions'],
  ['users.import',             'users',     'استيراد مستخدمين',               'Import users'],

  ['targets.view',             'targets',   'عرض التارغيت',                   'View targets'],
  ['targets.manage',           'targets',   'إدارة التارغيت',                 'Manage targets'],

  ['catalog.manage_products',  'settings',  'إدارة المنتجات',                 'Manage products'],
  ['catalog.manage_geography', 'settings',  'إدارة المحافظات والمناطق',        'Manage geography'],
  ['catalog.manage_classes',   'settings',  'إدارة التصنيفات',                'Manage classes'],
  ['catalog.manage_lookups',   'settings',  'إدارة القوائم المرجعية',          'Manage lookups'],
  ['settings.manage',          'settings',  'إعدادات النظام',                 'System settings'],
  ['audit.view',               'settings',  'سجل التدقيق',                    'View audit log'],
];

const ROLE_PERMISSIONS = {
  super_admin: '*',
  admin: PERMISSIONS.map(([k]) => k).filter((k) => k !== 'settings.manage'),
  manager: [
    'visits.create', 'visits.view_own', 'visits.view_team', 'corrections.approve', 'corrections.request',
    'customers.view_own', 'customers.view_team', 'customers.create', 'customers.approve', 'customers.assign',
    'reports.view_own', 'reports.view_team', 'reports.export',
    'users.view', 'targets.view', 'targets.manage',
  ],
  team_leader: [
    'visits.create', 'visits.view_own', 'visits.view_team', 'corrections.approve', 'corrections.request',
    'customers.view_own', 'customers.view_team', 'customers.create', 'customers.approve',
    'reports.view_own', 'reports.view_team', 'reports.export', 'targets.view',
  ],
  representative: [
    'visits.create', 'visits.view_own', 'corrections.request',
    'customers.view_own', 'customers.create',
    'reports.view_own', 'targets.view',
  ],
  viewer: ['visits.view_all', 'customers.view_all', 'reports.view_all', 'reports.view_own'],
};

const APP_SETTINGS = [
  ['visit.allow_future_date',    false, 'السماح بتسجيل زيارة بتاريخ مستقبلي'],
  ['visit.max_backdate_days',    30,    'أقصى عدد أيام للتسجيل بأثر رجعي'],
  ['visit.max_reminder_products', 3,    'أقصى عدد منتجات تذكيرية في الزيارة'],
  ['visit.max_sample_products',   3,    'أقصى عدد نماذج مجانية في الزيارة'],
  ['visit.duplicate_warn_days',   3,    'تحذير عند زيارة نفس العميل خلال هذا العدد من الأيام'],
  ['promo.enforce_list',         false, 'إلزام اختيار المادة الدعائية من قائمة بدل الكتابة الحرة'],
  ['security.max_login_attempts', 5,    'عدد محاولات الدخول قبل القفل'],
  ['security.lockout_minutes',    15,   'مدة القفل بالدقائق'],
];

// ════════════════════════════════════════════════════════════════

async function seedLookups() {
  console.log('\n📚 القوائم المرجعية');

  for (const r of lookups.roles) {
    await prisma.role.upsert({ where: { key: r.key }, update: r, create: r });
  }
  console.log(`   ✓ ${lookups.roles.length} أدوار`);

  for (const [key, group, nameAr, nameEn] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { group, nameAr, nameEn },
      create: { key, group, nameAr, nameEn },
    });
  }
  console.log(`   ✓ ${PERMISSIONS.length} إذناً`);

  const allPerms = await prisma.permission.findMany();
  const permId = new Map(allPerms.map((p) => [p.key, p.id]));

  for (const [roleKey, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUnique({ where: { key: roleKey } });
    const list = keys === '*' ? allPerms.map((p) => p.key) : keys;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: list.map((k) => ({ roleId: role.id, permissionId: permId.get(k) })).filter((x) => x.permissionId),
      skipDuplicates: true,
    });
    console.log(`   ✓ ${roleKey.padEnd(16)} → ${list.length} إذناً`);
  }

  for (const d of lookups.departments) {
    await prisma.department.upsert({ where: { nameEn: d.nameEn }, update: d, create: d });
  }
  for (const o of lookups.offices) {
    await prisma.office.upsert({ where: { nameEn: o.nameEn }, update: o, create: o });
  }
  console.log(`   ✓ ${lookups.departments.length} أقسام · ${lookups.offices.length} مكاتب`);

  for (const p of lookups.provinces) {
    await prisma.province.upsert({ where: { nameAr: p.nameAr }, update: p, create: p });
  }
  console.log(`   ✓ ${lookups.provinces.length} محافظة`);

  for (const s of lookups.specialities) {
    await prisma.speciality.upsert({ where: { nameEn: s.nameEn }, update: s, create: s });
  }
  console.log(`   ✓ ${lookups.specialities.length} اختصاصاً`);

  for (const c of lookups.customerClasses) {
    await prisma.customerClass.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  const zeroTargets = await prisma.customerClass.count({ where: { monthlyTarget: 0 } });
  console.log(`   ✓ ${lookups.customerClasses.length} تصنيفاً`);
  if (zeroTargets) {
    console.log(`   ⚠️  ${zeroTargets} تصنيفاً بتارغيت 0 — بانتظار أرقام العميل`);
  }

  for (const [key, value, description] of APP_SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { description },
      create: { key, value, description },
    });
  }
  console.log(`   ✓ ${APP_SETTINGS.length} إعداداً`);
}

async function seedProducts() {
  console.log('\n💊 المنتجات');

  for (const c of lookups.productCategories) {
    await prisma.productCategory.upsert({ where: { key: c.key }, update: c, create: c });
  }

  const cats = await prisma.productCategory.findMany();
  const catId = new Map(cats.map((c) => [c.key, c.id]));

  let aliasCount = 0;
  for (const p of products) {
    const { aliases, categoryKey, ...data } = p;
    const product = await prisma.product.upsert({
      where: { code: p.code },
      update: { ...data, categoryId: catId.get(categoryKey) },
      create: { ...data, categoryId: catId.get(categoryKey) },
    });

    // الاسم المختصر والعربي يدخلان كأسماء بديلة تلقائياً
    const all = new Set([...(aliases || []), p.shortName, p.nameAr].filter(Boolean));
    for (const alias of all) {
      const norm = normalize(alias);
      if (!norm) continue;
      await prisma.productAlias.upsert({
        where: { normalized: norm },
        update: { productId: product.id, alias },
        create: { productId: product.id, alias, normalized: norm },
      });
      aliasCount++;
    }
  }
  console.log(`   ✓ ${products.length} منتجاً في ${cats.length} فئات`);
  console.log(`   ✓ ${aliasCount} اسماً بديلاً — يحوّل الصيغ النصية إلى منتج واحد`);
}

async function seedUsers() {
  if (!SEED_USERS) return console.log('\n👤 المستخدمون — تُخُطّي (SEED_USERS=0)');

  console.log('\n👤 المستخدمون');

  if (!fs.existsSync(USERS_JSON)) {
    console.log(`   ⚠️  ${USERS_JSON} غير موجود`);
    console.log(`      شغّل أولاً:  node scripts/import/build-users.mjs`);
    return;
  }

  const list = JSON.parse(fs.readFileSync(USERS_JSON, 'utf8'));

  const [roles, deps, offices, provs] = await Promise.all([
    prisma.role.findMany(), prisma.department.findMany(),
    prisma.office.findMany(), prisma.province.findMany(),
  ]);
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  const depId = new Map(deps.map((d) => [d.nameEn, d.id]));
  const offId = new Map(offices.map((o) => [o.nameEn, o.id]));
  const provByNorm = new Map(provs.map((p) => [normalize(p.nameAr), p.id]));
  const provAlias = new Map(
    Object.entries(lookups.provinceAliases).map(([k, v]) => [normalize(k), v]),
  );

  // المناصب: تُنشأ من بيانات المستخدمين
  const positions = new Map();
  for (const u of list) {
    if (!u.position) continue;
    const key = `${u.position}|${u.department ?? ''}`;
    if (positions.has(key)) continue;
    const departmentId = depId.get(u.department) ?? null;

    // upsert لا يقبل null في مفتاح مركّب (departmentId اختياري لمنصب
    // مثل CEO)، لذا نبحث أولاً ثم ننشئ أو نحدّث.
    const existing = await prisma.position.findFirst({
      where: { nameEn: u.position, departmentId },
    });

    const pos = existing
      ? await prisma.position.update({
          where: { id: existing.id },
          data: { level: u.positionLevel },
        })
      : await prisma.position.create({
          data: {
            nameEn: u.position, nameAr: u.position,
            departmentId, level: u.positionLevel,
          },
        });

    positions.set(key, pos.id);
  }
  console.log(`   ✓ ${positions.size} منصباً`);

  // تمريرة ١: إنشاء الحسابات بلا مدير
  let created = 0, updated = 0;
  for (const u of list) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    const data = {
      username: u.username,
      legacyUserId: u.legacyUserId,
      fullNameEn: u.fullNameEn,
      departmentId: depId.get(u.department) ?? null,
      positionId: positions.get(`${u.position}|${u.department ?? ''}`) ?? null,
      officeId: offId.get(u.office) ?? null,
      roleId: roleId.get(u.role) ?? roleId.get('representative'),
      isActive: u.isActive,
    };
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      // كلمة المرور الأولى = UserID  (قرار العميل: نفس ما يحفظه المندوب)
      await prisma.user.create({
        data: { ...data, passwordHash: await bcrypt.hash(u.initialPassword, ROUNDS) },
      });
      created++;
    }
  }
  console.log(`   ✓ ${created} حساباً جديداً · ${updated} محدّثاً`);

  // تمريرة ٢: ربط الهرم الإداري
  const dbUsers = await prisma.user.findMany({ select: { id: true, fullNameEn: true } });
  const userId = new Map(dbUsers.map((u) => [u.fullNameEn, u.id]));

  let linked = 0;
  for (const u of list) {
    if (!u.managerName) continue;
    const mid = userId.get(u.managerName);
    if (!mid) continue;
    await prisma.user.update({
      where: { username: u.username },
      data: { managerId: mid },
    });
    linked++;
  }
  console.log(`   ✓ ${linked} رابط هرمي`);

  // تمريرة ٣: مناطق المندوبين
  let terr = 0, unknownCities = new Set();
  for (const u of list) {
    if (!u.cities?.length) continue;
    const uid = userId.get(u.fullNameEn);
    for (const city of u.cities) {
      const norm = normalize(city);
      const canonical = provAlias.get(norm);
      const pid = provByNorm.get(normalize(canonical ?? city));
      if (!pid) { unknownCities.add(city); continue; }
      // areaId فارغ يعني "كل مناطق المحافظة"، و upsert لا يقبل null
      // في مفتاح مركّب — فنبحث أولاً.
      const exists = await prisma.userTerritory.findFirst({
        where: { userId: uid, provinceId: pid, areaId: null },
      });
      if (!exists) {
        await prisma.userTerritory.create({ data: { userId: uid, provinceId: pid } });
        terr++;
      }
    }
  }
  console.log(`   ✓ ${terr} إسناد منطقة`);
  if (unknownCities.size) {
    console.log(`   ⚠️  مدن غير معروفة: ${[...unknownCities].join('، ')}`);
  }

  const sa = await prisma.user.findFirst({
    where: { role: { key: 'super_admin' } },
    select: { fullNameEn: true, username: true },
  });
  if (sa) console.log(`   ★ Super Admin: ${sa.fullNameEn} — ${sa.username}`);
}

async function main() {
  console.log('═'.repeat(64));
  console.log('  زرع قاعدة بيانات نظام الزيارات — Dawaa Al Hayat');
  console.log('═'.repeat(64));

  await seedLookups();
  await seedProducts();
  await seedUsers();

  const counts = {
    'مستخدمون': await prisma.user.count(),
    'أدوار': await prisma.role.count(),
    'أذونات': await prisma.permission.count(),
    'منتجات': await prisma.product.count(),
    'أسماء بديلة': await prisma.productAlias.count(),
    'محافظات': await prisma.province.count(),
    'اختصاصات': await prisma.speciality.count(),
    'تصنيفات': await prisma.customerClass.count(),
  };

  console.log('\n' + '═'.repeat(64));
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log('═'.repeat(64) + '\n');
}

main()
  .catch((e) => { console.error('\n❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
