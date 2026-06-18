import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Printer, Camera, Lightbulb, PackageCheck, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { DataTable, type Column } from '../components/common/DataTable';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
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

export function LoansPage() {
  const navigate = useNavigate();
  const { loans, loading, fetchAll } = useLoansStore();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'admin';
  const lockedDept = !isAdmin ? (user?.department as Department | null) : null;

  const [direction, setDirection] = useState<LoanDirection>('OUTWARD');
  const isOutward = direction === 'OUTWARD';
  const partyHeader = isOutward ? 'Borrower' : 'Lender';

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

  const printList = () => {
    const activeLoans = directionLoans.filter((l) => l.status !== 'RETURNED');
    const sections = [activeDept].map((dept) => {
      const deptLoans = activeLoans.filter((l) => l.department === dept);
      const rows = deptLoans.map((l) => `
        <tr>
          <td>${escapeHtml(l.loan_number)}</td>
          <td>${escapeHtml(l.person_or_org)}</td>
          <td>${escapeHtml(l.purpose) || '—'}</td>
          <td>${escapeHtml(l.location) || '—'}</td>
          <td>${l.out_count ?? 0} / ${l.item_count ?? 0}</td>
          <td>${escapeHtml(fmtDate(l.loaned_date))}</td>
          <td>${escapeHtml(fmtDate(l.tentative_return_date))}</td>
        </tr>`).join('');
      return `
        <h2>${escapeHtml(DEPARTMENT_CONFIG[dept].label)}</h2>
        <table>
          <thead><tr><th>Loan #</th><th>${escapeHtml(partyHeader)}</th><th>Purpose</th><th>Location</th><th>Out / Total</th><th>${isOutward ? 'Loaned' : 'Received'}</th><th>${isOutward ? 'Tentative Return' : 'Return By'}</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7">No active loans</td></tr>'}</tbody>
        </table>`;
    }).join('');

    const body = `
      <div class="header">
        <h1>${escapeHtml(DEPARTMENT_CONFIG[activeDept].label)} — Loaned Equipment (${escapeHtml(LOAN_DIRECTION_CONFIG[direction].label)})</h1>
        <p class="muted">${isOutward ? 'Equipment we have loaned out' : 'Equipment loaned to us'} as of ${escapeHtml(new Date().toLocaleDateString())}</p>
      </div>
      ${sections}`;
    printHtml('Loaned Equipment List', body);
  };

  const columns: Column<EquipmentLoan>[] = [
    { key: 'loan_number', header: 'Loan #', render: (l) => <span className="font-mono text-xs text-primary-400">{l.loan_number}</span> },
    { key: 'person_or_org', header: partyHeader, render: (l) => <span className="font-medium text-surface-100">{l.person_or_org}</span> },
    { key: 'purpose', header: 'Purpose', render: (l) => <span className="text-surface-400">{l.purpose || '—'}</span> },
    { key: 'items', header: 'Items Out', render: (l) => <span className="text-surface-300">{l.out_count ?? 0} / {l.item_count ?? 0}</span> },
    { key: 'tentative_return_date', header: isOutward ? 'Tentative Return' : 'Return By', render: (l) => <span className="text-surface-400">{fmtDate(l.tentative_return_date)}</span> },
    { key: 'status', header: 'Status', render: (l) => <Badge variant={STATUS_VARIANT[l.status] || 'default'}>{LOAN_STATUS_CONFIG[l.status]?.label || l.status}</Badge> },
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
        <Button onClick={() => navigate('/loans/new', { state: { department: activeDept, direction } })}><Plus size={16} /> New Loan</Button>
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
      </div>

      {(() => {
        const Icon = DEPT_ICONS[activeDept];
        const deptLoans = byDept[activeDept];
        return (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
              <Icon size={18} className={DEPT_LABEL_COLOR[activeDept]} />
              <h2 className={`text-base font-semibold ${DEPT_LABEL_COLOR[activeDept]}`}>{DEPARTMENT_CONFIG[activeDept].label}</h2>
              <span className="text-xs text-surface-500 ml-1">({deptLoans.length})</span>
            </div>
            <DataTable
              columns={columns}
              data={deptLoans}
              onRowClick={(l) => navigate(`/loans/${l.id}`)}
              loading={false}
              emptyMessage={isOutward ? 'No loans recorded' : 'No inward loans recorded'}
            />
          </div>
        );
      })()}
    </div>
  );
}
