import { Plus, Trash2, Package } from 'lucide-react';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { PhotoUpload } from '../common/PhotoUpload';
import { REQUEST_TYPE_CONFIG } from '../../../shared/constants';
import {
  MAX_PR_ITEMS,
  REQUEST_TYPES,
  makeEmptyPRItem,
  prLineTotal,
  fmtPRAmount,
  type PRItemForm,
} from './purchase-request-items';

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
            <span className="font-semibold text-surface-100">{fmtPRAmount(prLineTotal(item))}</span>
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
        <span className="font-bold text-surface-100">{fmtPRAmount(grandTotal)}</span>
      </div>
    </div>
  );
}
