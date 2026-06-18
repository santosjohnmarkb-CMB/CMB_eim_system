import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { usePartsStore } from '../stores/parts.store';
import { useVendorsStore } from '../stores/vendors.store';
import { useLoansStore } from '../stores/loans.store';
import { useAuthStore } from '../stores/auth.store';
import { useDepartmentStore } from '../stores/department.store';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT, LOAN_STATUS_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import { REPAIR_STATUS_CONFIG } from '../lib/constants';
import { Badge } from '../components/common/Badge';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import type { MaintenanceTicket, PartsCatalogItem, Vendor, CompletedHistoryEntry, EquipmentLoan } from '../../shared/types';
import { Camera, Lightbulb, ArrowLeft, Wrench, Box, Truck, BarChart3, Plus, AlertTriangle, History, PackageCheck, ChevronRight } from 'lucide-react';

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

function ReportsTab({ dept }: { dept: Department }) {
  const navigate = useNavigate();
  const { items, categories } = useEquipmentStore();
  const { tickets, getCompletedHistory } = useMaintenanceStore();
  const loans = useLoansStore((s) => s.loans);
  const fetchLoans = useLoansStore((s) => s.fetchAll);

  const [completed, setCompleted] = useState<CompletedHistoryEntry[]>([]);

  useEffect(() => { fetchLoans(); }, [fetchLoans]);

  useEffect(() => {
    let cancelled = false;
    getCompletedHistory()
      .then((d) => { if (!cancelled) setCompleted(d); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [getCompletedHistory]);

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
    () => deptTickets.filter((t) => t.repair_status !== 'COMPLETED' && t.repair_status !== 'CANCELLED'),
    [deptTickets],
  );

  // Recent completed maintenance/repair jobs for this department.
  const deptHistory = useMemo(
    () => completed
      .filter((e) => e.category_name && CATEGORY_TO_DEPARTMENT[e.category_name] === dept)
      .slice(0, 5),
    [completed, dept],
  );

  // Currently-out loans for this department.
  const deptLoans = useMemo(
    () => loans.filter((l) => l.department === dept && l.status !== 'RETURNED').slice(0, 5),
    [loans, dept],
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

      {/* Quick-view cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Maintenance & Repair History */}
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
            <History size={18} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-surface-200">Maintenance &amp; Repair History</h3>
            <button
              onClick={() => navigate('/maintenance')}
              className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
            >
              Full List <ChevronRight size={13} />
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

        {/* Loaned Equipment */}
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-surface-700/40">
            <PackageCheck size={18} className="text-primary-400" />
            <h3 className="text-sm font-semibold text-surface-200">Loaned Equipment</h3>
            <button
              onClick={() => navigate('/loans')}
              className="ml-auto flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors font-medium"
            >
              Full List <ChevronRight size={13} />
            </button>
          </div>
          {deptLoans.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-surface-500">No active loans</div>
          ) : (
            <div className="divide-y divide-surface-800/60">
              {deptLoans.map((loan: EquipmentLoan) => (
                <button
                  key={loan.id}
                  onClick={() => navigate(`/loans/${loan.id}`)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-800/40 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-200 font-medium truncate">{loan.person_or_org}</p>
                    <p className="text-2xs text-surface-500 font-mono">{loan.loan_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-medium ${LOAN_STATUS_CONFIG[loan.status]?.color ?? 'text-surface-400'}`}>
                      {LOAN_STATUS_CONFIG[loan.status]?.label ?? loan.status}
                    </span>
                    <p className="text-2xs text-surface-500 mt-1">
                      {loan.out_count ?? 0}/{loan.item_count ?? 0} out · {fmtDate(loan.tentative_return_date)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────

export function DepartmentSegmentPage() {
  const { dept } = useParams<{ dept: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<TabKey>('reports');

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
        {activeTab === 'reports' && <ReportsTab dept={validDept} />}
      </div>
    </div>
  );
}
