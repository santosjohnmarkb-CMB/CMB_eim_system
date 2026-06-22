import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Lightbulb, Package, CheckCircle, Wrench,
  AlertTriangle, ArrowRight, BarChart3,
} from 'lucide-react';
import { DEPARTMENT_CONFIG, USE_COUNT_SUBCATEGORIES, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ipcInvoke } from '../lib/ipc';
import { useAuthStore } from '../stores/auth.store';
import type { DashboardStats, EquipmentUseCount } from '../../shared/types';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_ACCENT: Record<Department, { iconBg: string; iconColor: string; border: string; text: string }> = {
  camera: {
    iconBg: 'bg-primary-500/10',
    iconColor: 'text-primary-400',
    border: 'hover:border-primary-500/30',
    text: 'text-primary-400',
  },
  lights_grips: {
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    border: 'hover:border-amber-500/30',
    text: 'text-amber-400',
  },
};

export function EquipmentDashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const userDept = user?.department as Department | null;
  const [deptStats, setDeptStats] = useState<Record<Department, DashboardStats | null>>({
    camera: null, lights_grips: null,
  });
  const [useCounts, setUseCounts] = useState<EquipmentUseCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [statsResults, counts] = await Promise.all([
        Promise.all(
          (Object.keys(DEPARTMENT_CONFIG) as Department[]).map(async (key) => {
            try {
              const stats = await ipcInvoke<DashboardStats>('db:equipment:getDashboardStats', DEPARTMENT_CONFIG[key].categories);
              return [key, stats] as const;
            } catch { return [key, null] as const; }
          }),
        ),
        ipcInvoke<EquipmentUseCount[]>('db:equipment:getUseCounts').catch(() => []),
      ]);
      if (cancelled) return;
      setDeptStats(Object.fromEntries(statsResults) as Record<Department, DashboardStats | null>);
      setUseCounts(counts || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const deptUseCounts = useMemo(() => {
    const result: Record<Department, EquipmentUseCount[]> = { camera: [], lights_grips: [] };
    for (const c of useCounts) {
      const dept = CATEGORY_TO_DEPARTMENT[c.category_name];
      if (dept) result[dept].push(c);
    }
    return result;
  }, [useCounts]);

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  const allDepartments = Object.keys(DEPARTMENT_CONFIG) as Department[];
  const departments = isAdmin
    ? allDepartments
    : (userDept ? [userDept] : allDepartments);
  const totalAll = departments.reduce((sum, d) => sum + (deptStats[d]?.totalEquipment || 0), 0);
  const availAll = departments.reduce((sum, d) => sum + (deptStats[d]?.availableCount || 0), 0);
  const repairAll = departments.reduce((sum, d) => sum + (deptStats[d]?.inRepairCount || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-surface-100">Equipment Inventory</h1>
        <p className="text-sm text-surface-500 mt-1">
          Linked to the CMB Rental Request database &middot;{' '}
          <span className="text-surface-300 font-medium">{totalAll}</span> total &middot;{' '}
          <span className="text-success-400">{availAll}</span> available &middot;{' '}
          <span className="text-warning-400">{repairAll}</span> in repair
        </p>
      </div>

      {/* Department cards */}
      <div className={`grid grid-cols-1 ${departments.length > 1 ? 'md:grid-cols-2' : ''} gap-5`}>
        {departments.map((key) => {
          const cfg = DEPARTMENT_CONFIG[key];
          const stats = deptStats[key];
          const Icon = DEPT_ICONS[key];
          const accent = DEPT_ACCENT[key];
          return (
            <button
              key={key}
              onClick={() => navigate(`/equipment/${key}`)}
              className={`glass-panel rounded-2xl p-6 text-left transition-all duration-200 group
                         border border-surface-700/40 ${accent.border} hover:bg-surface-800/60`}
            >
              <div className="flex items-center justify-between mb-5">
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${accent.iconBg}`}>
                  <Icon size={24} className={accent.iconColor} />
                </div>
                <ArrowRight size={18} className="text-surface-600 group-hover:text-surface-300 group-hover:translate-x-1 transition-all" />
              </div>
              <h2 className="text-lg font-semibold text-surface-100 mb-1">{cfg.label}</h2>
              <p className="text-xs text-surface-500 mb-5">{cfg.categories.join(' · ')}</p>
              {stats && (
                <div className="grid grid-cols-4 gap-2">
                  <StatCell label="Total" value={stats.totalEquipment} icon={Package} color="text-surface-200" />
                  <StatCell label="Available" value={stats.availableCount} icon={CheckCircle} color="text-success-400" />
                  <StatCell label="In Repair" value={stats.inRepairCount} icon={Wrench} color="text-warning-400" />
                  <StatCell label="Tickets" value={stats.activeTickets} icon={AlertTriangle} color="text-danger-400" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Use Count by department with subcategory breakdown */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <BarChart3 size={16} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-surface-200">Equipment Use Count</h3>
        </div>

        <div className={`grid grid-cols-1 ${departments.length > 1 ? 'lg:grid-cols-2 lg:divide-y-0 lg:divide-x' : ''} divide-y divide-surface-800`}>
          {departments.map((dept) => {
            const Icon = DEPT_ICONS[dept];
            const accent = DEPT_ACCENT[dept];
            const deptCounts = deptUseCounts[dept];

            // Preferred subcategory order (as defined in constants), then any others alphabetically.
            const preferredOrder = USE_COUNT_SUBCATEGORIES[dept].flatMap((g) => g.subcategoryNames);
            const itemsBySubcategory = new Map<string, EquipmentUseCount[]>();
            for (const c of deptCounts) {
              const key = c.subcategory_name || 'Other';
              const existing = itemsBySubcategory.get(key);
              if (existing) existing.push(c);
              else itemsBySubcategory.set(key, [c]);
            }

            const subcategoryGroups = Array.from(itemsBySubcategory.keys())
              .sort((a, b) => {
                const ia = preferredOrder.indexOf(a);
                const ib = preferredOrder.indexOf(b);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return a.localeCompare(b);
              })
              .map((label) => ({
                label,
                items: (itemsBySubcategory.get(label) || [])
                  .slice()
                  .sort((a, b) => b.use_count - a.use_count)
                  .slice(0, 5),
              }));

            return (
              <div key={dept} className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={accent.iconColor} />
                  <span className={`text-sm font-semibold ${accent.text}`}>
                    {DEPARTMENT_CONFIG[dept].shortLabel}
                  </span>
                </div>

                {subcategoryGroups.map((group) => {
                  const groupItems = group.items;

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
                  className="text-xs text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1"
                >
                  View Complete List <ArrowRight size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: typeof Package; color: string;
}) {
  return (
    <div className="bg-surface-900/50 rounded-lg px-2 py-2.5 text-center">
      <Icon size={14} className={`${color} mx-auto mb-1 opacity-60`} />
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-surface-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
