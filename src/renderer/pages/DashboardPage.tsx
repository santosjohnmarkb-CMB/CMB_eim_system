import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Lightbulb, Package, CheckCircle, Wrench,
  AlertTriangle, Box, Clock, ArrowRight,
} from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { useDepartmentStore } from '../stores/department.store';
import { useAuthStore } from '../stores/auth.store';
import { DEPARTMENT_CONFIG, type Department } from '../../shared/constants';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import type { DashboardStats, EquipmentStatus } from '../../shared/types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

// ─── Admin landing: two department entry cards ───────────────────────

function DepartmentSelector() {
  const setDepartment = useDepartmentStore((s) => s.setDepartment);
  const fetchStats = useEquipmentStore((s) => s.fetchDashboardStats);

  const [deptStats, setDeptStats] = useState<Record<Department, DashboardStats | null>>({
    camera: null,
    lights_grips: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const results = await Promise.all(
        (Object.keys(DEPARTMENT_CONFIG) as Department[]).map(async (key) => {
          const cfg = DEPARTMENT_CONFIG[key];
          const stats = await fetchDeptStats(cfg.categories);
          return [key, stats] as const;
        }),
      );
      if (cancelled) return;
      setDeptStats(Object.fromEntries(results) as Record<Department, DashboardStats | null>);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  const departments = Object.keys(DEPARTMENT_CONFIG) as Department[];

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-8 max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-surface-100">Equipment Dashboard</h1>
        <p className="text-sm text-surface-400">Select a department to view its equipment</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {departments.map((key) => {
          const cfg = DEPARTMENT_CONFIG[key];
          const stats = deptStats[key];
          const Icon = DEPT_ICONS[key];

          return (
            <button
              key={key}
              onClick={() => setDepartment(key)}
              className="glass-panel rounded-2xl p-6 text-left hover:bg-surface-800/60
                         transition-all duration-200 group border border-surface-700/40
                         hover:border-surface-600/60"
            >
              <div className="flex items-center justify-between mb-5">
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl
                  ${key === 'camera' ? 'bg-primary-500/10' : 'bg-warning-500/10'}`}
                >
                  <Icon
                    size={24}
                    className={key === 'camera' ? 'text-primary-400' : 'text-warning-400'}
                  />
                </div>
                <ArrowRight
                  size={18}
                  className="text-surface-600 group-hover:text-surface-300
                             group-hover:translate-x-1 transition-all"
                />
              </div>

              <h2 className="text-lg font-semibold text-surface-100 mb-1">{cfg.label}</h2>
              <p className="text-xs text-surface-500 mb-5">
                {cfg.categories.join(' · ')}
              </p>

              {stats && (
                <div className="grid grid-cols-3 gap-3">
                  <StatPill label="Total" value={stats.totalEquipment} color="text-surface-300" />
                  <StatPill label="In Repair" value={stats.inRepairCount} color="text-warning-400" />
                  <StatPill label="Tickets" value={stats.activeTickets} color="text-danger-400" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface-900/50 rounded-lg px-3 py-2 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-surface-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}

async function fetchDeptStats(categoryNames: string[]): Promise<DashboardStats | null> {
  try {
    const { ipcInvoke } = await import('../lib/ipc');
    return await ipcInvoke<DashboardStats>('db:equipment:getDashboardStats', categoryNames);
  } catch {
    return null;
  }
}

// ─── Filtered department dashboard ───────────────────────────────────

function DepartmentDashboard({ departmentKey }: { departmentKey: Department }) {
  const stats = useEquipmentStore((s) => s.dashboardStats);
  const fetchStats = useEquipmentStore((s) => s.fetchDashboardStats);
  const user = useAuthStore((s) => s.user);
  const setDepartment = useDepartmentStore((s) => s.setDepartment);
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const cfg = DEPARTMENT_CONFIG[departmentKey];

  useEffect(() => {
    fetchStats(cfg.categories);
  }, [departmentKey, fetchStats]);

  if (!stats) return <LoadingSpinner size="lg" className="py-24" />;

  const cards = [
    { label: 'Total Equipment', value: stats.totalEquipment, icon: Package, color: 'text-primary-400', bg: 'bg-primary-500/10' },
    { label: 'Available', value: stats.availableCount, icon: CheckCircle, color: 'text-success-400', bg: 'bg-success-500/10' },
    { label: 'In Repair', value: stats.inRepairCount, icon: Wrench, color: 'text-warning-400', bg: 'bg-warning-500/10' },
    { label: 'Active Tickets', value: stats.activeTickets, icon: AlertTriangle, color: 'text-danger-400', bg: 'bg-danger-500/10', onClick: () => navigate('/maintenance') },
    { label: 'Low Stock Parts', value: stats.lowStockParts, icon: Box, color: 'text-purple-400', bg: 'bg-purple-500/10', onClick: () => navigate('/parts') },
  ];

  return (
    <div className="space-y-6">
      {isAdmin && (
        <button
          onClick={() => useDepartmentStore.setState({ activeDepartment: null })}
          className="inline-flex items-center gap-1.5 text-sm text-surface-400
                     hover:text-surface-200 transition-colors"
        >
          <ArrowRight size={14} className="rotate-180" />
          All Departments
        </button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={card.onClick}
            className="glass-panel rounded-xl p-4 text-left hover:bg-surface-800/50 transition-colors"
          >
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${card.bg} mb-3`}>
              <card.icon size={20} className={card.color} />
            </div>
            <p className="text-2xl font-bold text-surface-100">{card.value}</p>
            <p className="text-xs text-surface-500 mt-0.5">{card.label}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-xl p-5">
          <h3 className="text-sm font-semibold text-surface-300 mb-4">Status Distribution</h3>
          <div className="space-y-2">
            {Object.entries(stats.statusDistribution).map(([status, count]) => {
              const config = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus];
              if (!config || count === 0) return null;
              const pct = stats.totalEquipment > 0 ? (count / stats.totalEquipment) * 100 : 0;
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`text-xs font-medium w-28 ${config.textColor}`}>{config.label}</span>
                  <div className="flex-1 h-2 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${config.bgColor.replace('/15', '')}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-surface-400 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5">
          <h3 className="text-sm font-semibold text-surface-300 mb-4">Recent Activity</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {stats.recentActivity.length === 0 ? (
              <p className="text-sm text-surface-500">No recent activity</p>
            ) : (
              stats.recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 text-sm">
                  <Clock size={14} className="text-surface-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-surface-300">
                      <span className="font-medium">{entry.changed_by}</span> changed status from{' '}
                      <span className="text-warning-400">{entry.previous_status}</span> to{' '}
                      <span className="text-success-400">{entry.new_status}</span>
                    </p>
                    {entry.reason && <p className="text-surface-500 text-xs mt-0.5">{entry.reason}</p>}
                    <p className="text-surface-600 text-xs mt-0.5">
                      {new Date(entry.changed_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root component ──────────────────────────────────────────────────

export function DashboardPage() {
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);

  if (!activeDepartment) {
    return <DepartmentSelector />;
  }

  return <DepartmentDashboard departmentKey={activeDepartment} />;
}
