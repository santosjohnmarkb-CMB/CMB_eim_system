import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Lightbulb, AlertTriangle, ClipboardList } from 'lucide-react';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useAuthStore } from '../stores/auth.store';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { REPAIR_STATUS_CONFIG, SEVERITY_CONFIG } from '../lib/constants';
import type { DashboardStats, MaintenanceTicket, RepairStatus } from '../../shared/types';
import { Badge } from '../components/common/Badge';
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

const SEVERITY_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'default'> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'default',
};

const OPEN_STATUSES: RepairStatus[] = ['REPORTED', 'ASSESSED', 'QUEUED', 'IN_PROGRESS', 'TESTING', 'ESCALATED'];

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

  const statusTally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of OPEN_STATUSES) counts[s] = 0;
    for (const t of openTickets) {
      counts[t.repair_status] = (counts[t.repair_status] ?? 0) + 1;
    }
    return counts;
  }, [openTickets]);

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
                <div>
                  <h2 className="text-sm font-semibold text-surface-100">{cfg.label}</h2>
                  <p className="text-2xs text-surface-500">{cfg.categories.join(' · ')}</p>
                </div>
              </div>

              {stats ? (
                <div className="grid grid-cols-4 gap-3">
                  <MiniStat label="Total" value={stats.totalEquipment} color="text-surface-200" />
                  <MiniStat label="Available" value={stats.availableCount} color="text-success-400" />
                  <MiniStat label="In Repair" value={stats.inRepairCount} color="text-warning-400" />
                  <MiniStat label="Tickets" value={stats.activeTickets} color="text-danger-400" />
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
          {OPEN_STATUSES.map((status) => {
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

      {/* ── Open Tickets List ──────────────────────── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <AlertTriangle size={16} className="text-danger-400" />
          <h3 className="text-sm font-semibold text-surface-200">Open Tickets</h3>
          <span className="text-xs text-surface-500 ml-1">({openTickets.length})</span>
        </div>

        {openTickets.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">
            No open tickets across departments
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                  <th className="text-left px-5 py-2.5 font-medium">Ticket</th>
                  <th className="text-left px-3 py-2.5 font-medium">Equipment</th>
                  <th className="text-left px-3 py-2.5 font-medium">Dept</th>
                  <th className="text-left px-3 py-2.5 font-medium">Severity</th>
                  <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  <th className="text-left px-3 py-2.5 font-medium">Last Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60">
                {openTickets.map((ticket) => {
                  const dept = ticket.category_name
                    ? CATEGORY_TO_DEPARTMENT[ticket.category_name]
                    : undefined;
                  const deptCfg = dept ? DEPARTMENT_CONFIG[dept] : undefined;
                  const severityCfg = SEVERITY_CONFIG[ticket.severity];
                  const statusCfg = REPAIR_STATUS_CONFIG[ticket.repair_status];

                  return (
                    <tr
                      key={ticket.id}
                      onClick={() => {
                        if (dept) {
                          navigate(`/dept/${dept}/ticket/${ticket.id}`);
                        }
                      }}
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
                        {dept && (
                          <Badge variant={dept === 'camera' ? 'info' : 'warning'}>
                            {deptCfg?.shortLabel ?? dept}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge variant={SEVERITY_BADGE_VARIANT[ticket.severity] ?? 'default'}>
                          {severityCfg?.label ?? ticket.severity}
                        </Badge>
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
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface-900/50 rounded-lg px-3 py-2 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-2xs text-surface-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
