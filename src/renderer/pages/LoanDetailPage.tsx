import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Trash2, PackageCheck, ArrowUpRight, ArrowDownLeft, Pencil, FileSignature } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG, LOAN_STATUS_CONFIG, LOAN_DIRECTION_CONFIG } from '../../shared/constants';
import { printLoanReleaseForm } from '../lib/loanForms';
import type { EquipmentLoanWithItems } from '../../shared/types';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success'> = {
  ACTIVE: 'info',
  PARTIAL: 'warning',
  RETURNED: 'success',
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { getById, update, returnItems, returnOrder, remove } = useLoansStore();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const isViewer = role === 'viewer';

  const [loan, setLoan] = useState<EquipmentLoanWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    person_or_org: '', loaned_date: '', tentative_return_date: '',
    purpose: '', location: '', duration: '', remarks: '', internal_notes: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await getById(id);
      setLoan(data);
    } finally {
      setLoading(false);
    }
  }, [id, getById]);

  useEffect(() => { load(); }, [load]);

  const handleReturnItem = async (itemId: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await returnItems(id, [itemId]);
      await load();
      toast.success('Item returned');
    } catch (err: any) {
      toast.error(err.message || 'Failed to return item');
    }
    setBusy(false);
  };

  const handleReturnAll = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await returnOrder(id);
      await load();
      toast.success('All items returned');
    } catch (err: any) {
      toast.error(err.message || 'Failed to return items');
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!id) return;
    const isOut = (loan?.direction ?? 'OUTWARD') === 'OUTWARD';
    const msg = isOut
      ? 'Delete this loan record? Any items still out will be returned to inventory.'
      : 'Delete this inward loan record?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await remove(id);
      toast.success('Loan deleted');
      navigate('/loans');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete loan');
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!loan) return;
    setEditForm({
      person_or_org: loan.person_or_org || '',
      loaned_date: loan.loaned_date || '',
      tentative_return_date: loan.tentative_return_date || '',
      purpose: loan.purpose || '',
      location: loan.location || '',
      duration: loan.duration || '',
      remarks: loan.remarks || '',
      internal_notes: loan.internal_notes || '',
    });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    if (!editForm.person_or_org.trim()) { toast.error('Person or organization is required'); return; }
    if (!editForm.loaned_date) { toast.error('Date is required'); return; }
    setSavingEdit(true);
    try {
      await update(id, {
        person_or_org: editForm.person_or_org,
        loaned_date: editForm.loaned_date,
        tentative_return_date: editForm.tentative_return_date || null,
        purpose: editForm.purpose,
        location: editForm.location,
        duration: editForm.duration,
        remarks: editForm.remarks,
        internal_notes: editForm.internal_notes,
      });
      setShowEdit(false);
      await load();
      toast.success('Loan updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update loan');
    }
    setSavingEdit(false);
  };

  const handlePrintReleaseForm = () => {
    if (!loan) return;
    printLoanReleaseForm({
      loan_number: loan.loan_number,
      department: loan.department,
      person_or_org: loan.person_or_org,
      purpose: loan.purpose,
      location: loan.location,
      loaned_date: loan.loaned_date,
      tentative_return_date: loan.tentative_return_date,
      duration: loan.duration,
      remarks: loan.remarks,
      released_by: loan.created_by,
      items: loan.items.map((it) => ({ code: it.equipment_code, name: it.equipment_name || '' })),
    });
  };

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;
  if (!loan) {
    return (
      <div className="text-center py-24 text-surface-500">
        <p>Loan not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/loans')}>Back to Loans</Button>
      </div>
    );
  }

  const outItems = loan.items.filter((it) => it.status === 'OUT');
  const direction = loan.direction ?? 'OUTWARD';
  const isOutward = direction === 'OUTWARD';
  const dirCfg = LOAN_DIRECTION_CONFIG[direction];
  const DirIcon = isOutward ? ArrowUpRight : ArrowDownLeft;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate('/loans')} className="flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors">
        <ArrowLeft size={16} /> Back to Loaned Equipment
      </button>

      <div className="flex items-start gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10 shrink-0">
          <PackageCheck size={20} className="text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-surface-100 font-mono">{loan.loan_number}</h1>
            <Badge variant={STATUS_VARIANT[loan.status] || 'default'} size="md">
              {LOAN_STATUS_CONFIG[loan.status]?.label || loan.status}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-surface-300 bg-surface-800 border border-surface-700 rounded-md px-2 py-1">
              <DirIcon size={13} /> {dirCfg.label}
            </span>
          </div>
          <p className="text-sm text-surface-500">{DEPARTMENT_CONFIG[loan.department].label} · {dirCfg.description}</p>
        </div>
        <div className="flex gap-2">
          {isOutward && !isViewer && (
            <Button variant="secondary" onClick={handlePrintReleaseForm}><FileSignature size={16} /> Print Release Form</Button>
          )}
          {isAdmin && (
            <Button variant="secondary" onClick={openEdit}><Pencil size={16} /> Edit</Button>
          )}
          {outItems.length > 0 && !isViewer && (
            <Button onClick={handleReturnAll} loading={busy}><RotateCcw size={16} /> Return All</Button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Loan Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          <Detail label={isOutward ? 'Person / Organization' : 'Lent By'} value={loan.person_or_org} />
          <Detail label={isOutward ? 'Loaned Date' : 'Received Date'} value={fmtDate(loan.loaned_date)} />
          <Detail label={isOutward ? 'Tentative Return' : 'Return By'} value={fmtDate(loan.tentative_return_date)} />
          <Detail label="Purpose" value={loan.purpose || '—'} />
          <Detail label="Location" value={loan.location || '—'} />
          <Detail label="Duration" value={loan.duration || '—'} />
          <Detail label="Recorded By" value={loan.created_by || '—'} />
        </div>
        {loan.remarks && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-1">Remarks</p>
            <p className="text-sm text-surface-300 whitespace-pre-wrap">{loan.remarks}</p>
          </div>
        )}
        {loan.internal_notes && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-1">
              Internal Notes <span className="text-surface-600 normal-case tracking-normal">· internal only, not on release form</span>
            </p>
            <p className="text-sm text-surface-300 whitespace-pre-wrap">{loan.internal_notes}</p>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <h2 className="text-sm font-semibold text-surface-200">{isOutward ? 'Loaned Equipment' : 'Items'}</h2>
          <span className="text-xs text-surface-500 ml-auto">{outItems.length} out · {loan.items.length} total</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
              {isOutward && <th className="text-left px-5 py-2.5 font-medium">Code</th>}
              <th className="text-left px-3 py-2.5 font-medium">{isOutward ? 'Equipment' : 'Item'}</th>
              {!isOutward && <th className="text-left px-3 py-2.5 font-medium">Notes</th>}
              <th className="text-left px-3 py-2.5 font-medium">Status</th>
              <th className="text-right px-5 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/60">
            {loan.items.map((it) => (
              <tr key={it.id}>
                {isOutward && <td className="px-5 py-3 font-mono text-xs text-primary-400 whitespace-nowrap">{it.equipment_code}</td>}
                <td className={`${isOutward ? 'px-3' : 'px-5'} py-3 text-surface-200`}>{it.equipment_name}</td>
                {!isOutward && <td className="px-3 py-3 text-surface-400">{it.notes || '—'}</td>}
                <td className="px-3 py-3">
                  {it.status === 'RETURNED' ? (
                    <span className="text-xs text-success-400">{isOutward ? 'Returned' : 'Returned to lender'} {fmtDate(it.returned_date)}</span>
                  ) : (
                    <span className="text-xs text-warning-400">Out</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {it.status === 'OUT' && !isViewer && (
                    <button
                      onClick={() => handleReturnItem(it.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={13} /> {isOutward ? 'Return' : 'Mark Returned'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="danger" onClick={handleDelete} loading={busy}><Trash2 size={16} /> Delete Loan</Button>
        </div>
      )}

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Loan Details" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={isOutward ? 'Person / Organization *' : 'Lent By (Person / Organization) *'}
              value={editForm.person_or_org}
              onChange={(e) => setEditForm((p) => ({ ...p, person_or_org: e.target.value }))}
            />
            <Input
              label={isOutward ? 'Loaned Date *' : 'Received Date *'}
              type="date"
              value={editForm.loaned_date}
              onChange={(e) => setEditForm((p) => ({ ...p, loaned_date: e.target.value }))}
            />
            <Input
              label={isOutward ? 'Tentative Return Date' : 'Return-by Date'}
              type="date"
              value={editForm.tentative_return_date}
              onChange={(e) => setEditForm((p) => ({ ...p, tentative_return_date: e.target.value }))}
            />
            <Input
              label="Duration"
              value={editForm.duration}
              onChange={(e) => setEditForm((p) => ({ ...p, duration: e.target.value }))}
              placeholder="e.g. 3 days"
            />
            <Input
              label="Purpose"
              value={editForm.purpose}
              onChange={(e) => setEditForm((p) => ({ ...p, purpose: e.target.value }))}
            />
            <Input
              label="Location"
              value={editForm.location}
              onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Remarks</label>
            <textarea
              value={editForm.remarks}
              onChange={(e) => setEditForm((p) => ({ ...p, remarks: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
            />
            {isOutward && <p className="mt-1 text-xs text-surface-500">Appears on the printed release form.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Internal Notes</label>
            <textarea
              value={editForm.internal_notes}
              onChange={(e) => setEditForm((p) => ({ ...p, internal_notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
              placeholder="Internal monitoring notes — follow-ups, reminders, status, etc."
            />
            <p className="mt-1 text-xs text-surface-500">For internal monitoring only — not shown on the release form.</p>
          </div>
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
