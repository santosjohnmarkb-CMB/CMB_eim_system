import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Lightbulb, History, Printer } from 'lucide-react';
import { useMaintenanceStore } from '../../stores/maintenance.store';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../common/Button';
import { ArchiveListButton } from '../common/ArchiveListButton';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SEVERITY_CONFIG, COMPLETION_OUTCOME_CONFIG } from '../../lib/constants';
import { printHtml, escapeHtml } from '../../lib/print';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../../shared/constants';
import type { Department } from '../../../shared/constants';
import type { CompletedHistoryEntry } from '../../../shared/types';

const DEPTS: Department[] = ['camera', 'lights_grips'];

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_LABEL_COLOR: Record<Department, string> = {
  camera: 'text-yellow-400',
  lights_grips: 'text-orange-400',
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function docTypeLabel(entry: CompletedHistoryEntry) {
  return entry.document_type === 'loss' ? 'Equipment Loss' : (entry.document_type || '—');
}

function outcomeLabel(entry: CompletedHistoryEntry) {
  return entry.completion_outcome
    ? (COMPLETION_OUTCOME_CONFIG[entry.completion_outcome]?.label || entry.completion_outcome)
    : '—';
}

// Completed maintenance tickets, scoped to a department, with admin "Archive List".
// Tickets captured in an archived list snapshot (list_archived_at) are excluded.
export function CompletedTicketsTab() {
  const navigate = useNavigate();
  const { getCompletedHistory } = useMaintenanceStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const userDept = user?.department as Department | null;
  const visibleDepts = useMemo<Department[]>(
    () => ((isAdmin || isViewer) ? DEPTS : (userDept ? [userDept] : DEPTS)),
    [isAdmin, isViewer, userDept],
  );

  const [entries, setEntries] = useState<CompletedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDept, setActiveDept] = useState<Department>(visibleDepts[0] ?? 'camera');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getCompletedHistory();
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [getCompletedHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visibleDepts.includes(activeDept)) setActiveDept(visibleDepts[0] ?? 'camera');
  }, [visibleDepts, activeDept]);

  // Active department's completed tickets, excluding those already archived to a list.
  const deptEntries = useMemo(() => {
    return entries.filter((e) => {
      if (e.list_archived_at) return false;
      const dept = e.category_name ? CATEGORY_TO_DEPARTMENT[e.category_name] : undefined;
      return dept === activeDept;
    });
  }, [entries, activeDept]);

  const buildListBody = () => {
    const rows = deptEntries.map((entry, idx) => {
      const mType = (entry.maintenance_type || '').replace(/_/g, ' ');
      const severity = SEVERITY_CONFIG[entry.severity]?.label || entry.severity || '—';
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(entry.ticket_number)}</td>
        <td>${escapeHtml(entry.equipment_name)}<br/><span style="color:#888;font-size:10px">${escapeHtml(entry.equipment_code)}</span></td>
        <td style="text-transform:capitalize">${escapeHtml(docTypeLabel(entry))}${mType ? `<br/><span style="color:#888;font-size:10px;text-transform:capitalize">${escapeHtml(mType)}</span>` : ''}</td>
        <td>${escapeHtml(severity)}</td>
        <td>${escapeHtml(fmtDate(entry.reported_date))}</td>
        <td>${escapeHtml(fmtDate(entry.completion_date))}</td>
        <td>${escapeHtml(outcomeLabel(entry))}</td>
        <td>${escapeHtml(entry.issue_description || '—')}</td>
        <td>${escapeHtml(entry.last_remarks || '—')}</td>
      </tr>`;
    }).join('');
    return `
      <div class="header">
        <h1>${escapeHtml(DEPARTMENT_CONFIG[activeDept].label)} — Completed Maintenance Tickets</h1>
        <p class="muted">${deptEntries.length} completed ticket${deptEntries.length !== 1 ? 's' : ''} · As of ${escapeHtml(new Date().toLocaleDateString())}</p>
      </div>
      <table>
        <thead><tr><th>#</th><th>Control No.</th><th>Equipment</th><th>Type</th><th>Severity</th><th>Reported</th><th>Completed</th><th>Outcome</th><th>Issue Description</th><th>Last Remarks</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10">No completed tickets</td></tr>'}</tbody>
      </table>`;
  };

  const printList = () => printHtml('Completed Maintenance Tickets', buildListBody());

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Department switcher */}
        <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
          {visibleDepts.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const active = activeDept === dept;
            const count = entries.filter((e) => {
              if (e.list_archived_at) return false;
              return (e.category_name ? CATEGORY_TO_DEPARTMENT[e.category_name] : undefined) === dept;
            }).length;
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
        <div className="ml-auto">
          <Button variant="secondary" onClick={printList}><Printer size={16} /> Print List</Button>
        </div>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <History size={18} className="text-emerald-400" />
          <h3 className="text-base font-semibold text-surface-200">Completed Tickets</h3>
          <span className="text-xs text-surface-500 ml-1">({deptEntries.length})</span>
        </div>

        {deptEntries.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">No completed tickets</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                  <th className="text-left px-5 py-2 font-medium">Control No.</th>
                  <th className="text-left px-3 py-2 font-medium">Equipment</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Completed</th>
                  <th className="text-left px-3 py-2 font-medium">Outcome</th>
                  <th className="text-left px-3 py-2 font-medium">Issue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60">
                {deptEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => navigate(`/maintenance/${entry.id}`)}
                    className="hover:bg-surface-800/40 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono text-xs text-primary-400 whitespace-nowrap">{entry.ticket_number}</td>
                    <td className="px-3 py-3">
                      <p className="text-surface-200 font-medium truncate max-w-[220px]">{entry.equipment_name}</p>
                      <p className="text-2xs text-surface-500">{entry.equipment_code}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-surface-300 whitespace-nowrap capitalize">{docTypeLabel(entry)}</td>
                    <td className="px-3 py-3 text-xs text-surface-300 whitespace-nowrap">{fmtDate(entry.completion_date)}</td>
                    <td className="px-3 py-3 text-xs text-surface-300 whitespace-nowrap">{outcomeLabel(entry)}</td>
                    <td className="px-3 py-3 text-xs text-surface-400 max-w-[260px]"><p className="truncate">{entry.issue_description || '—'}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Archive the active department's completed tickets into a PDF snapshot (admin
          only), then clear them from this list. */}
      <div className="flex justify-end">
        <ArchiveListButton
          section="maintenance"
          departmentLabel={DEPARTMENT_CONFIG[activeDept].label}
          filenameBase={`${DEPARTMENT_CONFIG[activeDept].label} - Completed Maintenance Tickets`}
          recordIds={deptEntries.map((e) => e.id)}
          buildDoc={() => ({ title: 'Completed Maintenance Tickets', bodyHtml: buildListBody() })}
          onArchived={load}
        />
      </div>
    </div>
  );
}
