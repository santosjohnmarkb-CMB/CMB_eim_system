import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import type { User } from '../../shared/types';
import { useDepartmentStore } from './department.store';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  // False until the initial session-restore attempt completes. Routes wait on
  // this so a reload doesn't flash the login page before the session is known.
  hydrated: boolean;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  loading: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const user = await ipcInvoke<User | null>('auth:getSession');
      if (user) {
        set({ user, isAuthenticated: true });
        useDepartmentStore.getState().initFromUser(user.department);
      }
    } catch { /* no active session — stay logged out */ }
    set({ hydrated: true });
  },

  login: async (username: string, password: string) => {
    set({ loading: true });
    try {
      const user = await ipcInvoke<User | null>('auth:login', username, password);
      if (user) {
        set({ user, isAuthenticated: true, loading: false });
        useDepartmentStore.getState().initFromUser(user.department);
      } else {
        set({ loading: false });
      }
      return user;
    } catch {
      set({ loading: false });
      return null;
    }
  },

  logout: async () => {
    try {
      await ipcInvoke('auth:logout');
    } catch { /* ignore */ }
    set({ user: null, isAuthenticated: false });
    useDepartmentStore.getState().initFromUser(null);
  },
}));
