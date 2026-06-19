import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, ShoppingCart, Pencil, Printer, CheckCircle2, XCircle } from 'lucide-react';
import { usePurchaseRequestsStore } from '../stores/purchaseRequests.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Input } from '../components/common/Input';
import { PhotoUpload } from '../components/common/PhotoUpload';
import { Modal } from '../components/common/Modal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG, PURCHASE_REQUEST_STATUS_CONFIG, REQUEST_TYPE_CONFIG } from '../../shared/constants';
import { printPurchaseRequestForm } from '../lib/purchaseForms';
import type { PurchaseRequest, PurchaseRequestType } from '../../shared/types';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
  PENDING: 'warning',
  FULFILLED: 'success',
  CANCELLED: 'default',
};

const REQUEST_TYPES: PurchaseRequestType[] = [
  'NEW_EQUIPMENT',
  'ACCESSORY',
  'SPARE_PART',
  'REPLACEMENT',
  'ADDITIONAL_INVENTORY',
];

const MANAGER_ROLES = ['equipment_manager', 'inventory_manager'];

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function fmtAmount(n: number | null | undefined) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { getById, update, fulfill, cancel, remove } = usePurchaseRequestsStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canEdit = isAdmin || MANAGER_ROLES.includes(user?.role || '');

  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    request_date: '', requested_asset: '', request_type: 'NEW_EQUIPMENT' as PurchaseRequestType,
    current_quantity: '0', requested_quantity: '1', reason: '', supplier: '', amount: '0',
    photo_data: null as string | null,
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getById(id);
      setRequest(data);
    } finally {
      setLoading(false);
    }
  }, [id, getById]);

  useEffect(() => { load(); }, [load]);

  const openEdit = () => {
    if (!request) return;
    setEditForm({
      request_date: request.request_date || '',
      requested_asset: request.requested_asset || '',
      request_type: request.request_type,
      current_quantity: String(request.current_quantity ?? 0),
      requested_quantity: String(request.requested_quantity ?? 1),
      reason: request.reason || '',
      supplier: request.supplier || '',
      amount: String(request.amount ?? 0),
      photo_data: request.photo_data ?? null,
    });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    if (!editForm.requested_asset.trim()) { toast.error('Requested asset is required'); return; }
    if (!editForm.request_date) { toast.error('Date is required'); return; }
    const reqQty = parseInt(editForm.requested_quantity, 10);
    if (!reqQty || reqQty < 1) { toast.error('Requested quantity must be at least 1'); return; }
    setSavingEdit(true);
    try {
      await update(id, {
        request_date: editForm.request_date,
        requested_asset: editForm.requested_asset.trim(),
        request_type: editForm.request_type,
        current_quantity: Math.max(0, parseInt(editForm.current_quantity, 10) || 0),
        requested_quantity: reqQty,
        reason: editForm.reason.trim(),
        supplier: editForm.supplier.trim(),
        amount: Math.max(0, Number(editForm.amount) || 0),
        photo_data: editForm.photo_data,
      });
      setShowEdit(false);
      await load();
      toast.success('Request updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update request');
    }
    setSavingEdit(false);
  };

  const handleFulfill = async () => {
    if (!id) return;
    if (!window.confirm('Mark this request as fulfilled? It will move to the completed list.')) return;
    setBusy(true);
    try {
      await fulfill(id);
      await load();
      toast.success('Request marked fulfilled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to fulfill request');
    }
    setBusy(false);
  };

  const handleCancel = async () => {
    if (!id) return;
    if (!window.confirm('Cancel this purchase request?')) return;
    setBusy(true);
    try {
      await cancel(id);
      await load();
      toast.success('Request cancelled');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel request');
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this purchase request permanently?')) return;
    setBusy(true);
    try {
      await remove(id);
      toast.success('Request deleted');
      navigate('/purchase-requests');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete request');
      setBusy(false);
    }
  };

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;
  if (!request) {
    return (
      <div className="text-center py-24 text-surface-500">
        <p>Purchase request not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/purchase-requests')}>Back to Purchase Requests</Button>
      </div>
    );
  }

  const isPending = request.status === 'PENDING';
  const estTotal = Number(request.amount || 0) * Number(request.requested_quantity || 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate('/purchase-requests')} className="flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors">
        <ArrowLeft size={16} /> Back to Purchase Requests
      </button>

      <div className="flex items-start gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10 shrink-0">
          <ShoppingCart size={20} className="text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-surface-100 font-mono">{request.request_number}</h1>
            <Badge variant={STATUS_VARIANT[request.status] || 'default'} size="md">
              {PURCHASE_REQUEST_STATUS_CONFIG[request.status]?.label || request.status}
            </Badge>
          </div>
          <p className="text-sm text-surface-500">
            {DEPARTMENT_CONFIG[request.department].label} · {REQUEST_TYPE_CONFIG[request.request_type]?.label || request.request_type}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="secondary" onClick={() => printPurchaseRequestForm(request)}><Printer size={16} /> Print Request</Button>
          {canEdit && isPending && (
            <Button variant="secondary" onClick={openEdit}><Pencil size={16} /> Edit</Button>
          )}
          {isAdmin && isPending && (
            <Button onClick={handleFulfill} loading={busy}><CheckCircle2 size={16} /> Mark Fulfilled</Button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Request Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          <Detail label="Date of Request" value={fmtDate(request.request_date)} />
          <Detail label="Requested Asset" value={request.requested_asset} />
          <Detail label="Request Type" value={REQUEST_TYPE_CONFIG[request.request_type]?.label || request.request_type} />
          <Detail label="Current Quantity" value={String(request.current_quantity)} />
          <Detail label="Requested Quantity" value={String(request.requested_quantity)} />
          <Detail label="Supplier" value={request.supplier || '—'} />
          <Detail label="Amount (per unit)" value={fmtAmount(request.amount)} />
          <Detail label="Estimated Total" value={fmtAmount(estTotal)} />
          <Detail label="Requested By" value={request.created_by || '—'} />
          {request.status === 'FULFILLED' && (
            <>
              <Detail label="Fulfilled On" value={fmtDate(request.fulfilled_at)} />
              <Detail label="Fulfilled By" value={request.fulfilled_by || '—'} />
            </>
          )}
        </div>
        {request.reason && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-1">Reason for Request</p>
            <p className="text-sm text-surface-300 whitespace-pre-wrap">{request.reason}</p>
          </div>
        )}
        {request.photo_data && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">Equipment Photo</p>
            <img
              src={request.photo_data}
              alt="Requested equipment"
              className="max-h-64 rounded-lg border border-surface-700 object-contain bg-surface-800"
            />
          </div>
        )}
      </div>

      {(canEdit || isAdmin) && (
        <div className="flex justify-end gap-3">
          {canEdit && isPending && (
            <Button variant="secondary" onClick={handleCancel} loading={busy}><XCircle size={16} /> Cancel Request</Button>
          )}
          {isAdmin && (
            <Button variant="danger" onClick={handleDelete} loading={busy}><Trash2 size={16} /> Delete</Button>
          )}
        </div>
      )}

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Purchase Request" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Date of Request *" type="date" value={editForm.request_date} onChange={(e) => setEditForm((p) => ({ ...p, request_date: e.target.value }))} />
            <Input label="Requested Asset / Item *" value={editForm.requested_asset} onChange={(e) => setEditForm((p) => ({ ...p, requested_asset: e.target.value }))} />
            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Request Type</label>
              <select
                value={editForm.request_type}
                onChange={(e) => setEditForm((p) => ({ ...p, request_type: e.target.value as PurchaseRequestType }))}
                className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{REQUEST_TYPE_CONFIG[t]?.label || t}</option>
                ))}
              </select>
            </div>
            <Input label="Current Quantity" type="number" min={0} value={editForm.current_quantity} onChange={(e) => setEditForm((p) => ({ ...p, current_quantity: e.target.value }))} />
            <Input label="Requested Quantity *" type="number" min={1} value={editForm.requested_quantity} onChange={(e) => setEditForm((p) => ({ ...p, requested_quantity: e.target.value }))} />
            <Input label="Supplier" value={editForm.supplier} onChange={(e) => setEditForm((p) => ({ ...p, supplier: e.target.value }))} />
            <Input label="Amount (per unit)" type="number" min={0} step="0.01" value={editForm.amount} onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Reason for Request</label>
            <textarea
              value={editForm.reason}
              onChange={(e) => setEditForm((p) => ({ ...p, reason: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
            />
          </div>
          <PhotoUpload
            value={editForm.photo_data}
            onChange={(photo_data) => setEditForm((p) => ({ ...p, photo_data }))}
            disabled={savingEdit}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} loading={savingEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-surface-200">{value}</p>
    </div>
  );
}
