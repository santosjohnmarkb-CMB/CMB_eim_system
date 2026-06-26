import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, ChevronRight, ChevronDown, Camera, Lightbulb,
  Wrench, PackageCheck, ShoppingCart,
} from 'lucide-react';
import { getClearedArchive, type ClearedArchiveEntry, type ListSection } from '../lib/archiveList';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';

const SECTION_ORDER: ListSection[] = ['maintenance', 'loan', 'purchase'];

const SECTION_LABEL: Record<ListSection, string> = {
  maintenance: 'Maintenance - Completed Tickets',
  loan: 'Loaned Equipment - Returned',
  purchase: 'Purchase Requests - Fulfilled',
};

const SECTION_ICON: Record<ListSection, typeof Wrench> = {
  maintenance: Wrench,
  loan: PackageCheck,
  purchase: ShoppingCart,
};

const SECTION_ROUTE: Record<ListSection, string> = {
  maintenance: '/maintenance/',
  loan: '/loans/',
  purchase: '/purchase-requests/',
};

const DEPT_ICON: Record<string, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parsedDate(d: string | null): { year: string; monthIndex: number; monthName: string } {
  if (d) {
    const date = new Date(d);
    if (!isNaN(date.getTime())) {
      return { year: String(date.getFullYear()), monthIndex: date.getMonth(), monthName: MONTH_NAMES[date.getMonth()] };
    }
  }
  return { year: 'Unknown', monthIndex: -1, monthName: 'Unknown' };
}

interface MonthGroup { monthIndex: number; monthName: string; sections: Map<ListSection, ClearedArchiveEntry[]>; count: number }
interface YearGroup { year: string; months: Map<string, MonthGroup>; count: number }
interface DeptGroup { key: string; label: string; years: Map<string, YearGroup>; count: number }

