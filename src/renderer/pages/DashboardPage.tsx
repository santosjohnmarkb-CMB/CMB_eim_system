import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, CheckCircle, Wrench, AlertTriangle, Box, Clock } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import type { EquipmentStatus } from '../../shared/types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export function DashboardPage() {
  const stats = useEquipmentStore((s) => s.dashboardStats);
  const fetchStats = useEquipmentStore((s) => s.fetchDashboardStats);
  const navigate = useNavigate();

  useEffect(() => { fetchStats(); }, [fetchStats]);

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
                    <div className={`h-full rounded-full ${config.bgColor.replace('/15', '')}`} style={{ width: `${pct}%` }} />
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
                    <p className="text-surface-600 text-xs mt-0.5">{new Date(entry.changed_at).toLocaleString()}</p>
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
