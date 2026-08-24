'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, Loader2, MapPin, Stethoscope, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface CustomerHit {
  id: number;
  code: string;
  nameAr: string;
  customerType: 'doctor' | 'pharmacy';
  status: string;
  speciality: string | null;
  province: string | null;
  area: string | null;
  street: string | null;
  hospital: string | null;
  workTime: string | null;
  classCode: string | null;
  monthlyTarget: number | null;
  inMyList: boolean;
}

/**
 * بحث فوري عن العميل مع خيار الإضافة.
 * يستبدل الكتابة الحرة التي أنتجت 1406 صيغة اسم في النظام القديم.
 */
export function CustomerSearch({
  customerType,
  value,
  onSelect,
  onCreateNew,
}: {
  customerType: 'doctor' | 'pharmacy';
  value: CustomerHit | null;
  onSelect: (c: CustomerHit) => void;
  onCreateNew: (name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // إلغاء الطلب السابق: ردّ بطيء لاستعلام قديم كان يدهس نتيجة أحدث
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await api.get<CustomerHit[]>(
          `/customers/search?q=${encodeURIComponent(q.trim())}&type=${customerType}&onlyMine=false`,
        );
        if (!ctrl.signal.aborted) {
          setHits(res);
          setCursor(0);
        }
      } catch {
        if (!ctrl.signal.aborted) setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 260);

    return () => { ctrl.abort(); clearTimeout(t); };
  }, [q, customerType]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const canCreate = q.trim().length >= 2;
  const options = canCreate ? hits.length + 1 : hits.length;

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !options) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % options); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + options) % options); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor < hits.length) pick(hits[cursor]);
      else if (canCreate) { onCreateNew(q.trim()); setOpen(false); }
    } else if (e.key === 'Escape') setOpen(false);
  }

  function pick(c: CustomerHit) {
    onSelect(c);
    setOpen(false);
    setQ('');
  }

  const noun = customerType === 'doctor' ? 'الطبيب' : 'الزبون';

  if (value) {
    return (
      <div className="rounded-field border-2 border-brand/30 bg-brand-soft/40 p-4 animate-scale-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{value.nameAr}</span>
              <span className="chip bg-surface text-muted num">{value.code}</span>
              {value.classCode && (
                <span className="chip bg-brand text-brand-ink">{value.classCode}</span>
              )}
              {value.status === 'pending' && (
                <span className="chip bg-warn-soft text-warn">بانتظار الموافقة</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {value.speciality && (
                <span className="inline-flex items-center gap-1.5">
                  <Stethoscope className="size-3.5" />{value.speciality}
                </span>
              )}
              {(value.province || value.area) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {[value.province, value.area].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ok">
              <Check className="size-3.5" />
              تُملأ كل بياناته تلقائياً في الزيارة
            </p>
          </div>
          <button type="button" onClick={() => onSelect(null as any)} className="btn-ghost !p-2 !text-xs shrink-0">
            تغيير
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-[1.125rem] text-faint" />
        <input
          className="field ps-10"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={`ابحث باسم ${noun}…`}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading && (
          <Loader2 className="absolute inset-y-0 end-3 my-auto size-[1.125rem] animate-spin text-faint" />
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div
          role="listbox"
          className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-field border border-line bg-surface shadow-pop animate-scale-in"
        >
          <div className="max-h-72 overflow-y-auto">
            {hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={i === cursor}
                onClick={() => pick(h)}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  'flex w-full items-start gap-3 px-3.5 py-3 text-start transition-colors border-b border-line last:border-0',
                  i === cursor && 'bg-elevated',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{h.nameAr}</span>
                    {h.inMyList && <span className="chip bg-ok-soft text-ok">في قائمتي</span>}
                    {h.status === 'pending' && <span className="chip bg-warn-soft text-warn">معلّق</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    <span className="num">{h.code}</span>
                    {h.speciality && ` · ${h.speciality}`}
                    {h.province && ` · ${h.province}`}
                    {h.area && ` / ${h.area}`}
                  </p>
                </div>
                {h.classCode && (
                  <span className="chip bg-elevated text-muted shrink-0">{h.classCode}</span>
                )}
              </button>
            ))}

            {!loading && !hits.length && (
              <p className="px-3.5 py-4 text-center text-sm text-faint">لا نتائج مطابقة</p>
            )}
          </div>

          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={cursor === hits.length}
              onClick={() => { onCreateNew(q.trim()); setOpen(false); }}
              onMouseEnter={() => setCursor(hits.length)}
              className={cn(
                'flex w-full items-center gap-2.5 border-t border-line px-3.5 py-3 text-start text-sm font-medium text-brand transition-colors',
                cursor === hits.length && 'bg-brand-soft',
              )}
            >
              <UserPlus className="size-4 shrink-0" />
              <span className="truncate">إضافة «{q.trim()}» كعميل جديد</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
