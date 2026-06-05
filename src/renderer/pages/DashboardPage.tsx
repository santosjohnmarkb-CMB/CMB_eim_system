import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Lightbulb, AlertTriangle, ClipboardList, BarChart3 } from 'lucide-react';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useAuthStore } from '../stores/auth.store';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT, USE_COUNT_SUBCATEGORIES } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { REPAIR_STATUS_CONFIG, SEVERITY_CONFIG } from '../lib/constants';
import type { DashboardStats, MaintenanceTicket, RepairStatus, EquipmentUseCount } from '../../shared/types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ipcInvoke } from '../lib/ipc';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_ACCENT: Record<Department, { text: string; bg: string; border: string }> = {
  camera:       { text: 'text-primary-400', bg: 'bg-primary-500/10', border: 'border-primary-500/20' },
  lights_grips: { text: 'text-warning-400', bg: 'bg-warning-500/10', border: 'border-warning-500/20' },
};

const TALLY_STATUSES: RepairStatus[] = ['REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED'];
const DEPTS: Department[] = ['camera', 'lights_grips'];

const DEPT_LABEL_COLOR: Record<Department, string> = {
  camera: 'text-yellow-400',
  lights_grips: 'text-orange-400',
};

function isOpenTicket(t: MaintenanceTicket) {
  return t.repair_status !== 'COMPLETED' && t.repair_status !== 'CANCELLED';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const tickets = useMaintenanceStore((s) => s.tickets);
  const fetchTickets = useMaintenanceStore((s) => s.fetchAll);
  const ticketsLoading = useMaintenanceStore((s) => s.loading);

  const [deptStats, setDeptStats] = useState<Record<Department, DashboardStats | null>>({
    camera: null,
    lights_grips: null,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [useCounts, setUseCounts] = useState<EquipmentUseCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      const results = await Promise.all(
        (Object.keys(DEPARTMENT_CONFIG) as Department[]).map(async (key) => {
          try {
            const stats = await ipcInvoke<DashboardStats>(
              'db:equipment:getDashboardStats',
              DEPARTMENT_CONFIG[key].categories,
            );
            return [key, stats] as const;
          } catch {
            return [key, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setDeptStats(Object.fromEntries(results) as Record<Department, DashboardStats | null>);
      setStatsLoading(false);
    }
    loadStats();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  useEffect(() => {
    let cancelled = false;
    async function loadUseCounts() {
      try {
        const counts = await ipcInvoke<EquipmentUseCount[]>('db:equipment:getUseCounts');
        if (!cancelled) setUseCounts(counts || []);
      } catch { /* ignore */ }
    }
    loadUseCounts();
    return () => { cancelled = true; };
  }, []);

  const openTickets = useMemo(
    () => tickets
      .filter(isOpenTicket)
      .filter((t) => t.category_name && CATEGORY_TO_DEPARTMENT[t.category_name])
      .sort((a, b) => {
        const sp = (SEVERITY_CONFIG[a.severity]?.priority ?? 99) - (SEVERITY_CONFIG[b.severity]?.priority ?? 99);
        if (sp !== 0) return sp;
        return new Date(b.reported_date).getTime() - new Date(a.reported_date).getTime();
      }),
    [tickets],
  );

  const openByDept = useMemo(() => {
    const result: Record<Department, MaintenanceTicket[]> = { camera: [], lights_grips: [] };
    for (const t of openTickets) {
      const dept = t.category_name ? CATEGORY_TO_DEPARTMENT[t.category_name] : undefined;
      if (dept) result[dept].push(t);
    }
    return result;
  }, [openTickets]);

  const deptUseCounts = useMemo(() => {
    const result: Record<Department, EquipmentUseCount[]> = { camera: [], lights_grips: [] };
    for (const c of useCounts) {
      const dept = CATEGORY_TO_DEPARTMENT[c.category_name];
      if (dept) result[dept].push(c);
    }
    return result;
  }, [useCounts]);

  const allDeptTickets = useMemo(
    () => tickets.filter((t) => t.category_name && CATEGORY_TO_DEPARTMENT[t.category_name]),
    [tickets],
  );

  const statusTally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of TALLY_STATUSES) counts[s] = 0;
    for (const t of allDeptTickets) {
      if (counts[t.repair_status] !== undefined) {
        counts[t.repair_status] += 1;
      }
    }
    return counts;
  }, [allDeptTickets]);

  if (statsLoading || ticketsLoading) {
    return <LoadingSpinner size="lg" className="py-24" />;
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* ── Header ──────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Admin Dashboard</h1>
        <p className="text-sm text-surface-500 mt-1">
          Combined overview — {user?.full_name ?? 'Admin'}
        </p>
      </div>

      {/* ── Equipment Inventory Summary ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((dept) => {
          const cfg = DEPARTMENT_CONFIG[dept];
          const stats = deptStats[dept];
          const accent = DEPT_ACCENT[dept];
          const Icon = DEPT_ICONS[dept];

          return (
            <div
              key={dept}
              className={`glass-panel rounded-xl p-5 border ${accent.border}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${accent.bg}`}>
                  <Icon size={20} className={accent.text} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-surface-100">{cfg.label}</h2>
                  <p className="text-2xs text-surface-500">{cfg.categories.join(' · ')}</p>
                </div>
                <button
                  onClick={() => navigate(`/dept/${dept}`)}
                  className="text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium whitespace-nowrap"
                >
                  View List →
                </button>
              </div>

              {stats ? (
                <div className="grid grid-cols-4">
                  <MiniStat label="Total" value={stats.totalEquipment} color="text-surface-200" position="first" />
                  <MiniStat label="Available" value={stats.availableCount} color="text-success-400" position="middle" />
                  <MiniStat label="In Repair" value={stats.inRepairCount} color="text-warning-400" position="middle" />
                  <MiniStat label="Tickets" value={stats.activeTickets} color="text-danger-400" position="last" />
                </div>
              ) : (
                <p className="text-xs text-surface-500">Unable to load stats</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Maintenance Tally ──────────────────────── */}
      <div className="glass-panel rounded-xl px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList size={16} className="text-surface-400" />
          <h3 className="text-sm font-semibold text-surface-200">Maintenance Tally</h3>
          <span className="ml-auto text-xs text-surface-500">
            {openTickets.length} open ticket{openTickets.length !== 1 && 's'}
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {TALLY_STATUSES.map((status) => {
            const cfg = REPAIR_STATUS_CONFIG[status];
            const count = statusTally[status] ?? 0;
            return (
              <div
                key={status}
                className="flex items-center gap-2 bg-surface-900/60 rounded-lg px-3 py-1.5"
              >
                <span className={`text-xs font-medium ${cfg?.color ?? 'text-surface-400'}`}>
                  {cfg?.label ?? status}
                </span>
                <span className="text-sm font-bold text-surface-200">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Open Tickets ──────────────────────────── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <AlertTriangle size={16} className="text-danger-400" />
          <h3 className="text-base font-semibold text-surface-200">Open Tickets</h3>
        </div>

        {DEPTS.map((dept, deptIdx) => {
          const Icon = DEPT_ICONS[dept];
          const labelColor = DEPT_LABEL_COLOR[dept];
          const cfg = DEPARTMENT_CONFIG[dept];
          const deptOpen = openByDept[dept];

          return (
            <div key={dept}>
              <div className={`flex items-center gap-2 px-5 py-2.5 bg-surface-900/40 ${deptIdx > 0 ? 'border-t border-surface-700/40 mt-4' : ''}`}>
                <Icon size={16} className={labelColor} />
                <span className={`text-sm font-semibold ${labelColor}`}>{cfg.shortLabel}</span>
                <span className="text-xs text-surface-500 ml-1">({deptOpen.length})</span>
                <button
                  onClick={() => navigate(`/dept/${dept}`)}
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
                              <p className="text-surface-200 font-medium truncate max-w-[220px]">
                                {ticket.equipment_name}
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

      {/* ── Equipment Use Count ────────────────────── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <BarChart3 size={16} className="text-primary-400" />
          <h3 className="text-base font-semibold text-surface-200">Equipment Use Count</h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-surface-800">
          {DEPTS.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const labelColor = DEPT_LABEL_COLOR[dept];
            const subGroups = USE_COUNT_SUBCATEGORIES[dept];
            const deptCounts = deptUseCounts[dept];

            return (
              <div key={dept} className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={labelColor} />
                  <span className={`text-sm font-semibold ${labelColor}`}>
                    {DEPARTMENT_CONFIG[dept].shortLabel}
                  </span>
                </div>

                {subGroups.map((group) => {
                  const nameSet = new Set(group.subcategoryNames);
                  const groupItems = deptCounts
                    .filter((c) => nameSet.has(c.subcategory_name))
                    .slice(0, 5);

                  if (groupItems.length === 0) return null;

                  return (
                    <div key={group.label}>
                      <p className="text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-wide">
                        {group.label}
                      </p>
                      <table className="w-full text-sm">
                        <tbody>
                          {groupItems.map((item, idx) => (
                            <tr key={item.equipment_id} className="border-b border-surface-800/40 last:border-0">
                              <td className="py-1.5 pr-2 text-surface-600 w-5 text-right text-xs">{idx + 1}</td>
                              <td className="py-1.5 px-2 text-surface-200 truncate max-w-[180px]">{item.name}</td>
                              <td className="py-1.5 pl-2 text-right font-bold text-surface-100 w-12">{item.use_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}

                <button
                  onClick={() => navigate('/equipment/use-count')}
                  className="text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
                >
                  View Complete List →
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, position = 'middle' }: { label: string; value: number; color: string; position?: 'first' | 'middle' | 'last' }) {
  const rounded = position === 'first' ? 'rounded-l-lg' : position === 'last' ? 'rounded-r-lg' : '';
  const border = position !== 'last' ? 'border-r border-surface-700/40' : '';
  return (
    <div className={`bg-surface-900/50 px-3 py-2 text-center ${rounded} ${border}`}>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-2xs text-surface-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
