export const EQUIPMENT_HIERARCHY: Record<string, Record<string, string[]>> = {
  'Camera': {
    'Camera Body': [],
    'Camera Support': ['Clip-On Mattebox', 'Wireless Follow Focus', '6.6x6.6 Rod Mount'],
    'Filters': ['4"x5.6"', '6.6"x6.6"'],
    'Lens': ['Prime', 'Zoom', 'Macro', 'Extender', 'Probe', 'Viewfinder'],
    'Special Rig': ['Camera Stabilizer', 'Underwater Housing'],
    'Video Peripherals': ['Overhead Monitor', 'Floor Monitor', 'Monitor/Recorder', 'Wireless Video Assist'],
    'Camera Package Components': [],
    'Cables': [],
    'Power Supply & Battery': [],
  },
  'Dollies Mounts & Cranes': {
    'Crane': [],
    'Motorized Dolly': [],
    'Dolly': [],
    'Tracks': [],
    'Slider/Table Top Dolly': [],
    'Mounts': [],
  },
  'Lights and Grips': {
    'Grip': ['Light Stands', 'Clamps/Arms', 'Magic Cloth', 'Butterfly Frame', 'Chroma', 'Muslin'],
    'Lighting': ['LED', 'Tungsten', 'Daylight', 'Fluorescent', 'Diffusion', 'Par', 'Traditional'],
  },
  'Power & Transport': {
    'Power': ['Generator', 'Portable Genet', 'Power Box', 'Cables'],
    'Transport': ['Grip Trucks'],
  },
  'Special Equipment': {
    'SFX & Others': ['Dimmer/Variac', 'DMX Board', 'Smoke FX', 'Wind FX'],
  },
};

export const EQUIPMENT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  DEPLOYED: 'DEPLOYED',
  IN_REPAIR: 'IN_REPAIR',
  ON_HOLD: 'ON_HOLD',
  IN_TRANSIT: 'IN_TRANSIT',
  RETIRED: 'RETIRED',
  MISSING: 'MISSING',
  FOR_INSPECTION: 'FOR_INSPECTION',
} as const;

export type EquipmentStatusType = typeof EQUIPMENT_STATUS[keyof typeof EQUIPMENT_STATUS];

export const EQUIPMENT_STATUS_CONFIG: Record<EquipmentStatusType, { label: string; color: string; bgColor: string; textColor: string; rentable: boolean }> = {
  AVAILABLE:      { label: 'Available',      color: 'green',  bgColor: 'bg-success-500/15',  textColor: 'text-success-400',  rentable: true },
  DEPLOYED:       { label: 'Deployed',       color: 'blue',   bgColor: 'bg-primary-500/15',  textColor: 'text-primary-400',  rentable: false },
  IN_REPAIR:      { label: 'In Repair',      color: 'orange', bgColor: 'bg-warning-500/15',  textColor: 'text-warning-400',  rentable: false },
  ON_HOLD:        { label: 'On Hold',        color: 'yellow', bgColor: 'bg-yellow-500/15',   textColor: 'text-yellow-400',   rentable: false },
  IN_TRANSIT:     { label: 'In Transit',     color: 'cyan',   bgColor: 'bg-cyan-500/15',     textColor: 'text-cyan-400',     rentable: false },
  RETIRED:        { label: 'Retired',        color: 'gray',   bgColor: 'bg-surface-500/15',  textColor: 'text-surface-400',  rentable: false },
  MISSING:        { label: 'Missing',        color: 'red',    bgColor: 'bg-danger-500/15',   textColor: 'text-danger-400',   rentable: false },
  FOR_INSPECTION: { label: 'For Inspection', color: 'purple', bgColor: 'bg-purple-500/15',   textColor: 'text-purple-400',   rentable: false },
};

