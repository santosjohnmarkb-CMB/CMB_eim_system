import { z } from 'zod';

// Optional YYYY-MM-DD date that treats empty strings (from blank form inputs) as "not provided".
const optionalDate = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
);

// ── Auth ──
export const LoginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

// ── Users ──
export const UserCreateSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(200),
  full_name: z.string().min(1).max(100),
  email: z.string().email().max(200).optional().default(''),
  role: z.enum(['admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user',
    'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk',
    'camera_personnel', 'lighting_personnel', 'viewer']),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
});

export const UserUpdateSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/).optional(),
  password: z.string().min(8).max(200).optional(),
  full_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  role: z.enum(['admin', 'equipment_manager', 'accounts_manager', 'billing_user', 'payroll_user',
    'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk',
    'camera_personnel', 'lighting_personnel', 'viewer']).optional(),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
  is_active: z.boolean().optional(),
});

// ── Equipment ──
export const EquipmentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  display_name: z.string().min(1).max(200),
  category_id: z.string().uuid(),
  subcategory_id: z.string().uuid(),
  sub_subcategory: z.string().max(100).nullable().optional(),
  item_type: z.enum(['standalone', 'package_main', 'package_component', 'add_on']).default('standalone'),
  brand: z.string().max(100).default(''),
  model: z.string().max(100).default(''),
  description: z.string().max(2000).default(''),
  pricing_type: z.enum(['per_day', 'per_project', 'package_rate']).default('per_day'),
  base_price: z.number().min(0).max(9999999).default(0),
  notes: z.string().max(2000).nullable().optional(),
  serial_number: z.string().max(100).default(''),
  asset_tag: z.string().max(100).nullable().optional(),
  purchase_date: optionalDate,
  delivered_date: optionalDate,
  purchase_price: z.number().min(0).max(99999999).default(0),
  vendor_name: z.string().max(200).nullable().optional(),
  warranty_expiry: optionalDate,
  quantity: z.number().int().min(0).default(1),
  // Optional per-unit details. When provided, one asset row is created per entry
  // (overriding `quantity`); when omitted, `quantity` blank units are created.
  units: z.array(z.object({
    serial_number: z.string().max(100).default(''),
    vendor_name: z.string().max(200).nullable().optional(),
    delivered_date: optionalDate,
  })).optional(),
});

// Editable equipment fields. All optional (partial update); `quantity` reconciles
// the per-unit asset rows. Unknown keys are ignored so the handler's allow-list
// remains the source of truth for which columns are written.
export const EquipmentUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  display_name: z.string().min(1).max(200).optional(),
  category_id: z.string().uuid().optional(),
  subcategory_id: z.string().uuid().optional(),
  sub_subcategory: z.string().max(100).nullable().optional(),
  item_type: z.enum(['standalone', 'package_main', 'package_component', 'add_on']).optional(),
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  pricing_type: z.enum(['per_day', 'per_project', 'package_rate']).optional(),
  base_price: z.number().min(0).max(9999999).optional(),
  notes: z.string().max(2000).nullable().optional(),
  quantity: z.number().int().min(0).optional(),
});

// Per-unit asset detail edit (serial number, supplier, delivery date).
export const AssetUpdateSchema = z.object({
  asset_id: z.string().uuid(),
  serial_number: z.string().max(100).optional(),
  vendor_name: z.string().max(200).nullable().optional(),
  delivered_date: optionalDate.nullable(),
});

// Per-unit status change.
export const AssetStatusUpdateSchema = z.object({
  asset_id: z.string().uuid(),
  status: z.enum(['AVAILABLE', 'DEPLOYED', 'IN_REPAIR', 'ON_HOLD', 'IN_TRANSIT', 'RETIRED', 'MISSING', 'FOR_INSPECTION']),
  reason: z.string().max(2000).default(''),
});

// ── Maintenance ──
export const MaintenanceTicketCreateSchema = z.object({
  equipment_id: z.string().uuid(),
  asset_id: z.string().uuid().nullable().optional(),
  issue_description: z.string().min(1).max(5000),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  maintenance_type: z.enum(['routine_maintenance', 'update', 'repair', 'corrective', 'preventive', 'predictive']).default('repair'),
  reported_by: z.string().min(1).max(100),
  project_name: z.string().max(200).nullable().optional(),
  production_name: z.string().max(200).nullable().optional(),
  project_date: z.string().nullable().optional(),
  verified_by: z.string().max(100).nullable().optional(),
  document_type: z.enum(['maintenance', 'repair', 'update', 'loss']).default('repair'),
});

