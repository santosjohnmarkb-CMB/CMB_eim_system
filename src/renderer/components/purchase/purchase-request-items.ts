import type { PurchaseRequestType, PurchaseRequestItem } from '../../../shared/types';

// A purchase request covers between 1 and 5 distinct equipment line items.
export const MAX_PR_ITEMS = 5;

export const REQUEST_TYPES: PurchaseRequestType[] = [
  'NEW_EQUIPMENT',
  'ACCESSORY',
  'SPARE_PART',
  'REPLACEMENT',
  'ADDITIONAL_INVENTORY',
];

let prItemKeySeq = 0;

// Form-shaped line item: numeric fields are kept as strings while editing.
export interface PRItemForm {
  key: number;
  requested_asset: string;
  request_type: PurchaseRequestType;
  current_quantity: string;
  requested_quantity: string;
  supplier: string;
  amount: string;
  photo_data: string | null;
}

export function makeEmptyPRItem(): PRItemForm {
  return {
    key: ++prItemKeySeq,
    requested_asset: '',
    request_type: 'NEW_EQUIPMENT',
    current_quantity: '0',
    requested_quantity: '1',
    supplier: '',
    amount: '0',
    photo_data: null,
  };
}

// Build a form row from a saved line item (used by the edit modal).
export function prItemFromRecord(rec: PurchaseRequestItem): PRItemForm {
  return {
    key: ++prItemKeySeq,
    requested_asset: rec.requested_asset || '',
    request_type: rec.request_type,
    current_quantity: String(rec.current_quantity ?? 0),
    requested_quantity: String(rec.requested_quantity ?? 1),
    supplier: rec.supplier || '',
    amount: String(rec.amount ?? 0),
    photo_data: rec.photo_data ?? null,
  };
}

export function prLineTotal(item: PRItemForm): number {
  return (Number(item.amount) || 0) * (Number(item.requested_quantity) || 0);
}

// Maps the editable form rows into the payload shape expected by the IPC schema.
export function toItemsPayload(items: PRItemForm[]) {
  return items.map((i) => ({
    requested_asset: i.requested_asset.trim(),
    request_type: i.request_type,
    current_quantity: Math.max(0, parseInt(i.current_quantity, 10) || 0),
    requested_quantity: Math.max(1, parseInt(i.requested_quantity, 10) || 0),
    supplier: i.supplier.trim(),
    amount: Math.max(0, Number(i.amount) || 0),
    photo_data: i.photo_data,
  }));
}

// Validates rows, returning an error message or null when valid.
export function validatePRItems(items: PRItemForm[]): string | null {
  if (items.length === 0) return 'Add at least one equipment item';
  if (items.length > MAX_PR_ITEMS) return `A request can have at most ${MAX_PR_ITEMS} equipment items`;
  for (const item of items) {
    if (!item.requested_asset.trim()) return 'Each equipment item needs a requested asset';
    const reqQty = parseInt(item.requested_quantity, 10);
    if (!reqQty || reqQty < 1) return 'Requested quantity must be at least 1 for every item';
  }
  return null;
}

export const fmtPRAmount = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
