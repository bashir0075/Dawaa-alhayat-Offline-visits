'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, PlusCircle, ClipboardList, Users, BarChart3,
  Settings, LogOut, Menu, X, Moon, Sun, ChevronLeft, Bell,
} from 'lucide-react';
import { useAuth, useUi } from '@/lib/store';
import { cn, initials } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  /** يظهر في الشريط السفلي على الجوال */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { href: '/',          label: 'الرئيسية',   icon: LayoutDashboard, primary: true },
  { href: '/visits/new', label: 'زيارة جديدة', icon: PlusCircle, permission: 'visits.create', primary: true },
  { href: '/visits',    label: 'الزيارات',   icon: ClipboardList, permission: 'visits.view_own', primary: true },
  { href: '/customers', label: 'قائمتي',     icon: Users, permission: 'customers.view_own', primary: true },
  { href: '/reports',   label: 'التقارير',   icon: BarChart3, permission: 'reports.view_own', primary: true },
  { href: '/admin',     label: 'الإدارة',    icon: Settings, permission: 'users.view' },
];

/* ────────────────────────────────────────────────────────────── */

function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('dv.theme');
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'dark' : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('dv.theme', next ? 'dark' : 'light');
      return next;
    });
  };

  return { dark, toggle };
}

/* ────────────────────────────────────────────────────────────── */

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, hydrate, logout, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const { dark, toggle } = useTheme();

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!loading && !user && !pathname.startsWith('/login')) router.replace('/login');
  }, [loading, user, pathname, router]);

  // إغلاق الدرج عند التنقل — وإلا بقي مفتوحاً فوق الصفحة الجديدة
  useEffect(() => { setDrawer(false); }, [pathname]);

  // منع تمرير الخلفية أثناء فتح الدرج
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawer]);

  if (pathname.startsWith('/login')) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="min-h-dvh grid place-items-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-full border-[3px] border-line border-t-brand animate-spin" />
          <p className="text-sm text-faint">جارٍ التحميل…</p>
        </div>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.permission || can(n.permission));
  const primary = items.filter((n) => n.primary).slice(0, 5);

  // أطول مسار مطابق يفوز: بدونه يُضيء /visits و /visits/new معاً
  const matched = items
    .filter((n) => (n.href === '/' ? pathname === '/' : pathname === n.href || pathname.startsWith(n.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const active = (href: string) => matched?.href === href;

  return (
    <div className="min-h-dvh bg-bg">
      {/* ═══ شريط جانبي — ديسكتوب وتابليت أفقي (lg+) ═══ */}
      <aside className="hidden lg:flex fixed inset-y-0 right-0 z-30 w-64 flex-col border-l border-line bg-surface">
        <Brand />
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {items.map((it) => (
            <NavLink key={it.href} item={it} active={active(it.href)} />
          ))}
        </nav>
        <UserCard user={user} dark={dark} onToggle={toggle} onLogout={async () => { await logout(); router.replace('/login'); }} />
      </aside>

      {/* ═══ درج منزلق — جوال وتابليت (< lg) ═══ */}
      {drawer && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-scale-in"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <aside className="lg:hidden fixed inset-y-0 right-0 z-50 w-[17rem] flex flex-col bg-surface border-l border-line shadow-pop">
            <div className="flex items-center justify-between pe-2">
              <Brand />
              <button onClick={() => setDrawer(false)} className="btn-ghost !p-2" aria-label="إغلاق">
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {items.map((it) => (
                <NavLink key={it.href} item={it} active={active(it.href)} />
              ))}
            </nav>
            <UserCard user={user} dark={dark} onToggle={toggle} onLogout={async () => { await logout(); router.replace('/login'); }} />
          </aside>
        </>
      )}

      {/* ═══ المحتوى ═══ */}
      <div className="lg:pe-64">
        {/* شريط علوي — يظهر دون lg فقط */}
        <header className="lg:hidden sticky top-0 z-20 safe-t bg-surface/85 backdrop-blur-xl border-b border-line">
          <div className="flex h-14 items-center gap-2 px-3">
            <button onClick={() => setDrawer(true)} className="btn-ghost !p-2" aria-label="القائمة">
              <Menu className="size-5" />
            </button>
            <span className="font-semibold text-[0.9375rem] truncate">
              {items.find((i) => active(i.href))?.label ?? 'دواء الحياة'}
            </span>
            <button onClick={toggle} className="btn-ghost !p-2 ms-auto" aria-label="تبديل المظهر">
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[88rem] px-4 py-5 sm:px-6 lg:px-8 lg:py-8 pb-[calc(var(--nav-h)+1.5rem)] md:pb-8">
          {children}
        </main>
      </div>

      {/* ═══ شريط سفلي — الجوال فقط (< md) ═══ */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 safe-b bg-surface/90 backdrop-blur-xl border-t border-line">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0,1fr))` }}>
          {primary.map((it) => {
            const on = active(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 transition-colors',
                  on ? 'text-brand' : 'text-faint active:text-muted',
                )}
              >
                <it.icon className={cn('size-[1.375rem] transition-transform', on && 'scale-110')} strokeWidth={on ? 2.4 : 1.9} />
                <span className="text-[0.6875rem] font-medium leading-none">{it.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <Toasts />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 h-16 shrink-0">
      <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink font-bold text-sm shadow-card">
        دح
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-[0.9375rem] leading-tight truncate">دواء الحياة</p>
        <p className="text-[0.6875rem] text-faint leading-tight">نظام الزيارات</p>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-3 rounded-field px-3 py-2.5 mb-0.5 text-[0.9375rem] font-medium transition-colors',
        active
          ? 'bg-brand-soft text-brand'
          : 'text-muted hover:bg-elevated hover:text-ink',
      )}
    >
      {active && <span className="absolute inset-y-2 -end-3 w-1 rounded-full bg-brand" />}
      <item.icon className="size-[1.125rem] shrink-0" strokeWidth={active ? 2.3 : 1.9} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function UserCard({
  user, dark, onToggle, onLogout,
}: { user: any; dark: boolean; onToggle: () => void; onLogout: () => void }) {
  return (
    <div className="border-t border-line p-3 safe-b">
      <div className="flex items-center gap-3 rounded-field px-2 py-2">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-elevated text-sm font-semibold text-muted">
          {initials(user.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{user.fullName}</p>
          <p className="text-xs text-faint truncate">{user.roleName ?? user.role}</p>
        </div>
      </div>
      <div className="mt-1 flex gap-1">
        <button onClick={onToggle} className="btn-ghost flex-1 !py-2 !text-sm">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {dark ? 'فاتح' : 'داكن'}
        </button>
        <button onClick={onLogout} className="btn-ghost flex-1 !py-2 !text-sm hover:!text-danger">
          <LogOut className="size-4" />
          خروج
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useUi();
  if (!toasts.length) return null;

  return (
    <div className="fixed z-[60] inset-x-3 bottom-[calc(var(--nav-h)+0.75rem)] md:bottom-4 md:inset-x-auto md:start-4 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            'pointer-events-auto text-start w-full md:w-[24rem] rounded-field px-4 py-3 text-sm shadow-pop animate-fade-up border',
            t.kind === 'ok' && 'bg-ok-soft text-ok border-ok/25',
            t.kind === 'err' && 'bg-danger-soft text-danger border-danger/25',
            t.kind === 'info' && 'bg-surface text-ink border-line',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
