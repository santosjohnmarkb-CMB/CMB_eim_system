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

export type EimUserRole = 'admin' | 'equipment_manager' | 'accounts_manager' | 'billing_user' | 'payroll_user'
  | 'inventory_manager' | 'maintenance_lead' | 'technician' | 'parts_clerk'
  | 'camera_personnel' | 'lighting_personnel' | 'viewer';

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

export interface EquipmentAsset {
  id: string;
  equipment_id: string;
  serial_number: string;
  asset_tag: string | null;
  purchase_date: string | null;
  delivered_date: string | null;
  purchase_price: number;
  vendor_name: string | null;
  warranty_expiry: string | null;
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
  assets?: EquipmentAsset[];
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

export type RepairStatus = 'REPORTED' | 'ASSESSED' | 'IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type MaintenanceType = 'routine_maintenance' | 'update' | 'repair' | 'corrective' | 'preventive' | 'predictive';
export type DocumentType = 'maintenance' | 'repair' | 'update' | 'loss';
export type CompletionOutcome = 'repaired' | 'unrepairable' | 'total_loss' | 'found' | 'not_found';

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
  completion_outcome: CompletionOutcome | null;
  post_repair_grade: string | null;
  project_name: string | null;
  production_name: string | null;
  project_date: string | null;
  verified_by: string | null;
  document_type: DocumentType;
  // Service completion document (image or PDF) as a base64 data URL; required before
  // a non-loss ticket can be COMPLETED. Local-only; merged into the archived PDF.
  service_doc_data?: string | null;
  created_at: string;
  updated_at: string;
  equipment_name?: string;
  equipment_code?: string;
  category_id?: string;
  category_name?: string;
  asset_serial?: string | null;
  asset_tag?: string | null;
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

export type LoanStatus = 'ACTIVE' | 'PARTIAL' | 'RETURNED';
export type LoanItemStatus = 'OUT' | 'RETURNED';
// OUTWARD = we lend our equipment to others; INWARD = equipment lent to us by others.
export type LoanDirection = 'OUTWARD' | 'INWARD';

export interface EquipmentLoanItem {
  id: string;
  loan_id: string;
  equipment_id: string | null;
  asset_id: string | null;
  item_name: string | null;
  status: LoanItemStatus;
  returned_date: string | null;
  notes: string | null;
  created_at: string;
  equipment_name?: string;
  equipment_code?: string;
  category_name?: string;
}

export interface EquipmentLoan {
  id: string;
  loan_number: string;
  direction: LoanDirection;
  department: 'camera' | 'lights_grips';
  person_or_org: string;
  purpose: string;
  location: string;
  loaned_date: string;
  duration: string;
  tentative_return_date: string | null;
  remarks: string;
  internal_notes: string;
  status: LoanStatus;
  created_by: string;
  // Signed release form (image or PDF) as a base64 data URL; required before an
  // OUTWARD loan can be closed. Local-only; merged into the archived release PDF.
  signed_form_data?: string | null;
  // Stamped when a returned loan is captured in an admin "Archive List" snapshot,
  // hiding it from the returned list without deleting the record.
  list_archived_at?: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
  out_count?: number;
  // Comma-separated names of every item on the loan; provided by getAll for list views.
  equipment_names?: string;
}

export interface EquipmentLoanWithItems extends EquipmentLoan {
  items: EquipmentLoanItem[];
}

// ── Purchase Requests ──
// Standalone tracking for buying new equipment, accessories, spare parts,
// wear-and-tear replacements, or additional inventory. Independent of inventory.
export type PurchaseRequestStatus = 'PENDING' | 'FULFILLED' | 'CANCELLED';
export type PurchaseRequestType =
  | 'NEW_EQUIPMENT'
  | 'ACCESSORY'
  | 'SPARE_PART'
  | 'REPLACEMENT'
  | 'ADDITIONAL_INVENTORY';

export interface PurchaseRequestItem {
  id: string;
  request_id: string;
  requested_asset: string;
  request_type: PurchaseRequestType;
  current_quantity: number;
  requested_quantity: number;
  supplier: string;
  amount: number;
  photo_data: string | null;
  sort_order: number;
  created_at: string;
}

export interface PurchaseRequest {
  id: string;
  request_number: string;
  department: 'camera' | 'lights_grips';
  request_date: string;
  // Mirrors the first line item for backward-compatible single-item displays.
  requested_asset: string;
  request_type: PurchaseRequestType;
  current_quantity: number;
  requested_quantity: number;
  reason: string;
  supplier: string;
  amount: number;
  photo_data: string | null;
  status: PurchaseRequestStatus;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  created_by: string;
  // Purchase invoice / receipt (image or PDF) as a base64 data URL; required before
  // the request can be marked FULFILLED. Local-only; merged into the archived PDF.
  invoice_data?: string | null;
  // Stamped when a fulfilled request is captured in an admin "Archive List" snapshot,
  // hiding it from the completed list without deleting the record.
  list_archived_at?: string | null;
  created_at: string;
  updated_at: string;
  // Populated by getById; getAll provides aggregates only.
  items?: PurchaseRequestItem[];
  item_count?: number;
  total_amount?: number;
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
  // True when the cloud (Supabase) database is missing columns/tables the app
  // expects — i.e. database/supabase-migration.sql needs to be (re)run. Pending
  // changes can never clear while this is true.
  schemaOutdated?: boolean;
  // Human-readable descriptions of the detected schema gaps, e.g.
  // "maintenance_tickets: missing column 'completion_outcome'".
  schemaIssues?: string[];
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

export interface EquipmentUseCount {
  equipment_id: string;
  equipment_code: string;
  name: string;
  brand: string;
  model: string;
  category_name: string;
  subcategory_name: string;
  use_count: number;
}

export interface CompletedHistoryEntry {
  id: string;
  ticket_number: string;
  equipment_id: string;
  reported_date: string;
  completion_date: string | null;
  issue_description: string;
  severity: Severity;
  repair_status: RepairStatus;
  maintenance_type: MaintenanceType;
  document_type: DocumentType;
  completion_outcome?: CompletionOutcome | null;
  equipment_name: string;
  equipment_code: string;
  category_name: string;
  last_remarks: string | null;
  // Stamped when a completed ticket is captured in an admin "Archive List" snapshot.
  list_archived_at?: string | null;
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
