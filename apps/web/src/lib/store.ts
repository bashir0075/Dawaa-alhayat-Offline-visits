'use client';

import { create } from 'zustand';
import { api, tokens, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login: (u: string, p: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,

  async hydrate() {
    if (!tokens.access && !tokens.refresh) {
      set({ user: null, loading: false });
      return;
    }
    try {
      const me = await api.get<any>('/auth/me');
      set({
        user: { ...me, role: me.roleKey, fullName: me.fullName },
        loading: false,
      });
    } catch {
      tokens.clear();
      set({ user: null, loading: false });
    }
  },

  async login(username, password) {
    const user = await api.login(username, password);
    set({ user, loading: false });
    return user;
  },

  async logout() {
    await api.logout();
    set({ user: null });
  },

  // super_admin يتجاوز كل شيء — نفس قاعدة PermissionsGuard في الخادم
  can(permission) {
    const u = get().user;
    if (!u) return false;
    return u.role === 'super_admin' || u.permissions.includes(permission);
  },
}));

interface Toast { id: number; kind: 'ok' | 'err' | 'info'; text: string }

interface UiState {
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismiss: (id: number) => void;
}

export const useUi = create<UiState>((set) => ({
  toasts: [],
  toast(kind, text) {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
