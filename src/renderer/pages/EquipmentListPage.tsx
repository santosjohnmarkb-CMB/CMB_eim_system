import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowLeft, Camera, Lightbulb, Printer, ChevronDown } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Badge } from '../components/common/Badge';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { EquipmentWithAsset, EquipmentStatus } from '../../shared/types';
import { useAuthStore } from '../stores/auth.store';
import { printHtml, escapeHtml } from '../lib/print';

const statusVariantMap: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'default'> = {
  AVAILABLE: 'success', DEPLOYED: 'info', IN_REPAIR: 'warning', ON_HOLD: 'default',
  IN_TRANSIT: 'info', RETIRED: 'default', MISSING: 'danger', FOR_INSPECTION: 'purple',
};

const DEPT_ICONS: Record<Department, typeof Camera> = {
  camera: Camera,
  lights_grips: Lightbulb,
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function EquipmentListPage() {
  const { dept } = useParams<{ dept: string }>();
  const department = (dept === 'camera' || dept === 'lights_grips') ? dept as Department : null;
  const deptConfig = department ? DEPARTMENT_CONFIG[department] : null;
  const DeptIcon = department ? DEPT_ICONS[department] : null;

  const { items, categories, subcategories, loading, fetchAll, fetchCategories, fetchSubcategories } = useEquipmentStore();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const userDept = useAuthStore((s) => s.user?.department);
  const isAdmin = role === 'admin';

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) setPrintMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { fetchAll(); fetchCategories(); fetchSubcategories(); }, [fetchAll, fetchCategories, fetchSubcategories]);

  const deptCategoryNames = useMemo(() => {
    if (!deptConfig) return null;
    return new Set(deptConfig.categories);
  }, [deptConfig]);

  const deptItems = useMemo(() => {
    if (!deptCategoryNames) return items;
    const catIdSet = new Set(
      categories.filter((c) => deptCategoryNames.has(c.name)).map((c) => c.id)
    );
    return items.filter((i) => catIdSet.has(i.category_id));
  }, [items, categories, deptCategoryNames]);

  const usedCategoryIds = useMemo(() => new Set(deptItems.map((i) => i.category_id)), [deptItems]);

  const deduplicatedCategories = useMemo(() => {
    const seen = new Map<string, typeof categories[0]>();
    for (const cat of categories) {
      if (deptCategoryNames && !deptCategoryNames.has(cat.name)) continue;
      const existing = seen.get(cat.name);
      if (!existing) {
        seen.set(cat.name, cat);
      } else if (usedCategoryIds.has(cat.id) && !usedCategoryIds.has(existing.id)) {
        seen.set(cat.name, cat);
      }
    }
    return Array.from(seen.values());
  }, [categories, usedCategoryIds, deptCategoryNames]);

  const filteredSubcategories = useMemo(() => {
    if (!categoryFilter) return [];
    return subcategories.filter((s) => s.category_id === categoryFilter);
  }, [subcategories, categoryFilter]);

  const handleCategoryChange = (catId: string) => {
    setCategoryFilter(catId);
    setSubcategoryFilter('');
  };

  const filtered = useMemo(() => {
    return deptItems.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.equipment_code.toLowerCase().includes(q) && !item.brand.toLowerCase().includes(q)) return false;
      }
      if (categoryFilter && item.category_id !== categoryFilter) return false;
      if (subcategoryFilter && item.subcategory_id !== subcategoryFilter) return false;
      if (statusFilter && item.asset?.current_status !== statusFilter) return false;
      return true;
    });
  }, [deptItems, search, categoryFilter, subcategoryFilter, statusFilter]);

  // Departments this user is allowed to print. Admins get both; a department user only theirs.
  const printableDepts = useMemo<Department[]>(() => {
    if (isAdmin) return ['camera', 'lights_grips'];
    if (userDept === 'camera' || userDept === 'lights_grips') return [userDept];
    if (department) return [department];
    return [];
  }, [isAdmin, userDept, department]);

  const buildPrintSection = (d: Department) => {
    const list = items.filter((i) => i.category_name && CATEGORY_TO_DEPARTMENT[i.category_name] === d);
    const rows = list.map((i) => {
      const status = i.asset?.current_status || 'AVAILABLE';
      const statusLabel = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus]?.label || status;
      const sub = [i.brand, i.model].filter(Boolean).join(' ');
      return `<tr>
        <td>${escapeHtml(i.equipment_code)}</td>
        <td>${escapeHtml(i.name)}${sub ? `<br/><span style="color:#888;font-size:10px">${escapeHtml(sub)}</span>` : ''}</td>
        <td>${escapeHtml(i.category_name || '—')}</td>
        <td>${escapeHtml(i.asset?.vendor_name || '—')}</td>
        <td>${escapeHtml(fmtDate(i.asset?.delivered_date))}</td>
        <td>${i.quantity ?? 1}</td>
        <td>${i.available_qty ?? i.quantity ?? 1}</td>
        <td>${escapeHtml(statusLabel)}</td>
      </tr>`;
    }).join('');
    return `<h2>${escapeHtml(DEPARTMENT_CONFIG[d].label)} (${list.length})</h2>
      <table>
        <thead><tr><th>Code</th><th>Equipment</th><th>Category</th><th>Supplier</th><th>Delivered</th><th>Qty</th><th>Avail</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">No equipment</td></tr>'}</tbody>
      </table>`;
  };

  const printEquipment = (scope: 'all' | Department) => {
    setPrintMenuOpen(false);
    const depts: Department[] = scope === 'all' ? printableDepts : [scope];
    const title = scope === 'all'
      ? (depts.length > 1 ? 'All Equipment' : DEPARTMENT_CONFIG[depts[0]!].label)
      : DEPARTMENT_CONFIG[scope].label;
    const body = `
      <div class="header">
        <h1>Equipment List — ${escapeHtml(title)}</h1>
        <p class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</p>
      </div>
      ${depts.map(buildPrintSection).join('')}`;
    printHtml('Equipment List', body);
  };

  const columns: Column<EquipmentWithAsset>[] = [
    { key: 'equipment_code', header: 'Code', className: 'w-24' },
    { key: 'name', header: 'Name', render: (item) => (<div><p className="font-medium text-surface-100">{item.name}</p><p className="text-xs text-surface-500">{item.brand} {item.model}</p></div>) },
    { key: 'category_name', header: 'Category', render: (item) => (<span className="text-surface-400">{item.category_name}</span>) },
    { key: 'supplier', header: 'Supplier', render: (item) => (<span className="text-surface-400">{item.asset?.vendor_name || '—'}</span>) },
    { key: 'delivered_date', header: 'Delivered', render: (item) => (<span className="text-surface-400">{fmtDate(item.asset?.delivered_date)}</span>) },
    { key: 'status', header: 'Status', render: (item) => {
      const status = item.asset?.current_status || 'AVAILABLE';
      const config = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus];
      return <Badge variant={statusVariantMap[status] || 'default'}>{config?.label || status}</Badge>;
    }},
    { key: 'quantity', header: 'Qty', render: (item) => (<span className="text-surface-300">{item.quantity ?? 1}</span>), className: 'w-14 text-center' },
    { key: 'available_qty', header: 'Avail', render: (item) => {
      const avail = item.available_qty ?? item.quantity ?? 1;
      const total = item.quantity ?? 1;
      const color = avail === 0 ? 'text-danger-400' : avail < total ? 'text-warning-400' : 'text-success-400';
      return <span className={color}>{avail}</span>;
    }, className: 'w-14 text-center' },
    { key: 'base_price', header: 'Rate', render: (item) => (<span className="text-surface-300">P{item.base_price.toLocaleString()}</span>), className: 'w-24 text-right' },
  ];

  const canCreate = role === 'admin' || role === 'inventory_manager';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        {isAdmin && (
          <button
            onClick={() => navigate('/equipment')}
            className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        {DeptIcon && <DeptIcon size={22} className={department === 'camera' ? 'text-primary-400' : 'text-amber-400'} />}
        <h1 className="text-lg font-semibold text-surface-100">
          {deptConfig ? `${deptConfig.shortLabel} Equipment` : 'All Equipment'}
        </h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={search} onChange={setSearch} placeholder="Search equipment..." className="w-64" />
        <select value={categoryFilter} onChange={(e) => handleCategoryChange(e.target.value)} className="px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200">
          <option value="">All Categories</option>
          {deduplicatedCategories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        {categoryFilter && filteredSubcategories.length > 0 && (
          <select value={subcategoryFilter} onChange={(e) => setSubcategoryFilter(e.target.value)} className="px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200">
            <option value="">All Subcategories</option>
            {filteredSubcategories.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200">
          <option value="">All Statuses</option>
          {Object.entries(EQUIPMENT_STATUS_CONFIG).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
        </select>
        <div className="flex-1" />
        <div className="relative" ref={printMenuRef}>
          {isAdmin ? (
            <>
              <Button variant="secondary" onClick={() => setPrintMenuOpen((o) => !o)}>
                <Printer size={16} /> Print <ChevronDown size={14} />
              </Button>
              {printMenuOpen && (
                <div className="absolute right-0 z-20 mt-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-lg overflow-hidden">
                  <button onClick={() => printEquipment('all')} className="w-full text-left px-4 py-2.5 text-sm text-surface-200 hover:bg-surface-700/60 transition-colors border-b border-surface-700/50">Whole List</button>
                  <button onClick={() => printEquipment('camera')} className="w-full text-left px-4 py-2.5 text-sm text-surface-200 hover:bg-surface-700/60 transition-colors border-b border-surface-700/50">Camera Only</button>
                  <button onClick={() => printEquipment('lights_grips')} className="w-full text-left px-4 py-2.5 text-sm text-surface-200 hover:bg-surface-700/60 transition-colors">Lights &amp; Grips Only</button>
                </div>
              )}
            </>
          ) : (
            printableDepts.length > 0 && (
              <Button variant="secondary" onClick={() => printEquipment(printableDepts[0]!)}>
                <Printer size={16} /> Print List
              </Button>
            )
          )}
        </div>
        {canCreate && <Button onClick={() => navigate('/equipment/new')}><Plus size={16} /> Add Equipment</Button>}
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} onRowClick={(item) => navigate(`/equipment/detail/${item.id}`)} loading={loading} emptyMessage="No equipment found" />
      </div>
      <p className="text-xs text-surface-600">{filtered.length} of {deptItems.length} items</p>
    </div>
  );
}
