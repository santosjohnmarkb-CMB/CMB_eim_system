import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import type { PartsCatalogItem, PartsTransaction, PartsCompatibility } from '../../shared/types';

interface PartsState {
  items: PartsCatalogItem[];
  lowStockItems: PartsCatalogItem[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  fetchLowStock: () => Promise<void>;
  getById: (id: string) => Promise<PartsCatalogItem>;
  create: (data: any) => Promise<PartsCatalogItem>;
  update: (id: string, data: any) => Promise<PartsCatalogItem>;
  deletePart: (id: string) => Promise<void>;
  adjustStock: (data: any) => Promise<void>;
  getTransactions: (partId: string) => Promise<PartsTransaction[]>;
  getCompatibility: (partId: string) => Promise<PartsCompatibility[]>;
  setCompatibility: (partId: string, equipmentIds: string[]) => Promise<void>;
}

export const usePartsStore = create<PartsState>((set, get) => ({
  items: [],
  lowStockItems: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const items = await ipcInvoke<PartsCatalogItem[]>('db:parts:getAll');
      set({ items, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchLowStock: async () => {
    try {
      const items = await ipcInvoke<PartsCatalogItem[]>('db:parts:getLowStock');
      set({ lowStockItems: items });
    } catch { /* ignore */ }
  },

  getById: async (id: string) => {
    return await ipcInvoke<PartsCatalogItem>('db:parts:getById', id);
  },

  create: async (data: any) => {
    const result = await ipcInvoke<PartsCatalogItem>('db:parts:create', data);
    await get().fetchAll();
    return result;
  },

  update: async (id: string, data: any) => {
    const result = await ipcInvoke<PartsCatalogItem>('db:parts:update', id, data);
    await get().fetchAll();
    return result;
  },

  deletePart: async (id: string) => {
    await ipcInvoke('db:parts:delete', id);
    await get().fetchAll();
  },

  adjustStock: async (data: any) => {
    await ipcInvoke('db:parts:adjustStock', data);
    await get().fetchAll();
    await get().fetchLowStock();
  },

  getTransactions: async (partId: string) => {
    return await ipcInvoke<PartsTransaction[]>('db:parts:getTransactions', partId);
  },

  getCompatibility: async (partId: string) => {
    return await ipcInvoke<PartsCompatibility[]>('db:parts:getCompatibility', partId);
  },

  setCompatibility: async (partId: string, equipmentIds: string[]) => {
    await ipcInvoke('db:parts:setCompatibility', partId, equipmentIds);
  },
}));
