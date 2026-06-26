import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Camera, Lightbulb, PackageCheck, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { DataTable, type Column } from '../components/common/DataTable';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ArchiveListButton } from '../components/common/ArchiveListButton';
import { DEPARTMENT_CONFIG, LOAN_STATUS_CONFIG, LOAN_DIRECTION_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { printHtml, escapeHtml } from '../lib/print';
import type { EquipmentLoan, LoanDirection } from '../../shared/types';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_LABEL_COLOR: Record<Department, string> = {
  camera: 'text-yellow-400',
  lights_grips: 'text-orange-400',
};

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success'> = {
  ACTIVE: 'info',
  PARTIAL: 'warning',
  RETURNED: 'success',
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

// A loan is overdue when its expected return date has passed but items are still out.
function isOverdue(l: EquipmentLoan): boolean {
  if (!l.tentative_return_date) return false;
  if (l.status === 'RETURNED' || (l.out_count ?? 0) === 0) return false;
  const due = new Date(l.tentative_return_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

export function LoansPage() {
  const navigate = useNavigate();
  const { loans, loading, fetchAll } = useLoansStore();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  // Admins and viewers see both departments; department users are locked to theirs.
  const lockedDept = (!isAdmin && !isViewer) ? (user?.department as Department | null) : null;

  const [direction, setDirection] = useState<LoanDirection>('OUTWARD');
  const isOutward = direction === 'OUTWARD';
  const partyHeader = isOutward ? 'Borrower' : 'Lender';

  // Status view: All (current behavior) | Active (still out) | Returned (fully returned,
  // not yet captured in an archived list snapshot).
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'RETURNED'>('ALL');

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const visibleDepts = useMemo<Department[]>(
    () => (lockedDept ? [lockedDept] : (Object.keys(DEPARTMENT_CONFIG) as Department[])),
    [lockedDept],
  );

  // Camera and Lights & Grips are run as separate, distinct loan processes. Admins switch
  // between them; department users are locked to the one they're assigned to.
  const [activeDept, setActiveDept] = useState<Department>(lockedDept || 'camera');
  useEffect(() => {
    if (!visibleDepts.includes(activeDept)) setActiveDept(visibleDepts[0] ?? 'camera');
  }, [visibleDepts, activeDept]);

  // Older records created before the inward/outward split default to OUTWARD.
  const directionLoans = useMemo(
    () => loans.filter((l) => (l.direction ?? 'OUTWARD') === direction),
    [loans, direction],
  );

  const byDept = useMemo(() => {
    const result: Record<Department, EquipmentLoan[]> = { camera: [], lights_grips: [] };
    for (const loan of directionLoans) {
      if (result[loan.department]) result[loan.department].push(loan);
    }
    return result;
  }, [directionLoans]);

  const statusLabel = statusFilter === 'ACTIVE' ? 'Active' : statusFilter === 'RETURNED' ? 'Returned' : '';

  // Loans shown for the active department after the status filter. The Returned view
  // also hides loans already captured in an archived list snapshot (list_archived_at).
  const displayLoans = useMemo(() => {
    const deptLoans = byDept[activeDept];
    if (statusFilter === 'ACTIVE') return deptLoans.filter((l) => l.status !== 'RETURNED');
    if (statusFilter === 'RETURNED') return deptLoans.filter((l) => l.status === 'RETURNED' && !l.list_archived_at);
    return deptLoans;
  }, [byDept, activeDept, statusFilter]);

  // Build the printable/archivable list body for a set of loans (letterhead added by
  // the print/PDF wrapper). Shared by the on-screen Print button and Archive List.
  const buildListBody = (loansList: EquipmentLoan[], statusLabel: string, emptyText: string) => {
    const rows = loansList.map((l) => `
      <tr>
        <td>${escapeHtml(l.loan_number)}</td>
        <td>${escapeHtml(l.person_or_org)}</td>
        <td>${escapeHtml(l.purpose) || '—'}</td>
        <td>${escapeHtml(l.equipment_names) || '—'}</td>
        <td>${escapeHtml(l.location) || '—'}</td>
        <td>${l.out_count ?? 0} / ${l.item_count ?? 0}</td>
        <td>${escapeHtml(fmtDate(l.loaned_date))}</td>
        <td>${escapeHtml(fmtDate(l.tentative_return_date))}</td>
      </tr>`).join('');
    return `
      <div class="header">
        <h1>${escapeHtml(DEPARTMENT_CONFIG[activeDept].label)} — Loaned Equipment (${escapeHtml(LOAN_DIRECTION_CONFIG[direction].label)}${statusLabel ? ` · ${escapeHtml(statusLabel)}` : ''})</h1>
        <p class="muted">${isOutward ? 'Equipment we have loaned out' : 'Equipment loaned to us'} as of ${escapeHtml(new Date().toLocaleDateString())}</p>
      </div>
      <h2>${escapeHtml(DEPARTMENT_CONFIG[activeDept].label)}</h2>
      <table>
        <thead><tr><th>Loan #</th><th>${escapeHtml(partyHeader)}</th><th>Purpose</th><th>Equipment</th><th>Location</th><th>Out / Total</th><th>${isOutward ? 'Loaned' : 'Received'}</th><th>${isOutward ? 'Tentative Return' : 'Return By'}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${escapeHtml(emptyText)}</td></tr>`}</tbody>
      </table>`;
  };

  const printList = () => {
    printHtml('Loaned Equipment List', buildListBody(displayLoans, statusLabel, 'No loans'));
  };

  const columns: Column<EquipmentLoan>[] = [
    { key: 'loan_number', header: 'Loan #', render: (l) => <span className="font-mono text-xs text-primary-400">{l.loan_number}</span> },
    { key: 'person_or_org', header: partyHeader, render: (l) => <span className="font-medium text-surface-100">{l.person_or_org}</span> },
    { key: 'purpose', header: 'Purpose', render: (l) => <span className="text-surface-400">{l.purpose || '—'}</span> },
    { key: 'equipment_names', header: 'Equipment', render: (l) => <span className="text-surface-300">{l.equipment_names || '—'}</span> },
    { key: 'items', header: 'Items Out', render: (l) => <span className="text-surface-300">{l.out_count ?? 0} / {l.item_count ?? 0}</span> },
    { key: 'tentative_return_date', header: isOutward ? 'Tentative Return' : 'Return By', render: (l) => <span className="text-surface-400">{fmtDate(l.tentative_return_date)}</span> },
    { key: 'status', header: 'Status', render: (l) => (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[l.status] || 'default'}>{LOAN_STATUS_CONFIG[l.status]?.label || l.status}</Badge>
        {isOverdue(l) && <Badge variant="danger">Overdue</Badge>}
      </span>
    ) },
  ];

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <PackageCheck size={20} className="text-primary-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-surface-100">Loaned Equipment</h1>
          <p className="text-sm text-surface-500">
            {isOutward ? 'Equipment we loan out for events, training, and workshops' : 'Equipment loaned to us by external parties'}
          </p>
        </div>
        <Button variant="secondary" onClick={printList}><Printer size={16} /> Print List</Button>
        {!isViewer && (
          <Button onClick={() => navigate('/loans/new', { state: { department: activeDept, direction } })}><Plus size={16} /> New Loan</Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Department switcher — Camera and Lights & Grips are separate loan processes */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {visibleDepts.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const active = activeDept === dept;
            const count = directionLoans.filter((l) => l.department === dept).length;
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

        {/* Direction filter */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {(['OUTWARD', 'INWARD'] as LoanDirection[]).map((dir) => {
            const cfg = LOAN_DIRECTION_CONFIG[dir];
            const Icon = dir === 'OUTWARD' ? ArrowUpRight : ArrowDownLeft;
            const active = direction === dir;
            const count = loans.filter((l) => (l.direction ?? 'OUTWARD') === dir && l.department === activeDept).length;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => setDirection(dir)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  active ? 'bg-primary-600/25 text-primary-200' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <Icon size={15} /> {cfg.label}
                <span className="text-xs text-surface-500">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {(['ALL', 'ACTIVE', 'RETURNED'] as const).map((s) => {
            const active = statusFilter === s;
            const label = s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Returned';
            const deptLoans = byDept[activeDept];
            const count = s === 'ALL'
              ? deptLoans.length
              : s === 'ACTIVE'
                ? deptLoans.filter((l) => l.status !== 'RETURNED').length
                : deptLoans.filter((l) => l.status === 'RETURNED' && !l.list_archived_at).length;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  active ? 'bg-primary-600/25 text-primary-200' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {label}
                <span className="text-xs text-surface-500">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {(() => {
        const Icon = DEPT_ICONS[activeDept];
        return (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
              <Icon size={18} className={DEPT_LABEL_COLOR[activeDept]} />
              <h2 className={`text-base font-semibold ${DEPT_LABEL_COLOR[activeDept]}`}>{DEPARTMENT_CONFIG[activeDept].label}</h2>
              <span className="text-xs text-surface-500 ml-1">({displayLoans.length})</span>
            </div>
            <DataTable
              columns={columns}
              data={displayLoans}
              onRowClick={(l) => navigate(`/loans/${l.id}`)}
              loading={false}
              emptyMessage={
                statusFilter === 'RETURNED'
                  ? 'No returned loans'
                  : isOutward ? 'No loans recorded' : 'No inward loans recorded'
              }
              rowClassName={(l) => (isOverdue(l) ? 'bg-danger-500/10 hover:bg-danger-500/20' : undefined)}
            />
          </div>
        );
      })()}

      {/* Archive the active department's returned loans into a PDF snapshot (admin
          only), then clear them from the Returned list. */}
      {statusFilter === 'RETURNED' && (
        <div className="flex justify-end">
          <ArchiveListButton
            section="loan"
            departmentLabel={`${DEPARTMENT_CONFIG[activeDept].label} (${LOAN_DIRECTION_CONFIG[direction].label})`}
            filenameBase={`${DEPARTMENT_CONFIG[activeDept].label} - Returned Loans (${LOAN_DIRECTION_CONFIG[direction].label})`}
            recordIds={displayLoans.map((l) => l.id)}
            buildDoc={() => ({ title: 'Loaned Equipment List', bodyHtml: buildListBody(displayLoans, 'Returned', 'No returned loans') })}
            onArchived={fetchAll}
          />
        </div>
      )}
    </div>
  );
}