export const REPAIR_STATUS = {
  REPORTED: 'REPORTED',
  ASSESSED: 'ASSESSED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type RepairStatusType = typeof REPAIR_STATUS[keyof typeof REPAIR_STATUS];

export const REPAIR_STATUS_CONFIG: Record<RepairStatusType, { label: string; color: string; order: number }> = {
  REPORTED:    { label: 'Reported',    color: 'text-danger-400',   order: 0 },
  ASSESSED:    { label: 'Assessed',    color: 'text-purple-400',   order: 1 },
  IN_PROGRESS: { label: 'In Progress', color: 'text-primary-400',  order: 2 },
  COMPLETED:   { label: 'Completed',   color: 'text-success-400',  order: 3 },
  CANCELLED:   { label: 'Cancelled',   color: 'text-surface-400',  order: 4 },
};

export const COMPLETION_OUTCOME = {
  REPAIRED: 'repaired',
  UNREPAIRABLE: 'unrepairable',
  TOTAL_LOSS: 'total_loss',
  FOUND: 'found',
  NOT_FOUND: 'not_found',
} as const;

export type CompletionOutcomeType = typeof COMPLETION_OUTCOME[keyof typeof COMPLETION_OUTCOME];

// `writeOff` outcomes permanently remove one unit from inventory (quantity -1).
export const COMPLETION_OUTCOME_CONFIG: Record<CompletionOutcomeType, {
  label: string; description: string; color: string; bgColor: string; writeOff: boolean; appliesTo: 'repair' | 'loss';
}> = {
  repaired:     { label: 'Repaired',     description: 'Fully repaired and returned to available inventory', color: 'text-success-400', bgColor: 'bg-success-500/15', writeOff: false, appliesTo: 'repair' },
  unrepairable: { label: 'Unrepairable', description: 'Cannot be repaired — written off from inventory',      color: 'text-danger-400',  bgColor: 'bg-danger-500/15',  writeOff: true,  appliesTo: 'repair' },
  total_loss:   { label: 'Total Loss',   description: 'Damaged beyond use — written off from inventory',      color: 'text-danger-400',  bgColor: 'bg-danger-500/15',  writeOff: true,  appliesTo: 'repair' },
  found:        { label: 'Found',        description: 'Located and returned to available inventory',          color: 'text-success-400', bgColor: 'bg-success-500/15', writeOff: false, appliesTo: 'loss' },
  not_found:    { label: 'Not Found',    description: 'Could not be located — written off as missing',        color: 'text-danger-400',  bgColor: 'bg-danger-500/15',  writeOff: true,  appliesTo: 'loss' },
};

export const DOCUMENT_TYPE_CONFIG: Record<string, { label: string; reportTitle: string }> = {
  maintenance: { label: 'Maintenance', reportTitle: 'Maintenance Report' },
  repair:      { label: 'Repair',      reportTitle: 'Repair Report' },
  update:      { label: 'Update',      reportTitle: 'Update Report' },
  loss:        { label: 'Equipment Loss', reportTitle: 'Equipment Loss Report' },
};

export const SEVERITY_CONFIG: Record<string, { label: string; color: string; priority: number }> = {
  CRITICAL: { label: 'Critical', color: 'text-danger-400',  priority: 0 },
  HIGH:     { label: 'High',     color: 'text-warning-400', priority: 1 },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-400',  priority: 2 },
  LOW:      { label: 'Low',      color: 'text-surface-400', priority: 3 },
};

export const PARTS_CATEGORY_CONFIG: Record<string, { label: string; description: string }> = {
  spare:      { label: 'Spare Parts',  description: 'Replacement components for equipment repair' },
  expendable: { label: 'Expendables',  description: 'Single-use items consumed during production' },
  consumable: { label: 'Consumables',  description: 'Items that deplete with use' },
  accessory:  { label: 'Accessories',  description: 'Add-on items that accompany equipment' },
};

export type Department = 'camera' | 'lights_grips';

export const DEPARTMENT_CONFIG: Record<Department, { label: string; shortLabel: string; icon: string; categories: string[] }> = {
  camera: {
    label: 'Camera Department',
    shortLabel: 'Camera',
    icon: 'Camera',
    categories: ['Camera'],
  },
  lights_grips: {
    label: 'Lights & Grips Department',
    shortLabel: 'Lights & Grips',
    icon: 'Lightbulb',
    categories: ['Lights and Grips', 'Dollies Mounts & Cranes', 'Special Equipment'],
  },
};

export const CATEGORY_TO_DEPARTMENT: Record<string, Department> = {
  'Camera': 'camera',
  'Lights and Grips': 'lights_grips',
  'Dollies Mounts & Cranes': 'lights_grips',
  'Special Equipment': 'lights_grips',
};

export const USE_COUNT_SUBCATEGORIES: Record<Department, { label: string; subcategoryNames: string[] }[]> = {
  camera: [
    { label: 'Camera Package', subcategoryNames: ['Camera Body', 'Camera Package Components', 'Camera Support'] },
    { label: 'Lens', subcategoryNames: ['Lens'] },
    { label: 'Special Rig', subcategoryNames: ['Special Rig'] },
  ],
  lights_grips: [
    { label: 'Lighting', subcategoryNames: ['Lighting'] },
    { label: 'Cranes & Motorized Dolly', subcategoryNames: ['Crane', 'Motorized Dolly'] },
  ],
};

export const CATEGORY_PREFIXES: Record<string, string> = {
  'Camera': 'CAM',
  'Dollies Mounts & Cranes': 'DMC',
  'Lights and Grips': 'LIT',
  'Power & Transport': 'PWR',
  'Special Equipment': 'SPL',
};

export const IPC_CHANNELS = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_VERIFY_ADMIN: 'auth:verifyAdmin',
  AUTH_LOGOUT: 'auth:logout',

  // Users
  USERS_GET_ALL: 'db:users:getAll',
  USERS_CREATE: 'db:users:create',
  USERS_UPDATE: 'db:users:update',
  USERS_DELETE: 'db:users:delete',

  // Categories & Subcategories
  CATEGORIES_GET_ALL: 'db:categories:getAll',
  SUBCATEGORIES_GET_ALL: 'db:subcategories:getAll',
  SUBCATEGORIES_GET_BY_CATEGORY: 'db:subcategories:getByCategory',

  // Equipment
  EQUIPMENT_GET_ALL: 'db:equipment:getAll',
  EQUIPMENT_GET_BY_ID: 'db:equipment:getById',
  EQUIPMENT_CREATE: 'db:equipment:create',
  EQUIPMENT_UPDATE: 'db:equipment:update',
  EQUIPMENT_DELETE: 'db:equipment:delete',
  EQUIPMENT_GENERATE_CODE: 'db:equipment:generateCode',
  EQUIPMENT_IMPORT_CSV: 'db:equipment:importCsv',
  EQUIPMENT_SEARCH: 'db:equipment:search',
  EQUIPMENT_UPDATE_STATUS: 'db:equipment:updateStatus',
  EQUIPMENT_BATCH_UPDATE_STATUS: 'db:equipment:batchUpdateStatus',
  EQUIPMENT_GET_STATUS_LOG: 'db:equipment:getStatusLog',
  EQUIPMENT_GET_DASHBOARD_STATS: 'db:equipment:getDashboardStats',
  EQUIPMENT_GET_USE_COUNTS: 'db:equipment:getUseCounts',

  // Maintenance
  MAINTENANCE_GET_ALL: 'db:maintenance:getAll',
  MAINTENANCE_GET_BY_ID: 'db:maintenance:getById',
  MAINTENANCE_CREATE: 'db:maintenance:create',
  MAINTENANCE_UPDATE: 'db:maintenance:update',
  MAINTENANCE_UPDATE_STATUS: 'db:maintenance:updateStatus',
  MAINTENANCE_ADD_NOTE: 'db:maintenance:addNote',
  MAINTENANCE_GET_NOTES: 'db:maintenance:getNotes',
  MAINTENANCE_CONSUME_PARTS: 'db:maintenance:consumeParts',
  MAINTENANCE_GET_SCHEDULES: 'db:maintenance:getSchedules',
  MAINTENANCE_CREATE_SCHEDULE: 'db:maintenance:createSchedule',
  MAINTENANCE_UPDATE_SCHEDULE: 'db:maintenance:updateSchedule',
  MAINTENANCE_DELETE_SCHEDULE: 'db:maintenance:deleteSchedule',
  MAINTENANCE_GET_ACTIONS: 'db:maintenance:getActions',
  MAINTENANCE_ADD_ACTION: 'db:maintenance:addAction',
  MAINTENANCE_UPDATE_ACTION: 'db:maintenance:updateAction',
  MAINTENANCE_DELETE_ACTION: 'db:maintenance:deleteAction',

  // Parts
  PARTS_GET_ALL: 'db:parts:getAll',
  PARTS_GET_BY_ID: 'db:parts:getById',
  PARTS_CREATE: 'db:parts:create',
  PARTS_UPDATE: 'db:parts:update',
  PARTS_DELETE: 'db:parts:delete',
  PARTS_ADJUST_STOCK: 'db:parts:adjustStock',
  PARTS_GET_TRANSACTIONS: 'db:parts:getTransactions',
  PARTS_GET_LOW_STOCK: 'db:parts:getLowStock',
  PARTS_GET_COMPATIBILITY: 'db:parts:getCompatibility',
  PARTS_SET_COMPATIBILITY: 'db:parts:setCompatibility',

  // Vendors
  VENDORS_GET_ALL: 'db:vendors:getAll',
  VENDORS_GET_BY_ID: 'db:vendors:getById',
  VENDORS_CREATE: 'db:vendors:create',
  VENDORS_UPDATE: 'db:vendors:update',
  VENDORS_DELETE: 'db:vendors:delete',

  // Reports
  REPORTS_FLEET_UTILIZATION: 'reports:fleetUtilization',
  REPORTS_REPAIR_COSTS: 'reports:repairCosts',
  REPORTS_PARTS_SPEND: 'reports:partsSpend',
  REPORTS_AVAILABILITY_TRENDS: 'reports:availabilityTrends',
  REPORTS_EXPORT_PDF: 'reports:exportPdf',
  REPORTS_EXPORT_EXCEL: 'reports:exportExcel',

  // Sync
  SYNC_STATUS: 'sync:status',
  SYNC_FORCE: 'sync:forceSync',
  SYNC_NOTIFY_ACTION: 'sync:notifyAction',
  SYNC_DATA_CHANGED: 'sync:dataChanged',
  SYNC_CONFIG_GET: 'sync:config:get',
  SYNC_CONFIG_SET: 'sync:config:set',
  SYNC_TABLE_STATUS: 'sync:tableStatus',

  // App
  APP_GET_VERSION: 'app:getVersion',
} as const;