export const MaintenanceTicketUpdateSchema = z.object({
  issue_description: z.string().max(5000).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  assigned_technician: z.string().max(100).nullable().optional(),
  diagnosis: z.string().max(5000).nullable().optional(),
  estimated_cost: z.number().min(0).optional(),
  actual_cost: z.number().min(0).optional(),
  labor_hours: z.number().min(0).optional(),
  post_repair_grade: z.string().nullable().optional(),
  project_name: z.string().max(200).nullable().optional(),
  production_name: z.string().max(200).nullable().optional(),
  project_date: z.string().nullable().optional(),
  verified_by: z.string().max(100).nullable().optional(),
  document_type: z.enum(['maintenance', 'repair', 'update', 'loss']).optional(),
});

export const TicketStatusUpdateSchema = z.object({
  status: z.enum(['REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  outcome: z.enum(['repaired', 'unrepairable', 'total_loss', 'found', 'not_found']).nullable().optional(),
});

export const TicketActionSchema = z.object({
  ticket_id: z.string().uuid(),
  action_date: z.string().default(() => new Date().toISOString().slice(0, 10)),
  action_taken: z.string().max(2000).default(''),
  remarks: z.string().max(2000).default(''),
  personnel: z.string().max(200).default(''),
});

export const TicketActionUpdateSchema = z.object({
  action_date: z.string().optional(),
  action_taken: z.string().max(2000).optional(),
  remarks: z.string().max(2000).optional(),
  personnel: z.string().max(200).optional(),
});

export const MaintenanceNoteSchema = z.object({
  ticket_id: z.string().uuid(),
  note_text: z.string().min(1).max(5000),
  note_type: z.enum(['update', 'escalation', 'resolution', 'parts', 'status_change']).default('update'),
  author: z.string().min(1).max(100),
});

// ── Parts ──
export const PartCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  category: z.enum(['spare', 'expendable', 'consumable', 'accessory']).default('spare'),
  unit_of_measure: z.string().max(50).default('unit'),
  unit_cost: z.number().min(0).max(9999999).default(0),
  vendor_id: z.string().uuid().nullable().optional(),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
  initial_stock: z.number().int().min(0).default(0),
  reorder_point: z.number().int().min(0).default(5),
  reorder_qty: z.number().int().min(1).default(10),
  location: z.string().max(200).default('Main Warehouse'),
});

export const PartUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(['spare', 'expendable', 'consumable', 'accessory']).optional(),
  unit_of_measure: z.string().max(50).optional(),
  unit_cost: z.number().min(0).max(9999999).optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const StockAdjustmentSchema = z.object({
  part_id: z.string().uuid(),
  quantity: z.number().int(),
  reason: z.enum(['received', 'damaged', 'shrinkage', 'audit_correction', 'return']),
  notes: z.string().max(1000).default(''),
  performed_by: z.string().min(1).max(100),
});

// ── Vendors ──
export const VendorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  contact_person: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  payment_terms: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
});

export const VendorUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contact_person: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  payment_terms: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
  is_active: z.boolean().optional(),
});

// ── Preventive Schedule ──
export const PreventiveScheduleSchema = z.object({
  equipment_id: z.string().uuid(),
  schedule_type: z.enum(['calendar', 'usage']).default('calendar'),
  interval_days: z.number().int().min(1).nullable().optional(),
  interval_rentals: z.number().int().min(1).nullable().optional(),
  description: z.string().max(1000).default(''),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// ── Equipment Loans ──
export const LoanCreateSchema = z.object({
  direction: z.enum(['OUTWARD', 'INWARD']).default('OUTWARD'),
  department: z.enum(['camera', 'lights_grips']),
  person_or_org: z.string().min(1).max(200),
  purpose: z.string().max(2000).default(''),
  location: z.string().max(200).default(''),
  loaned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration: z.string().max(200).default(''),
  tentative_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  remarks: z.string().max(2000).default(''),
  internal_notes: z.string().max(2000).default(''),
  items: z.array(z.object({
    equipment_id: z.string().uuid().nullable().optional(),
    item_name: z.string().max(200).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })).min(1),
}).superRefine((data, ctx) => {
  data.items.forEach((item, idx) => {
    if (data.direction === 'OUTWARD') {
      // Outward loans draw from our catalog and must reference an equipment record.
      if (!item.equipment_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', idx, 'equipment_id'], message: 'equipment_id is required for outward loans' });
      }
    } else {
      // Inward items are external — described by free-text name only.
      if (!item.item_name || !item.item_name.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', idx, 'item_name'], message: 'item_name is required for inward loans' });
      }
    }
  });
});

// Editable loan-order fields (admin only). Direction, department, and line items are
// intentionally excluded since they affect numbering and inventory accounting.
export const LoanUpdateSchema = z.object({
  person_or_org: z.string().min(1).max(200),
  purpose: z.string().max(2000).default(''),
  location: z.string().max(200).default(''),
  loaned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration: z.string().max(200).default(''),
  tentative_return_date: optionalDate.nullable(),
  remarks: z.string().max(2000).default(''),
  internal_notes: z.string().max(2000).default(''),
});

export const LoanReturnSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1),
});

