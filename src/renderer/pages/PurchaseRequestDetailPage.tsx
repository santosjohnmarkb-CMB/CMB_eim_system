import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, ShoppingCart, Pencil, Printer, CheckCircle2, XCircle, Upload } from 'lucide-react';
import { usePurchaseRequestsStore } from '../stores/purchaseRequests.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { DocumentUpload } from '../components/common/DocumentUpload';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useToast } from '../hooks';
import {
  PurchaseRequestItemsEditor,
  prItemFromRecord,
  toItemsPayload,
  validatePRItems,
  type PRItemForm,
} from '../components/purchase/PurchaseRequestItemsEditor';
import { DEPARTMENT_CONFIG, PURCHASE_REQUEST_STATUS_CONFIG, REQUEST_TYPE_CONFIG } from '../../shared/constants';
import { printPurchaseRequestForm } from '../lib/purchaseForms';
import type { PurchaseRequest, PurchaseRequestItem } from '../../shared/types';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
  PENDING: 'warning',
  FULFILLED: 'success',
  CANCELLED: 'default',
};

const MANAGER_ROLES = ['equipment_manager', 'inventory_manager'];

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function fmtAmount(n: number | null | undefined) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Older single-item requests may arrive without an items array; fall back to the
// parent row's mirrored columns so the page still renders a line item.
function resolveItems(request: PurchaseRequest): PurchaseRequestItem[] {
  if (request.items && request.items.length > 0) return request.items;
  return [{
    id: `${request.id}-legacy`,
    request_id: request.id,
    requested_asset: request.requested_asset,
    request_type: request.request_type,
    current_quantity: request.current_quantity,
    requested_quantity: request.requested_quantity,
    supplier: request.supplier,
    amount: request.amount,
    photo_data: request.photo_data,
    sort_order: 0,
    created_at: request.created_at,
  }];
}

