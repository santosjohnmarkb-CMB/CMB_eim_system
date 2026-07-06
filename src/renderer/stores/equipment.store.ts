import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import { reportLoadError } from '../lib/notify';
import type { EquipmentWithAsset, Category, Subcategory, DashboardStats, AssetStatusLogEntry } from '../../shared/types';

interface EquipmentState {
  items: EquipmentWithAsset[];
  categories: Category[];
  subcategories: Subcategory[];
  loading: boolean;
  dashboardStats: DashboardStats | null;
  fetchAll: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchSubcategories: () => Promise<void>;
  fetchDashboardStats: (categoryNames?: string[]) => Promise<void>;
  createEquipment: (data: any) => Promise<EquipmentWithAsset>;
  updateEquipment: (id: string, data: any) => Promise<EquipmentWithAsset>;
  deleteEquipment: (id: string) => Promise<void>;
  updateStatus: (equipmentId: string, newStatus: string, reason: string) => Promise<void>;
  batchUpdateStatus: (ids: string[], newStatus: string, reason: string) => Promise<void>;
  updateAsset: (data: { asset_id: string; serial_number?: string; vendor_name?: string | null; delivered_date?: string | null }) => Promise<void>;
  updateAssetStatus: (data: { asset_id: string; status: string; reason?: string }) => Promise<void>;
  getStatusLog: (equipmentId: string) => Promise<AssetStatusLogEntry[]>;
  generateCode: (categoryId: string) => Promise<string>;
  importCsv: (csvContent: string) => Promise<any>;
}

export const useEquipmentStore = create<EquipmentState>((set, get) => ({
  items: [],
  categories: [],
  subcategories: [],
  loading: false,
  dashboardStats: null,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const items = await ipcInvoke<EquipmentWithAsset[]>('db:equipment:getAll');
      set({ items, loading: false });
    } catch (err) {
      reportLoadError('equipment', err);
      set({ loading: false });
    }
  },

  fetchCategories: async () => {
    try {
      const categories = await ipcInvoke<Category[]>('db:categories:getAll');
      set({ categories });
    } catch { /* ignore */ }
  },

  fetchSubcategories: async () => {
    try {
      const subcategories = await ipcInvoke<Subcategory[]>('db:subcategories:getAll');
      set({ subcategories });
    } catch { /* ignore */ }
  },

  fetchDashboardStats: async (categoryNames?: string[]) => {
    try {
      const stats = await ipcInvoke<DashboardStats>('db:equipment:getDashboardStats', categoryNames);
      set({ dashboardStats: stats });
    } catch { /* ignore */ }
  },

  createEquipment: async (data: any) => {
    const result = await ipcInvoke<EquipmentWithAsset>('db:equipment:create', data);
    await get().fetchAll();
    return result;
  },

  updateEquipment: async (id: string, data: any) => {
    const result = await ipcInvoke<EquipmentWithAsset>('db:equipment:update', id, data);
    await get().fetchAll();
    return result;
  },

  deleteEquipment: async (id: string) => {
    await ipcInvoke('db:equipment:delete', id);
    await get().fetchAll();
  },

  updateStatus: async (equipmentId: string, newStatus: string, reason: string) => {
    await ipcInvoke('db:equipment:updateStatus', equipmentId, newStatus, reason);
    await get().fetchAll();
    await get().fetchDashboardStats();
  },

  batchUpdateStatus: async (ids: string[], newStatus: string, reason: string) => {
    await ipcInvoke('db:equipment:batchUpdateStatus', ids, newStatus, reason);
    await get().fetchAll();
    await get().fetchDashboardStats();
  },

  updateAsset: async (data) => {
    await ipcInvoke('db:equipment:updateAsset', data);
    await get().fetchAll();
  },

  updateAssetStatus: async (data) => {
    await ipcInvoke('db:equipment:updateAssetStatus', data);
    await get().fetchAll();
    await get().fetchDashboardStats();
  },

  getStatusLog: async (equipmentId: string) => {
    return await ipcInvoke<AssetStatusLogEntry[]>('db:equipment:getStatusLog', equipmentId);
  },

  generateCode: async (categoryId: string) => {
    return await ipcInvoke<string>('db:equipment:generateCode', categoryId);
  },

  importCsv: async (csvContent: string) => {
    const result = await ipcInvoke('db:equipment:importCsv', csvContent);
    await get().fetchAll();
    return result;
  },
}));
