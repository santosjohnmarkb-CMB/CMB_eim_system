import { Plus, Trash2, Package } from 'lucide-react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { PhotoUpload } from '../common/PhotoUpload';
import { REQUEST_TYPE_CONFIG } from '../../../shared/constants';
import type { PurchaseRequestType, PurchaseRequestItem } from '../../../shared/types';

// A purchase request covers between 1 and 5 distinct equipment line items.
export const MAX_PR_ITEMS = 5;

const REQUEST_TYPES: PurchaseRequestType[] = [
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

const fmtAmount = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  items: PRItemForm[];
  onChange: (items: PRItemForm[]) => void;
  disabled?: boolean;
}

export function PurchaseRequestItemsEditor({ items, onChange, disabled }: Props) {
  const updateField = (key: number, field: keyof PRItemForm, value: string | null) =>
    onChange(items.map((i) => (i.key === key ? { ...i, [field]: value } : i)));

  const removeItem = (key: number) => onChange(items.filter((i) => i.key !== key));

  const addItem = () => {
    if (items.length >= MAX_PR_ITEMS) return;
    onChange([...items, makeEmptyPRItem()]);
  };

  const grandTotal = items.reduce((sum, i) => sum + prLineTotal(i), 0);
  const canAdd = items.length < MAX_PR_ITEMS;
  const canRemove = items.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">
          Equipment ({items.length}/{MAX_PR_ITEMS})
        </h2>
        <Button type="button" variant="secondary" onClick={addItem} disabled={disabled || !canAdd}>
          <Plus size={16} /> Add Equipment
        </Button>
      </div>

      {items.map((item, idx) => (
        <div key={item.key} className="rounded-lg border border-surface-700 bg-surface-800/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-surface-300">
              <Package size={14} className="text-primary-400" /> Equipment {idx + 1}
            </span>
            {canRemove && (
              <button
                type="button"
                onClick={() => removeItem(item.key)}
                disabled={disabled}
                className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-danger-400 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Requested Asset / Item *"
              value={item.requested_asset}
              onChange={(e) => updateField(item.key, 'requested_asset', e.target.value)}
              placeholder="e.g. Sony FX9 body, ND filter set, gimbal motor"
              disabled={disabled}
            />

            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Request Type</label>
              <select
                value={item.request_type}
                onChange={(e) => updateField(item.key, 'request_type', e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 disabled:opacity-50"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{REQUEST_TYPE_CONFIG[t]?.label || t}</option>
                ))}
              </select>
            </div>

            <Input
              label="Current Quantity On Hand"
              type="number"
              min={0}
              value={item.current_quantity}
              onChange={(e) => updateField(item.key, 'current_quantity', e.target.value)}
              disabled={disabled}
            />

            <Input
              label="Requested Quantity *"
              type="number"
              min={1}
              value={item.requested_quantity}
              onChange={(e) => updateField(item.key, 'requested_quantity', e.target.value)}
              disabled={disabled}
            />

            <Input
              label="Supplier"
              value={item.supplier}
              onChange={(e) => updateField(item.key, 'supplier', e.target.value)}
              placeholder="e.g. ABC Camera Supplies"
              disabled={disabled}
            />

            <Input
              label="Amount (per unit)"
              type="number"
              min={0}
              step="0.01"
              value={item.amount}
              onChange={(e) => updateField(item.key, 'amount', e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-surface-500">Line Total:</span>
            <span className="font-semibold text-surface-100">{fmtAmount(prLineTotal(item))}</span>
          </div>

          <PhotoUpload
            value={item.photo_data}
            onChange={(photo_data) => updateField(item.key, 'photo_data', photo_data)}
            disabled={disabled}
          />
        </div>
      ))}

      <div className="flex items-center justify-end gap-2 text-sm border-t border-surface-800 pt-3">
        <span className="text-surface-500">Estimated Total:</span>
        <span className="font-bold text-surface-100">{fmtAmount(grandTotal)}</span>
      </div>
    </div>
  );
}
