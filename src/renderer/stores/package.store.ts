import { create } from 'zustand';
import type { PackageDefinition } from '../../shared/types';
import { ipcInvoke } from '../lib/ipc';
import { reportLoadError } from '../lib/notify';

// Wire shape shared by create + update. Mirrors the packages IPC handler payload.
export interface PackageInput {
  main_item_id: string;
  name: string;
  description: string;
  package_cost: number;
  components: Array<{ equipment_id: string; qty: number; is_required: boolean }>;
}

interface PackageState {
  packages: PackageDefinition[];
  isLoading: boolean;
  error: string | null;

  fetchAll: () => Promise<void>;
  createPackage: (data: PackageInput) => Promise<PackageDefinition>;
  updatePackage: (id: string, data: PackageInput) => Promise<PackageDefinition>;
  deletePackage: (id: string) => Promise<void>;
}

export const usePackageStore = create<PackageState>((set, get) => ({
  packages: [],
  isLoading: false,
  error: null,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const packages = await ipcInvoke<PackageDefinition[]>('db:packages:getAll');
      set({ packages, isLoading: false });
    } catch (error) {
      const message = reportLoadError('packages', error);
      set({ error: message, isLoading: false });
    }
  },

  createPackage: async (data) => {
    const result = await ipcInvoke<PackageDefinition>('db:packages:create', data);
    await get().fetchAll();
    return result;
  },

  updatePackage: async (id, data) => {
    const result = await ipcInvoke<PackageDefinition>('db:packages:update', id, data);
    await get().fetchAll();
    return result;
  },

  deletePackage: async (id) => {
    await ipcInvoke('db:packages:delete', id);
    await get().fetchAll();
  },
}));
