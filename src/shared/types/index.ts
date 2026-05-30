// ═══════════════════════════════════════════════════════════════════
// SHARED TYPES (compatible with Rental Request System)
// ═══════════════════════════════════════════════════════════════════

export interface Category {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ItemType = 'standalone' | 'package_main' | 'package_component' | 'add_on';
export type PricingType = 'per_day' | 'per_project' | 'package_rate';

export interface EquipmentItem {
  id: string;
  equipment_code: string;
  name: string;
  display_name: string;
  category_id: string;
  subcategory_id: string;
  sub_subcategory: string | null;
  item_type: ItemType;
  brand: string;
  model: string;
  description: string;
  pricing_type: PricingType;
  base_price: number;
  notes: string | null;
  quantity: number;
  available_qty: number;
  is_active: boolean;
  version?: number;
  created_at: string;
  updated_at: string;
}

export interface PackageDefinition {
  id: string;
  main_item_id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  items?: PackageItem[];
  main_item?: EquipmentItem;
}

export interface PackageItem {
  id: string;
  package_id: string;
  component_id: string;
  included_qty: number;
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  component?: EquipmentItem;
}

export type EimUserRole = 'admin' | 'accounts_manager' | 'billing_user' | 'payroll_user'
  | 'inventory_manager' | 'maintenance_lead' | 'technician' | 'parts_clerk' | 'viewer';

export interface User {
  id: string;
  username: string;
  password_hash?: string;
  full_name: string;
  email: string;
  role: EimUserRole;
  department: 'camera' | 'lights_grips' | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// EIM-SPECIFIC TYPES
// ═══════════════════════════════════════════════════════════════════

export type EquipmentStatus = 'AVAILABLE' | 'DEPLOYED' | 'IN_REPAIR' | 'ON_HOLD'
  | 'IN_TRANSIT' | 'RETIRED' | 'MISSING' | 'FOR_INSPECTION';

export type ConditionGrade = 'A' | 'B' | 'C' | 'D';

export interface EquipmentAsset {
  id: string;
  equipment_id: string;
  serial_number: string;
  asset_tag: string | null;
  purchase_date: string | null;
  purchase_price: number;
  vendor_name: string | null;
  warranty_expiry: string | null;
  condition_grade: ConditionGrade;
  current_location: string;
  current_status: EquipmentStatus;
  last_inspection_date: string | null;
  retirement_date: string | null;
  retirement_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EquipmentWithAsset extends EquipmentItem {
  asset?: EquipmentAsset;
  category_name?: string;
  subcategory_name?: string;
}

export interface AssetStatusLogEntry {
  id: string;
  asset_id: string;
  equipment_id: string;
  previous_status: string;
  new_status: string;
  changed_by: string;
  changed_at: string;
  reason: string;
  related_ticket_id: string | null;
  related_project: string | null;
  notes: string | null;
}

export type RepairStatus = 'REPORTED' | 'ASSESSED' | 'QUEUED' | 'IN_PROGRESS'
  | 'TESTING' | 'COMPLETED' | 'ESCALATED' | 'CANCELLED';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type MaintenanceType = 'corrective' | 'preventive' | 'predictive';

export interface MaintenanceTicket {
  id: string;
  ticket_number: string;
  equipment_id: string;
  asset_id: string | null;
  reported_by: string;
  reported_date: string;
  issue_description: string;
  severity: Severity;
  repair_status: RepairStatus;
  maintenance_type: MaintenanceType;
  assigned_technician: string | null;
  diagnosis: string | null;
  estimated_cost: number;
  actual_cost: number;
  labor_hours: number;
  parts_consumed: string;
  priority_order: number;
  completion_date: string | null;
  post_repair_grade: ConditionGrade | null;
  project_name: string | null;
  production_name: string | null;
  project_date: string | null;
  verified_by: string | null;
  document_type: 'maintenance' | 'repair';
  created_at: string;
  updated_at: string;
  equipment_name?: string;
  equipment_code?: string;
  category_id?: string;
  category_name?: string;
  notes_count?: number;
  last_action_date?: string | null;
  last_action_taken?: string | null;
  last_action_personnel?: string | null;
}

export interface TicketAction {
  id: string;
  ticket_id: string;
  action_date: string;
  action_taken: string;
  remarks: string;
  personnel: string;
  created_at: string;
}

export interface MaintenanceNote {
  id: string;
  ticket_id: string;
  author: string;
  note_text: string;
  note_type: 'update' | 'escalation' | 'resolution' | 'parts' | 'status_change';
  created_at: string;
}

export type PartsCategory = 'spare' | 'expendable' | 'consumable' | 'accessory';

export interface PartsCatalogItem {
  id: string;
  part_code: string;
  name: string;
  description: string;
  category: PartsCategory;
  unit_of_measure: string;
  unit_cost: number;
  vendor_id: string | null;
  department: 'camera' | 'lights_grips' | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  vendor_name?: string;
  qty_on_hand?: number;
  qty_reserved?: number;
  reorder_point?: number;
}

export interface PartsInventory {
  id: string;
  part_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  reorder_point: number;
  reorder_qty: number;
  location: string;
  last_count_date: string | null;
  created_at: string;
  updated_at: string;
}

export type TransactionType = 'receive' | 'consume' | 'adjust' | 'return';

export interface PartsTransaction {
  id: string;
  part_id: string;
  transaction_type: TransactionType;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string;
  notes: string | null;
  created_at: string;
  part_name?: string;
  part_code?: string;
}

export interface PartsCompatibility {
  id: string;
  part_id: string;
  equipment_id: string;
  notes: string | null;
  created_at: string;
  equipment_name?: string;
  equipment_code?: string;
}

export interface PreventiveSchedule {
  id: string;
  equipment_id: string;
  asset_id: string | null;
  schedule_type: 'calendar' | 'usage';
  interval_days: number | null;
  interval_rentals: number | null;
  description: string;
  next_due_date: string | null;
  last_performed: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  equipment_name?: string;
  equipment_code?: string;
}

export interface Vendor {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  notes: string | null;
  department: 'camera' | 'lights_grips' | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  totalEquipment: number;
  availableCount: number;
  deployedCount: number;
  inRepairCount: number;
  onHoldCount: number;
  missingCount: number;
  forInspectionCount: number;
  activeTickets: number;
  lowStockParts: number;
  overdueSchedules: number;
  recentActivity: AssetStatusLogEntry[];
  statusDistribution: Record<EquipmentStatus, number>;
}

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

export interface SyncStatusInfo {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingChanges: number;
}

export interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface BulkImportError {
  row: number;
  message: string;
}

export interface BulkImportResult {
  imported: number;
  errors: BulkImportError[];
}

export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
