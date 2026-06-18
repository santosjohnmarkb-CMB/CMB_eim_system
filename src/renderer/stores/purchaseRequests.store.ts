import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import type { PurchaseRequest } from '../../shared/types';

interface PurchaseRequestsState {
  requests: PurchaseRequest[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  getById: (id: string) => Promise<PurchaseRequest | null>;
  create: (data: any) => Promise<PurchaseRequest>;
  update: (id: string, data: any) => Promise<PurchaseRequest>;
  fulfill: (id: string) => Promise<PurchaseRequest>;
  cancel: (id: string) => Promise<PurchaseRequest>;
  remove: (id: string) => Promise<void>;
}

export const usePurchaseRequestsStore = create<PurchaseRequestsState>((set, get) => ({
  requests: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const requests = await ipcInvoke<PurchaseRequest[]>('db:purchaseRequests:getAll');
      set({ requests, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  getById: async (id: string) => {
    return await ipcInvoke<PurchaseRequest | null>('db:purchaseRequests:getById', id);
  },

  create: async (data: any) => {
    const result = await ipcInvoke<PurchaseRequest>('db:purchaseRequests:create', data);
    await get().fetchAll();
    return result;
  },

  update: async (id: string, data: any) => {
    const result = await ipcInvoke<PurchaseRequest>('db:purchaseRequests:update', id, data);
    await get().fetchAll();
    return result;
  },

  fulfill: async (id: string) => {
    const result = await ipcInvoke<PurchaseRequest>('db:purchaseRequests:fulfill', id);
    await get().fetchAll();
    return result;
  },

  cancel: async (id: string) => {
    const result = await ipcInvoke<PurchaseRequest>('db:purchaseRequests:cancel', id);
    await get().fetchAll();
    return result;
  },

  remove: async (id: string) => {
    await ipcInvoke('db:purchaseRequests:delete', id);
    await get().fetchAll();
  },
}));
