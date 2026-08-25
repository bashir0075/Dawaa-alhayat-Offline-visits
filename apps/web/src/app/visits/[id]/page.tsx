'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft, Lock, Stethoscope, Building2, Package, Gift, Megaphone,
  FileText, Clock, User, MapPin, PenLine, Loader2, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useUi } from '@/lib/store';
import { cn, formatDate } from '@/lib/utils';

/** الحقول التي يسمح الخادم بطلب تصحيحها — يجب أن تطابق CORRECTABLE فيه */
const CORRECTABLE: [string, string][] = [
  ['visitDate', 'تاريخ الزيارة'],
  ['sampleQuantity', 'عدد النماذج'],
  ['promoText', 'نوع المادة الدعائية'],
  ['visitReason', 'سبب الزيارة'],
  ['notes', 'الملاحظات'],
];

export default function VisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useUi((s) => s.toast);
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);

  const [v, setV] = useState<any>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  const load = () =>
    api.get<any>(`/visits/${id}`).then(setV).catch((e) => setError(e.message));

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink onClick={() => router.back()} />
        <div className="card grid place-items-center gap-3 p-12 text-center">
          <XCircle className="size-10 text-faint" />
          <p className="font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!v) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-32 rounded-card" />
        <div className="skeleton h-64 rounded-card" />
      </div>
    );
  }

  const Icon = v.customerType === 'doctor' ? Stethoscope : Building2;
  const byRole = (r: string) =>
    v.products.filter((p: any) => p.role === r).map((p: any) => p.product.shortName);
  const main = byRole('main')[0];
  const reminders = byRole('reminder');
  const samples = byRole('sample');
  const mine = v.userId === user?.id;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink onClick={() => router.back()} />

      {/* ═══ الترويسة ═══ */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Icon className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold sm:text-xl">{v.snapCustomerName}</h1>
              {v.snapClassCode && (
                <span className="chip bg-brand text-brand-ink">{v.snapClassCode}</span>
              )}
              {v.visitType === 'out_list' && (
                <span className="chip bg-warn-soft text-warn">خارج القائمة</span>
              )}
            </div>
            <p className="num mt-1 text-sm text-faint">
              {v.visitNo} · {v.snapCustomerCode}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-field bg-elevated px-3.5 py-2.5 text-sm text-muted">
          <Lock className="size-4 shrink-0" />
          <span>هذه الزيارة مقفلة — التصحيح يحتاج موافقة المدير</span>
        </div>
      </div>

      {/* ═══ اللقطة ═══ */}
      <Section title="بيانات العميل وقت الزيارة" icon={MapPin}>
        <p className="mb-3 text-xs leading-relaxed text-faint">
          نسخة مجمّدة لحظة التسجيل — لا تتغيّر لو انتقل العميل أو تغيّر تصنيفه لاحقاً.
        </p>
        <dl className="divide-y divide-line">
          <Row k="النوع" v={v.customerType === 'doctor' ? 'طبيب' : 'صيدلية / زبون'} />
          <Row k="الاختصاص" v={v.snapSpeciality} />
          <Row k="المشفى" v={v.snapHospital} />
          <Row k="الدوام" v={v.snapWorkTime === 'a' ? 'صباحي' : v.snapWorkTime === 'p' ? 'مسائي' : null} />
          <Row k="المحافظة" v={v.snapProvince} />
          <Row k="المنطقة" v={v.snapArea} />
          <Row k="الشارع" v={v.snapStreet} />
          <Row k="التصنيف" v={v.snapClassCode} />
          <Row k="التارغيت الشهري" v={v.snapMonthlyTarget || null} mono />
        </dl>
      </Section>

      {/* ═══ الزيارة ═══ */}
      <Section title="تفاصيل الزيارة" icon={FileText}>
        <dl className="divide-y divide-line">
          <Row k="التاريخ" v={formatDate(v.visitDate)} mono strong />
          <Row k="سبب الزيارة" v={v.visitReason} />
          <Row k="الملاحظات" v={v.notes} />
        </dl>
      </Section>

      {/* ═══ المنتجات ═══ */}
      <Section title="المنتجات" icon={Package}>
        <div className="space-y-3">
          <ProductRow label="أساسي" icon={Package} items={main ? [main] : []} tone="brand" />
          {reminders.length > 0 && (
            <ProductRow label="تذكيري" icon={Megaphone} items={reminders} />
          )}
          {samples.length > 0 && (
            <ProductRow
              label="نماذج مجانية"
              icon={Gift}
              items={samples}
              badge={v.sampleQuantity ? `${v.sampleQuantity} نموذج` : undefined}
            />
          )}
          {v.promoGiven && (
            <ProductRow label="مادة دعائية" icon={Megaphone} items={[v.promoText || 'نعم']} />
          )}
        </div>
      </Section>

      {/* ═══ التسجيل ═══ */}
      <Section title="التسجيل" icon={User}>
        <dl className="divide-y divide-line">
          <Row k="المندوب" v={v.snapUserName} />
          <Row k="القسم" v={v.snapDepartment} />
          <Row k="المنصب" v={v.snapPosition} />
          <Row k="المدير المباشر" v={v.snapManagerName} />
          <Row
            k="وقت التسجيل"
            v={new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Asia/Baghdad', dateStyle: 'short', timeStyle: 'short',
            }).format(new Date(v.recordedAt))}
            mono
          />
          <Row k="المصدر" v={{ web: 'ويب', mobile: 'جوال', imported: 'استيراد' }[v.source as string]} />
        </dl>
      </Section>

      {/* ═══ التصحيحات ═══ */}
      {v.corrections?.length > 0 && (
        <Section title="طلبات التصحيح" icon={Clock}>
          <ul className="space-y-2">
            {v.corrections.map((c: any) => (
              <li key={c.id} className="rounded-field border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {CORRECTABLE.find(([k]) => k === c.fieldName)?.[1] ?? c.fieldName}
                  </span>
                  <StatusChip status={c.status} />
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  <span className="line-through opacity-60">{c.oldValue || '—'}</span>
                  {' ← '}
                  <span className="font-medium text-ink">{c.newValue || '—'}</span>
                </p>
                <p className="mt-1 text-xs text-faint">{c.reason}</p>
                {c.reviewNote && (
                  <p className="mt-1 text-xs text-muted">ملاحظة المراجع: {c.reviewNote}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mine && can('corrections.request') && (
        <>
          {asking ? (
            <CorrectionForm
              visit={v}
              onCancel={() => setAsking(false)}
              onDone={async () => { setAsking(false); await load(); toast('ok', 'أُرسل طلب التصحيح لمديرك'); }}
              onError={(m) => toast('err', m)}
            />
          ) : (
            <button onClick={() => setAsking(true)} className="btn-outline w-full">
              <PenLine className="size-4" />
              طلب تصحيح
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function CorrectionForm({
  visit, onCancel, onDone, onError,
}: { visit: any; onCancel: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [field, setField] = useState(CORRECTABLE[0][0]);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const current = String(visit[field] ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/visits/${visit.id}/corrections`, {
        fieldName: field, newValue: value, reason,
      });
      onDone();
    } catch (err: any) {
      onError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5 animate-fade-up">
      <div>
        <h2 className="font-semibold">طلب تصحيح</h2>
        <p className="mt-0.5 text-sm text-muted">
          لا يُطبَّق إلا بعد موافقة مديرك، والقيمة الأصلية تبقى محفوظة.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="f">الحقل</label>
        <select
          id="f"
          className="field"
          value={field}
          onChange={(e) => { setField(e.target.value); setValue(''); }}
        >
          {CORRECTABLE.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-faint">القيمة الحالية: {current || '—'}</p>
      </div>

      <div>
        <label className="label" htmlFor="nv">القيمة الصحيحة</label>
        <input
          id="nv"
          className={cn('field', field === 'visitDate' && 'num')}
          type={field === 'visitDate' ? 'date' : field === 'sampleQuantity' ? 'number' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="rs">سبب التصحيح</label>
        <input
          id="rs"
          className="field"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: خطأ إملائي عند الإدخال"
          required
        />
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="btn-outline flex-1" disabled={busy}>
          إلغاء
        </button>
        <button type="submit" className="btn-brand flex-[2]" disabled={busy || !value || !reason}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          إرسال الطلب
        </button>
      </div>
    </form>
  );
}

function Section({
  title, icon: Icon, children,
}: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon className="size-[1.125rem] text-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v, mono, strong }: { k: string; v: any; mono?: boolean; strong?: boolean }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted">{k}</dt>
      <dd className={cn('text-sm text-end break-words', mono && 'num', strong && 'font-semibold')}>
        {v}
      </dd>
    </div>
  );
}

function ProductRow({
  label, icon: Icon, items, badge, tone,
}: { label: string; icon: any; items: string[]; badge?: string; tone?: 'brand' }) {
  if (!items.length) return null;
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg',
          tone === 'brand' ? 'bg-brand-soft text-brand' : 'bg-elevated text-muted',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-faint">{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {items.map((it) => (
            <span key={it} className={cn('chip', tone === 'brand' ? 'bg-brand text-brand-ink' : 'bg-elevated text-ink')}>
              {it}
            </span>
          ))}
          {badge && <span className="chip bg-ok-soft text-ok num">{badge}</span>}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string, any]> = {
    pending: ['بانتظار المراجعة', 'bg-warn-soft text-warn', Clock],
    approved: ['موافَق عليه', 'bg-ok-soft text-ok', CheckCircle2],
    rejected: ['مرفوض', 'bg-danger-soft text-danger', XCircle],
  };
  const [label, cls, Icon] = map[status] ?? [status, 'bg-elevated text-muted', Clock];
  return (
    <span className={cn('chip', cls)}>
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-ghost -ms-2 !px-2">
      <ChevronLeft className="size-4 rotate-180" />
      رجوع
    </button>
  );
}
