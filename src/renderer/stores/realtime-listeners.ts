import { ipcOn, ipcRemoveListener } from '../lib/ipc';
import { useEquipmentStore } from './equipment.store';
import { useMaintenanceStore } from './maintenance.store';
import { usePartsStore } from './parts.store';
import { useVendorsStore } from './vendors.store';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const dataChangedHandler = (...args: unknown[]) => {
  const payload = args[0] as { table: string } | undefined;
  if (!payload) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const { table } = payload;

    if (['categories', 'subcategories', 'equipment_items', 'equipment_assets'].includes(table)) {
      useEquipmentStore.getState().fetchAll();
      useEquipmentStore.getState().fetchDashboardStats();
    }
    if (['maintenance_tickets', 'maintenance_notes'].includes(table)) {
      useMaintenanceStore.getState().fetchAll();
    }
    if (['parts_catalog', 'parts_inventory', 'parts_transactions'].includes(table)) {
      usePartsStore.getState().fetchAll();
      usePartsStore.getState().fetchLowStock();
    }
    if (table === 'vendors') {
      useVendorsStore.getState().fetchAll();
    }
  }, 100);
};

export function initRealtimeListeners(): void {
  ipcOn('sync:dataChanged', dataChangedHandler);
}

export function cleanupRealtimeListeners(): void {
  ipcRemoveListener('sync:dataChanged', dataChangedHandler);
}
