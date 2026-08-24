'use client';

const BASE = '/api/v1';

const ACCESS = 'dv.access';
const REFRESH = 'dv.refresh';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleName?: string;
  permissions: string[];
  mustChangePassword?: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export const tokens = {
  get access() {
    return typeof window === 'undefined' ? null : localStorage.getItem(ACCESS);
  },
  get refresh() {
    return typeof window === 'undefined' ? null : localStorage.getItem(REFRESH);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

/**
 * تجديد التوكن مرة واحدة مهما تعدّدت الطلبات المتزامنة.
 * بدون هذا، عشرة طلبات تنتهي صلاحيتها معاً تُطلق عشر عمليات
 * تجديد — وكل واحدة تُبطل توكن الأخرى لأن التدوير مفعّل.
 */
let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });

  if (!res.ok) {
    tokens.clear();
    return false;
  }
  const data = await res.json();
  tokens.set(data.accessToken, data.refreshToken);
  return true;
}

async function refreshOnce(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: any; raw?: boolean; retry?: boolean } = {},
): Promise<T> {
  const access = tokens.access;

  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (res.status === 401 && opts.retry !== false && tokens.refresh) {
    if (await refreshOnce()) {
      return request<T>(method, path, { ...opts, retry: false });
    }
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
    throw new ApiError(401, 'انتهت الجلسة');
  }

  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'فشل التحميل');
    return res as unknown as T;
  }

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    // NestJS يعيد message كنص أو كمصفوفة من أخطاء التحقق
    const msg = Array.isArray(data?.message)
      ? data.message.join(' · ')
      : data?.message || 'حدث خطأ غير متوقع';
    throw new ApiError(res.status, msg, data);
  }

  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body?: any) => request<T>('POST', p, { body }),
  raw: (p: string) => request<Response>('GET', p, { raw: true }),

  async login(username: string, password: string) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, data?.message || 'فشل تسجيل الدخول', data);
    }
    tokens.set(data.accessToken, data.refreshToken);
    return data.user as AuthUser;
  },

  async logout() {
    const rt = tokens.refresh;
    if (rt) await request('POST', '/auth/logout', { body: { refreshToken: rt } }).catch(() => {});
    tokens.clear();
  },

  /** تنزيل ملف — الاسم يأتي من ترويسة الخادم */
  async download(path: string, fallbackName: string) {
    const res = await request<Response>('GET', path, { raw: true });
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
