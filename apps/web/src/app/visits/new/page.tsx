'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check, ChevronLeft, Lock, AlertTriangle, Info, Loader2,
  Stethoscope, Building2, Package, CalendarDays,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { cn, todayBaghdad } from '@/lib/utils';
import { CustomerSearch, type CustomerHit } from '@/components/CustomerSearch';

interface Product { id: number; code: string; shortName: string; nameAr: string | null }
interface Province { id: number; nameAr: string; areas: { id: number; nameAr: string }[] }
interface Speciality { id: number; nameEn: string; nameAr: string | null }
interface ClassRow { id: number; code: string; monthlyTarget: number }
interface Bootstrap {
  products: Product[]; provinces: Province[]; specialities: Speciality[];
  classes: ClassRow[]; promoSuggestions: string[]; classesReady: boolean;
}
interface Warning { code: string; severity: 'info' | 'warning'; message: string }

type Step = 'who' | 'what' | 'review';

export default function NewVisitPage() {
  const router = useRouter();
  const toast = useUi((s) => s.toast);

  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [step, setStep] = useState<Step>('who');
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  // من
  const [customerType, setCustomerType] = useState<'doctor' | 'pharmacy'>('doctor');
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [nc, setNc] = useState({
    specialityId: '', provinceId: '', areaId: '', street: '',
    hospital: '', workTime: '', classId: '',
  });
  const [visitReason, setVisitReason] = useState('');

  // ماذا
  const [visitDate, setVisitDate] = useState(todayBaghdad());
  const [mainId, setMainId] = useState<number | null>(null);
  const [reminderIds, setReminderIds] = useState<number[]>([]);
  const [sampleIds, setSampleIds] = useState<number[]>([]);
  const [sampleQty, setSampleQty] = useState('');
  const [promoGiven, setPromoGiven] = useState(false);
  const [promoText, setPromoText] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.get<Bootstrap>('/catalog/bootstrap')
      .then(setBoot)
      .catch((e) => toast('err', e.message));
  }, [toast]);

  const isOutList = !!newName;
  const areas = useMemo(
    () => boot?.provinces.find((p) => String(p.id) === nc.provinceId)?.areas ?? [],
    [boot, nc.provinceId],
  );

  function buildPayload() {
    const products = [
      ...(mainId ? [{ productId: mainId, role: 'main' as const }] : []),
      ...reminderIds.map((id) => ({ productId: id, role: 'reminder' as const })),
      ...sampleIds.map((id) => ({ productId: id, role: 'sample' as const })),
    ];
    return {
      visitType: isOutList ? ('out_list' as const) : ('in_list' as const),
      customerType,
      ...(customer ? { customerId: customer.id } : {}),
      ...(isOutList
        ? {
            newCustomer: {
              nameAr: newName!,
              ...(customerType === 'doctor' && nc.specialityId ? { specialityId: +nc.specialityId } : {}),
              ...(customerType === 'doctor' && nc.hospital ? { hospital: nc.hospital } : {}),
              ...(customerType === 'doctor' && nc.workTime ? { workTime: nc.workTime as 'a' | 'p' } : {}),
              ...(nc.provinceId ? { provinceId: +nc.provinceId } : {}),
              ...(nc.areaId ? { areaId: +nc.areaId } : {}),
              ...(nc.street ? { street: nc.street } : {}),
              ...(nc.classId ? { classId: +nc.classId } : {}),
            },
            visitReason,
          }
        : {}),
      visitDate,
      products,
      ...(sampleQty ? { sampleQuantity: +sampleQty } : {}),
      promoGiven,
      ...(promoGiven && promoText ? { promoText } : {}),
      ...(notes ? { notes } : {}),
      source: 'web' as const,
    };
  }

  const whoDone = (customer || (newName && (!isOutList || visitReason.trim())));
  const whatDone = !!mainId && !!visitDate;

  async function goReview() {
    setBusy(true);
    try {
      setWarnings(await api.post<Warning[]>('/visits/preview', buildPayload()));
      setStep('review');
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const v = await api.post<any>('/visits', buildPayload());
      toast('ok', `سُجّلت الزيارة ${v.visitNo}`);
      router.push('/visits');
    } catch (e: any) {
      toast('err', e.message);
      setBusy(false);
    }
  }

  if (!boot) return <PageSkeleton />;

  const P = boot.products;
  const name = (id: number) => P.find((p) => p.id === id)?.shortName ?? '';

  return (
    <div className="mx-auto max-w-3xl">
      <Header step={step} onBack={() => setStep(step === 'review' ? 'what' : 'who')} />

      {/* ═══ من ═══ */}
      {step === 'who' && (
        <div className="space-y-5 animate-fade-up">
          <section className="card p-5">
            <h2 className="font-semibold mb-4">نوع العميل</h2>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['doctor', 'طبيب', Stethoscope],
                ['pharmacy', 'صيدلية / زبون', Building2],
              ] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setCustomerType(v); setCustomer(null); setNewName(null); }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-field border-2 p-4 transition-all',
                    customerType === v
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-line text-muted hover:border-faint',
                  )}
                >
                  <Icon className="size-6" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-1">العميل</h2>
            <p className="text-sm text-muted mb-4">
              ابحث في قائمتك — أو أضف عميلاً جديداً إن لم تجده
            </p>

            {newName ? (
              <NewCustomerForm
                name={newName}
                customerType={customerType}
                boot={boot}
                areas={areas}
                value={nc}
                onChange={setNc}
                reason={visitReason}
                onReason={setVisitReason}
                onCancel={() => { setNewName(null); setVisitReason(''); }}
              />
            ) : (
              <CustomerSearch
                customerType={customerType}
                value={customer}
                onSelect={setCustomer}
                onCreateNew={(n) => { setNewName(n); setCustomer(null); }}
              />
            )}
          </section>

          <StickyBar>
            <button
              className="btn-brand w-full !py-3"
              disabled={!whoDone}
              onClick={() => { setStep('what'); window.scrollTo({ top: 0 }); }}
            >
              التالي: تفاصيل الزيارة
            </button>
          </StickyBar>
        </div>
      )}

      {/* ═══ ماذا ═══ */}
      {step === 'what' && (
        <div className="space-y-5 animate-fade-up">
          <section className="card p-5">
            <label className="label" htmlFor="d">
              <CalendarDays className="inline size-4 me-1 -mt-0.5" />
              تاريخ الزيارة
            </label>
            <input
              id="d"
              type="date"
              className="field num"
              value={visitDate}
              max={todayBaghdad()}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-1">
              <Package className="inline size-[1.125rem] me-1.5 -mt-1" />
              المنتج الأساسي
            </h2>
            <p className="text-sm text-muted mb-4">اختر منتجاً واحداً</p>
            <ProductGrid products={P} selected={mainId ? [mainId] : []} onToggle={(id) => setMainId(id)} single />
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-1">منتجات تذكيرية</h2>
            <p className="text-sm text-muted mb-4">اختياري — حتى ٣ منتجات</p>
            <ProductGrid
              products={P.filter((p) => p.id !== mainId)}
              selected={reminderIds}
              max={3}
              onToggle={(id) =>
                setReminderIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 3 ? [...s, id] : s))
              }
            />
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-1">نماذج مجانية</h2>
            <p className="text-sm text-muted mb-4">اختياري — حتى ٣ منتجات</p>
            <ProductGrid
              products={P}
              selected={sampleIds}
              max={3}
              onToggle={(id) =>
                setSampleIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 3 ? [...s, id] : s))
              }
            />
            {sampleIds.length > 0 && (
              <div className="mt-4">
                <label className="label" htmlFor="q">عدد النماذج</label>
                <input
                  id="q"
                  type="number"
                  min={0}
                  className="field num max-w-40"
                  value={sampleQty}
                  onChange={(e) => setSampleQty(e.target.value)}
                />
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-4">مادة دعائية</h2>
            <div className="flex gap-3">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setPromoGiven(v)}
                  className={cn(
                    'flex-1 rounded-field border-2 py-2.5 text-sm font-medium transition-all',
                    promoGiven === v ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted',
                  )}
                >
                  {v ? 'نعم' : 'لا'}
                </button>
              ))}
            </div>
            {promoGiven && (
              <div className="mt-4 animate-fade-up">
                <label className="label" htmlFor="pt">نوع المادة</label>
                <input
                  id="pt"
                  className="field"
                  list="promo-list"
                  value={promoText}
                  onChange={(e) => setPromoText(e.target.value)}
                  placeholder="اكتب أو اختر…"
                />
                <datalist id="promo-list">
                  {boot.promoSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
            )}
          </section>

          <section className="card p-5">
            <label className="label" htmlFor="n">ملاحظات</label>
            <textarea
              id="n"
              rows={3}
              className="field resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات العميل…"
            />
          </section>

          <StickyBar>
            <button className="btn-brand w-full !py-3" disabled={!whatDone || busy} onClick={goReview}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              مراجعة قبل الحفظ
            </button>
          </StickyBar>
        </div>
      )}

      {/* ═══ المراجعة ═══ */}
      {step === 'review' && (
        <div className="space-y-5 animate-fade-up">
          <div className="flex items-start gap-3 rounded-card border-2 border-warn/30 bg-warn-soft p-4">
            <Lock className="size-5 shrink-0 text-warn mt-0.5" />
            <div>
              <p className="font-semibold text-warn">لا يمكن التعديل بعد الحفظ</p>
              <p className="mt-0.5 text-sm text-warn/80">
                راجع كل سطر بعناية. التصحيح لاحقاً يحتاج موافقة مديرك.
              </p>
            </div>
          </div>

          {warnings.map((w) => (
            <div
              key={w.code}
              className={cn(
                'flex items-start gap-3 rounded-field border p-3.5 text-sm',
                w.severity === 'warning'
                  ? 'border-warn/25 bg-warn-soft text-warn'
                  : 'border-line bg-elevated text-muted',
              )}
            >
              {w.severity === 'warning'
                ? <AlertTriangle className="size-[1.125rem] shrink-0 mt-px" />
                : <Info className="size-[1.125rem] shrink-0 mt-px" />}
              <span>{w.message}</span>
            </div>
          ))}

          <section className="card divide-y divide-line">
            <Row label="العميل" value={customer?.nameAr ?? newName} strong />
            {customer?.code && <Row label="الكود" value={customer.code} mono />}
            <Row label="النوع" value={customerType === 'doctor' ? 'طبيب' : 'صيدلية / زبون'} />
            <Row label="نوع الزيارة" value={isOutList ? 'خارج القائمة' : 'داخل القائمة'} />
            {customer?.speciality && <Row label="الاختصاص" value={customer.speciality} />}
            {customer?.province && (
              <Row label="الموقع" value={[customer.province, customer.area].filter(Boolean).join(' · ')} />
            )}
            {customer?.classCode && <Row label="التصنيف" value={customer.classCode} />}
            {isOutList && <Row label="سبب الزيارة" value={visitReason} />}
            <Row label="التاريخ" value={visitDate} mono />
            <Row label="المنتج الأساسي" value={mainId ? name(mainId) : '—'} strong />
            {reminderIds.length > 0 && <Row label="تذكيرية" value={reminderIds.map(name).join(' + ')} />}
            {sampleIds.length > 0 && <Row label="نماذج مجانية" value={sampleIds.map(name).join(' + ')} />}
            {sampleQty && <Row label="عدد النماذج" value={sampleQty} mono />}
            <Row label="مادة دعائية" value={promoGiven ? (promoText || 'نعم') : 'لا'} />
            {notes && <Row label="ملاحظات" value={notes} />}
          </section>

          <StickyBar>
            <div className="flex gap-3">
              <button className="btn-outline flex-1 !py-3" onClick={() => setStep('what')} disabled={busy}>
                تعديل
              </button>
              <button className="btn-brand flex-[2] !py-3" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-[1.125rem]" />}
                تأكيد نهائي
              </button>
            </div>
          </StickyBar>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Header({ step, onBack }: { step: Step; onBack: () => void }) {
  const steps: [Step, string][] = [['who', 'العميل'], ['what', 'التفاصيل'], ['review', 'المراجعة']];
  const idx = steps.findIndex(([s]) => s === step);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-5">
        {step !== 'who' && (
          <button onClick={onBack} className="btn-ghost !p-2 -ms-2" aria-label="رجوع">
            <ChevronLeft className="size-5 rotate-180" />
          </button>
        )}
        <h1 className="text-xl font-bold sm:text-2xl">تسجيل زيارة</h1>
      </div>

      <ol className="flex items-center gap-2">
        {steps.map(([s, label], i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors',
                  i < idx && 'bg-ok text-white',
                  i === idx && 'bg-brand text-brand-ink',
                  i > idx && 'bg-elevated text-faint',
                )}
              >
                {i < idx ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('text-sm truncate', i === idx ? 'font-medium text-ink' : 'text-faint')}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('h-px flex-1 transition-colors', i < idx ? 'bg-ok' : 'bg-line')} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProductGrid({
  products, selected, onToggle, single, max,
}: {
  products: Product[]; selected: number[]; onToggle: (id: number) => void;
  single?: boolean; max?: number;
}) {
  const full = !single && max !== undefined && selected.length >= max;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {products.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onToggle(p.id)}
            disabled={!on && full}
            className={cn(
              'rounded-field border-2 px-3 py-2.5 text-start transition-all active:scale-[0.98]',
              on ? 'border-brand bg-brand-soft' : 'border-line hover:border-faint',
              !on && full && 'opacity-40 pointer-events-none',
            )}
          >
            <span className={cn('block text-sm font-medium truncate', on && 'text-brand')}>
              {p.shortName}
            </span>
            {p.nameAr && <span className="block truncate text-xs text-faint">{p.nameAr}</span>}
          </button>
        );
      })}
    </div>
  );
}

