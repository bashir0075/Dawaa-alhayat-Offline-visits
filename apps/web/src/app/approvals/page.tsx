'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, XCircle, Loader2, Inbox, Stethoscope, Building2,
  UserPlus, Trash2, PenLine, MapPin,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useUi } from '@/lib/store';
import { cn, relativeDay } from '@/lib/utils';

export default function ApprovalsPage() {
  const toast = useUi((s) => s.toast);
  const can = useAuth((s) => s.can);

  const [customers, setCustomers] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!can('customers.approve')) { setCustomers([]); return; }
    try {
      setCustomers(await api.get<any[]>('/customers/requests/pending'));
    } catch {
      setCustomers([]);
    }
  }, [can]);

  useEffect(() => { void load(); }, [load]);

  async function review(id: number, approve: boolean, reviewNote?: string) {
    setBusy(`c${id}`);
    try {
      await api.post(`/customers/requests/${id}/review`, { approve, note: reviewNote });
      toast('ok', approve ? 'تمت الموافقة' : 'رُفض الطلب');
      setRejecting(null);
      setNote('');
      await load();
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!can('customers.approve')) {
    return (
      <div className="card grid place-items-center gap-3 p-12 text-center">
        <XCircle className="size-10 text-faint" />
        <p className="font-medium">لا تملك صلاحية الموافقات</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">الموافقات</h1>
        {customers && customers.length > 0 && (
          <span className="chip bg-warn-soft text-warn num">{customers.length}</span>
        )}
      </div>

      {!customers ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-32 rounded-card" />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="card grid place-items-center gap-3 p-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-ok-soft text-ok">
            <Inbox className="size-6" />
          </div>
          <div>
            <p className="font-medium">لا طلبات معلّقة</p>
            <p className="mt-1 text-sm text-faint">كل شيء مراجَع</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {customers.map((r) => {
            const c = r.customer;
            const Icon = c?.customerType === 'doctor' ? Stethoscope : Building2;
            const [TypeIcon, typeLabel, typeCls] =
              r.requestType === 'add'
                ? [UserPlus, 'إضافة عميل', 'bg-brand-soft text-brand']
                : r.requestType === 'remove'
                  ? [Trash2, 'حذف عميل', 'bg-danger-soft text-danger']
                  : [PenLine, 'تعديل عميل', 'bg-warn-soft text-warn'];
            const isBusy = busy === `c${r.id}`;

            return (
              <li key={r.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('chip', typeCls)}>
                    <TypeIcon className="size-3" />
                    {typeLabel}
                  </span>
                  <span className="text-xs text-faint">{relativeDay(r.createdAt)}</span>
                </div>

                <div className="mt-3 flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-elevated text-muted">
                    <Icon className="size-[1.125rem]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c?.nameAr ?? '—'}</p>
                    <p className="num mt-0.5 text-xs text-faint">{c?.code}</p>
                    {(c?.province || c?.speciality) && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                        <MapPin className="size-3.5 shrink-0" />
                        {[c?.speciality?.nameEn, c?.province?.nameAr, c?.area?.nameAr]
                          .filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {c?.customerClass && (
                      <span className="chip mt-1.5 bg-brand-soft text-brand">
                        {c.customerClass.code}
                      </span>
                    )}
                  </div>
                </div>

                <dl className="mt-3 space-y-1 rounded-field bg-elevated px-3.5 py-2.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted">مقدّم الطلب:</dt>
                    <dd className="font-medium">
                      {r.requestedBy?.fullNameAr || r.requestedBy?.fullNameEn}
                    </dd>
                  </div>
                  {r.reason && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">السبب:</dt>
                      <dd>{r.reason}</dd>
                    </div>
                  )}
                </dl>

                {rejecting === r.id ? (
                  <div className="mt-3 space-y-2 animate-fade-up">
                    <input
                      className="field"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="سبب الرفض (يصل لمقدّم الطلب)…"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setRejecting(null); setNote(''); }}
                        className="btn-outline flex-1"
                        disabled={isBusy}
                      >
                        تراجع
                      </button>
                      <button
                        onClick={() => review(r.id, false, note)}
                        className="btn-danger flex-1"
                        disabled={isBusy}
                      >
                        {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                        تأكيد الرفض
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setRejecting(r.id)}
                      className="btn-outline flex-1 hover:!text-danger"
                      disabled={isBusy}
                    >
                      <XCircle className="size-4" />
                      رفض
                    </button>
                    <button
                      onClick={() => review(r.id, true)}
                      className="btn-brand flex-[2]"
                      disabled={isBusy}
                    >
                      {isBusy
                        ? <Loader2 className="size-4 animate-spin" />
                        : <CheckCircle2 className="size-4" />}
                      موافقة
                    </button>
                  </div>
                )}

                {c?.id && (
                  <Link
                    href={`/customers`}
                    className="mt-2 block text-center text-xs text-faint hover:text-brand"
                  >
                    عرض في القائمة
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