export function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { getById, update, fulfill, cancel, uploadInvoice, clearInvoice, remove } = usePurchaseRequestsStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const canEdit = isAdmin || MANAGER_ROLES.includes(user?.role || '');

  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadValue, setUploadValue] = useState<string | null>(null);
  const [savingUpload, setSavingUpload] = useState(false);
  const [fulfillAfterUpload, setFulfillAfterUpload] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<PRItemForm[]>([]);

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

  const items = useMemo(() => (request ? resolveItems(request) : []), [request]);
  const grandTotal = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.amount || 0) * Number(i.requested_quantity || 0), 0),
    [items],
  );

  const openEdit = () => {
    if (!request) return;
    setEditDate(request.request_date || '');
    setEditReason(request.reason || '');
    setEditItems(resolveItems(request).map(prItemFromRecord));
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    if (!editDate) { toast.error('Date is required'); return; }
    const itemsError = validatePRItems(editItems);
    if (itemsError) { toast.error(itemsError); return; }
    setSavingEdit(true);
    try {
      await update(id, {
        request_date: editDate,
        reason: editReason.trim(),
        items: toItemsPayload(editItems),
      });
      setShowEdit(false);
      await load();
      toast.success('Request updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update request');
    }
    setSavingEdit(false);
  };

  const doFulfill = async () => {
    if (!id) return;
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

  const handleFulfill = async () => {
    if (!id) return;
    // A purchase invoice must be on file before the request can be fulfilled.
    if (!request?.invoice_data) {
      toast.info('Upload the purchase invoice to fulfill this request.');
      openUpload(true);
      return;
    }
    if (!window.confirm('Mark this request as fulfilled? It will move to the completed list.')) return;
    await doFulfill();
  };

  const openUpload = (forFulfill = false) => {
    setUploadValue(request?.invoice_data ?? null);
    setFulfillAfterUpload(forFulfill);
    setShowUpload(true);
  };

  const handleSaveUpload = async () => {
    if (!id) return;
    setSavingUpload(true);
    try {
      if (uploadValue) {
        await uploadInvoice(id, uploadValue);
        toast.success('Invoice uploaded');
      } else {
        await clearInvoice(id);
        toast.success('Invoice removed');
      }
      setShowUpload(false);
      await load();
      if (fulfillAfterUpload && uploadValue) {
        setFulfillAfterUpload(false);
        if (window.confirm('Mark this request as fulfilled? It will move to the completed list.')) {
          await doFulfill();
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save invoice');
    }
    setSavingUpload(false);
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
  const photoItems = items.filter((i) => i.photo_data);

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
            {DEPARTMENT_CONFIG[request.department].label} · {items.length} equipment item{items.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="secondary" onClick={() => printPurchaseRequestForm(request)}><Printer size={16} /> Print Request</Button>
          {canEdit && isPending && (
            <Button variant="secondary" onClick={openEdit}><Pencil size={16} /> Edit</Button>
          )}
          {canEdit && isPending && (
            <Button variant="secondary" onClick={() => openUpload(false)}>
              {request.invoice_data ? <CheckCircle2 size={16} className="text-success-400" /> : <Upload size={16} />}
              {request.invoice_data ? 'Invoice Uploaded' : 'Upload Purchase Invoice'}
            </Button>
          )}
          {isAdmin && isPending && (
            <Button onClick={handleFulfill} loading={busy}><CheckCircle2 size={16} /> Mark Fulfilled</Button>
          )}
        </div>
      </div>

      {/* Request-level details */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Request Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          <Detail label="Date of Request" value={fmtDate(request.request_date)} />
          <Detail label="Department" value={DEPARTMENT_CONFIG[request.department].label} />
          <Detail label="Requested By" value={request.created_by || '—'} />
          <Detail label="Estimated Total" value={fmtAmount(grandTotal)} />
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
      </div>

      {/* Line items */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Equipment ({items.length})</h2>
        <div className="border border-surface-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-900/60 text-surface-400">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Asset</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Type</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Current</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Requested</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Supplier</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Unit Amount</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/60">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2.5 text-surface-100 font-medium">{item.requested_asset}</td>
                  <td className="px-4 py-2.5 text-surface-300">{REQUEST_TYPE_CONFIG[item.request_type]?.shortLabel || item.request_type}</td>
                  <td className="px-4 py-2.5 text-center text-surface-400">{item.current_quantity}</td>
                  <td className="px-4 py-2.5 text-center text-surface-300">{item.requested_quantity}</td>
                  <td className="px-4 py-2.5 text-surface-400">{item.supplier || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-surface-300">{fmtAmount(item.amount)}</td>
                  <td className="px-4 py-2.5 text-right text-surface-200">{fmtAmount(Number(item.amount || 0) * Number(item.requested_quantity || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-800 bg-surface-900/40">
                <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-surface-400">Estimated Total</td>
                <td className="px-4 py-2.5 text-right font-bold text-surface-100">{fmtAmount(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {photoItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">Equipment Photos</p>
            <div className="flex flex-wrap gap-3">
              {photoItems.map((item) => (
                <figure key={item.id} className="w-40">
                  <img
                    src={item.photo_data as string}
                    alt={item.requested_asset}
                    className="h-32 w-40 rounded-lg border border-surface-700 object-cover bg-surface-800"
                  />
                  <figcaption className="mt-1 text-xs text-surface-400 truncate">{item.requested_asset}</figcaption>
                </figure>
              ))}
            </div>
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

      <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Purchase Invoice">
        <div className="space-y-4">
          <p className="text-sm text-surface-400">
            Upload the purchase invoice or receipt (image or PDF). This is required before the request
            can be marked fulfilled, and is included in the archived request document.
          </p>
          <DocumentUpload
            label="Purchase Invoice / Receipt"
            hint="Upload the invoice or receipt (image or PDF)"
            value={uploadValue}
            onChange={setUploadValue}
            disabled={savingUpload}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleSaveUpload} loading={savingUpload}>
              {fulfillAfterUpload ? 'Save & Continue' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Purchase Request" size="lg">
        <div className="space-y-4">
          <Input label="Date of Request *" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Reason for Request</label>
            <textarea
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
            />
          </div>
          <PurchaseRequestItemsEditor items={editItems} onChange={setEditItems} disabled={savingEdit} />
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
