import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Wrench, Camera, Lightbulb, ClipboardList, AlertTriangle, History, X, Plus, Printer } from 'lucide-react';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useAuthStore } from '../stores/auth.store';
import { useToast } from '../hooks';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { CompletedTicketsTab } from '../components/maintenance/CompletedTicketsTab';
import { REPAIR_STATUS_CONFIG, SEVERITY_CONFIG, COMPLETION_OUTCOME_CONFIG } from '../lib/constants';
import { printHtml, escapeHtml } from '../lib/print';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { MaintenanceTicket, RepairStatus, CompletedHistoryEntry } from '../../shared/types';

const TALLY_STATUSES: RepairStatus[] = ['REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED'];
const DEPTS: Department[] = ['camera', 'lights_grips'];

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_ACCENT: Record<Department, string> = {
  camera: 'text-yellow-400',
  lights_grips: 'text-orange-400',
};

function isOpenTicket(t: { repair_status: string }) {
  return t.repair_status !== 'COMPLETED' && t.repair_status !== 'CANCELLED';
}

function buildTally(tickets: MaintenanceTicket[]) {
  const counts: Record<string, number> = {};
  for (const s of TALLY_STATUSES) counts[s] = 0;
  for (const t of tickets) {
    if (t.repair_status in counts) counts[t.repair_status]! += 1;
  }
  return counts;
}

