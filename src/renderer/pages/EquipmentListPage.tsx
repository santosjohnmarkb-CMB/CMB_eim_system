import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowLeft, Camera, Lightbulb, Printer, ChevronDown, Upload, Download } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { EquipmentWithAsset, EquipmentStatus, BulkImportResult } from '../../shared/types';
import { useAuthStore } from '../stores/auth.store';
import { useToast } from '../hooks';
import { printHtml, escapeHtml } from '../lib/print';

// Columns the equipment CSV importer understands (see db:equipment:importCsv).
// base_price is honored only for admins; a manager's import always lands at 0.
const EQUIPMENT_CSV_HEADERS = [
  'name', 'category', 'subcategory', 'display_name', 'sub_subcategory', 'brand', 'model',
  'description', 'base_price', 'notes', 'serial_number', 'asset_tag', 'purchase_date',
  'delivered_date', 'purchase_price', 'vendor_name', 'warranty_expiry',
];

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

// An item now holds one asset per unit. Collapse a per-unit field to a single label
// for the list: show the shared value, or "Multiple" when units differ.
function unitsOf(item: EquipmentWithAsset) {
  return item.assets ?? (item.asset ? [item.asset] : []);
}

function summarizeField(item: EquipmentWithAsset, pick: (a: NonNullable<EquipmentWithAsset['asset']>) => string | null | undefined) {
  const units = unitsOf(item);
  if (units.length === 0) return '—';
  const distinct = Array.from(new Set(units.map((a) => (pick(a) || '').trim())));
  if (distinct.length === 1) return distinct[0] || '—';
  return 'Multiple';
}

// Overall status label for the list: the shared unit status, or "Mixed" when units differ.
function summarizeStatus(item: EquipmentWithAsset): { status: string; mixed: boolean } {
  const units = unitsOf(item);
  if (units.length === 0) return { status: item.asset?.current_status || 'AVAILABLE', mixed: false };
  const distinct = Array.from(new Set(units.map((a) => a.current_status || 'AVAILABLE')));
  if (distinct.length === 1) return { status: distinct[0]!, mixed: false };
  return { status: 'Mixed', mixed: true };
}

// Camera "CAM-CAMPKG" package components are stored at a price of 0 because they are
// only billed as part of the package. They should stay in the database but be hidden
// from the equipment list (only priced items are shown). Not a deletion — just a filter.
function isZeroPricedPackageComponent(item: EquipmentWithAsset): boolean {
  const code = item.equipment_code?.toLowerCase() ?? '';
  return code.includes('campkg') && (item.base_price ?? 0) === 0;
}

// Default ordering for the equipment list. Certain groups should surface first on
// initial viewing: camera/lens/special for the camera dept, lighting for lights & grips.
// Lower rank sorts first; items within the same rank keep their existing order.
function defaultGroupRank(item: EquipmentWithAsset, department: Department | null): number {
  const sub = (item.subcategory_name ?? '').toLowerCase();
  if (department === 'camera') {
    // Rank by subcategory only — the category is "Camera" for every item here, so a
    // category-name match would lump lens/special rigs in with the camera group.
    if (sub.includes('camera')) return 0;
    if (sub.includes('lens')) return 1;
    if (sub.includes('special')) return 2;
    return 3;
  }
  if (department === 'lights_grips') {
    // Grip and Lighting share the "Lights and Grips" category, so rank by subcategory
    // only — otherwise the category name ("Lights and Grips") matches grips too.
    if (sub.includes('light')) return 0;
    return 1;
  }
  return 0;
}

