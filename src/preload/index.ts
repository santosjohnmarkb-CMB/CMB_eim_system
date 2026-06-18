import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const ALLOWED_CHANNELS = new Set([
  'db:categories:getAll',
  'db:subcategories:getAll',
  'db:subcategories:getByCategory',
  'db:equipment:getAll',
  'db:equipment:getById',
  'db:equipment:create',
  'db:equipment:update',
  'db:equipment:delete',
  'db:equipment:generateCode',
  'db:equipment:importCsv',
  'db:equipment:search',
  'db:equipment:updateStatus',
  'db:equipment:batchUpdateStatus',
  'db:equipment:updateAsset',
  'db:equipment:updateAssetStatus',
  'db:equipment:getStatusLog',
  'db:equipment:getDashboardStats',
  'db:equipment:getUseCounts',
  'db:maintenance:getAll',
  'db:maintenance:getById',
  'db:maintenance:create',
  'db:maintenance:update',
  'db:maintenance:updateStatus',
  'db:maintenance:addNote',
  'db:maintenance:getNotes',
  'db:maintenance:consumeParts',
  'db:maintenance:getSchedules',
  'db:maintenance:createSchedule',
  'db:maintenance:updateSchedule',
  'db:maintenance:deleteSchedule',
  'db:maintenance:delete',
  'db:maintenance:getActions',
  'db:maintenance:addAction',
  'db:maintenance:updateAction',
  'db:maintenance:deleteAction',
  'db:maintenance:getCompletedHistory',
  'db:maintenance:getEquipmentHistory',
  'db:parts:getAll',
  'db:parts:getById',
  'db:parts:create',
  'db:parts:update',
  'db:parts:delete',
  'db:parts:adjustStock',
  'db:parts:getTransactions',
  'db:parts:getLowStock',
  'db:parts:getCompatibility',
  'db:parts:setCompatibility',
  'db:vendors:getAll',
  'db:vendors:getById',
  'db:vendors:create',
  'db:vendors:update',
  'db:vendors:delete',
  'db:loans:getAll',
  'db:loans:getById',
  'db:loans:create',
  'db:loans:update',
  'db:loans:returnItems',
  'db:loans:returnOrder',
  'db:loans:delete',
  'db:purchaseRequests:getAll',
  'db:purchaseRequests:getById',
  'db:purchaseRequests:create',
  'db:purchaseRequests:update',
  'db:purchaseRequests:fulfill',
  'db:purchaseRequests:cancel',
  'db:purchaseRequests:delete',
  'db:users:getAll',
  'db:users:create',
  'db:users:update',
  'db:users:delete',
  'auth:login',
  'auth:verifyAdmin',
  'auth:logout',
  'reports:fleetUtilization',
  'reports:repairCosts',
  'reports:partsSpend',
  'reports:availabilityTrends',
  'reports:exportPdf',
  'reports:exportExcel',
  'sync:status',
  'sync:forceSync',
  'sync:notifyAction',
  'sync:dataChanged',
  'sync:config:get',
  'sync:config:set',
  'sync:tableStatus',
  'app:getVersion',
]);

type WrappedListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

const listenerMap = new Map<string, WrappedListener>();
const callbackIds = new WeakMap<Function, number>();
let nextId = 0;

function listenerKey(channel: string, callback: Function): string {
  if (!callbackIds.has(callback)) {
    callbackIds.set(callback, nextId++);
  }
  return `${channel}::${callbackIds.get(callback)!}`;
}

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_CHANNELS.has(channel)) return;
    const wrapped: WrappedListener = (_event, ...args) => callback(...args);
    const key = listenerKey(channel, callback);
    listenerMap.set(key, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    const key = listenerKey(channel, callback);
    const wrapped = listenerMap.get(key);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      listenerMap.delete(key);
    }
  },
});
