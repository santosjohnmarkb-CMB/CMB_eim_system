import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import type { Vendor } from '../../shared/types';

interface VendorsState {
  vendors: Vendor[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  create: (data: any) => Promise<Vendor>;
  update: (id: string, data: any) => Promise<Vendor>;
  deleteVendor: (id: string) => Promise<void>;
}

export const useVendorsStore = create<VendorsState>((set, get) => ({
  vendors: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const vendors = await ipcInvoke<Vendor[]>('db:vendors:getAll');
      set({ vendors, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (data: any) => {
    const result = await ipcInvoke<Vendor>('db:vendors:create', data);
    await get().fetchAll();
    return result;
  },

  update: async (id: string, data: any) => {
    const result = await ipcInvoke<Vendor>('db:vendors:update', id, data);
    await get().fetchAll();
    return result;
  },

  deleteVendor: async (id: string) => {
    await ipcInvoke('db:vendors:delete', id);
    await get().fetchAll();
  },
}));
