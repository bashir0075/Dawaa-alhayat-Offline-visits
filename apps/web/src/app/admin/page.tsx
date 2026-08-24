'use client';

import { useEffect, useState } from 'react';
import { Save, Loader2, Target, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useUi } from '@/lib/store';

interface ClassRow { id: number; code: string; classLetter: string; monthlyTarget: number }

export default function AdminPage() {
  const toast = useUi((s) => s.toast);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<ClassRow[]>('/catalog/classes')
      .then((c) => {
        setClasses(c);
        setEdits(Object.fromEntries(c.map((x) => [x.code, String(x.monthlyTarget)])));
      })
      .catch(() => setClasses([]));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.post('/catalog/classes/targets', {
        targets: Object.entries(edits).map(([code, v]) => ({ code, monthlyTarget: Number(v) || 0 })),
      });
      toast('ok', 'حُفظ التارغيت — تقرير التحقيق مفعّل الآن');
      setClasses(await api.get<ClassRow[]>('/catalog/classes'));
    } catch (e: any) {
      toast('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = classes?.every((c) => (Number(edits[c.code]) || 0) > 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold sm:text-2xl">الإدارة</h1>

      <section className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Target className="size-[1.125rem] text-brand" />
          <h2 className="font-semibold">تارغيت التصنيفات</h2>
          {ready && <CheckCircle2 className="size-4 text-ok" />}
        </div>
        <p className="mb-5 text-sm text-muted">
          كم زيارة شهرياً لكل تصنيف. تقرير تحقيق التارغيت معطّل حتى تُملأ.
        </p>

        {!classes ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-16 rounded-field" />)}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {classes.map((c) => (
                <div key={c.code}>
                  <label className="label" htmlFor={c.code}>{c.code}</label>
                  <input
                    id={c.code}
                    type="number"
                    min={0}
                    max={31}
                    className="field num"
                    value={edits[c.code] ?? ''}
                    onChange={(e) => setEdits((s) => ({ ...s, [c.code]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <button onClick={save} disabled={busy} className="btn-brand mt-5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              حفظ
            </button>
          </>
        )}
      </section>
    </div>
  );
}
