/**
 * بناء قائمة المستخدمين من AuthUsers.xlsx
 * ────────────────────────────────────────────────────────────────
 * - يولّد اسم مستخدم = <UserID>@dawaa-alhayat
 * - كلمة المرور الأولى = UserID  (كما طلب العميل: نفس ما يحفظه المندوب)
 * - يحلّ الأخطاء الإملائية في Direct_Manager إلى manager_id حقيقي
 * - يولّد UserID جديداً لأي تكرار
 * - ينشئ حسابات معطّلة للمدراء غير الموجودين في الملف
 *
 * المخرج:  data/output/users-review.xlsx   ← للمراجعة قبل الاستيراد الفعلي
 *          data/output/users.json          ← مدخل سكربت الاستيراد
 *
 * تشغيل:  node scripts/import/build-users.mjs
 */

import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const SUFFIX = '@dawaa-alhayat';
const SRC = process.argv[2] || 'data/source/AuthUsers.xlsx';
const OUT_DIR = 'data/output';

// ── تصحيحات أسماء المدراء المؤكدة (وافق عليها العميل) ────────────
const MANAGER_FIXES = {
  'Salam Sadoon': 'Salam Saadon',
  'Hawsar Saleh': 'Hawser Salih',
  'Mohammed Abdulkadir': 'Mohammed Abdulkader',
  'Bashir saleh': 'Bashir Salih',
  'Tuqa Mounir': 'Tuqa Munir Alatrash',
};

// ── حسابات مدراء غير موجودين في الملف — تُنشأ معطّلة ──────────────
const PLACEHOLDER_MANAGERS = [
  { name: 'CEO',           department: null,      position: 'CEO',           manager: null },
  { name: 'Nareen abdin',  department: 'Sales',   position: 'Sales Team Leader', manager: 'Sales Manager' },
  { name: 'Omar Samir',    department: 'Sales',   position: 'Sales Team Leader', manager: 'Sales Manager' },
  { name: 'Sales Manager', department: 'Sales',   position: 'Sales Manager', manager: 'CEO' },
];

// من يترأس الهرم ويحمل صلاحية Super Admin
const SUPER_ADMIN_NAME = 'Bashir Salih';

// ── أدوات ────────────────────────────────────────────────────────
const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function normId(v) {
  const s = clean(v);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** توليد UserID جديد من 10 خانات لا يصطدم بالموجود */
function generateUserId(taken) {
  let id;
  do {
    id = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));
  } while (taken.has(id));
  taken.add(id);
  return id;
}

/** استنتاج الدور من المنصب */
function roleFromPosition(position, name) {
  if (name === SUPER_ADMIN_NAME) return 'super_admin';
  const p = clean(position).toLowerCase();
  if (!p) return 'representative';
  if (p.includes('ceo')) return 'admin';
  if (p.includes('manager')) return 'manager';
  if (p.includes('team leader') || p.includes('supervisor')) return 'team_leader';
  return 'representative';
}

/** مستوى المنصب في الهرم */
function levelFromPosition(position) {
  const p = clean(position).toLowerCase();
  if (p.includes('ceo')) return 5;
  if (p.includes('manager') && !p.includes('area')) return 4;
  if (p.includes('area')) return 3;
  if (p.includes('team leader')) return 2;
  if (p.includes('supervisor')) return 1;
  return 0;
}

/** توحيد كتابة المنصب (Sale Representative / Sales Representatives / …) */
function canonicalPosition(position) {
  const p = clean(position).replace(/\s+/g, ' ');
  if (!p) return null;
  const l = p.toLowerCase();
  if (l.startsWith('sale') && l.includes('representative')) return 'Sales Representative';
  if (l.includes('sale') && l.includes('supervisor')) return 'Sales Supervisor';
  if (l.includes('promotion') && l.includes('representative')) return 'Promotion Representative';
  return p;
}

/** تقسيم City إلى قائمة محافظات */
function splitCities(city) {
  return clean(city)
    .split(/[,،]/)
    .map((c) => c.trim())
    .filter((c) => c && c.toLowerCase() !== 'iraq');
}

// ── قراءة الملف ──────────────────────────────────────────────────
if (!fs.existsSync(SRC)) {
  console.error(`\n❌ الملف غير موجود: ${SRC}`);
  console.error(`   انسخ AuthUsers.xlsx إلى data/source/ ثم أعد التشغيل.\n`);
  process.exit(1);
}

const wb = XLSX.readFile(SRC);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const raw = rows.filter((r) => clean(r.Name) || clean(r.UserID));

console.log(`\n📖 قُرئ ${raw.length} صفاً من ${SRC}\n`);

// ── المرحلة ١: توليد أسماء المستخدمين وحل التكرار ────────────────
const takenIds = new Set();
const notes = [];
const users = [];

