import { useState, useEffect } from 'react';
import { BarChart3, Wrench, Box, TrendingUp, FileSpreadsheet, FileText } from 'lucide-react';
import { ipcInvoke } from '../lib/ipc';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useDepartmentStore } from '../stores/department.store';
import { useUiStore } from '../stores/ui.store';
import { DEPARTMENT_CONFIG } from '../../shared/constants';

type ReportType = 'fleet' | 'repair' | 'parts' | 'availability';

export function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportType>('fleet');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const addToast = useUiStore((s) => s.addToast);

  const loadReport = async (type: ReportType) => {
    setLoading(true);
    setActiveReport(type);
    try {
      const channelMap: Record<ReportType, string> = { fleet: 'reports:fleetUtilization', repair: 'reports:repairCosts', parts: 'reports:partsSpend', availability: 'reports:availabilityTrends' };
      const result = await ipcInvoke(channelMap[type], activeDepartment ?? undefined);
      setData(result);
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { loadReport('fleet'); }, [activeDepartment]);

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      const channel = format === 'xlsx' ? 'reports:exportExcel' : 'reports:exportPdf';
      const result: any = await ipcInvoke(channel, activeReport, activeDepartment ?? undefined);
      if (result?.success) {
        addToast({ type: 'success', message: `Report exported to ${result.path}` });
      } else if (!result?.canceled) {
        addToast({ type: 'error', message: result?.message || 'Export failed' });
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Export failed' });
    } finally {
      setExporting(null);
    }
  };

  const tabs = [
    { key: 'fleet' as ReportType, label: 'Fleet Utilization', icon: BarChart3 },
    { key: 'repair' as ReportType, label: 'Repair Costs', icon: Wrench },
    { key: 'parts' as ReportType, label: 'Parts Spend', icon: Box },
    { key: 'availability' as ReportType, label: 'Availability', icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      {activeDepartment && (
        <p className="text-xs text-surface-500">
          Showing reports for <span className="text-surface-300 font-semibold">{DEPARTMENT_CONFIG[activeDepartment].label}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => loadReport(tab.key)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeReport === tab.key ? 'bg-primary-600/15 text-primary-400' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'}`}>
            <tab.icon size={16} />{tab.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => handleExport('xlsx')}
            disabled={loading || !!exporting || !data}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-surface-300 bg-surface-800/50 hover:bg-surface-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileSpreadsheet size={16} />{exporting === 'xlsx' ? 'Exporting…' : 'Excel'}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            disabled={loading || !!exporting || !data}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-surface-300 bg-surface-800/50 hover:bg-surface-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileText size={16} />{exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-6">
        {loading ? <LoadingSpinner size="lg" className="py-12" /> : !data ? <p className="text-surface-500 text-center py-12">No data available</p> : (
          <div className="space-y-4">
            {activeReport === 'fleet' && data.statusDistribution && (
              <div>
                <h3 className="text-sm font-semibold text-surface-300 mb-3">Status Distribution</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.statusDistribution.map((s: any) => (
                    <div key={s.current_status} className="bg-surface-800/50 rounded-lg p-3"><p className="text-lg font-bold text-surface-100">{s.count}</p><p className="text-xs text-surface-500">{s.current_status}</p></div>
                  ))}
                </div>
              </div>
            )}
            {activeReport === 'repair' && data.byEquipment && (
              <div>
                <h3 className="text-sm font-semibold text-surface-300 mb-3">Top Repair Costs by Equipment</h3>
                <div className="space-y-2">
                  {data.byEquipment.map((r: any) => (
                    <div key={r.equipment_code} className="flex items-center justify-between text-sm">
                      <span className="text-surface-200">{r.equipment_code} — {r.name}</span>
                      <span className="text-surface-300">P{r.total_cost.toLocaleString()} ({r.ticket_count} tickets)</span>
                    </div>
                  ))}
                  {data.byEquipment.length === 0 && <p className="text-surface-500">No completed repairs</p>}
                </div>
              </div>
            )}
            {activeReport === 'parts' && data.topConsumed && (
              <div>
                <h3 className="text-sm font-semibold text-surface-300 mb-3">Top Consumed Parts</h3>
                <div className="space-y-2">
                  {data.topConsumed.map((p: any) => (
                    <div key={p.part_code} className="flex items-center justify-between text-sm">
                      <span className="text-surface-200">{p.part_code} — {p.name}</span>
                      <span className="text-surface-300">{p.total_consumed} units — P{p.total_cost.toLocaleString()}</span>
                    </div>
                  ))}
                  {data.topConsumed.length === 0 && <p className="text-surface-500">No parts consumed</p>}
                </div>
              </div>
            )}
            {activeReport === 'availability' && data.daily && (
              <div>
                <h3 className="text-sm font-semibold text-surface-300 mb-3">Status Changes (Last 30 Days)</h3>
                <div className="space-y-1">
                  {data.daily.map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-surface-400">{d.day}</span>
                      <span className="text-surface-200">{d.new_status}: {d.count}</span>
                    </div>
                  ))}
                  {data.daily.length === 0 && <p className="text-surface-500">No status changes in the last 30 days</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
