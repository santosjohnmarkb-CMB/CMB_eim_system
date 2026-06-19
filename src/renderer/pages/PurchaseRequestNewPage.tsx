import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart, Printer } from 'lucide-react';
import { usePurchaseRequestsStore } from '../stores/purchaseRequests.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { printPurchaseRequestForm } from '../lib/purchaseForms';
import {
  PurchaseRequestItemsEditor,
  makeEmptyPRItem,
  toItemsPayload,
  validatePRItems,
  type PRItemForm,
} from '../components/purchase/PurchaseRequestItemsEditor';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';

const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<PRItemForm[]>([makeEmptyPRItem()]);
  const [saving, setSaving] = useState(false);

  const submit = async (withPrint: boolean) => {
    if (!requestDate) { toast.error('Date is required'); return; }
    const itemsError = validatePRItems(items);
    if (itemsError) { toast.error(itemsError); return; }

    setSaving(true);
    try {
      const request = await create({
        department,
        request_date: requestDate,
        reason: reason.trim(),
        items: toItemsPayload(items),
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
          <p className="text-sm text-surface-500">Request up to 5 equipment items, accessories, spare parts, or additional inventory</p>
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
        </div>

        <div className="glass-panel rounded-xl p-5">
          <PurchaseRequestItemsEditor items={items} onChange={setItems} disabled={saving} />
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
