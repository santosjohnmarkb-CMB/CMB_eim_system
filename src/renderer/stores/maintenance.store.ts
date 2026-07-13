import { create } from 'zustand';
import { ipcInvoke } from '../lib/ipc';
import { reportLoadError } from '../lib/notify';
import type { MaintenanceTicket, MaintenanceNote, PreventiveSchedule, TicketAction, CompletedHistoryEntry } from '../../shared/types';

interface MaintenanceState {
  tickets: MaintenanceTicket[];
  schedules: PreventiveSchedule[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  fetchSchedules: () => Promise<void>;
  getById: (id: string) => Promise<MaintenanceTicket>;
  create: (data: any) => Promise<MaintenanceTicket>;
  update: (id: string, data: any) => Promise<MaintenanceTicket>;
  updateStatus: (id: string, newStatus: string, outcome?: string | null) => Promise<void>;
  uploadServiceDoc: (id: string, dataUrl: string) => Promise<void>;
  clearServiceDoc: (id: string) => Promise<void>;
  addNote: (data: any) => Promise<MaintenanceNote>;
  getNotes: (ticketId: string) => Promise<MaintenanceNote[]>;
  consumeParts: (ticketId: string, parts: any[]) => Promise<void>;
  createSchedule: (data: any) => Promise<PreventiveSchedule>;
  updateSchedule: (id: string, data: any) => Promise<PreventiveSchedule>;
  deleteSchedule: (id: string) => Promise<void>;
  getActions: (ticketId: string) => Promise<TicketAction[]>;
  archiveReleaseForm: (id: string, inChargeOfRepair: string) => Promise<{ savedLocally: boolean; uploadedToDrive: boolean }>;
  addAction: (data: any) => Promise<TicketAction>;
  updateAction: (id: string, data: any) => Promise<TicketAction>;
  deleteAction: (id: string) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  getCompletedHistory: () => Promise<CompletedHistoryEntry[]>;
  getEquipmentHistory: (equipmentId: string) => Promise<CompletedHistoryEntry[]>;
}

export const useMaintenanceStore = create<MaintenanceState>((set, get) => ({
  tickets: [],
  schedules: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const tickets = await ipcInvoke<MaintenanceTicket[]>('db:maintenance:getAll');
      set({ tickets, loading: false });
    } catch (err) {
      reportLoadError('maintenance tickets', err);
      set({ loading: false });
    }
  },

  fetchSchedules: async () => {
    try {
      const schedules = await ipcInvoke<PreventiveSchedule[]>('db:maintenance:getSchedules');
      set({ schedules });
    } catch { /* ignore */ }
  },

  getById: async (id: string) => {
    return await ipcInvoke<MaintenanceTicket>('db:maintenance:getById', id);
  },

  create: async (data: any) => {
    const result = await ipcInvoke<MaintenanceTicket>('db:maintenance:create', data);
    await get().fetchAll();
    return result;
  },

  update: async (id: string, data: any) => {
    const result = await ipcInvoke<MaintenanceTicket>('db:maintenance:update', id, data);
    await get().fetchAll();
    return result;
  },

  updateStatus: async (id: string, newStatus: string, outcome?: string | null) => {
    await ipcInvoke('db:maintenance:updateStatus', id, newStatus, outcome ?? null);
    await get().fetchAll();
  },

  uploadServiceDoc: async (id: string, dataUrl: string) => {
    await ipcInvoke('db:maintenance:uploadServiceDoc', id, dataUrl);
  },

  clearServiceDoc: async (id: string) => {
    await ipcInvoke('db:maintenance:clearServiceDoc', id);
  },

  addNote: async (data: any) => {
    return await ipcInvoke<MaintenanceNote>('db:maintenance:addNote', data);
  },

  getNotes: async (ticketId: string) => {
    return await ipcInvoke<MaintenanceNote[]>('db:maintenance:getNotes', ticketId);
  },

  consumeParts: async (ticketId: string, parts: any[]) => {
    await ipcInvoke('db:maintenance:consumeParts', ticketId, parts);
    await get().fetchAll();
  },

  createSchedule: async (data: any) => {
    const result = await ipcInvoke<PreventiveSchedule>('db:maintenance:createSchedule', data);
    await get().fetchSchedules();
    return result;
  },

  updateSchedule: async (id: string, data: any) => {
    const result = await ipcInvoke<PreventiveSchedule>('db:maintenance:updateSchedule', id, data);
    await get().fetchSchedules();
    return result;
  },

  deleteSchedule: async (id: string) => {
    await ipcInvoke('db:maintenance:deleteSchedule', id);
    await get().fetchSchedules();
  },

  getActions: async (ticketId: string) => {
    return await ipcInvoke<TicketAction[]>('db:maintenance:getActions', ticketId);
  },

  archiveReleaseForm: async (id: string, inChargeOfRepair: string) => {
    return await ipcInvoke<{ savedLocally: boolean; uploadedToDrive: boolean }>(
      'db:maintenance:archiveReleaseForm', id, inChargeOfRepair,
    );
  },

  addAction: async (data: any) => {
    return await ipcInvoke<TicketAction>('db:maintenance:addAction', data);
  },

  updateAction: async (id: string, data: any) => {
    return await ipcInvoke<TicketAction>('db:maintenance:updateAction', id, data);
  },

  deleteAction: async (id: string) => {
    await ipcInvoke('db:maintenance:deleteAction', id);
  },

  deleteTicket: async (id: string) => {
    await ipcInvoke('db:maintenance:delete', id);
    await get().fetchAll();
  },

  getCompletedHistory: async () => {
    return await ipcInvoke<CompletedHistoryEntry[]>('db:maintenance:getCompletedHistory');
  },

  getEquipmentHistory: async (equipmentId: string) => {
    return await ipcInvoke<CompletedHistoryEntry[]>('db:maintenance:getEquipmentHistory', equipmentId);
  },
}));