for (const r of raw) {
  const name = clean(r.Name);
  let userId = normId(r.UserID);
  let note = '';

  if (!userId) {
    userId = generateUserId(takenIds);
    note = 'UserID مفقود — وُلّد جديد';
  } else if (takenIds.has(userId)) {
    const old = userId;
    userId = generateUserId(takenIds);
    note = `UserID ${old} مكرر — وُلّد جديد`;
    notes.push({ type: 'duplicate', name, detail: `${old} → ${userId}` });
  } else {
    takenIds.add(userId);
  }

  if (/^\d{1,7}$/.test(userId) || !/^\d+$/.test(userId)) {
    notes.push({ type: 'weak_password', name, detail: `كلمة مرور ضعيفة: ${userId}` });
  }

  users.push({
    name,
    legacyUserId: userId,
    username: userId + SUFFIX,
    password: userId,
    department: clean(r.Department) || null,
    position: canonicalPosition(r.Position),
    managerRaw: clean(r.Direct_Manager) || null,
    cities: splitCities(r.City),
    office: clean(r.Office) || null,
    isPlaceholder: false,
    note,
  });
}

// ── المرحلة ٢: إنشاء حسابات المدراء الناقصين ─────────────────────
const byName = new Map(users.map((u) => [u.name, u]));

for (const ph of PLACEHOLDER_MANAGERS) {
  if (byName.has(ph.name)) continue;
  const userId = generateUserId(takenIds);
  const u = {
    name: ph.name,
    legacyUserId: userId,
    username: userId + SUFFIX,
    password: userId,
    department: ph.department,
    position: ph.position,
    managerRaw: ph.manager,
    cities: [],
    office: null,
    isPlaceholder: true,
    isActive: false,
    note: 'حساب معطّل — مدير مذكور في الملف بلا صف خاص به',
  };
  users.push(u);
  byName.set(ph.name, u);
  notes.push({ type: 'placeholder', name: ph.name, detail: `أُنشئ معطّلاً — UserID ${userId}` });
}

// ── المرحلة ٣: حل الهرم الإداري ──────────────────────────────────
let resolved = 0;
const unresolved = [];

for (const u of users) {
  u.isActive = u.isActive ?? true;
  u.role = roleFromPosition(u.position, u.name);
  u.level = levelFromPosition(u.position);

  if (!u.managerRaw) {
    u.managerName = null;
    continue;
  }

  // تصحيح مباشر ← ثم مطابقة حرفية ← ثم مطابقة غير حساسة لحالة الأحرف
  let target = MANAGER_FIXES[u.managerRaw] || u.managerRaw;

  if (!byName.has(target)) {
    const ci = users.find((x) => x.name.toLowerCase() === target.toLowerCase());
    if (ci) target = ci.name;
  }

  if (byName.has(target)) {
    u.managerName = target;
    resolved++;
    if (target !== u.managerRaw) {
      notes.push({ type: 'manager_fixed', name: u.name, detail: `${u.managerRaw} → ${target}` });
    }
  } else {
    u.managerName = null;
    unresolved.push({ name: u.name, manager: u.managerRaw });
  }
}

// رأس الهرم لا يتبع نفسه
const sa = byName.get(SUPER_ADMIN_NAME);
if (sa) {
  sa.role = 'super_admin';
  if (sa.managerName === SUPER_ADMIN_NAME) sa.managerName = null;
}

// كشف الحلقات في الهرم
for (const u of users) {
  const seen = new Set([u.name]);
  let cur = u.managerName;
  while (cur) {
    if (seen.has(cur)) {
      notes.push({ type: 'cycle', name: u.name, detail: `حلقة في الهرم عند ${cur} — فُصلت` });
      u.managerName = null;
      break;
    }
    seen.add(cur);
    cur = byName.get(cur)?.managerName ?? null;
  }
}

// عدد التابعين المباشرين
const directReports = new Map();
for (const u of users) {
  if (u.managerName) directReports.set(u.managerName, (directReports.get(u.managerName) || 0) + 1);
}

// ── التقرير على الطرفية ──────────────────────────────────────────
const line = '─'.repeat(64);
console.log(line);
console.log(`  إجمالي الحسابات        : ${users.length}`);
console.log(`  منها معطّلة (placeholder): ${users.filter((u) => u.isPlaceholder).length}`);
console.log(`  مدير محلول             : ${resolved}`);
console.log(`  بلا مدير (رأس الهرم)    : ${users.filter((u) => !u.managerName).length}`);
console.log(`  مدير غير محلول          : ${unresolved.length}`);
console.log(line);

const byType = notes.reduce((a, n) => ((a[n.type] ??= []).push(n), a), {});
for (const [type, list] of Object.entries(byType)) {
  const label = {
    duplicate: '🔴 UserID مكرر',
    weak_password: '🟠 كلمة مرور ضعيفة',
    placeholder: '⚙️  حساب معطّل أُنشئ',
    manager_fixed: '✅ اسم مدير صُحّح',
    cycle: '🔴 حلقة في الهرم',
  }[type] || type;
  console.log(`\n${label}  (${list.length})`);
  for (const n of list.slice(0, 20)) console.log(`   • ${n.name} — ${n.detail}`);
  if (list.length > 20) console.log(`   … و${list.length - 20} أخرى`);
}
if (unresolved.length) {
  console.log(`\n🔴 مدراء لم يُحلّوا (${unresolved.length})`);
  for (const u of unresolved) console.log(`   • ${u.name} → "${u.manager}"`);
}

