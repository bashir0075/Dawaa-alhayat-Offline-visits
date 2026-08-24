'use client';

import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Package, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';
import { cn, todayBaghdad } from '@/lib/utils';

interface Report {
  key: string; titleAr: string; titleEn: string;
  description: string; requiresTargets: boolean;
}

export default function ReportsPage() {
  const toast = useUi((s) => s.toast);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [classesReady, setClassesReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const to = todayBaghdad();
  const [from, setFrom] = useState(to.slice(0, 5) + '01-01');
  const [until, setUntil] = useState(to);

  useEffect(() => {
    api.get<Report[]>('/reports').then(setReports).catch(() => setReports([]));
    api.get<any>('/catalog/bootstrap').then((b) => setClassesReady(b.classesReady)).catch(() => {});
  }, []);

  async function download(key: string | null) {
    const id = key ?? '__full__';
    setBusy(id);
    try {
      const path = key
        ? `/reports/export?key=${key}&from=${from}&to=${until}`
        : `/reports/export/full?from=${from}&to=${until}`;
      await api.download(path, `${id}_${from}_${until}.xlsx`);
      toast('ok', 'اكتمل التنزيل');
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold sm:text-2xl">التقارير</h1>

      {!classesReady && (
        <div className="flex items-start gap-3 rounded-card border border-warn/25 bg-warn-soft p-4 text-sm text-warn">
          <AlertTriangle className="size-5 shrink-0 mt-px" />
          <div>
            <p className="font-semibold">تارغيت التصنيفات غير مضبوط</p>
            <p className="mt-0.5 text-warn/80">
              تقرير «تحقيق التارغيت» يحتاج ضبط A1…C2 من صفحة الإدارة أولاً.
            </p>
          </div>
        </div>
      )}

      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="f">من تاريخ</label>
          <input id="f" type="date" className="field num" value={from} max={until}
                 onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="t">إلى تاريخ</label>
          <input id="t" type="date" className="field num" value={until} max={to}
                 onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>

      <button
        onClick={() => download(null)}
        disabled={busy !== null}
        className="group flex w-full items-center gap-4 rounded-card bg-brand p-5 text-brand-ink shadow-lift transition-transform active:scale-[0.99] disabled:opacity-60"
      >
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15">
          {busy === '__full__'
            ? <Loader2 className="size-6 animate-spin" />
            : <Package className="size-6" />}
        </div>
        <div className="min-w-0 flex-1 text-start">
          <p className="font-semibold">المصنّف الشامل</p>
          <p className="text-sm text-white/70">كل التقارير في ملف Excel واحد</p>
        </div>
        <Download className="size-5 shrink-0" />
      </button>

      {!reports ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-card" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {reports.map((r) => {
            const blocked = r.requiresTargets && !classesReady;
            return (
              <button
                key={r.key}
                onClick={() => download(r.key)}
                disabled={busy !== null || blocked}
                className={cn(
                  'card flex items-start gap-3 p-4 text-start transition-colors',
                  blocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-elevated',
                )}
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                  {busy === r.key
                    ? <Loader2 className="size-[1.125rem] animate-spin" />
                    : <FileSpreadsheet className="size-[1.125rem]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.titleAr}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-faint">{r.description}</p>
                  {blocked && <p className="mt-1.5 text-xs text-warn">يحتاج ضبط التارغيت</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
