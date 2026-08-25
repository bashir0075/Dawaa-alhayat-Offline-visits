/**
 * اختبار تدفق كامل على API حيّ
 * ────────────────────────────────────────────────────────────────
 * تشغيل:  node scripts/e2e-smoke.mjs [BASE_URL]
 */

const BASE = process.argv[2] || 'http://localhost:3901/api/v1';

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
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const section = (t) => console.log(`\n${'─'.repeat(60)}\n${t}\n${'─'.repeat(60)}`);

(async () => {
  // ══ المصادقة ══════════════════════════════════════════════════
  section('١ · المصادقة');

  let r = await api('POST', '/auth/login', { body: { username: 'wrong', password: 'wrong' } });
  check('رفض بيانات خاطئة', r.status === 401, `HTTP ${r.status}`);

  // الرقم وحده — بلا لاحقة
  r = await api('POST', '/auth/login', { body: { username: 'bashir.salih', password: '6905306500' } });
  check('دخول بالاسم بلا لاحقة', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const admin = r.body;
  if (!admin?.accessToken) { console.log('\n🛑 فشل الدخول — توقف'); process.exit(1); }

  check('الدور super_admin', admin.user.role === 'super_admin', admin.user?.role);
  check('يملك 37 إذناً', admin.user.permissions.length === 37, `${admin.user.permissions.length}`);

  // مع اللاحقة
  r = await api('POST', '/auth/login', { body: { username: 'bashir.salih@dawaa-alhayat', password: '6905306500' } });
  check('دخول باللاحقة الكاملة', r.status === 200, `HTTP ${r.status}`);

  r = await api('GET', '/auth/me', { token: admin.accessToken });
  check('/auth/me يعيد المستخدم', r.status === 200 && r.body.username?.endsWith('@dawaa-alhayat'), r.body?.username);

  r = await api('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } });
  check('تجديد التوكن', r.status === 200 && !!r.body.accessToken, `HTTP ${r.status}`);
  const rotated = r.body.refreshToken;

  r = await api('POST', '/auth/refresh', { body: { refreshToken: admin.refreshToken } });
  check('التوكن القديم أُبطل بعد التدوير', r.status === 401, `HTTP ${r.status}`);

  // ══ الصلاحيات ═════════════════════════════════════════════════
  section('٢ · الصلاحيات');

  // مندوب حقيقي من البذور
  const repRow = await api('GET', '/catalog/bootstrap', { token: admin.accessToken });
  check('bootstrap يعمل', repRow.status === 200, `HTTP ${repRow.status}`);
  check('21 منتجاً', repRow.body.products?.length === 21, `${repRow.body.products?.length}`);
  check('18 محافظة', repRow.body.provinces?.length === 18, `${repRow.body.provinces?.length}`);
  check('B12 أول منتج (الأكثر استخداماً)', repRow.body.products?.[0]?.shortName === 'B12', repRow.body.products?.[0]?.shortName);
  check('classesReady=false (التارغيت غير مضبوط)', repRow.body.classesReady === false, `${repRow.body.classesReady}`);

  r = await api('GET', '/catalog/bootstrap');
  check('بلا توكن يُرفض', r.status === 401, `HTTP ${r.status}`);

  // ══ العملاء ═══════════════════════════════════════════════════
  section('٣ · العملاء');

  const prov = repRow.body.provinces.find((p) => p.nameAr === 'بغداد');
  const spec = repRow.body.specialities.find((s) => s.nameEn === 'Pediatrics');
  const cls = repRow.body.classes.find((c) => c.code === 'A 2');

  r = await api('POST', '/customers', {
    token: admin.accessToken,
    body: {
      customerType: 'doctor', nameAr: 'أحمد محمّد الجبوري',
      specialityId: spec.id, provinceId: prov.id, street: 'شارع الأطباء',
      classId: cls.id, workTime: 'a', hospital: 'مستشفى اليرموك',
    },
  });
  check('إنشاء طبيب', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  const doc1 = r.body.customer;
  check('كود DR-00001', doc1?.code === 'DR-00001', doc1?.code);
  check('الحالة pending', doc1?.status === 'pending', doc1?.status);

  r = await api('POST', '/customers', {
    token: admin.accessToken,
    body: { customerType: 'pharmacy', nameAr: 'صيدلية كبسولة', provinceId: prov.id, classId: cls.id },
  });
  check('كود صيدلية PH-00001', r.body.customer?.code === 'PH-00001', r.body.customer?.code);

  // البحث المتسامح — كُتب "احمد" بلا همزة والمخزّن "أحمد"
  r = await api('GET', '/customers/search?q=' + encodeURIComponent('احمد'), { token: admin.accessToken });
  check('بحث "احمد" يجد "أحمد"', r.status === 200 && r.body.length > 0, `${r.body?.length} نتيجة`);
  check('البحث يعيد بيانات كاملة', r.body?.[0]?.speciality === 'Pediatrics', r.body?.[0]?.speciality);
  check('inMyList = true', r.body?.[0]?.inMyList === true, `${r.body?.[0]?.inMyList}`);

  r = await api('GET', '/customers/search?q=' + encodeURIComponent('محمد الجبوري'), { token: admin.accessToken });
  check('بحث بجزء من الاسم', r.body?.length > 0, `${r.body?.length} نتيجة`);

  // تحذير التشابه
  r = await api('POST', '/customers', {
    token: admin.accessToken,
    body: { customerType: 'doctor', nameAr: 'احمد محمد الجبوري', provinceId: prov.id, classId: cls.id },
  });
  check('تحذير من الاسم المشابه', r.body?.similarWarning?.length > 0, `${r.body?.similarWarning?.length}`);

  r = await api('GET', '/customers/my-list', { token: admin.accessToken });
  check('قائمتي فيها 3 عملاء', r.body?.total === 3, `${r.body?.total}`);

  // ══ الزيارات ══════════════════════════════════════════════════
  section('٤ · الزيارات');

  const b12 = repRow.body.products.find((p) => p.shortName === 'B12');
  const preb = repRow.body.products.find((p) => p.shortName === 'Prebiotic');
  const today = new Date().toISOString().slice(0, 10);

  const visitBody = {
    visitType: 'in_list', customerType: 'doctor', customerId: doc1.id, visitDate: today,
    products: [
      { productId: b12.id, role: 'main' },
      { productId: preb.id, role: 'reminder' },
      { productId: b12.id, role: 'sample' },
    ],
    sampleQuantity: 5, promoGiven: true, promoText: 'أقلام', notes: 'زيارة أولى',
  };

  r = await api('POST', '/visits/preview', { token: admin.accessToken, body: visitBody });
  check('preview يعمل', r.status === 200 && Array.isArray(r.body), `HTTP ${r.status}`);

  r = await api('POST', '/visits', { token: admin.accessToken, body: visitBody });
  check('تسجيل زيارة', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const visit = r.body;
  check('رقم الزيارة V-YYYY-000001', /^V-\d{4}-000001$/.test(visit?.visitNo), visit?.visitNo);
  check('اللقطة: اسم العميل', visit?.snapCustomerName === 'أحمد محمّد الجبوري', visit?.snapCustomerName);
  check('اللقطة: الاختصاص', visit?.snapSpeciality === 'Pediatrics', visit?.snapSpeciality);
  check('اللقطة: المحافظة', visit?.snapProvince === 'بغداد', visit?.snapProvince);
  check('اللقطة: التصنيف', visit?.snapClassCode === 'A 2', visit?.snapClassCode);
  check('اللقطة: كود العميل', visit?.snapCustomerCode === 'DR-00001', visit?.snapCustomerCode);
  check('اللقطة: المندوب', !!visit?.snapUserName, visit?.snapUserName);
  check('مقفلة', visit?.isLocked === true, `${visit?.isLocked}`);
  check('3 منتجات', visit?.products?.length === 3, `${visit?.products?.length}`);

  // تحذير التكرار
  r = await api('POST', '/visits/preview', { token: admin.accessToken, body: visitBody });
  check('تحذير من زيارة مكررة', r.body?.some((w) => w.code === 'recent_visit'), JSON.stringify(r.body?.map((w) => w.code)));

  // ══ التحقق ════════════════════════════════════════════════════
  section('٥ · التحقق من صحة الإدخال');

  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  r = await api('POST', '/visits', { token: admin.accessToken, body: { ...visitBody, visitDate: future } });
  check('رفض التاريخ المستقبلي', r.status === 400, `HTTP ${r.status}`);

  const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
  r = await api('POST', '/visits', { token: admin.accessToken, body: { ...visitBody, visitDate: old } });
  check('رفض التاريخ الأقدم من الحد', r.status === 400, `HTTP ${r.status}`);

  r = await api('POST', '/visits', {
    token: admin.accessToken,
    body: { ...visitBody, products: [{ productId: b12.id, role: 'main' }, { productId: preb.id, role: 'main' }] },
  });
  check('رفض منتجين أساسيين', r.status === 400, `HTTP ${r.status}`);

  r = await api('POST', '/visits', { token: admin.accessToken, body: { ...visitBody, products: [] } });
  check('رفض بلا منتجات', r.status === 400, `HTTP ${r.status}`);

  r = await api('POST', '/visits', {
    token: admin.accessToken,
    body: { ...visitBody, products: [{ productId: 99999, role: 'main' }] },
  });
  check('رفض منتج غير موجود', r.status === 400, `HTTP ${r.status}`);

  // ══ زيارة خارج القائمة ════════════════════════════════════════
  section('٦ · زيارة خارج القائمة → إنشاء عميل تلقائي');

  r = await api('POST', '/visits', {
    token: admin.accessToken,
    body: {
      visitType: 'out_list', customerType: 'doctor', visitDate: today,
      visitReason: 'اكتشاف طبيب جديد',
      newCustomer: { nameAr: 'سارة خالد', specialityId: spec.id, provinceId: prov.id, classId: cls.id },
      products: [{ productId: b12.id, role: 'main' }],
    },
  });
  check('تسجيل زيارة خارج القائمة', r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  check('وُلّد عميل تلقائياً', !!r.body?.customerId, `${r.body?.customerId}`);
  check('اللقطة تحمل الاسم الجديد', r.body?.snapCustomerName === 'سارة خالد', r.body?.snapCustomerName);

  r = await api('POST', '/visits', {
    token: admin.accessToken,
    body: {
      visitType: 'out_list', customerType: 'doctor', visitDate: today,
      newCustomer: { nameAr: 'بلا سبب' },
      products: [{ productId: b12.id, role: 'main' }],
    },
  });
  check('رفض خارج القائمة بلا سبب', r.status === 400, `HTTP ${r.status}`);

  r = await api('GET', '/customers/requests/pending', { token: admin.accessToken });
  check('طلبات الموافقة أُنشئت', r.body?.length >= 4, `${r.body?.length}`);

  // ══ التقارير ══════════════════════════════════════════════════
  section('٧ · التقارير');

  const range = `from=2026-01-01&to=2026-12-31`;
  for (const key of ['visits_detail', 'coverage', 'frequency_class', 'products',
                     'samples', 'promo', 'hierarchy', 'out_of_list', 'alerts', 'monthly_trend']) {
    r = await api('GET', `/reports/data?key=${key}&${range}`, { token: admin.accessToken });
    check(`تقرير ${key}`, r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  r = await api('GET', `/reports/data?key=target&${range}`, { token: admin.accessToken });
  check('التارغيت يرفض ويشرح السبب', r.status === 400 && /تارغيت/.test(r.body?.message ?? ''), `HTTP ${r.status} ${r.body?.message}`);

  r = await api('GET', `/reports/data?key=visits_detail&${range}`, { token: admin.accessToken });
  const row = r.body?.rows?.[0];
  check('الزيارات التفصيلي يعيد صفوفاً', r.body?.count >= 2, `${r.body?.count}`);
  check('العمود "المنتج الأساسي" = B12', row?.['المنتج الأساسي'] === 'B12', row?.['المنتج الأساسي']);
  check('العمود "المحافظة" ممتلئ', !!row?.['المحافظة'], row?.['المحافظة']);
  check('العمود "التصنيف" ممتلئ', !!row?.['التصنيف'], row?.['التصنيف']);

  // ══ ضبط التارغيت ثم إعادة المحاولة ════════════════════════════
  section('٨ · ضبط تارغيت التصنيفات');

  r = await api('POST', '/catalog/classes/targets', {
    token: admin.accessToken,
    body: { targets: [
      { code: 'A 1', monthlyTarget: 4 }, { code: 'A 2', monthlyTarget: 3 },
      { code: 'A 3', monthlyTarget: 3 }, { code: 'A 4', monthlyTarget: 2 },
      { code: 'B 1', monthlyTarget: 2 }, { code: 'B 2', monthlyTarget: 2 },
      { code: 'B 3', monthlyTarget: 1 }, { code: 'C 1', monthlyTarget: 1 },
      { code: 'C 2', monthlyTarget: 1 },
    ] },
  });
  check('ضبط التارغيت', r.status === 201 || r.status === 200, `HTTP ${r.status}`);

  r = await api('POST', '/catalog/classes/targets', {
    token: admin.accessToken, body: { targets: [{ code: 'A 1', monthlyTarget: 99 }] },
  });
  check('رفض تارغيت غير منطقي (99)', r.status === 400, `HTTP ${r.status}`);

  r = await api('GET', `/reports/data?key=target&${range}`, { token: admin.accessToken });
  check('التارغيت يعمل بعد الضبط', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

  // ══ التصدير ═══════════════════════════════════════════════════
  section('٩ · تصدير Excel');

  const xl = await fetch(`${BASE}/reports/export/full?${range}`, {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  const buf = Buffer.from(await xl.arrayBuffer());
  check('تصدير المصنّف الشامل', xl.status === 200, `HTTP ${xl.status}`);
  check('نوع الملف xlsx', xl.headers.get('content-type')?.includes('spreadsheetml'), xl.headers.get('content-type'));
  check('الملف غير فارغ', buf.length > 8000, `${(buf.length / 1024).toFixed(1)} KB`);
  check('توقيع ZIP صحيح', buf[0] === 0x50 && buf[1] === 0x4b, `${buf[0]},${buf[1]}`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync('data/output/live-report.xlsx', buf);

  // ══ التصحيح ═══════════════════════════════════════════════════
  section('١٠ · طلب التصحيح');

  r = await api('POST', `/visits/${visit.id}/corrections`, {
    token: admin.accessToken,
    body: { fieldName: 'notes', newValue: 'ملاحظة مصحّحة', reason: 'خطأ إملائي' },
  });
  check('طلب تصحيح حقل مسموح', r.status === 201, `HTTP ${r.status}`);
  const corr = r.body;

  r = await api('POST', `/visits/${visit.id}/corrections`, {
    token: admin.accessToken,
    body: { fieldName: 'customerId', newValue: '99', reason: 'محاولة' },
  });
  check('رفض تصحيح حقل ممنوع', r.status === 400, `HTTP ${r.status}`);

  r = await api('POST', `/visits/corrections/${corr.id}/review`, {
    token: admin.accessToken, body: { approve: true, note: 'موافق' },
  });
  check('super_admin يوافق على طلبه', r.status === 200 || r.status === 201, `HTTP ${r.status}`);

  r = await api('GET', `/visits/${visit.id}`, { token: admin.accessToken });
  check('التصحيح طُبّق فعلاً', r.body?.notes === 'ملاحظة مصحّحة', r.body?.notes);

  // ══ سجل التدقيق ═══════════════════════════════════════════════
  section('١١ · النتيجة');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅ نجح  ${pass}`);
  console.log(`  ❌ فشل  ${fail}`);
  console.log('═'.repeat(60));
  if (failures.length) {
    console.log('\nالإخفاقات:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\n💥', e); process.exit(1); });
