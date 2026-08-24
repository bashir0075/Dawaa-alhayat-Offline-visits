'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      router.replace('/');
    } catch (err: any) {
      setError(err?.message ?? 'تعذّر تسجيل الدخول');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-bg">
      {/* اللوحة الترويجية — تختفي دون lg لتوفير المساحة للنموذج */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-brand p-12 text-brand-ink">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <div className="grid size-12 place-items-center rounded-2xl bg-white/15 backdrop-blur text-lg font-bold">
            دح
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">نظام تسجيل الزيارات</h1>
          <p className="mt-4 text-lg leading-relaxed text-white/75">
            سجّل زيارتك في أقل من ثلاثين ثانية — بحث ذكي عن العميل،
            وتعبئة تلقائية لكل بياناته.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6">
            {[
              ['١١', 'تقريراً جاهزاً'],
              ['٢١', 'منتجاً'],
              ['١٨', 'محافظة'],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="text-3xl font-bold">{n}</dt>
                <dd className="mt-1 text-sm text-white/60">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="relative text-sm text-white/50">© دواء الحياة</p>
      </div>

      {/* النموذج */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-brand text-brand-ink font-bold shadow-card">
              دح
            </div>
            <div>
              <p className="font-semibold">دواء الحياة</p>
              <p className="text-xs text-faint">نظام الزيارات</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold">تسجيل الدخول</h2>
          <p className="mt-1.5 text-sm text-muted">أدخل رقم المستخدم وكلمة المرور</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="u" className="label">اسم المستخدم</label>
              <input
                id="u"
                className="field num text-start"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="6905306500"
                autoComplete="username"
                inputMode="text"
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-faint">
                الرقم وحده يكفي — تُضاف <span className="num">@dawaa-alhayat</span> تلقائياً
              </p>
            </div>

            <div>
              <label htmlFor="p" className="label">كلمة المرور</label>
              <div className="relative">
                <input
                  id="p"
                  type={show ? 'text' : 'password'}
                  className="field num text-start pe-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 end-0 grid w-11 place-items-center text-faint hover:text-muted"
                  aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {show ? <EyeOff className="size-[1.125rem]" /> : <Eye className="size-[1.125rem]" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-field border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger animate-fade-up"
              >
                <AlertCircle className="size-[1.125rem] shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-brand w-full !py-3">
              {busy ? (
                <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <LogIn className="size-[1.125rem]" />
              )}
              {busy ? 'جارٍ الدخول…' : 'دخول'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-faint">
            نسيت كلمة المرور؟ راجع مديرك المباشر
          </p>
        </div>
      </div>
    </div>
  );
}
