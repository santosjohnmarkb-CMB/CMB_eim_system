import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Camera, Lightbulb, ShoppingCart } from 'lucide-react';
import { usePurchaseRequestsStore } from '../stores/purchaseRequests.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { DataTable, type Column } from '../components/common/DataTable';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DEPARTMENT_CONFIG, PURCHASE_REQUEST_STATUS_CONFIG, REQUEST_TYPE_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { printHtml, escapeHtml } from '../lib/print';
import type { PurchaseRequest, PurchaseRequestStatus } from '../../shared/types';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_LABEL_COLOR: Record<Department, string> = {
  camera: 'text-yellow-400',
  lights_grips: 'text-orange-400',
};

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
  PENDING: 'warning',
  FULFILLED: 'success',
  CANCELLED: 'default',
};

const VIEWS: { key: PurchaseRequestStatus; label: string }[] = [
  { key: 'PENDING', label: 'Active' },
  { key: 'FULFILLED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function fmtAmount(n: number | null | undefined) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Total estimated cost of a request: the per-item aggregate when available,
// otherwise the mirrored first-item amount × quantity (legacy single-item rows).
function requestTotal(r: PurchaseRequest) {
  if (typeof r.total_amount === 'number') return r.total_amount;
  return Number(r.amount || 0) * Number(r.requested_quantity || 0);
}

// Group label for the completed list, e.g. "June 2026", derived from the fulfilled date.
function monthKey(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

export function PurchaseRequestsPage() {
  const navigate = useNavigate();
  const { requests, loading, fetchAll } = usePurchaseRequestsStore();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  // Admins and viewers see both departments; department users are locked to theirs.
  const lockedDept = (!isAdmin && !isViewer) ? (user?.department as Department | null) : null;

  const [view, setView] = useState<PurchaseRequestStatus>('PENDING');

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const visibleDepts = useMemo<Department[]>(
    () => (lockedDept ? [lockedDept] : (Object.keys(DEPARTMENT_CONFIG) as Department[])),
    [lockedDept],
  );

  const [activeDept, setActiveDept] = useState<Department>(lockedDept || 'camera');
  useEffect(() => {
    if (!visibleDepts.includes(activeDept)) setActiveDept(visibleDepts[0] ?? 'camera');
  }, [visibleDepts, activeDept]);

  const deptRequests = useMemo(
    () => requests.filter((r) => r.department === activeDept),
    [requests, activeDept],
  );

  const viewRequests = useMemo(
    () => deptRequests.filter((r) => r.status === view),
    [deptRequests, view],
  );

  // Completed requests are presented grouped by their fulfilled month.
  const completedGroups = useMemo(() => {
    if (view !== 'FULFILLED') return [];
    const map = new Map<string, PurchaseRequest[]>();
    for (const r of viewRequests) {
      const key = monthKey(r.fulfilled_at || r.updated_at);
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [viewRequests, view]);

  const printList = () => {
    const cfg = VIEWS.find((v) => v.key === view);
    const rows = viewRequests.map((r) => {
      const extra = (r.item_count ?? 1) > 1 ? ` (+${(r.item_count as number) - 1} more)` : '';
      return `
      <tr>
        <td>${escapeHtml(r.request_number)}</td>
        <td>${escapeHtml(fmtDate(r.request_date))}</td>
        <td>${escapeHtml(r.requested_asset)}${escapeHtml(extra)}</td>
        <td>${escapeHtml(REQUEST_TYPE_CONFIG[r.request_type]?.label || r.request_type)}</td>
        <td style="text-align:center;">${escapeHtml(String(r.current_quantity))}</td>
        <td style="text-align:center;">${escapeHtml(String(r.requested_quantity))}</td>
        <td>${escapeHtml(r.supplier) || '—'}</td>
        <td style="text-align:right;">${fmtAmount(requestTotal(r))}</td>
      </tr>`;
    }).join('');
    const body = `
      <div class="header">
        <h1>${escapeHtml(DEPARTMENT_CONFIG[activeDept].label)} — ${escapeHtml(cfg?.label || '')} Purchase Requests</h1>
        <p class="muted">As of ${escapeHtml(new Date().toLocaleDateString())}</p>
      </div>
      <table>
        <thead><tr><th>Request #</th><th>Date</th><th>Asset</th><th>Type</th><th>Current</th><th>Requested</th><th>Supplier</th><th>Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">No requests</td></tr>'}</tbody>
      </table>`;
    printHtml('Purchase Requests', body);
  };

  const columns: Column<PurchaseRequest>[] = [
    { key: 'request_number', header: 'Request #', render: (r) => <span className="font-mono text-xs text-primary-400">{r.request_number}</span> },
    { key: 'request_date', header: 'Date', render: (r) => <span className="text-surface-400">{fmtDate(r.request_date)}</span> },
    {
      key: 'requested_asset',
      header: 'Requested Asset',
      render: (r) => (
        <span className="font-medium text-surface-100">
          {r.requested_asset}
          {(r.item_count ?? 1) > 1 && (
            <span className="ml-2 text-xs font-normal text-surface-500">+{(r.item_count as number) - 1} more</span>
          )}
        </span>
      ),
    },
    { key: 'request_type', header: 'Type', render: (r) => <span className="text-surface-300">{REQUEST_TYPE_CONFIG[r.request_type]?.shortLabel || r.request_type}</span> },
    { key: 'current_quantity', header: 'Current', render: (r) => <span className="text-surface-400">{r.current_quantity}</span> },
    { key: 'requested_quantity', header: 'Requested', render: (r) => <span className="text-surface-300">{r.requested_quantity}</span> },
    { key: 'supplier', header: 'Supplier', render: (r) => <span className="text-surface-400">{r.supplier || '—'}</span> },
    { key: 'amount', header: 'Amount', render: (r) => <span className="text-surface-300">{fmtAmount(requestTotal(r))}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_VARIANT[r.status] || 'default'}>{PURCHASE_REQUEST_STATUS_CONFIG[r.status]?.label || r.status}</Badge> },
  ];

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <ShoppingCart size={20} className="text-primary-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-surface-100">Purchase Requests</h1>
          <p className="text-sm text-surface-500">
            Track requests for new equipment, accessories, spare parts, and additional inventory
          </p>
        </div>
        <Button variant="secondary" onClick={printList}><Printer size={16} /> Print List</Button>
        {!isViewer && (
          <Button onClick={() => navigate('/purchase-requests/new', { state: { department: activeDept } })}><Plus size={16} /> New Request</Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Department switcher */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {visibleDepts.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const active = activeDept === dept;
            const count = requests.filter((r) => r.department === dept && r.status === 'PENDING').length;
            return (
              <button
                key={dept}
                type="button"
                onClick={() => setActiveDept(dept)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  active ? 'bg-primary-600/25 text-primary-200' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <Icon size={15} className={active ? '' : DEPT_LABEL_COLOR[dept]} /> {DEPARTMENT_CONFIG[dept].label}
                <span className="text-xs text-surface-500">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Status view filter */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {VIEWS.map((v) => {
            const active = view === v.key;
            const count = deptRequests.filter((r) => r.status === v.key).length;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  active ? 'bg-primary-600/25 text-primary-200' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {v.label}
                <span className="text-xs text-surface-500">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {view === 'FULFILLED' ? (
        completedGroups.length === 0 ? (
          <div className="glass-panel rounded-xl px-5 py-12 text-center text-surface-500 text-sm">No completed requests</div>
        ) : (
          completedGroups.map(([month, items]) => (
            <div key={month} className="glass-panel rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
                <h2 className="text-base font-semibold text-surface-200">{month}</h2>
                <span className="text-xs text-surface-500 ml-1">({items.length})</span>
              </div>
              <DataTable
                columns={columns}
                data={items}
                onRowClick={(r) => navigate(`/purchase-requests/${r.id}`)}
                loading={false}
                emptyMessage="No requests"
              />
            </div>
          ))
        )
      ) : (
        (() => {
          const Icon = DEPT_ICONS[activeDept];
          return (
            <div className="glass-panel rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
                <Icon size={18} className={DEPT_LABEL_COLOR[activeDept]} />
                <h2 className={`text-base font-semibold ${DEPT_LABEL_COLOR[activeDept]}`}>{DEPARTMENT_CONFIG[activeDept].label}</h2>
                <span className="text-xs text-surface-500 ml-1">({viewRequests.length})</span>
              </div>
              <DataTable
                columns={columns}
                data={viewRequests}
                onRowClick={(r) => navigate(`/purchase-requests/${r.id}`)}
                loading={false}
                emptyMessage={view === 'PENDING' ? 'No active requests' : 'No cancelled requests'}
              />
            </div>
          );
        })()
      )}
    </div>
  );
}