function NewCustomerForm({
  name, customerType, boot, areas, value, onChange, reason, onReason, onCancel,
}: any) {
  const set = (k: string) => (e: any) =>
    onChange({ ...value, [k]: e.target.value, ...(k === 'provinceId' ? { areaId: '' } : {}) });

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between rounded-field bg-brand-soft px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">عميل جديد</p>
          <p className="font-semibold truncate">{name}</p>
        </div>
        <button type="button" onClick={onCancel} className="btn-ghost !p-2 !text-xs shrink-0">إلغاء</button>
      </div>

      <div className="rounded-field border border-line bg-elevated px-3.5 py-2.5 text-xs text-muted">
        سيُضاف لقائمتك فوراً بكود تلقائي، ويصل طلب موافقة لمديرك.
      </div>

      <div>
        <label className="label">سبب الزيارة <span className="text-danger">*</span></label>
        <input className="field" value={reason} onChange={(e) => onReason(e.target.value)}
               placeholder="مثال: اكتشاف طبيب جديد" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {customerType === 'doctor' && (
          <div>
            <label className="label">الاختصاص</label>
            <select className="field" value={value.specialityId} onChange={set('specialityId')}>
              <option value="">—</option>
              {boot.specialities.map((s: Speciality) => (
                <option key={s.id} value={s.id}>{s.nameAr ?? s.nameEn}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">المحافظة</label>
          <select className="field" value={value.provinceId} onChange={set('provinceId')}>
            <option value="">—</option>
            {boot.provinces.map((p: Province) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
          </select>
        </div>

        <div>
          <label className="label">المنطقة</label>
          <select className="field" value={value.areaId} onChange={set('areaId')} disabled={!areas.length}>
            <option value="">{areas.length ? '—' : 'اختر المحافظة أولاً'}</option>
            {areas.map((a: any) => <option key={a.id} value={a.id}>{a.nameAr}</option>)}
          </select>
        </div>

        <div>
          <label className="label">الشارع</label>
          <input className="field" value={value.street} onChange={set('street')} />
        </div>

        {customerType === 'doctor' && (
          <>
            <div>
              <label className="label">المشفى</label>
              <input className="field" value={value.hospital} onChange={set('hospital')} />
            </div>
            <div>
              <label className="label">الدوام</label>
              <select className="field" value={value.workTime} onChange={set('workTime')}>
                <option value="">—</option>
                <option value="a">صباحي</option>
                <option value="p">مسائي</option>
              </select>
            </div>
          </>
        )}

        <div>
          <label className="label">التصنيف</label>
          <select className="field" value={value.classId} onChange={set('classId')}>
            <option value="">—</option>
            {boot.classes.map((c: ClassRow) => (
              <option key={c.id} value={c.id}>
                {c.code}{c.monthlyTarget > 0 ? ` · ${c.monthlyTarget} زيارة/شهر` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: any; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <span className="text-sm text-muted shrink-0">{label}</span>
      <span className={cn('text-sm text-end break-words', strong && 'font-semibold', mono && 'num')}>
        {value || '—'}
      </span>
    </div>
  );
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--nav-h)+0.5rem)] md:bottom-4 z-10 pt-2">
      <div className="rounded-card border border-line bg-surface/90 p-3 shadow-pop backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-7 w-full" />
      {[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 w-full rounded-card" />)}
    </div>
  );
}
