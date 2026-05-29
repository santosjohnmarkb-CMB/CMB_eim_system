import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Badge } from '../components/common/Badge';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import type { EquipmentWithAsset, EquipmentStatus } from '../../shared/types';
import { useAuthStore } from '../stores/auth.store';

const statusVariantMap: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'default'> = {
  AVAILABLE: 'success', DEPLOYED: 'info', IN_REPAIR: 'warning', ON_HOLD: 'default',
  IN_TRANSIT: 'info', RETIRED: 'default', MISSING: 'danger', FOR_INSPECTION: 'purple',
};

export function EquipmentListPage() {
  const { items, categories, subcategories, loading, fetchAll, fetchCategories, fetchSubcategories } = useEquipmentStore();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { fetchAll(); fetchCategories(); fetchSubcategories(); }, [fetchAll, fetchCategories, fetchSubcategories]);

  const usedCategoryIds = useMemo(() => new Set(items.map((i) => i.category_id)), [items]);

  const deduplicatedCategories = useMemo(() => {
    const seen = new Map<string, typeof categories[0]>();
    for (const cat of categories) {
      const existing = seen.get(cat.name);
      if (!existing) {
        seen.set(cat.name, cat);
      } else if (usedCategoryIds.has(cat.id) && !usedCategoryIds.has(existing.id)) {
        seen.set(cat.name, cat);
      }
    }
    return Array.from(seen.values());
  }, [categories, usedCategoryIds]);

  const filteredSubcategories = useMemo(() => {
    if (!categoryFilter) return [];
    return subcategories.filter((s) => s.category_id === categoryFilter);
  }, [subcategories, categoryFilter]);

  const handleCategoryChange = (catId: string) => {
    setCategoryFilter(catId);
    setSubcategoryFilter('');
  };

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.equipment_code.toLowerCase().includes(q) && !item.brand.toLowerCase().includes(q)) return false;
      }
      if (categoryFilter && item.category_id !== categoryFilter) return false;
      if (subcategoryFilter && item.subcategory_id !== subcategoryFilter) return false;
      if (statusFilter && item.asset?.current_status !== statusFilter) return false;
      return true;
    });
  }, [items, search, categoryFilter, subcategoryFilter, statusFilter]);

  const columns: Column<EquipmentWithAsset>[] = [
    { key: 'equipment_code', header: 'Code', className: 'w-24' },
    { key: 'name', header: 'Name', render: (item) => (<div><p className="font-medium text-surface-100">{item.name}</p><p className="text-xs text-surface-500">{item.brand} {item.model}</p></div>) },
    { key: 'category_name', header: 'Category', render: (item) => (<span className="text-surface-400">{item.category_name}</span>) },
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
    { key: 'condition', header: 'Grade', render: (item) => (<span className="text-surface-400">{item.asset?.condition_grade || '-'}</span>), className: 'w-16' },
    { key: 'base_price', header: 'Rate', render: (item) => (<span className="text-surface-300">P{item.base_price.toLocaleString()}</span>), className: 'w-24 text-right' },
  ];

  const canCreate = role === 'admin' || role === 'inventory_manager';

  return (
    <div className="space-y-4">
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
        {canCreate && <Button onClick={() => navigate('/equipment/new')}><Plus size={16} /> Add Equipment</Button>}
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} onRowClick={(item) => navigate(`/equipment/${item.id}`)} loading={loading} emptyMessage="No equipment found" />
      </div>
      <p className="text-xs text-surface-600">{filtered.length} of {items.length} items</p>
    </div>
  );
}