// ── كتابة المخرجات ───────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

const payload = users.map((u) => ({
  fullNameEn: u.name,
  legacyUserId: u.legacyUserId,
  username: u.username,
  initialPassword: u.password,
  department: u.department,
  position: u.position,
  positionLevel: u.level,
  role: u.role,
  managerName: u.managerName,
  cities: u.cities,
  office: u.office,
  isActive: u.isActive,
  isPlaceholder: u.isPlaceholder,
}));
fs.writeFileSync(path.join(OUT_DIR, 'users.json'), JSON.stringify(payload, null, 2), 'utf8');

// ── Excel للمراجعة ───────────────────────────────────────────────
const out = new ExcelJS.Workbook();
out.creator = 'Dawaa Al Hayat — Visits System';
out.created = new Date();

const ws = out.addWorksheet('الحسابات', { views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }] });
ws.columns = [
  { header: '#',              key: 'i',    width: 5 },
  { header: 'الاسم',           key: 'name', width: 26 },
  { header: 'اسم المستخدم',    key: 'user', width: 30 },
  { header: 'كلمة المرور',     key: 'pass', width: 16 },
  { header: 'القسم',           key: 'dep',  width: 14 },
  { header: 'المنصب',          key: 'pos',  width: 26 },
  { header: 'الصلاحية',        key: 'role', width: 18 },
  { header: 'المدير المباشر',   key: 'mgr',  width: 26 },
  { header: 'عدد التابعين',    key: 'subs', width: 12 },
  { header: 'المحافظات',       key: 'city', width: 34 },
  { header: 'المكتب',          key: 'off',  width: 34 },
  { header: 'مفعّل',           key: 'act',  width: 9 },
  { header: 'ملاحظة',          key: 'note', width: 46 },
];

const sorted = [...users].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
sorted.forEach((u, i) => {
  ws.addRow({
    i: i + 1,
    name: u.name,
    user: u.username,
    pass: u.password,
    dep: u.department || '—',
    pos: u.position || '—',
    role: u.role,
    mgr: u.managerName || '— (رأس الهرم)',
    subs: directReports.get(u.name) || 0,
    city: u.cities.join('، ') || '—',
    off: u.office || '—',
    act: u.isActive ? 'نعم' : 'لا',
    note: u.note || '',
  });
});

// تنسيق
const head = ws.getRow(1);
head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
head.alignment = { vertical: 'middle', horizontal: 'center' };
head.height = 26;

ws.eachRow((row, n) => {
  if (n === 1) return;
  const u = sorted[n - 2];
  if (!u.isActive) {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  } else if (u.role === 'super_admin') {
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    row.font = { bold: true };
  }
  if (u.note?.includes('مكرر') || /^\d{1,7}$/.test(u.password)) {
    row.getCell('pass').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };
  }
});
ws.autoFilter = { from: 'A1', to: 'M1' };

// ورقة الهرم
const hs = out.addWorksheet('الهرم الإداري', { views: [{ rightToLeft: true }] });
hs.columns = [{ header: 'الهيكل', key: 'tree', width: 70 }, { header: 'المنصب', key: 'pos', width: 30 }];
hs.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
hs.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };

const childrenOf = (name) => users.filter((u) => u.managerName === name).sort((a, b) => b.level - a.level);
(function walk(name, depth) {
  for (const c of childrenOf(name)) {
    hs.addRow({ tree: '   '.repeat(depth) + (depth ? '└─ ' : '') + c.name, pos: c.position || '—' });
    walk(c.name, depth + 1);
  }
})(null, 0);

// ورقة الملاحظات
const ns = out.addWorksheet('ملاحظات', { views: [{ rightToLeft: true }] });
ns.columns = [
  { header: 'النوع', key: 't', width: 22 },
  { header: 'الاسم', key: 'n', width: 28 },
  { header: 'التفصيل', key: 'd', width: 60 },
];
ns.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ns.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
for (const n of notes) ns.addRow({ t: n.type, n: n.name, d: n.detail });
for (const u of unresolved) ns.addRow({ t: 'unresolved_manager', n: u.name, d: `"${u.manager}" غير موجود` });

const xlsxPath = path.join(OUT_DIR, 'users-review.xlsx');
await out.xlsx.writeFile(xlsxPath);

console.log(`\n${line}`);
console.log(`✅ ${xlsxPath}`);
console.log(`✅ ${path.join(OUT_DIR, 'users.json')}`);
console.log(`${line}\n`);