export function MaintenanceQueuePage() {
  const { tickets, loading, fetchAll, getCompletedHistory, getEquipmentHistory } = useMaintenanceStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const historyRef = useRef<HTMLDivElement>(null);
  const scrollTo = (location.state as { scrollTo?: string } | null)?.scrollTo;
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const userDept = user?.department as Department | null;
  // Admins and viewers see every department; department users see only their own.
  const visibleDepts: Department[] = (isAdmin || isViewer) ? DEPTS : (userDept ? [userDept] : DEPTS);

  const [completedHistory, setCompletedHistory] = useState<CompletedHistoryEntry[]>([]);
  const [historyModal, setHistoryModal] = useState<{ equipmentId: string; equipmentName: string; equipmentCode: string } | null>(null);
  const [modalHistory, setModalHistory] = useState<CompletedHistoryEntry[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [view, setView] = useState<'overview' | 'completed'>('overview');

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // When arriving via a "View All" on the equipment repair history, jump straight to that card.
  useEffect(() => {
    if (loading || scrollTo !== 'history') return undefined;
    const t = setTimeout(() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    return () => clearTimeout(t);
  }, [loading, scrollTo, location.key]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const data = await getCompletedHistory();
        if (!cancelled) setCompletedHistory(data);
      } catch { /* ignore */ }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [getCompletedHistory]);

  const openEquipmentHistoryModal = useCallback(async (equipmentId: string, equipmentName: string, equipmentCode: string) => {
    setHistoryModal({ equipmentId, equipmentName, equipmentCode });
    setModalLoading(true);
    try {
      const data = await getEquipmentHistory(equipmentId);
      setModalHistory(data);
    } catch {
      setModalHistory([]);
    } finally {
      setModalLoading(false);
    }
  }, [getEquipmentHistory]);

  // Print the full completed repair & maintenance history for the equipment in the open modal.
  const printEquipmentHistory = useCallback(() => {
    if (!historyModal || modalHistory.length === 0) return;
    const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : '—');
    const rows = modalHistory.map((entry, idx) => {
      const docType = entry.document_type === 'loss' ? 'Equipment Loss' : (entry.document_type || '—');
      const mType = (entry.maintenance_type || '').replace(/_/g, ' ');
      const severity = SEVERITY_CONFIG[entry.severity]?.label || entry.severity || '—';
      const outcome = entry.completion_outcome
        ? (COMPLETION_OUTCOME_CONFIG[entry.completion_outcome]?.label || entry.completion_outcome)
        : '—';
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(entry.ticket_number)}</td>
        <td style="text-transform:capitalize">${escapeHtml(docType)}${mType ? `<br/><span style="color:#888;font-size:10px;text-transform:capitalize">${escapeHtml(mType)}</span>` : ''}</td>
        <td>${escapeHtml(severity)}</td>
        <td>${escapeHtml(fmt(entry.reported_date))}</td>
        <td>${escapeHtml(fmt(entry.completion_date))}</td>
        <td>${escapeHtml(outcome)}</td>
        <td>${escapeHtml(entry.issue_description || '—')}</td>
        <td>${escapeHtml(entry.last_remarks || '—')}</td>
      </tr>`;
    }).join('');

    const body = `
      <div class="header">
        <h1>Equipment Repair & Maintenance History</h1>
        <p class="muted">${escapeHtml(historyModal.equipmentName)} · ${escapeHtml(historyModal.equipmentCode)}</p>
        <p class="muted">${modalHistory.length} completed job${modalHistory.length !== 1 ? 's' : ''} on record · Generated ${escapeHtml(new Date().toLocaleString())}</p>
      </div>
      <table>
        <thead><tr><th>#</th><th>Control No.</th><th>Type</th><th>Severity</th><th>Reported</th><th>Completed</th><th>Outcome</th><th>Issue Description</th><th>Last Remarks</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    printHtml(`Maintenance History — ${historyModal.equipmentCode}`, body);
  }, [historyModal, modalHistory]);

  const recentByDept = useMemo(() => {
    const result: Record<Department, { equipmentId: string; equipmentName: string; equipmentCode: string; completionDate: string; category: string }[]> = { camera: [], lights_grips: [] };
    const seen: Record<Department, Set<string>> = { camera: new Set(), lights_grips: new Set() };

    for (const entry of completedHistory) {
      const dept = entry.category_name ? CATEGORY_TO_DEPARTMENT[entry.category_name] : undefined;
      if (!dept) continue;
      if (seen[dept].has(entry.equipment_id)) continue;
      if (result[dept].length >= 5) continue;
      seen[dept].add(entry.equipment_id);
      result[dept].push({
        equipmentId: entry.equipment_id,
        equipmentName: entry.equipment_name,
        equipmentCode: entry.equipment_code,
        completionDate: entry.completion_date || entry.reported_date,
        category: entry.category_name,
      });
    }
    return result;
  }, [completedHistory]);

  const ticketsByDept = useMemo(() => {
    const result: Record<Department, MaintenanceTicket[]> = { camera: [], lights_grips: [] };
    for (const t of tickets) {
      const dept = t.category_name ? CATEGORY_TO_DEPARTMENT[t.category_name] : undefined;
      if (dept) result[dept].push(t);
    }
    return result;
  }, [tickets]);

  const openByDept = useMemo(() => {
    const result: Record<Department, MaintenanceTicket[]> = { camera: [], lights_grips: [] };
    for (const dept of DEPTS) {
      result[dept] = ticketsByDept[dept]
        .filter(isOpenTicket)
        .sort((a, b) => {
          const sp = (SEVERITY_CONFIG[a.severity]?.priority ?? 99) - (SEVERITY_CONFIG[b.severity]?.priority ?? 99);
          if (sp !== 0) return sp;
          return new Date(b.reported_date).getTime() - new Date(a.reported_date).getTime();
        });
    }
    return result;
  }, [ticketsByDept]);

  const tallyByDept = useMemo(() => {
    const result: Record<Department, Record<string, number>> = { camera: {}, lights_grips: {} };
    for (const dept of DEPTS) result[dept] = buildTally(ticketsByDept[dept]);
    return result;
  }, [ticketsByDept]);

  if (loading) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Wrench size={22} className="text-primary-400" />
          <h1 className="text-2xl font-bold text-surface-100">Maintenance</h1>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Maintenance overview by department
        </p>
      </div>

      {/* View toggle: live overview vs the completed-tickets archive list */}
      <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/60 p-1">
        {([['overview', 'Overview'], ['completed', 'Completed Tickets']] as const).map(([key, label]) => {
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                active ? 'bg-primary-600/25 text-primary-200' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {view === 'completed' ? (
        <CompletedTicketsTab />
      ) : (
      <>
      {/* ── Maintenance Tally Card ── */}
      <div className="glass-panel rounded-xl px-5 py-4">
        <div className="flex items-center gap-2 mb-4">
          <ClipboardList size={18} className="text-surface-400" />
          <h3 className="text-base font-semibold text-surface-200">Maintenance Tally</h3>
        </div>

        <div className="divide-y divide-surface-700/40">
          {visibleDepts.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const accent = DEPT_ACCENT[dept];
            const cfg = DEPARTMENT_CONFIG[dept];
            const tally = tallyByDept[dept];
            const openCount = openByDept[dept].length;

            return (
              <div key={dept} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={accent} />
                  <span className={`text-sm font-semibold ${accent}`}>{cfg.shortLabel}</span>
                  <span className="text-xs text-surface-500 ml-auto">
                    {openCount} open
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 ml-5">
                  {TALLY_STATUSES.map((status) => {
                    const statusCfg = REPAIR_STATUS_CONFIG[status];
                    const count = tally[status] ?? 0;
                    return (
                      <div
                        key={status}
                        className="flex items-center gap-2 bg-surface-900/60 rounded-lg px-3 py-1.5"
                      >
                        <span className={`text-xs font-medium ${statusCfg?.color ?? 'text-surface-400'}`}>
                          {statusCfg?.label ?? status}
                        </span>
                        <span className="text-sm font-bold text-surface-200">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Open Tickets Card ── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <AlertTriangle size={18} className="text-danger-400" />
          <h3 className="text-base font-semibold text-surface-200">Open Tickets</h3>
          {!isViewer && (
            <button
              onClick={() => navigate('/maintenance/new')}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-lg transition-colors"
            >
              <Plus size={14} /> Create New Ticket
            </button>
          )}
        </div>

        {visibleDepts.map((dept, deptIdx) => {
          const Icon = DEPT_ICONS[dept];
          const accent = DEPT_ACCENT[dept];
          const cfg = DEPARTMENT_CONFIG[dept];
          const deptOpen = openByDept[dept];

          return (
            <div key={dept}>
              {/* Dept label divider */}
              <div className={`flex items-center gap-2 px-5 py-2.5 bg-surface-900/40 ${deptIdx > 0 ? 'border-t border-surface-700/40 mt-4' : ''}`}>
                <Icon size={16} className={accent} />
                <span className={`text-sm font-semibold ${accent}`}>{cfg.shortLabel}</span>
                <span className="text-xs text-surface-500 ml-1">({deptOpen.length})</span>
                <button
                  onClick={() => {
                    if (deptOpen.length === 0) {
                      toast.info(`No open tickets available for ${cfg.shortLabel}.`);
                      return;
                    }
                    navigate(`/dept/${dept}`, { state: { scrollTo: 'open-tickets' } });
                  }}
                  className="text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium ml-auto"
                >
                  View All →
                </button>
              </div>

              {deptOpen.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-surface-500">
                  No open tickets
                </div>
              ) : (
                <div className="overflow-x-auto ml-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                        <th className="text-left px-5 py-2 font-medium">Ticket</th>
                        <th className="text-left px-3 py-2 font-medium">Equipment</th>
                        <th className="text-left px-3 py-2 font-medium">Status</th>
                        <th className="text-left px-3 py-2 font-medium">Last Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800/60">
                      {deptOpen.map((ticket) => {
                        const statusCfg = REPAIR_STATUS_CONFIG[ticket.repair_status];

                        return (
                          <tr
                            key={ticket.id}
                            onClick={() => navigate(`/maintenance/${ticket.id}`)}
                            className="hover:bg-surface-800/40 transition-colors cursor-pointer"
                          >
                            <td className="px-5 py-3 font-mono text-xs text-primary-400 whitespace-nowrap">
                              {ticket.ticket_number}
                            </td>
                            <td className="px-3 py-3">
                              <p className="text-surface-200 font-medium truncate max-w-[220px] flex items-center gap-1.5">
                                {ticket.equipment_name}
                                {ticket.document_type === 'loss' && (
                                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-danger-500/15 text-danger-400">
                                    Loss
                                  </span>
                                )}
                              </p>
                              <p className="text-2xs text-surface-500">{ticket.equipment_code}</p>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className={`text-xs font-medium ${statusCfg?.color ?? 'text-surface-400'}`}>
                                {statusCfg?.label ?? ticket.repair_status}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs max-w-[260px]">
                              {ticket.last_action_date ? (
                                <div>
                                  <p className="text-surface-300 truncate">
                                    {ticket.last_action_taken}
                                  </p>
                                  <p className="text-2xs text-surface-500 mt-0.5">
                                    {new Date(ticket.last_action_date).toLocaleDateString()}
                                    {ticket.last_action_personnel && (
                                      <> · {ticket.last_action_personnel}</>
                                    )}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-surface-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Equipment Repair & Maintenance History ── */}
      <div ref={historyRef} className="glass-panel rounded-xl overflow-hidden scroll-mt-4">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <History size={18} className="text-emerald-400" />
          <h3 className="text-base font-semibold text-surface-200">Equipment Repair & Maintenance History</h3>
          <span className="ml-auto text-xs text-surface-500">5 most recent per department</span>
        </div>

        {visibleDepts.map((dept, deptIdx) => {
          const Icon = DEPT_ICONS[dept];
          const accent = DEPT_ACCENT[dept];
          const cfg = DEPARTMENT_CONFIG[dept];
          const deptRecent = recentByDept[dept];

          return (
            <div key={dept}>
              <div className={`flex items-center gap-2 px-5 py-2.5 bg-surface-900/40 ${deptIdx > 0 ? 'border-t border-surface-700/40 mt-4' : ''}`}>
                <Icon size={16} className={accent} />
                <span className={`text-sm font-semibold ${accent}`}>{cfg.shortLabel}</span>
                <span className="text-xs text-surface-500 ml-1">({deptRecent.length})</span>
              </div>

              {deptRecent.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-surface-500">
                  No completed maintenance history
                </div>
              ) : (
                <div className="overflow-x-auto ml-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                        <th className="text-left px-5 py-2 font-medium">Equipment</th>
                        <th className="text-left px-3 py-2 font-medium">Code</th>
                        <th className="text-left px-3 py-2 font-medium">Last Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800/60">
                      {deptRecent.map((item) => (
                        <tr
                          key={item.equipmentId}
                          onClick={() => openEquipmentHistoryModal(item.equipmentId, item.equipmentName, item.equipmentCode)}
                          className="hover:bg-surface-800/40 transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3">
                            <p className="text-surface-200 font-medium truncate max-w-[260px]">
                              {item.equipmentName}
                            </p>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-surface-400 whitespace-nowrap">
                            {item.equipmentCode}
                          </td>
                          <td className="px-3 py-3 text-xs text-surface-300 whitespace-nowrap">
                            {new Date(item.completionDate).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── History Modal ── */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-[900px] max-h-[80vh] flex flex-col mx-4">
            {/* Modal Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-surface-700/60">
              <History size={20} className="text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-surface-100 truncate">
                  {historyModal.equipmentName}
                </h2>
                <p className="text-xs text-surface-500 font-mono">{historyModal.equipmentCode}</p>
              </div>
              <button
                onClick={() => { setHistoryModal(null); setModalHistory([]); }}
                className="p-1.5 rounded-lg hover:bg-surface-700/60 text-surface-400 hover:text-surface-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {modalLoading ? (
                <LoadingSpinner size="md" className="py-12" />
              ) : modalHistory.length === 0 ? (
                <p className="text-center text-sm text-surface-500 py-12">No maintenance history found</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-900">
                    <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-700">
                      <th className="text-left px-3 py-2.5 font-medium">Control No.</th>
                      <th className="text-left px-3 py-2.5 font-medium">Type</th>
                      <th className="text-left px-3 py-2.5 font-medium">Completed</th>
                      <th className="text-left px-3 py-2.5 font-medium">Issue Description</th>
                      <th className="text-left px-3 py-2.5 font-medium">Last Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/60">
                    {modalHistory.map((entry, idx) => {
                      const isLatest = idx === 0;
                      return (
                        <tr
                          key={entry.id}
                          onClick={() => { setHistoryModal(null); setModalHistory([]); navigate(`/maintenance/${entry.id}`); }}
                          className={`cursor-pointer hover:bg-surface-800/60 transition-colors ${isLatest ? 'bg-emerald-500/5' : ''}`}
                        >
                          <td className={`px-3 py-3 font-mono text-xs whitespace-nowrap ${isLatest ? 'text-emerald-400 font-semibold' : 'text-surface-400'}`}>
                            {entry.ticket_number}
                          </td>
                          <td className={`px-3 py-3 text-xs whitespace-nowrap ${isLatest ? 'text-surface-100 font-medium' : 'text-surface-400'}`}>
                            <span className="capitalize">{entry.document_type === 'loss' ? 'Equipment Loss' : entry.document_type}</span>
                            {entry.completion_outcome && COMPLETION_OUTCOME_CONFIG[entry.completion_outcome] && (
                              <span className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${COMPLETION_OUTCOME_CONFIG[entry.completion_outcome].bgColor} ${COMPLETION_OUTCOME_CONFIG[entry.completion_outcome].color}`}>
                                {COMPLETION_OUTCOME_CONFIG[entry.completion_outcome].label}
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-3 text-xs whitespace-nowrap ${isLatest ? 'text-surface-100 font-medium' : 'text-surface-400'}`}>
                            {entry.completion_date
                              ? new Date(entry.completion_date).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className={`px-3 py-3 text-xs max-w-[240px] ${isLatest ? 'text-surface-100' : 'text-surface-400'}`}>
                            <p className="truncate">{entry.issue_description}</p>
                          </td>
                          <td className={`px-3 py-3 text-xs max-w-[200px] ${isLatest ? 'text-surface-100' : 'text-surface-400'}`}>
                            <p className="truncate">{entry.last_remarks || '—'}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-surface-700/60 flex justify-between items-center">
              <p className="text-xs text-surface-500">
                {modalHistory.length} completed job{modalHistory.length !== 1 && 's'} on record
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={printEquipmentHistory}
                  disabled={modalLoading || modalHistory.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-primary-300 bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Printer size={15} /> Print History
                </button>
                <button
                  onClick={() => { setHistoryModal(null); setModalHistory([]); }}
                  className="px-4 py-1.5 text-sm font-medium text-surface-300 hover:text-surface-100 bg-surface-800 hover:bg-surface-700 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
