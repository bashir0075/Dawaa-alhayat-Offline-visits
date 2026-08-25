/**
 * اختبار قاعدة القسم: Sales صيدليات فقط · Promotion أطباء فقط
 * ────────────────────────────────────────────────────────────────
 * تشغيل:  node scripts/test-department-rule.mjs [BASE_URL]
 */

const BASE = process.argv[2] || 'http://localhost:3001/api/v1';

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name} — ${detail}`); console.log(`  ❌ ${name}  ${detail}`); }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function login(id) {
  const r = await api('POST', '/auth/login', { body: { username: id, password: id } });
  if (r.status !== 200) throw new Error(`فشل دخول ${id}: ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

const today = new Date().toISOString().slice(0, 10);

(async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  قاعدة القسم — Sales صيدليات · Promotion أطباء');
  console.log('═'.repeat(60));

  // ══ Promotion — أطباء فقط ═════════════════════════════════════
  console.log('\n── مندوب Promotion (Baqer Maki) ──');
  const promo = await login('6470983589');

  let r = await api('GET', '/catalog/bootstrap', { token: promo });
  check('bootstrap يعيد doctor فقط',
    JSON.stringify(r.body.allowedCustomerTypes) === '["doctor"]',
    JSON.stringify(r.body.allowedCustomerTypes));

  const b = r.body;
  const prod = b.products[0];
  const prov = b.provinces[0];

  r = await api('POST', '/customers', {
    token: promo,
    body: { customerType: 'pharmacy', nameAr: 'صيدلية ممنوعة', provinceId: prov.id },
  });
  check('يُرفض إنشاء صيدلية (403)', r.status === 403, `HTTP ${r.status} ${r.body?.message ?? ''}`);
  check('الرسالة توضّح السبب', /قسمك|الصيدليات/.test(r.body?.message ?? ''), r.body?.message);

  r = await api('POST', '/customers', {
    token: promo,
    body: { customerType: 'doctor', nameAr: 'د. اختبار الدعاية', provinceId: prov.id },
  });
  check('يُقبل إنشاء طبيب', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const doc = r.body?.customer;

  r = await api('POST', '/visits', {
    token: promo,
    body: {
      visitType: 'out_list', customerType: 'pharmacy', visitDate: today,
      visitReason: 'محاولة', newCustomer: { nameAr: 'صيدلية ممنوعة 2' },
      products: [{ productId: prod.id, role: 'main' }],
    },
  });
  check('تُرفض زيارة صيدلية (403)', r.status === 403, `HTTP ${r.status}`);

  r = await api('POST', '/visits', {
    token: promo,
    body: {
      visitType: 'in_list', customerType: 'doctor', customerId: doc.id, visitDate: today,
      products: [{ productId: prod.id, role: 'main' }],
    },
  });
  check('تُقبل زيارة طبيب', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  r = await api('GET', '/customers/search?q=' + encodeURIComponent('صيدلية') + '&onlyMine=false', { token: promo });
  check('البحث لا يعيد صيدليات',
    Array.isArray(r.body) && r.body.every((c) => c.customerType === 'doctor'),
    JSON.stringify(r.body?.map?.((c) => c.customerType)));

  r = await api('GET', '/customers/search?q=' + encodeURIComponent('صيدلية') + '&type=pharmacy', { token: promo });
  check('طلب النوع الممنوع صراحةً يعيد فارغاً', Array.isArray(r.body) && r.body.length === 0, `${r.body?.length}`);

  // ══ Sales — صيدليات فقط ═══════════════════════════════════════
  console.log('\n── مندوب Sales (Hawser Salih) ──');
  const sales = await login('5694668490');

  r = await api('GET', '/catalog/bootstrap', { token: sales });
  check('bootstrap يعيد pharmacy فقط',
    JSON.stringify(r.body.allowedCustomerTypes) === '["pharmacy"]',
    JSON.stringify(r.body.allowedCustomerTypes));

  r = await api('POST', '/customers', {
    token: sales,
    body: { customerType: 'doctor', nameAr: 'د. ممنوع', provinceId: prov.id },
  });
  check('يُرفض إنشاء طبيب (403)', r.status === 403, `HTTP ${r.status} ${r.body?.message ?? ''}`);
  check('الرسالة توضّح السبب', /قسمك|الأطباء/.test(r.body?.message ?? ''), r.body?.message);

  r = await api('POST', '/customers', {
    token: sales,
    body: { customerType: 'pharmacy', nameAr: 'صيدلية اختبار المبيعات', provinceId: prov.id },
  });
  check('يُقبل إنشاء صيدلية', r.status === 201, `HTTP ${r.status}`);
  const ph = r.body?.customer;
  check('كود يبدأ بـ PH', ph?.code?.startsWith('PH-'), ph?.code);

  r = await api('POST', '/visits', {
    token: sales,
    body: {
      visitType: 'in_list', customerType: 'pharmacy', customerId: ph.id, visitDate: today,
      products: [{ productId: prod.id, role: 'main' }],
    },
  });
  check('تُقبل زيارة صيدلية', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  r = await api('POST', '/visits/preview', {
    token: sales,
    body: {
      visitType: 'in_list', customerType: 'doctor', customerId: doc.id, visitDate: today,
      products: [{ productId: prod.id, role: 'main' }],
    },
  });
  check('preview يرفض النوع الممنوع أيضاً', r.status === 403, `HTTP ${r.status}`);

  // ══ super_admin — النوعان ═════════════════════════════════════
  console.log('\n── Super Admin (Bashir Salih — قسمه Sales) ──');
  const admin = await login('6905306500');

  r = await api('GET', '/catalog/bootstrap', { token: admin });
  check('يرى النوعين رغم أن قسمه Sales',
    r.body.allowedCustomerTypes?.length === 2,
    JSON.stringify(r.body.allowedCustomerTypes));

  r = await api('POST', '/customers', {
    token: admin,
    body: { customerType: 'doctor', nameAr: 'د. أدمن', provinceId: prov.id },
  });
  check('يُنشئ طبيباً', r.status === 201, `HTTP ${r.status}`);

  r = await api('POST', '/customers', {
    token: admin,
    body: { customerType: 'pharmacy', nameAr: 'صيدلية أدمن', provinceId: prov.id },
  });
  check('يُنشئ صيدلية', r.status === 201, `HTTP ${r.status}`);

  console.log('\n' + '═'.repeat(60));
  console.log(`  ✅ نجح  ${pass}`);
  console.log(`  ❌ فشل  ${fail}`);
  console.log('═'.repeat(60));
  if (failures.length) {
    console.log('\nالإخفاقات:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n💥', e); process.exit(1); });
