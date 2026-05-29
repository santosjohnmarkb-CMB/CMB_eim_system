import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import type { User } from '../../shared/types';
import { useDepartmentStore } from './department.store';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  loading: false,

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
