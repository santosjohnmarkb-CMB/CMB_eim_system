import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { usePartsStore } from '../stores/parts.store';
import { useVendorsStore } from '../stores/vendors.store';
import { useAuthStore } from '../stores/auth.store';
import { useDepartmentStore } from '../stores/department.store';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT, USE_COUNT_SUBCATEGORIES } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { REPAIR_STATUS_CONFIG, SEVERITY_CONFIG } from '../lib/constants';
import { ipcInvoke } from '../lib/ipc';
import { Badge } from '../components/common/Badge';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import type { MaintenanceTicket, PartsCatalogItem, Vendor, CompletedHistoryEntry, EquipmentUseCount } from '../../shared/types';
import { Camera, Lightbulb, ArrowLeft, Wrench, Box, Truck, BarChart3, Plus, AlertTriangle, History, ChevronRight } from 'lucide-react';

type TabKey = 'parts' | 'vendors' | 'reports';

const TABS: { key: TabKey; label: string; icon: typeof Wrench }[] = [
  { key: 'reports', label: 'Dashboard', icon: BarChart3 },
  { key: 'parts', label: 'Parts', icon: Box },
  { key: 'vendors', label: 'Vendors', icon: Truck },
];

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};


const KANBAN_COLUMNS = ['REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED'] as const;

// ─── Parts Tab ─────────────────────────────────────────────────────────

