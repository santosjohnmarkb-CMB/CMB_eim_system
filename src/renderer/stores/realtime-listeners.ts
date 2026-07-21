import { ipcOn, ipcRemoveListener } from '../lib/ipc';
import { useEquipmentStore } from './equipment.store';
import { useMaintenanceStore } from './maintenance.store';
import { usePartsStore } from './parts.store';
import { useVendorsStore } from './vendors.store';
import { useLoansStore } from './loans.store';
import { usePurchaseRequestsStore } from './purchaseRequests.store';
import { usePackageStore } from './package.store';

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
    // Package edits (locally or from another machine via Supabase realtime) refresh
    // the packages list. equipment_items also touches packages since a package's
    // price/name lives on its main equipment item.
    if (['package_definitions', 'package_items', 'equipment_items'].includes(table)) {
      usePackageStore.getState().fetchAll();
    }
    if (['maintenance_tickets', 'maintenance_notes', 'ticket_actions'].includes(table)) {
      useMaintenanceStore.getState().fetchAll();
    }
    if (['parts_catalog', 'parts_inventory', 'parts_transactions'].includes(table)) {
      usePartsStore.getState().fetchAll();
      usePartsStore.getState().fetchLowStock();
    }
    if (table === 'vendors') {
      useVendorsStore.getState().fetchAll();
    }
    if (['equipment_loans', 'equipment_loan_items'].includes(table)) {
      useLoansStore.getState().fetchAll();
    }
    if (['purchase_requests', 'purchase_request_items'].includes(table)) {
      usePurchaseRequestsStore.getState().fetchAll();
    }
  }, 100);
};

export function initRealtimeListeners(): void {
  ipcOn('sync:dataChanged', dataChangedHandler);
}

export function cleanupRealtimeListeners(): void {
  ipcRemoveListener('sync:dataChanged', dataChangedHandler);
}
