import { z } from 'zod';

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
  role: z.enum(['admin', 'accounts_manager', 'billing_user', 'payroll_user',
    'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'viewer']),
  department: z.enum(['camera', 'lights_grips']).nullable().optional(),
});

export const UserUpdateSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/).optional(),
  password: z.string().min(8).max(200).optional(),
  full_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  role: z.enum(['admin', 'accounts_manager', 'billing_user', 'payroll_user',
    'inventory_manager', 'maintenance_lead', 'technician', 'parts_clerk', 'viewer']).optional(),
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
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchase_price: z.number().min(0).max(99999999).default(0),
  vendor_name: z.string().max(200).nullable().optional(),
  warranty_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  condition_grade: z.enum(['A', 'B', 'C', 'D']).default('A'),
  quantity: z.number().int().min(0).default(1),
});

// ── Maintenance ──
export const MaintenanceTicketCreateSchema = z.object({
  equipment_id: z.string().uuid(),
  issue_description: z.string().min(1).max(5000),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  maintenance_type: z.enum(['corrective', 'preventive', 'predictive']).default('corrective'),
  reported_by: z.string().min(1).max(100),
  project_name: z.string().max(200).nullable().optional(),
  production_name: z.string().max(200).nullable().optional(),
  project_date: z.string().nullable().optional(),
  verified_by: z.string().max(100).nullable().optional(),
  document_type: z.enum(['maintenance', 'repair']).default('repair'),
});

export const MaintenanceTicketUpdateSchema = z.object({
  issue_description: z.string().max(5000).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  assigned_technician: z.string().max(100).nullable().optional(),
  diagnosis: z.string().max(5000).nullable().optional(),
  estimated_cost: z.number().min(0).optional(),
  actual_cost: z.number().min(0).optional(),
  labor_hours: z.number().min(0).optional(),
  post_repair_grade: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
  project_name: z.string().max(200).nullable().optional(),
  production_name: z.string().max(200).nullable().optional(),
  project_date: z.string().nullable().optional(),
  verified_by: z.string().max(100).nullable().optional(),
  document_type: z.enum(['maintenance', 'repair']).optional(),
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

// ── Inferred types ──
export type LoginInput = z.infer<typeof LoginSchema>;
export type UserCreateInput = z.infer<typeof UserCreateSchema>;
export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;
export type EquipmentCreateInput = z.infer<typeof EquipmentCreateSchema>;
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
export type TicketActionUpdateInput = z.infer<typeof TicketActionUpdateSchema>;