// ── Purchase Requests ──
const PURCHASE_REQUEST_TYPES = [
  'NEW_EQUIPMENT',
  'ACCESSORY',
  'SPARE_PART',
  'REPLACEMENT',
  'ADDITIONAL_INVENTORY',
] as const;

// Optional equipment photo as a base64 data URL. The renderer downscales images
// before upload, but cap the payload (~8MB of base64) to guard against oversized data.
const PhotoDataSchema = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/, 'Photo must be an image')
  .nullable()
  .optional();

// Supporting document attachment (signed form / invoice / service doc) as a base64
// data URL. Accepts images or PDFs. PDFs can be large, so the cap is raised to ~25MB
// of base64 (≈18MB raw). Used by the loan / purchase / maintenance upload handlers.
export const AttachmentDataSchema = z
  .string()
  .max(25_000_000)
  .regex(
    /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/,
    'Attachment must be an image or a PDF',
  );

// A single equipment line item on a purchase request.
export const PurchaseRequestItemSchema = z.object({
  requested_asset: z.string().min(1).max(200),
  request_type: z.enum(PURCHASE_REQUEST_TYPES).default('NEW_EQUIPMENT'),
  current_quantity: z.number().int().min(0).default(0),
  requested_quantity: z.number().int().min(1).default(1),
  supplier: z.string().max(200).default(''),
  amount: z.number().min(0).default(0),
  photo_data: PhotoDataSchema,
});

// A request covers 1–5 distinct equipment line items.
const PurchaseRequestItemsArray = z.array(PurchaseRequestItemSchema).min(1).max(5);

export const PurchaseRequestCreateSchema = z.object({
  department: z.enum(['camera', 'lights_grips']),
  request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(2000).default(''),
  items: PurchaseRequestItemsArray,
});

// Editable fields. Department is excluded since it drives the request number.
export const PurchaseRequestUpdateSchema = z.object({
  request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(2000).default(''),
  items: PurchaseRequestItemsArray,
});

// ── Inferred types ──
export type LoginInput = z.infer<typeof LoginSchema>;
export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type EquipmentCreateInput = z.infer<typeof EquipmentCreateSchema>;
export type EquipmentUpdateInput = z.infer<typeof EquipmentUpdateSchema>;
export type AssetUpdateInput = z.infer<typeof AssetUpdateSchema>;
export type AssetStatusUpdateInput = z.infer<typeof AssetStatusUpdateSchema>;
export type MaintenanceTicketCreateInput = z.infer<typeof MaintenanceTicketCreateSchema>;
export type MaintenanceTicketUpdateInput = z.infer<typeof MaintenanceTicketUpdateSchema>;
export type MaintenanceNoteInput = z.infer<typeof MaintenanceNoteSchema>;
export type PartCreateInput = z.infer<typeof PartCreateSchema>;
export type PartUpdateInput = z.infer<typeof PartUpdateSchema>;
export type StockAdjustmentInput = z.infer<typeof StockAdjustmentSchema>;
export type VendorCreateInput = z.infer<typeof VendorCreateSchema>;
export type VendorUpdateInput = z.infer<typeof VendorUpdateSchema>;
export type PreventiveScheduleInput = z.infer<typeof PreventiveScheduleSchema>;
export type TicketActionInput = z.infer<typeof TicketActionSchema>;
export type PurchaseRequestItemInput = z.infer<typeof PurchaseRequestItemSchema>;
export type PurchaseRequestCreateInput = z.infer<typeof PurchaseRequestCreateSchema>;
export type PurchaseRequestUpdateInput = z.infer<typeof PurchaseRequestUpdateSchema>;
export type TicketActionUpdateInput = z.infer<typeof TicketActionUpdateSchema>;
export type LoanCreateInput = z.infer<typeof LoanCreateSchema>;
export type LoanUpdateInput = z.infer<typeof LoanUpdateSchema>;
export type LoanReturnInput = z.infer<typeof LoanReturnSchema>;
