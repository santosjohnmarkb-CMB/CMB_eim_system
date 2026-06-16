import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, RotateCcw, Trash2, PackageCheck } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG, LOAN_STATUS_CONFIG } from '../../shared/constants';
import { printHtml, escapeHtml } from '../lib/print';
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
  const { getById, returnItems, returnOrder, remove } = useLoansStore();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const [loan, setLoan] = useState<EquipmentLoanWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
    if (!window.confirm('Delete this loan record? Any items still out will be returned to inventory.')) return;
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

  const handlePrint = () => {
    if (!loan) return;
    const rows = loan.items.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.equipment_code)}</td>
        <td>${escapeHtml(it.equipment_name)}</td>
        <td>${it.status === 'RETURNED' ? `Returned ${escapeHtml(fmtDate(it.returned_date))}` : 'Out'}</td>
      </tr>`).join('');

    const body = `
      <div class="header">
        <h1>Equipment Loan Document</h1>
        <p class="muted">${escapeHtml(loan.loan_number)} · ${escapeHtml(DEPARTMENT_CONFIG[loan.department].label)}</p>
      </div>
      <h2>Loan Details</h2>
      <div class="grid">
        <div class="field"><label>Person / Organization</label><span>${escapeHtml(loan.person_or_org)}</span></div>
        <div class="field"><label>Status</label><span>${escapeHtml(LOAN_STATUS_CONFIG[loan.status]?.label || loan.status)}</span></div>
        <div class="field"><label>Loaned Date</label><span>${escapeHtml(fmtDate(loan.loaned_date))}</span></div>
        <div class="field"><label>Tentative Return Date</label><span>${escapeHtml(fmtDate(loan.tentative_return_date))}</span></div>
        <div class="field"><label>Purpose</label><span>${escapeHtml(loan.purpose) || '—'}</span></div>
        <div class="field"><label>Location</label><span>${escapeHtml(loan.location) || '—'}</span></div>
        <div class="field"><label>Duration</label><span>${escapeHtml(loan.duration) || '—'}</span></div>
        <div class="field"><label>Recorded By</label><span>${escapeHtml(loan.created_by) || '—'}</span></div>
      </div>
      <h2>Remarks</h2>
      <p>${escapeHtml(loan.remarks) || '—'}</p>
      <h2>Loaned Equipment (${loan.items.length})</h2>
      <table>
        <thead><tr><th>#</th><th>Code</th><th>Equipment</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    printHtml(`Loan ${loan.loan_number}`, body);
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
          </div>
          <p className="text-sm text-surface-500">{DEPARTMENT_CONFIG[loan.department].label}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handlePrint}><Printer size={16} /> Print</Button>
          {outItems.length > 0 && (
            <Button onClick={handleReturnAll} loading={busy}><RotateCcw size={16} /> Return All</Button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Loan Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          <Detail label="Person / Organization" value={loan.person_or_org} />
          <Detail label="Loaned Date" value={fmtDate(loan.loaned_date)} />
          <Detail label="Tentative Return" value={fmtDate(loan.tentative_return_date)} />
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
      </div>

      {/* Items */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <h2 className="text-sm font-semibold text-surface-200">Loaned Equipment</h2>
          <span className="text-xs text-surface-500 ml-auto">{outItems.length} out · {loan.items.length} total</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
              <th className="text-left px-5 py-2.5 font-medium">Code</th>
              <th className="text-left px-3 py-2.5 font-medium">Equipment</th>
              <th className="text-left px-3 py-2.5 font-medium">Status</th>
              <th className="text-right px-5 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800/60">
            {loan.items.map((it) => (
              <tr key={it.id}>
                <td className="px-5 py-3 font-mono text-xs text-primary-400 whitespace-nowrap">{it.equipment_code}</td>
                <td className="px-3 py-3 text-surface-200">{it.equipment_name}</td>
                <td className="px-3 py-3">
                  {it.status === 'RETURNED' ? (
                    <span className="text-xs text-success-400">Returned {fmtDate(it.returned_date)}</span>
                  ) : (
                    <span className="text-xs text-warning-400">Out</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {it.status === 'OUT' && (
                    <button
                      onClick={() => handleReturnItem(it.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={13} /> Return
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
