import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { SearchBox } from '../components/common/SearchBox';
import { REPAIR_STATUS_CONFIG, SEVERITY_CONFIG } from '../lib/constants';
import { useDepartmentFilter } from '../hooks';
import type { MaintenanceTicket } from '../../shared/types';

const KANBAN_COLUMNS = ['REPORTED', 'ASSESSED', 'QUEUED', 'IN_PROGRESS', 'TESTING', 'COMPLETED'] as const;
const severityVariant: Record<string, 'danger' | 'warning' | 'default' | 'info'> = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'default', LOW: 'info' };

export function MaintenanceQueuePage() {
  const { tickets, loading, fetchAll } = useMaintenanceStore();
  const { items: equipmentItems, fetchAll: fetchEquipment } = useEquipmentStore();
  const { isEquipmentInDepartment } = useDepartmentFilter();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  useEffect(() => { fetchAll(); fetchEquipment(); }, [fetchAll, fetchEquipment]);

  const equipmentCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const eq of equipmentItems) map.set(eq.id, eq.category_id);
    return map;
  }, [equipmentItems]);

  const filtered = tickets.filter((t) => {
    const catId = equipmentCategoryMap.get(t.equipment_id);
    if (catId && !isEquipmentInDepartment(catId)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.ticket_number.toLowerCase().includes(q) || (t.equipment_name || '').toLowerCase().includes(q);
  });

  const columns = KANBAN_COLUMNS.map((status) => ({
    status,
    config: REPAIR_STATUS_CONFIG[status],
    tickets: filtered.filter((t) => t.repair_status === status),
  }));

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search tickets..." className="w-64" />
        <div className="flex-1" />
        <Button onClick={() => navigate('/maintenance/new')}><Plus size={16} /> New Ticket</Button>
      </div>
      <div className="flex-1 flex gap-3 overflow-x-auto pb-2">
        {columns.map(({ status, config, tickets: colTickets }) => (
          <div key={status} className="flex-shrink-0 w-56 flex flex-col">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
              <span className="text-2xs text-surface-500 bg-surface-800 px-1.5 py-0.5 rounded-full">{colTickets.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {colTickets.map((ticket) => (
                <button key={ticket.id} onClick={() => navigate(`/maintenance/${ticket.id}`)} className="w-full glass-panel rounded-lg p-3 text-left hover:bg-surface-800/70 transition-colors">
                  <p className="text-xs text-surface-500 mb-1">{ticket.ticket_number}</p>
                  <p className="text-sm font-medium text-surface-200 truncate">{ticket.equipment_name}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={severityVariant[ticket.severity] || 'default'} size="sm">{ticket.severity}</Badge>
                    {ticket.document_type && <Badge variant={ticket.document_type === 'maintenance' ? 'info' : 'warning'} size="sm">{ticket.document_type === 'maintenance' ? 'MNT' : 'RPR'}</Badge>}
                  </div>
                  {ticket.assigned_technician && <p className="text-2xs text-surface-500 mt-1.5">{ticket.assigned_technician}</p>}
                </button>
              ))}
              {colTickets.length === 0 && <p className="text-2xs text-surface-600 text-center py-4">Empty</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