export function EquipmentListPage() {
  const { dept } = useParams<{ dept: string }>();
  const department = (dept === 'camera' || dept === 'lights_grips') ? dept as Department : null;
  const deptConfig = department ? DEPARTMENT_CONFIG[department] : null;
  const DeptIcon = department ? DEPT_ICONS[department] : null;

  const { items, categories, subcategories, loading, fetchAll, fetchCategories, fetchSubcategories, importCsv } = useEquipmentStore();
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const userDept = useAuthStore((s) => s.user?.department);
  const isAdmin = role === 'admin';

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

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
    const visible = items.filter((i) => !isZeroPricedPackageComponent(i));
    if (!deptCategoryNames) return visible;
    const catIdSet = new Set(
      categories.filter((c) => deptCategoryNames.has(c.name)).map((c) => c.id)
    );
    return visible.filter((i) => catIdSet.has(i.category_id));
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

  // Shared predicate for the active search/category/subcategory/status filters, so the
  // on-screen table and the printed output stay in sync.
  const matchesFilters = useCallback((item: EquipmentWithAsset) => {
    if (isZeroPricedPackageComponent(item)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.name.toLowerCase().includes(q) && !item.equipment_code.toLowerCase().includes(q) && !item.brand.toLowerCase().includes(q)) return false;
    }
    if (categoryFilter && item.category_id !== categoryFilter) return false;
    if (subcategoryFilter && item.subcategory_id !== subcategoryFilter) return false;
    if (statusFilter) {
      const units = unitsOf(item);
      const matches = units.length > 0
        ? units.some((a) => (a.current_status || 'AVAILABLE') === statusFilter)
        : item.asset?.current_status === statusFilter;
      if (!matches) return false;
    }
    return true;
  }, [search, categoryFilter, subcategoryFilter, statusFilter]);

  const filtered = useMemo(() => {
    const list = deptItems.filter(matchesFilters);
    // Stable sort: priority groups first, original relative order preserved within a group.
    return list
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        defaultGroupRank(a.item, department) - defaultGroupRank(b.item, department) || a.index - b.index)
      .map((x) => x.item);
  }, [deptItems, matchesFilters, department]);

  // Departments this user is allowed to print. Admins get both; a department user only theirs.
  const printableDepts = useMemo<Department[]>(() => {
    if (isAdmin) return ['camera', 'lights_grips'];
    if (userDept === 'camera' || userDept === 'lights_grips') return [userDept];
    if (department) return [department];
    return [];
  }, [isAdmin, userDept, department]);

  const buildPrintSection = (d: Department) => {
    // Respect the active page filters so the printout matches what's visible on screen.
    const list = items
      .filter((i) => i.category_name && CATEGORY_TO_DEPARTMENT[i.category_name] === d && matchesFilters(i))
      .map((item, index) => ({ item, index }))
      .sort((a, b) => defaultGroupRank(a.item, d) - defaultGroupRank(b.item, d) || a.index - b.index)
      .map((x) => x.item);
    const rows = list.map((i) => {
      const { status, mixed } = summarizeStatus(i);
      const statusLabel = mixed ? 'Mixed' : (EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus]?.label || status);
      const sub = [i.brand, i.model].filter(Boolean).join(' ');
      const deliveredUnits = unitsOf(i);
      const deliveredDistinct = Array.from(new Set(deliveredUnits.map((a) => a.delivered_date || '')));
      const deliveredLabel = deliveredUnits.length === 0 ? '—' : deliveredDistinct.length === 1 ? fmtDate(deliveredDistinct[0] || null) : 'Multiple';
      return `<tr>
        <td>${escapeHtml(i.equipment_code)}</td>
        <td>${escapeHtml(i.name)}${sub ? `<br/><span style="color:#888;font-size:10px">${escapeHtml(sub)}</span>` : ''}</td>
        <td>${escapeHtml(i.category_name || '—')}</td>
        <td>${escapeHtml(summarizeField(i, (a) => a.vendor_name))}</td>
        <td>${escapeHtml(deliveredLabel)}</td>
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
    { key: 'supplier', header: 'Supplier', render: (item) => (<span className="text-surface-400">{summarizeField(item, (a) => a.vendor_name)}</span>) },
    { key: 'delivered_date', header: 'Delivered', render: (item) => {
      const units = unitsOf(item);
      const distinct = Array.from(new Set(units.map((a) => a.delivered_date || '')));
      const label = units.length === 0 ? '—' : distinct.length === 1 ? fmtDate(distinct[0] || null) : 'Multiple';
      return <span className="text-surface-400">{label}</span>;
    }},
    { key: 'status', header: 'Status', render: (item) => {
      const { status, mixed } = summarizeStatus(item);
      if (mixed) return <Badge variant="default">Mixed</Badge>;
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
  ];

  const canCreate = role === 'admin' || role === 'equipment_manager';

  // Client-side CSV template so managers can bulk-load without a backend round trip.
  // base_price is only pre-filled for admins (managers can't set prices).
  const handleDownloadTemplate = () => {
    const sample: Record<string, string> = {
      name: 'Sample Camera', category: 'Camera', subcategory: 'Camera Body',
      display_name: 'Sample Camera Body', sub_subcategory: '', brand: 'ARRI', model: 'Alexa Mini',
      description: '', base_price: isAdmin ? '15000' : '', notes: '', serial_number: 'SN-001',
      asset_tag: '', purchase_date: '', delivered_date: '', purchase_price: '', vendor_name: '', warranty_expiry: '',
    };
    const csv = EQUIPMENT_CSV_HEADERS.join(',') + '\n' + EQUIPMENT_CSV_HEADERS.map((h) => sample[h] ?? '').join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equipment_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const result = (await importCsv(text)) as BulkImportResult;
      setImportResult(result);
      if (result.imported > 0) toast.success(`Imported ${result.imported} item${result.imported > 1 ? 's' : ''}`);
      if (result.errors.length > 0 && result.imported === 0) toast.error('Import failed — see error details');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

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
        {canCreate && (
          <>
            <Button variant="secondary" onClick={handleDownloadTemplate}><Download size={16} /> Template</Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={isImporting}><Upload size={16} /> Import CSV</Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileSelected} />
            <Button onClick={() => navigate('/equipment/new')}><Plus size={16} /> Add Equipment</Button>
          </>
        )}
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} onRowClick={(item) => navigate(`/equipment/detail/${item.id}`)} loading={loading} emptyMessage="No equipment found" />
      </div>
      <p className="text-xs text-surface-600">{filtered.length} of {deptItems.length} items</p>

      <Modal isOpen={!!importResult} onClose={() => setImportResult(null)} title="Import Results" size="lg">
        {importResult && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="glass-panel rounded-lg p-4 flex-1">
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">Imported</p>
                <p className="text-2xl font-bold text-success-400">{importResult.imported}</p>
              </div>
              <div className="glass-panel rounded-lg p-4 flex-1">
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">Errors</p>
                <p className="text-2xl font-bold text-danger-400">{importResult.errors.length}</p>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-surface-200 mb-2">Error Details</h4>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {importResult.errors.map((err, i) => (
                    <div key={i} className="flex gap-3 text-xs py-1.5 px-3 rounded bg-surface-800/50">
                      <span className="text-surface-500 shrink-0">Row {err.row}</span>
                      <span className="text-danger-400">{err.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setImportResult(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