export function ArchivesPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ClearedArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getClearedArchive();
        if (!cancelled) setEntries(data);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Group entries Department > Year > Month > Section.
  const departments = useMemo<DeptGroup[]>(() => {
    const depts = new Map<string, DeptGroup>();
    for (const e of entries) {
      const deptKey = e.department ?? 'other';
      const deptLabel = e.department ? DEPARTMENT_CONFIG[e.department as Department].label : 'Other';
      let dept = depts.get(deptKey);
      if (!dept) { dept = { key: deptKey, label: deptLabel, years: new Map(), count: 0 }; depts.set(deptKey, dept); }
      dept.count += 1;

      const { year, monthIndex, monthName } = parsedDate(e.closedDate);
      let yg = dept.years.get(year);
      if (!yg) { yg = { year, months: new Map(), count: 0 }; dept.years.set(year, yg); }
      yg.count += 1;

      let mg = yg.months.get(monthName);
      if (!mg) { mg = { monthIndex, monthName, sections: new Map(), count: 0 }; yg.months.set(monthName, mg); }
      mg.count += 1;

      const list = mg.sections.get(e.section) ?? [];
      list.push(e);
      mg.sections.set(e.section, list);
    }

    // Sort: departments by config order (camera, lights_grips) then Other; years desc;
    // months desc by index; sections in fixed order.
    const deptOrder = (k: string) => (k === 'camera' ? 0 : k === 'lights_grips' ? 1 : 2);
    return Array.from(depts.values()).sort((a, b) => deptOrder(a.key) - deptOrder(b.key));
  }, [entries]);

  const sortedYears = (dept: DeptGroup) =>
    Array.from(dept.years.values()).sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  const sortedMonths = (yg: YearGroup) =>
    Array.from(yg.months.values()).sort((a, b) => b.monthIndex - a.monthIndex);
  const sortedSections = (mg: MonthGroup) =>
    SECTION_ORDER.filter((s) => mg.sections.has(s));

  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-6 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <Archive size={20} className="text-primary-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Archives</h1>
          <p className="text-sm text-surface-500">
            Closed records cleared from their lists, organized by department, year, month, and section
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="glass-panel rounded-xl px-5 py-16 text-center text-surface-500 text-sm">
          No archived records yet. Use the &ldquo;Archive List&rdquo; button on the Maintenance, Loaned Equipment,
          or Purchase Request pages to archive a completed list.
        </div>
      ) : (
        <div className="space-y-3">
          {departments.map((dept) => {
            const DeptIcon = DEPT_ICON[dept.key] ?? Archive;
            const deptExpanded = expanded.has(dept.key);
            return (
              <div key={dept.key} className="glass-panel rounded-xl overflow-hidden">
                <button
                  onClick={() => toggle(dept.key)}
                  className="w-full flex items-center gap-2.5 px-5 py-4 hover:bg-surface-800/40 transition-colors"
                >
                  {deptExpanded ? <ChevronDown size={16} className="text-surface-500" /> : <ChevronRight size={16} className="text-surface-500" />}
                  <DeptIcon size={18} className="text-primary-400" />
                  <span className="text-base font-semibold text-surface-100">{dept.label}</span>
                  <span className="text-xs text-surface-500 ml-1">({dept.count})</span>
                </button>

                {deptExpanded && (
                  <div className="border-t border-surface-800/60">
                    {sortedYears(dept).map((yg) => {
                      const yKey = `${dept.key}/${yg.year}`;
                      const yExpanded = expanded.has(yKey);
                      return (
                        <div key={yKey} className="border-b border-surface-800/40 last:border-b-0">
                          <button
                            onClick={() => toggle(yKey)}
                            className="w-full flex items-center gap-2.5 px-5 py-2.5 pl-8 hover:bg-surface-800/40 transition-colors"
                          >
                            {yExpanded ? <ChevronDown size={14} className="text-surface-500" /> : <ChevronRight size={14} className="text-surface-500" />}
                            <span className="text-sm font-semibold text-surface-200">{yg.year}</span>
                            <span className="text-xs text-surface-500 ml-1">({yg.count})</span>
                          </button>

                          {yExpanded && sortedMonths(yg).map((mg) => {
                            const mKey = `${yKey}/${mg.monthName}`;
                            const mExpanded = expanded.has(mKey);
                            return (
                              <div key={mKey}>
                                <button
                                  onClick={() => toggle(mKey)}
                                  className="w-full flex items-center gap-2.5 px-5 py-2 pl-14 hover:bg-surface-800/40 transition-colors"
                                >
                                  {mExpanded ? <ChevronDown size={13} className="text-surface-500" /> : <ChevronRight size={13} className="text-surface-500" />}
                                  <span className="text-sm text-surface-300">{mg.monthName}</span>
                                  <span className="text-xs text-surface-500 ml-1">({mg.count})</span>
                                </button>

                                {mExpanded && sortedSections(mg).map((section) => {
                                  const sKey = `${mKey}/${section}`;
                                  const sExpanded = expanded.has(sKey);
                                  const rows = mg.sections.get(section)!;
                                  const SectionIcon = SECTION_ICON[section];
                                  return (
                                    <div key={sKey}>
                                      <button
                                        onClick={() => toggle(sKey)}
                                        className="w-full flex items-center gap-2.5 px-5 py-2 pl-20 hover:bg-surface-800/40 transition-colors"
                                      >
                                        {sExpanded ? <ChevronDown size={13} className="text-surface-500" /> : <ChevronRight size={13} className="text-surface-500" />}
                                        <SectionIcon size={14} className="text-surface-400" />
                                        <span className="text-xs font-medium text-surface-300 uppercase tracking-wide">{SECTION_LABEL[section]}</span>
                                        <span className="text-xs text-surface-500 ml-1">({rows.length})</span>
                                      </button>

                                      {sExpanded && (
                                        <div className="pl-24 pr-5 pb-2">
                                          <table className="w-full text-sm">
                                            <tbody className="divide-y divide-surface-800/60">
                                              {rows.map((r) => (
                                                <tr
                                                  key={r.id}
                                                  onClick={() => navigate(`${SECTION_ROUTE[section]}${r.id}`)}
                                                  className="hover:bg-surface-800/40 transition-colors cursor-pointer"
                                                >
                                                  <td className="py-2 pr-3 font-mono text-xs text-primary-400 whitespace-nowrap align-top">{r.number}</td>
                                                  <td className="py-2 pr-3">
                                                    <p className="text-surface-200 truncate max-w-[320px]">{r.title}</p>
                                                    {r.subtitle && <p className="text-2xs text-surface-500 truncate max-w-[320px]">{r.subtitle}</p>}
                                                  </td>
                                                  <td className="py-2 text-xs text-surface-400 whitespace-nowrap align-top text-right">
                                                    {r.closedDate ? new Date(r.closedDate).toLocaleDateString() : '—'}
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
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
