'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PlusCircle, ClipboardList, Users, TrendingUp, ArrowLeft,
  Stethoscope, Building2, CalendarClock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { cn, formatDate, formatNumber, relativeDay, todayBaghdad } from '@/lib/utils';

interface Visit {
  id: number; visitNo: string; visitDate: string; visitType: string;
  customerType: string; snapCustomerName: string; snapCustomerCode: string;
  snapProvince: string | null; snapClassCode: string | null;
  products: { role: string; product: { shortName: string } }[];
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [listSize, setListSize] = useState<number | null>(null);

  useEffect(() => {
    const to = todayBaghdad();
    const from = to.slice(0, 8) + '01';

    api.get<any>(`/visits?from=${from}&to=${to}&pageSize=100`)
      .then((r) => setVisits(r.items))
      .catch(() => setVisits([]));

    if (can('customers.view_own')) {
      api.get<any>('/customers/my-list?pageSize=1')
        .then((r) => setListSize(r.total))
        .catch(() => setListSize(0));
    }
  }, [can]);

  const today = todayBaghdad();
  const todayCount = visits?.filter((v) => v.visitDate.slice(0, 10) === today).length ?? 0;
  const monthCount = visits?.length ?? 0;
  const uniqueCustomers = new Set(visits?.map((v) => v.snapCustomerCode)).size;
  const coverage = listSize ? Math.round((uniqueCustomers / listSize) * 100) : null;

  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', hour: 'numeric', hour12: false }).format(new Date()),
  );
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء الخير';

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">{greeting}</p>
        <h1 className="text-2xl font-bold sm:text-3xl">{user?.fullName}</h1>
      </header>

      {can('visits.create') && (
        <Link
          href="/visits/new"
          className="group flex items-center gap-4 rounded-card bg-brand p-5 text-brand-ink shadow-lift transition-transform active:scale-[0.99]"
        >
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15">
            <PlusCircle className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">تسجيل زيارة جديدة</p>
            <p className="text-sm text-white/70">أقل من ٣٠ ثانية</p>
          </div>
          <ArrowLeft className="size-5 shrink-0 transition-transform group-hover:-translate-x-1" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="زيارات اليوم" value={todayCount} icon={CalendarClock} loading={!visits} />
        <Stat label="هذا الشهر" value={monthCount} icon={TrendingUp} loading={!visits} />
        <Stat label="عملاء مختلفون" value={uniqueCustomers} icon={Users} loading={!visits} />
        <Stat
          label="التغطية"
          value={coverage}
          suffix="%"
          icon={ClipboardList}
          loading={listSize === null && can('customers.view_own')}
          tone={coverage === null ? undefined : coverage >= 70 ? 'ok' : coverage >= 40 ? 'warn' : 'danger'}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">آخر الزيارات</h2>
          <Link href="/visits" className="text-sm text-brand hover:underline">عرض الكل</Link>
        </div>

        {!visits ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[4.5rem] rounded-card" />)}
          </div>
        ) : visits.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {visits.slice(0, 6).map((v) => <VisitRow key={v.id} v={v} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Stat({
  label, value, suffix, icon: Icon, loading, tone,
}: {
  label: string; value: number | null; suffix?: string;
  icon: typeof TrendingUp; loading?: boolean;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  if (loading) return <div className="skeleton h-24 rounded-card" />;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="size-4" />
        <span className="text-xs font-medium truncate">{label}</span>
      </div>
      <p
        className={cn(
          'mt-2 num text-2xl font-bold sm:text-3xl',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value === null ? '—' : formatNumber(value)}
        {value !== null && suffix && <span className="text-lg">{suffix}</span>}
      </p>
    </div>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const main = v.products.find((p) => p.role === 'main')?.product.shortName;
  const Icon = v.customerType === 'doctor' ? Stethoscope : Building2;

  return (
    <li>
      <Link href={`/visits/${v.id}`} className="card flex items-center gap-3 p-3.5 transition-colors hover:bg-elevated">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-elevated text-muted">
          <Icon className="size-[1.125rem]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{v.snapCustomerName}</span>
            {v.visitType === 'out_list' && (
              <span className="chip bg-warn-soft text-warn shrink-0">خارج القائمة</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-faint">
            {main}
            {v.snapProvince && ` · ${v.snapProvince}`}
            {v.snapClassCode && ` · ${v.snapClassCode}`}
          </p>
        </div>

        <div className="shrink-0 text-end">
          <p className="text-xs text-muted">{relativeDay(v.visitDate)}</p>
          <p className="num mt-0.5 text-[0.6875rem] text-faint">{formatDate(v.visitDate)}</p>
        </div>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="card grid place-items-center gap-3 p-10 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-elevated text-faint">
        <ClipboardList className="size-6" />
      </div>
      <div>
        <p className="font-medium">لا زيارات هذا الشهر</p>
        <p className="mt-1 text-sm text-faint">ابدأ بتسجيل زيارتك الأولى</p>
      </div>
      <Link href="/visits/new" className="btn-brand mt-1">
        <PlusCircle className="size-4" />
        زيارة جديدة
      </Link>
    </div>
  );
}
