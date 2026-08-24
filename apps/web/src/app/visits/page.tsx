'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, Filter, Stethoscope, Building2, Lock, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { cn, formatDate, todayBaghdad } from '@/lib/utils';

export default function VisitsPage() {
  const can = useAuth((s) => s.can);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const to = todayBaghdad();
  const [from, setFrom] = useState(to.slice(0, 8) + '01');
  const [type, setType] = useState('');

  useEffect(() => {
    setData(null);
    const q = new URLSearchParams({ from, to, page: String(page), pageSize: '30' });
    if (type) q.set('visitType', type);
    api.get<any>(`/visits?${q}`).then(setData).catch(() => setData({ items: [], total: 0 }));
  }, [from, to, page, type]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">الزيارات</h1>
        {can('visits.create') && (
          <Link href="/visits/new" className="btn-brand !py-2">
            <PlusCircle className="size-4" />
            <span className="hidden sm:inline">زيارة جديدة</span>
          </Link>
        )}
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="f">من تاريخ</label>
          <input id="f" type="date" className="field num" value={from} max={to}
                 onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="t">النوع</label>
          <select id="t" className="field" value={type}
                  onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">الكل</option>
            <option value="in_list">داخل القائمة</option>
            <option value="out_list">خارج القائمة</option>
          </select>
        </div>
      </div>

      {!data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20 rounded-card" />)}
        </div>
      ) : data.items.length === 0 ? (
        <div className="card grid place-items-center gap-3 p-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-elevated text-faint">
            <ClipboardList className="size-6" />
          </div>
          <p className="font-medium">لا زيارات في هذه الفترة</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            <span className="num font-medium">{data.total}</span> زيارة
          </p>

          {/* بطاقات على الجوال — جدول على الشاشات الكبيرة */}
          <ul className="space-y-2 lg:hidden">
            {data.items.map((v: any) => <Card key={v.id} v={v} />)}
          </ul>

          <div className="hidden lg:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-elevated text-muted">
                <tr>
                  {['الرقم', 'التاريخ', 'العميل', 'الاختصاص', 'الموقع', 'المنتج', 'النوع'].map((h) => (
                    <th key={h} className="px-4 py-3 text-start font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((v: any) => (
                  <tr key={v.id} className="transition-colors hover:bg-elevated">
                    <td className="px-4 py-3">
                      <Link href={`/visits/${v.id}`} className="num text-brand hover:underline">{v.visitNo}</Link>
                    </td>
                    <td className="num px-4 py-3 whitespace-nowrap">{formatDate(v.visitDate)}</td>
                    <td className="px-4 py-3 font-medium">{v.snapCustomerName}</td>
                    <td className="px-4 py-3 text-muted">{v.snapSpeciality ?? '—'}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {[v.snapProvince, v.snapArea].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {v.products.find((p: any) => p.role === 'main')?.product.shortName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('chip', v.visitType === 'out_list'
                        ? 'bg-warn-soft text-warn' : 'bg-elevated text-muted')}>
                        {v.visitType === 'out_list' ? 'خارج' : 'داخل'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-outline !py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </button>
              <span className="num text-sm text-muted">{page} / {data.pages}</span>
              <button className="btn-outline !py-2" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                التالي
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ v }: { v: any }) {
  const Icon = v.customerType === 'doctor' ? Stethoscope : Building2;
  const main = v.products.find((p: any) => p.role === 'main')?.product.shortName;
  return (
    <li>
      <Link href={`/visits/${v.id}`} className="card block p-4 transition-colors hover:bg-elevated">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{v.snapCustomerName}</span>
              {v.visitType === 'out_list' && <span className="chip bg-warn-soft text-warn">خارج القائمة</span>}
              <Lock className="size-3 text-faint" />
            </div>
            <p className="mt-1 text-sm text-muted">{main}</p>
            <p className="mt-1 text-xs text-faint">
              <span className="num">{v.visitNo}</span> · <span className="num">{formatDate(v.visitDate)}</span>
              {v.snapProvince && ` · ${v.snapProvince}`}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}
