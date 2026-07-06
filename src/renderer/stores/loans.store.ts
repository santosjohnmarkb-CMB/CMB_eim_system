import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import { reportLoadError } from '../lib/notify';
import type { EquipmentLoan, EquipmentLoanWithItems } from '../../shared/types';

interface LoansState {
  loans: EquipmentLoan[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  getById: (id: string) => Promise<EquipmentLoanWithItems | null>;
  create: (data: any) => Promise<EquipmentLoan>;
  update: (loanId: string, data: any) => Promise<EquipmentLoan>;
  returnItems: (loanId: string, itemIds: string[]) => Promise<void>;
  returnOrder: (loanId: string) => Promise<void>;
  uploadSignedForm: (loanId: string, dataUrl: string) => Promise<void>;
  clearSignedForm: (loanId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useLoansStore = create<LoansState>((set, get) => ({
  loans: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const loans = await ipcInvoke<EquipmentLoan[]>('db:loans:getAll');
      set({ loans, loading: false });
    } catch (err) {
      reportLoadError('loans', err);
      set({ loading: false });
    }
  },

  getById: async (id: string) => {
    return await ipcInvoke<EquipmentLoanWithItems | null>('db:loans:getById', id);
  },

  create: async (data: any) => {
    const result = await ipcInvoke<EquipmentLoan>('db:loans:create', data);
    await get().fetchAll();
    return result;
  },

  update: async (loanId: string, data: any) => {
    const result = await ipcInvoke<EquipmentLoan>('db:loans:update', loanId, data);
    await get().fetchAll();
    return result;
  },

  returnItems: async (loanId: string, itemIds: string[]) => {
    await ipcInvoke('db:loans:returnItems', loanId, { item_ids: itemIds });
    await get().fetchAll();
  },

  returnOrder: async (loanId: string) => {
    await ipcInvoke('db:loans:returnOrder', loanId);
    await get().fetchAll();
  },

  uploadSignedForm: async (loanId: string, dataUrl: string) => {
    await ipcInvoke('db:loans:uploadSignedForm', loanId, dataUrl);
  },

  clearSignedForm: async (loanId: string) => {
    await ipcInvoke('db:loans:clearSignedForm', loanId);
  },

  remove: async (id: string) => {
    await ipcInvoke('db:loans:delete', id);
    await get().fetchAll();
  },
}));
