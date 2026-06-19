import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart, Printer } from 'lucide-react';
import { usePurchaseRequestsStore } from '../stores/purchaseRequests.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { PhotoUpload } from '../components/common/PhotoUpload';
import { useToast } from '../hooks';
import { printPurchaseRequestForm } from '../lib/purchaseForms';
import { DEPARTMENT_CONFIG, REQUEST_TYPE_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { PurchaseRequestType } from '../../shared/types';

const todayISO = () => new Date().toISOString().slice(0, 10);

const REQUEST_TYPES: PurchaseRequestType[] = [
  'NEW_EQUIPMENT',
  'ACCESSORY',
  'SPARE_PART',
  'REPLACEMENT',
  'ADDITIONAL_INVENTORY',
];

export function PurchaseRequestNewPage() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const toast = useToast();
  const { create } = usePurchaseRequestsStore();
  const user = useAuthStore((s) => s.user);

  const lockedDept = user?.role !== 'admin' ? (user?.department as Department | null) : null;

  const availableDepts = useMemo<Department[]>(
    () => (lockedDept ? [lockedDept] : (Object.keys(DEPARTMENT_CONFIG) as Department[])),
    [lockedDept],
  );

  const navState = (routerLocation.state || {}) as { department?: Department };

  const [department, setDepartment] = useState<Department>(lockedDept || navState.department || 'camera');
  const [requestDate, setRequestDate] = useState(todayISO());
  const [requestedAsset, setRequestedAsset] = useState('');
  const [requestType, setRequestType] = useState<PurchaseRequestType>('NEW_EQUIPMENT');
  const [currentQuantity, setCurrentQuantity] = useState('0');
  const [requestedQuantity, setRequestedQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('0');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const estTotal = (Number(amount) || 0) * (Number(requestedQuantity) || 0);

  const submit = async (withPrint: boolean) => {
    if (!requestedAsset.trim()) { toast.error('Requested asset is required'); return; }
    if (!requestDate) { toast.error('Date is required'); return; }
    const reqQty = parseInt(requestedQuantity, 10);
    if (!reqQty || reqQty < 1) { toast.error('Requested quantity must be at least 1'); return; }

    setSaving(true);
    try {
      const request = await create({
        department,
        request_date: requestDate,
        requested_asset: requestedAsset.trim(),
        request_type: requestType,
        current_quantity: Math.max(0, parseInt(currentQuantity, 10) || 0),
        requested_quantity: reqQty,
        reason: reason.trim(),
        supplier: supplier.trim(),
        amount: Math.max(0, Number(amount) || 0),
        photo_data: photoData,
      });

      if (withPrint) printPurchaseRequestForm(request);

      toast.success('Purchase request created');
      navigate(`/purchase-requests/${request.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create request');
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <ShoppingCart size={20} className="text-primary-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-surface-100">New Purchase Request</h1>
          <p className="text-sm text-surface-500">Request new equipment, accessories, spare parts, or additional inventory</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">Request Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Department</label>
              <div className="flex gap-2">
                {availableDepts.map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => setDepartment(dept)}
                    className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      department === dept
                        ? 'bg-primary-600/20 border-primary-500/40 text-primary-300'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {DEPARTMENT_CONFIG[dept].shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <Input label="Date of Request *" type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />

            <Input
              label="Requested Asset / Item *"
              value={requestedAsset}
              onChange={(e) => setRequestedAsset(e.target.value)}
              placeholder="e.g. Sony FX9 body, ND filter set, gimbal motor"
            />

            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Request Type</label>
              <select
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as PurchaseRequestType)}
                className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
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
              value={currentQuantity}
              onChange={(e) => setCurrentQuantity(e.target.value)}
            />

            <Input
              label="Requested Quantity *"
              type="number"
              min={1}
              value={requestedQuantity}
              onChange={(e) => setRequestedQuantity(e.target.value)}
            />

            <Input
              label="Supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. ABC Camera Supplies"
            />

            <Input
              label="Amount (per unit)"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-surface-500">Estimated Total:</span>
            <span className="font-semibold text-surface-100">
              {estTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="w-full">
            <label className="block text-xs font-medium text-surface-400 mb-1">Reason for Request</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
              placeholder="Why is this purchase needed? (e.g. replacement for damaged unit, additional capacity for upcoming productions)"
            />
          </div>

          <PhotoUpload value={photoData} onChange={setPhotoData} disabled={saving} />
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/purchase-requests')}>Cancel</Button>
          <Button type="button" variant="secondary" loading={saving} onClick={() => void submit(true)}>
            <Printer size={16} /> Create &amp; Print
          </Button>
          <Button type="submit" loading={saving}><Plus size={16} /> Create Request</Button>
        </div>
      </form>
    </div>
  );
}
