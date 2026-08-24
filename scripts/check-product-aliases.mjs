/**
 * فحص تغطية أسماء المنتجات البديلة
 * ────────────────────────────────────────────────────────────────
 * يمرّر كل صيغة نصية وردت في بيانات البوت القديم على جدول
 * product_aliases ويقيس نسبة المطابقة — بلا حاجة لقاعدة بيانات.
 *
 * تشغيل:  node scripts/check-product-aliases.mjs "D:/Downloads/تفريغ بيانات.xlsx"
 */

import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2];

function normalize(s) {
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

// قيم تعني "لا شيء" — ليست منتجات
const NOISE = new Set([
  '0', 'n', 'o', 'no', 'yes', 'yea', 'y', '.', '1', 'لا', 'نعم', 'تم', 'ج', 'ك', 'b', 'h', 'p',
  'none', 'null', 'na', 'كلا', 'ولا', 'لايوجد', 'لا يوجد',
]);

const products = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../apps/api/prisma/seed-data/products.json'), 'utf8'),
);

// بناء جدول البحث كما يبنيه seed.mjs
const lookup = new Map();
for (const p of products) {
  for (const a of new Set([...(p.aliases || []), p.shortName, p.nameAr].filter(Boolean))) {
    const n = normalize(a);
    if (n && !lookup.has(n)) lookup.set(n, p.shortName);
  }
}
console.log(`\n🔎 جدول البحث: ${lookup.size} اسماً بديلاً → ${products.length} منتجاً\n`);

/** مطابقة: تامة ← ثم احتواء (أطول اسم بديل يفوز) */
function match(raw) {
  const n = normalize(raw);
  if (!n || NOISE.has(n)) return { hit: null, noise: true };
  if (lookup.has(n)) return { hit: lookup.get(n), exact: true };
  let best = null, bestLen = 0;
  for (const [alias, name] of lookup) {
    if (alias.length > bestLen && (n.includes(alias) || alias.includes(n))) {
      if (alias.length < 3) continue;   // تجنّب مطابقات وهمية
      best = name; bestLen = alias.length;
    }
  }
  return { hit: best, exact: false };
}

if (!SRC || !fs.existsSync(SRC)) {
  console.log('اختبار سريع على عيّنة:\n');
  for (const s of ['B12', 'b 12', 'سليب ايد', 'prebioitc', 'الترا', 'i̇mmune booster',
                   'hair boster', 'bone', 'multivitamins plus', 'تم', 'p']) {
    const r = match(s);
    console.log(`  ${String(s).padEnd(22)} → ${r.noise ? '(ضجيج)' : r.hit ?? '❌ لا مطابقة'}`);
  }
  console.log('\nلقياس التغطية الكاملة، مرّر مسار ملف بيانات البوت القديم.\n');
  process.exit(0);
}

// ── قياس التغطية على البيانات الحقيقية ──────────────────────────
const wb = XLSX.readFile(SRC);
const COLS = ['main_call_product', 'reminders_products', 'sample_products'];
const counts = new Map();

for (const name of wb.SheetNames) {
  for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null })) {
    for (const c of COLS) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      counts.set(s, (counts.get(s) || 0) + 1);
    }
  }
}

let exact = 0, fuzzy = 0, noise = 0, missed = 0;
const missedList = new Map();
const perProduct = new Map();

for (const [raw, n] of counts) {
  const r = match(raw);
  if (r.noise) { noise += n; continue; }
  if (!r.hit) { missed += n; missedList.set(raw, n); continue; }
  if (r.exact) exact += n; else fuzzy += n;
  perProduct.set(r.hit, (perProduct.get(r.hit) || 0) + n);
}

const total = exact + fuzzy + noise + missed;
const real = exact + fuzzy + missed;
const pct = (x, base) => `${((x * 100) / base).toFixed(1)}%`;
const line = '─'.repeat(60);

console.log(line);
console.log(`  صيغ نصية مختلفة        : ${counts.size}`);
console.log(`  إجمالي الإشارات        : ${total}`);
console.log(line);
console.log(`  ✅ مطابقة تامة         : ${exact}  (${pct(exact, total)})`);
console.log(`  ✅ مطابقة تقريبية      : ${fuzzy}  (${pct(fuzzy, total)})`);
console.log(`  ⚪ ضجيج (ليست منتجات)  : ${noise}  (${pct(noise, total)})`);
console.log(`  ❌ لم تُطابق           : ${missed}  (${pct(missed, total)})`);
console.log(line);
console.log(`  📊 التغطية بعد استبعاد الضجيج: ${pct(exact + fuzzy, real)}`);
console.log(line);

console.log('\n📦 التوزيع على المنتجات:');
for (const [p, n] of [...perProduct].sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.max(1, Math.round(n / 60)));
  console.log(`  ${String(n).padStart(5)}  ${p.padEnd(18)} ${bar}`);
}
const unused = products.filter((p) => !perProduct.has(p.shortName));
if (unused.length) {
  console.log(`\n  ⚠️  بلا أي إشارة: ${unused.map((p) => p.shortName).join('، ')}`);
}

if (missedList.size) {
  console.log(`\n❌ أعلى الصيغ غير المطابقة (${missedList.size} صيغة):`);
  for (const [raw, n] of [...missedList].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(4)}  ${raw}`);
  }
}
console.log();