function PartsTab({ dept }: { dept: Department }) {
  const { items: allItems, loading, fetchAll, create } = usePartsStore();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'spare', unit_of_measure: 'unit', unit_cost: 0, initial_stock: 0, reorder_point: 5, reorder_qty: 10, location: 'Main Warehouse' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const items = useMemo(() =>
    allItems.filter((p) => p.department === dept || !p.department),
  [allItems, dept]);

  const filtered = useMemo(() => items.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.part_code.toLowerCase().includes(q);
  }), [items, search]);

  const set = (f: string, v: any) => setForm((p) => ({ ...p, [f]: v }));

  const handleCreate = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await create({ ...form, department: dept });
      toast.success('Part created');
      setShowAdd(false);
      setForm({ name: '', description: '', category: 'spare', unit_of_measure: 'unit', unit_cost: 0, initial_stock: 0, reorder_point: 5, reorder_qty: 10, location: 'Main Warehouse' });
    } catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const columns: Column<PartsCatalogItem>[] = [
    { key: 'part_code', header: 'Code', className: 'w-28' },
    { key: 'name', header: 'Name', render: (p) => (
      <div>
        <p className="font-medium text-surface-100">{p.name}</p>
        <p className="text-2xs text-surface-500 capitalize">{p.category}</p>
      </div>
    )},
    { key: 'category', header: 'Category', render: (p) => (
      <span className="text-surface-400 capitalize">{p.category}</span>
    )},
    { key: 'qty', header: 'Stock', render: (p) => {
      const qty = p.qty_on_hand ?? 0;
      const rp = p.reorder_point ?? 5;
      const isLow = qty <= rp;
      return <span className={isLow ? 'text-danger-400 font-semibold' : 'text-surface-200'}>{qty}{isLow && <AlertTriangle size={12} className="inline ml-1" />}</span>;
    }, className: 'w-20' },
    { key: 'unit_cost', header: 'Unit Cost', render: (p) => (
      <span className="text-surface-300">₱{p.unit_cost.toLocaleString()}</span>
    ), className: 'w-24' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search parts..." className="w-64" />
        <div className="flex-1" />
        <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Part</Button>
      </div>
      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="No parts found" />
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Part" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Category</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                <option value="spare">Spare</option>
                <option value="expendable">Expendable</option>
                <option value="consumable">Consumable</option>
                <option value="accessory">Accessory</option>
              </select>
            </div>
            <Input label="Unit Cost" type="number" value={form.unit_cost} onChange={(e) => set('unit_cost', parseFloat(e.target.value) || 0)} />
            <Input label="Initial Stock" type="number" value={form.initial_stock} onChange={(e) => set('initial_stock', parseInt(e.target.value) || 0)} />
            <Input label="Reorder Point" type="number" value={form.reorder_point} onChange={(e) => set('reorder_point', parseInt(e.target.value) || 0)} />
            <Input label="Reorder Qty" type="number" value={form.reorder_qty} onChange={(e) => set('reorder_qty', parseInt(e.target.value) || 0)} />
          </div>
          <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create Part</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Vendors Tab ───────────────────────────────────────────────────────

function VendorsTab({ dept }: { dept: Department }) {
  const { vendors: allVendors, loading, fetchAll, create } = useVendorsStore();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const vendors = useMemo(() =>
    allVendors.filter((v) => v.department === dept || !v.department),
  [allVendors, dept]);

  const filtered = useMemo(() =>
    vendors.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase())),
  [vendors, search]);

  const set = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  const handleCreate = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await create({ ...form, department: dept });
      toast.success('Vendor created');
      setShowAdd(false);
      setForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '' });
    } catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const columns: Column<Vendor>[] = [
    { key: 'name', header: 'Name', render: (v) => <span className="font-medium text-surface-100">{v.name}</span> },
    { key: 'contact_person', header: 'Contact', render: (v) => <span className="text-surface-400">{v.contact_person || '—'}</span> },
    { key: 'phone', header: 'Phone', render: (v) => <span className="text-surface-400">{v.phone || '—'}</span> },
    { key: 'email', header: 'Email', render: (v) => <span className="text-surface-400">{v.email || '—'}</span> },
    { key: 'payment_terms', header: 'Terms', render: (v) => <span className="text-surface-400">{v.payment_terms || '—'}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search vendors..." className="w-64" />
        <div className="flex-1" />
        <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Vendor</Button>
      </div>
      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="No vendors found" />
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Vendor" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input label="Contact Person" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input label="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Payment Terms" value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} />
            <Input label="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <Input label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create Vendor</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Reports Tab ───────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function ReportsTab({ dept, scrollTarget }: { dept: Department; scrollTarget?: string }) {
  const navigate = useNavigate();
  const openTicketsRef = useRef<HTMLDivElement>(null);
  const { items, categories } = useEquipmentStore();
  const { tickets, getCompletedHistory } = useMaintenanceStore();

  const [completed, setCompleted] = useState<CompletedHistoryEntry[]>([]);
  const [useCounts, setUseCounts] = useState<EquipmentUseCount[]>([]);

  useEffect(() => {
    let cancelled = false;
    getCompletedHistory()
      .then((d) => { if (!cancelled) setCompleted(d); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [getCompletedHistory]);

  useEffect(() => {
    let cancelled = false;
    ipcInvoke<EquipmentUseCount[]>('db:equipment:getUseCounts')
      .then((d) => { if (!cancelled) setUseCounts(d || []); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  // When arriving via a "View All" from the maintenance queue, jump straight to the open tickets list.
  useEffect(() => {
    if (scrollTarget !== 'open-tickets') return undefined;
    const t = setTimeout(() => openTicketsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    return () => clearTimeout(t);
  }, [scrollTarget]);

  const deptCategoryNames = DEPARTMENT_CONFIG[dept].categories;

  const stats = useMemo(() => {
    const nameSet = new Set(deptCategoryNames);
    const validCatIds = new Set(categories.filter((c) => nameSet.has(c.name)).map((c) => c.id));
    const deptItems = items.filter((i) => validCatIds.has(i.category_id));

    const total = deptItems.length;
    // Status is tracked per unit now, so count individual units, not items.
    const deptUnits = deptItems.flatMap((i) => i.assets ?? (i.asset ? [i.asset] : []));
    const available = deptUnits.filter((a) => (a.current_status || 'AVAILABLE') === 'AVAILABLE').length;
    const inRepair = deptUnits.filter((a) => a.current_status === 'IN_REPAIR').length;
    const deployed = deptUnits.filter((a) => a.current_status === 'DEPLOYED').length;

    const equipmentCategoryMap = new Map<string, string>();
    for (const eq of items) equipmentCategoryMap.set(eq.id, eq.category_id);
    const deptTickets = tickets.filter((t) => {
      const catId = equipmentCategoryMap.get(t.equipment_id);
      return catId && validCatIds.has(catId);
    });
    const openTickets = deptTickets.filter((t) => t.repair_status !== 'COMPLETED' && t.repair_status !== 'CANCELLED').length;

    return { total, available, inRepair, deployed, openTickets };
  }, [items, categories, tickets, deptCategoryNames]);

  // All tickets belonging to this department (by equipment category).
  const deptTickets = useMemo(() => {
    const nameSet = new Set(deptCategoryNames);
    const validCatIds = new Set(categories.filter((c) => nameSet.has(c.name)).map((c) => c.id));
    const map = new Map<string, string>();
    for (const eq of items) map.set(eq.id, eq.category_id);
    return tickets.filter((t) => {
      const catId = map.get(t.equipment_id);
      return catId && validCatIds.has(catId);
    });
  }, [tickets, items, categories, deptCategoryNames]);

  // Kanban-style tally grouped by repair status (mirrors the old Maintenance tab board).
  const kanbanData = useMemo(
    () => KANBAN_COLUMNS.map((status) => ({
      status,
      config: REPAIR_STATUS_CONFIG[status],
      tickets: deptTickets.filter((t) => t.repair_status === status),
    })),
    [deptTickets],
  );

  const openTickets = useMemo(
    () => deptTickets
      .filter((t) => t.repair_status !== 'COMPLETED' && t.repair_status !== 'CANCELLED')
      .sort((a, b) => {
        const sp = (SEVERITY_CONFIG[a.severity]?.priority ?? 99) - (SEVERITY_CONFIG[b.severity]?.priority ?? 99);
        if (sp !== 0) return sp;
        return new Date(b.reported_date).getTime() - new Date(a.reported_date).getTime();
      }),
    [deptTickets],
  );

  // Recent completed maintenance/repair jobs for this department.
  const deptHistory = useMemo(
    () => completed
      .filter((e) => e.category_name && CATEGORY_TO_DEPARTMENT[e.category_name] === dept)
      .slice(0, 5),
    [completed, dept],
  );

  // Equipment use counts limited to this department (via category → department mapping).
  const deptUseCounts = useMemo(
    () => useCounts.filter((c) => CATEGORY_TO_DEPARTMENT[c.category_name] === dept),
    [useCounts, dept],
  );

  const statCards = [
    { label: 'Total Equipment', value: stats.total, color: 'text-primary-400' },
    { label: 'Available', value: stats.available, color: 'text-success-400' },
    { label: 'Deployed', value: stats.deployed, color: 'text-cyan-400' },
    { label: 'In Repair', value: stats.inRepair, color: 'text-warning-400' },
    { label: 'Open Tickets', value: stats.openTickets, color: 'text-danger-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="glass-panel rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-surface-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Repair Tally — Kanban board */}
      <div className="glass-panel rounded-xl px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Wrench size={16} className="text-surface-400" />
          <h3 className="text-sm font-semibold text-surface-200">Repair Tally</h3>
          <span className="text-xs text-surface-500">{openTickets.length} open</span>
          <button
            onClick={() => navigate('/maintenance/new')}
            className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
          >
            <Plus size={13} /> New Ticket
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {kanbanData.map(({ status, config, tickets: colTickets }) => (
            <div key={status} className="flex-shrink-0 w-52 flex flex-col">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className={`text-xs font-semibold ${config?.color ?? 'text-surface-400'}`}>{config?.label ?? status}</span>
                <span className="text-2xs text-surface-500 bg-surface-800 px-1.5 py-0.5 rounded-full">{colTickets.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto max-h-[340px]">
                {colTickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => navigate(`/maintenance/${ticket.id}`)}
                    className="w-full bg-surface-900/60 rounded-lg p-3 text-left hover:bg-surface-800/70 transition-colors"
                  >
                    <p className="text-xs text-surface-500 mb-1">{ticket.ticket_number}</p>
                    <p className="text-sm font-medium text-surface-200 truncate">{ticket.equipment_name}</p>
                    {ticket.document_type && (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={ticket.document_type === 'maintenance' ? 'info' : ticket.document_type === 'update' ? 'purple' : 'warning'} size="sm">
                          {ticket.document_type === 'maintenance' ? 'MNT' : ticket.document_type === 'update' ? 'UPD' : 'RPR'}
                        </Badge>
                      </div>
                    )}
                  </button>
                ))}
                {colTickets.length === 0 && <p className="text-2xs text-surface-600 text-center py-4">Empty</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Open Tickets — equipment currently with an open ticket */}
      <div ref={openTicketsRef} className="glass-panel rounded-xl overflow-hidden scroll-mt-4">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <AlertTriangle size={18} className="text-danger-400" />
          <h3 className="text-sm font-semibold text-surface-200">Open Tickets</h3>
          <span className="text-xs text-surface-500">{openTickets.length}</span>
        </div>
        {openTickets.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">
            No open tickets — there is no data available on this list.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                {openTickets.map((ticket) => {
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
                            <p className="text-surface-300 truncate">{ticket.last_action_taken}</p>
                            <p className="text-2xs text-surface-500 mt-0.5">
                              {new Date(ticket.last_action_date).toLocaleDateString()}
                              {ticket.last_action_personnel && <> · {ticket.last_action_personnel}</>}
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

      {/* Maintenance & Repair History */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <History size={18} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-surface-200">Maintenance &amp; Repair History</h3>
          <button
            onClick={() => navigate('/maintenance', { state: { scrollTo: 'history' } })}
            className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
          >
            View All <ChevronRight size={13} />
          </button>
        </div>
        {deptHistory.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-surface-500">No completed maintenance history</div>
        ) : (
          <div className="divide-y divide-surface-800/60">
            {deptHistory.map((entry) => (
              <button
                key={entry.id}
                onClick={() => navigate(`/maintenance/${entry.id}`)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-800/40 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-200 font-medium truncate">{entry.equipment_name}</p>
                  <p className="text-2xs text-surface-500 font-mono">{entry.ticket_number}</p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={entry.document_type === 'maintenance' ? 'info' : entry.document_type === 'update' ? 'purple' : 'warning'} size="sm">
                    {entry.document_type}
                  </Badge>
                  <p className="text-2xs text-surface-500 mt-1">{fmtDate(entry.completion_date || entry.reported_date)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Equipment Use Count — limited to this department */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
          <BarChart3 size={18} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-surface-200">Equipment Use Count</h3>
          <button
            onClick={() => navigate('/equipment/use-count')}
            className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
          >
            View Complete List <ChevronRight size={13} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {(() => {
            // Preferred subcategory order (as defined in constants), then any others alphabetically.
            const preferredOrder = USE_COUNT_SUBCATEGORIES[dept].flatMap((g) => g.subcategoryNames);
            const itemsBySubcategory = new Map<string, EquipmentUseCount[]>();
            for (const c of deptUseCounts) {
              const key = c.subcategory_name || 'Other';
              const existing = itemsBySubcategory.get(key);
              if (existing) existing.push(c);
              else itemsBySubcategory.set(key, [c]);
            }

            const rendered = Array.from(itemsBySubcategory.keys())
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

            if (rendered.length === 0) {
              return (
                <p className="text-sm text-surface-500 text-center py-6">
                  No equipment use data available.
                </p>
              );
            }

            return rendered.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-wide">
                  {group.label}
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {group.items.map((item, idx) => (
                      <tr key={item.equipment_id} className="border-b border-surface-800/40 last:border-0">
                        <td className="py-1.5 pr-2 text-surface-600 w-5 text-right text-xs">{idx + 1}</td>
                        <td className="py-1.5 px-2 text-surface-200 truncate max-w-[220px]">{item.name}</td>
                        <td className="py-1.5 pl-2 text-right font-bold text-surface-100 w-12">{item.use_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────

export function DepartmentSegmentPage() {
  const { dept } = useParams<{ dept: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<TabKey>('reports');
  const scrollTarget = (location.state as { scrollTo?: string } | null)?.scrollTo;

  const validDept = (dept === 'camera' || dept === 'lights_grips') ? dept as Department : null;

  useEffect(() => {
    if (validDept) {
      useDepartmentStore.getState().setDepartment(validDept);
    }
  }, [validDept]);

  if (!validDept) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-surface-400">Invalid department.</p>
      </div>
    );
  }

  const config = DEPARTMENT_CONFIG[validDept];
  const DeptIcon = DEPT_ICONS[validDept];

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {role === 'admin' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2 rounded-lg hover:bg-surface-800/60 text-surface-400 hover:text-surface-200 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <DeptIcon size={22} className="text-primary-400" />
        <h1 className="text-lg font-semibold text-surface-100">{config.label}</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 bg-surface-900/50 rounded-xl w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600/15 text-primary-400'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'parts' && <PartsTab dept={validDept} />}
        {activeTab === 'vendors' && <VendorsTab dept={validDept} />}
        {activeTab === 'reports' && <ReportsTab dept={validDept} scrollTarget={scrollTarget} />}
      </div>
    </div>
  );
}
