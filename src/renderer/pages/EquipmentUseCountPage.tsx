import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Lightbulb, ArrowLeft, BarChart3, Search } from 'lucide-react';
import { DEPARTMENT_CONFIG, USE_COUNT_SUBCATEGORIES, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ipcInvoke } from '../lib/ipc';
import { useAuthStore } from '../stores/auth.store';
import type { EquipmentUseCount } from '../../shared/types';

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const DEPT_ACCENT: Record<Department, string> = {
  camera: 'text-primary-400',
  lights_grips: 'text-amber-400',
};

const OTHER_GROUP_LABEL = 'Other';

export function EquipmentUseCountPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const userDept = user?.department as Department | null;
  const departments: Department[] = isAdmin
    ? (['camera', 'lights_grips'] as Department[])
    : (userDept ? [userDept] : (['camera', 'lights_grips'] as Department[]));

  const [useCounts, setUseCounts] = useState<EquipmentUseCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const counts = await ipcInvoke<EquipmentUseCount[]>('db:equipment:getUseCounts');
        if (!cancelled) setUseCounts(counts || []);
      } catch {
        if (!cancelled) setUseCounts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Equipment use counts grouped by department (via category → department mapping).
  const deptUseCounts = useMemo(() => {
    const result: Record<Department, EquipmentUseCount[]> = { camera: [], lights_grips: [] };
    const q = search.trim().toLowerCase();
    for (const c of useCounts) {
      if (q && !(
        c.name.toLowerCase().includes(q) ||
        c.equipment_code.toLowerCase().includes(q) ||
        (c.brand || '').toLowerCase().includes(q)
      )) continue;
      const dept = CATEGORY_TO_DEPARTMENT[c.category_name];
      if (dept) result[dept].push(c);
    }
    return result;
  }, [useCounts, search]);

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <button
        onClick={() => navigate('/equipment')}
        className="flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <ArrowLeft size={16} /> Back to Equipment
      </button>

      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <BarChart3 size={20} className="text-primary-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-surface-100">Equipment Use Count</h1>
          <p className="text-sm text-surface-500">Total deployments per equipment, ranked by usage</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
          placeholder="Search by name, code, or brand..."
        />
      </div>

      <div className={`grid grid-cols-1 ${departments.length > 1 ? 'lg:grid-cols-2' : ''} gap-4`}>
        {departments.map((dept) => {
          const Icon = DEPT_ICONS[dept];
          const accent = DEPT_ACCENT[dept];
          const subGroups = USE_COUNT_SUBCATEGORIES[dept];
          const deptCounts = deptUseCounts[dept];

          // Preferred subcategory order (as defined in constants), then any others alphabetically.
          const preferredOrder = subGroups.flatMap((g) => g.subcategoryNames);
          const itemsBySubcategory = new Map<string, EquipmentUseCount[]>();
          for (const c of deptCounts) {
            const key = c.subcategory_name || OTHER_GROUP_LABEL;
            const existing = itemsBySubcategory.get(key);
            if (existing) existing.push(c);
            else itemsBySubcategory.set(key, [c]);
          }

          const groups = Array.from(itemsBySubcategory.keys())
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
              items: (itemsBySubcategory.get(label) || []).slice().sort((a, b) => b.use_count - a.use_count),
            }));

          return (
            <div key={dept} className="glass-panel rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
                <Icon size={18} className={accent} />
                <h3 className={`text-sm font-semibold ${accent}`}>{DEPARTMENT_CONFIG[dept].label}</h3>
                <span className="ml-auto text-xs text-surface-500">{deptCounts.length} items</span>
              </div>

              <div className="p-5 space-y-5">
                {groups.length === 0 ? (
                  <p className="text-sm text-surface-500 text-center py-6">
                    No equipment use data available.
                  </p>
                ) : (
                  groups.map((group) => (
                    <div key={group.label}>
                      <p className="text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-wide">
                        {group.label}
                      </p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-2xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                            <th className="py-1.5 pr-2 w-6 text-right font-medium">#</th>
                            <th className="py-1.5 px-2 text-left font-medium">Equipment</th>
                            <th className="py-1.5 px-2 text-left font-medium">Code</th>
                            <th className="py-1.5 pl-2 text-right font-medium w-16">Uses</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, idx) => (
                            <tr
                              key={item.equipment_id}
                              onClick={() => navigate(`/equipment/detail/${item.equipment_id}`)}
                              className="border-b border-surface-800/40 last:border-0 hover:bg-surface-800/40 transition-colors cursor-pointer"
                            >
                              <td className="py-1.5 pr-2 text-surface-600 text-right text-xs">{idx + 1}</td>
                              <td className="py-1.5 px-2 text-surface-200">
                                <span className="block truncate max-w-[220px]">{item.name}</span>
                                {item.brand && <span className="text-2xs text-surface-500">{item.brand}</span>}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-xs text-surface-400 whitespace-nowrap">{item.equipment_code}</td>
                              <td className="py-1.5 pl-2 text-right font-bold text-surface-100">{item.use_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
