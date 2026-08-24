'use client';

import { useEffect, useState } from 'react';
import { Users, Stethoscope, Building2, Search } from 'lucide-react';
import { api } from '@/lib/api';

export default function CustomersPage() {
  const [data, setData] = useState<any>(null);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ pageSize: '200' });
    if (type) p.set('type', type);
    api.get<any>(`/customers/my-list?${p}`).then(setData).catch(() => setData({ items: [], total: 0 }));
  }, [type]);

  const items = (data?.items ?? []).filter((c: any) => {
    const s = q.trim();
    return !s || c.nameAr.includes(s) || c.code.includes(s);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">قائمتي</h1>
        {data && <span className="chip bg-elevated text-muted num">{data.total}</span>}
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-[2]">
          <label className="label" htmlFor="s">بحث</label>
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
            <input id="s" className="field ps-9" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="بالاسم أو الكود…" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="ty">النوع</label>
          <select id="ty" className="field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">الكل</option>
            <option value="doctor">أطباء</option>
            <option value="pharmacy">صيدليات</option>
          </select>
        </div>
      </div>

      {!data ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-card" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card grid place-items-center gap-3 p-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-elevated text-faint">
            <Users className="size-6" />
          </div>
          <div>
            <p className="font-medium">{q ? 'لا نتائج' : 'قائمتك فارغة'}</p>
            <p className="mt-1 text-sm text-faint">
              كل زيارة خارج القائمة تضيف العميل هنا تلقائياً
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c: any) => {
            const Icon = c.customerType === 'doctor' ? Stethoscope : Building2;
            return (
              <div key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{c.nameAr}</span>
                      {c.status === 'pending' && <span className="chip bg-warn-soft text-warn">معلّق</span>}
                      {c.customerClass && (
                        <span className="chip bg-brand-soft text-brand">{c.customerClass.code}</span>
                      )}
                    </div>
                    <p className="num mt-0.5 text-xs text-faint">{c.code}</p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {c.speciality?.nameEn}
                      {c.province && ` · ${c.province.nameAr}`}
                      {c.area && ` / ${c.area.nameAr}`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
