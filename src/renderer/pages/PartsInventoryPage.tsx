import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';
import { usePartsStore } from '../stores/parts.store';
import { Button } from '../components/common/Button';
import { SearchBox } from '../components/common/SearchBox';
import { DataTable, type Column } from '../components/common/DataTable';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import type { PartsCatalogItem } from '../../shared/types';

export function PartsInventoryPage() {
  const { items, loading, fetchAll, create } = usePartsStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'spare', unit_of_measure: 'unit', unit_cost: 0, initial_stock: 0, reorder_point: 5, reorder_qty: 10, location: 'Main Warehouse' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => items.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.part_code.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter && p.category !== catFilter) return false;
    return true;
  }), [items, search, catFilter]);

  const handleCreate = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try { await create(form); toast.success('Part created'); setShowAdd(false); setForm({ name: '', description: '', category: 'spare', unit_of_measure: 'unit', unit_cost: 0, initial_stock: 0, reorder_point: 5, reorder_qty: 10, location: 'Main Warehouse' }); }
    catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const set = (f: string, v: any) => setForm((p) => ({ ...p, [f]: v }));

  const columns: Column<PartsCatalogItem>[] = [
    { key: 'part_code', header: 'Code', className: 'w-28' },
    { key: 'name', header: 'Name', render: (p) => <div><p className="font-medium text-surface-100">{p.name}</p><p className="text-2xs text-surface-500 capitalize">{p.category}</p></div> },
    { key: 'qty', header: 'Stock', render: (p) => {
      const qty = p.qty_on_hand ?? 0;
      const rp = p.reorder_point ?? 5;
      const isLow = qty <= rp;
      return <span className={isLow ? 'text-danger-400 font-semibold' : 'text-surface-200'}>{qty}{isLow && <AlertTriangle size={12} className="inline ml-1" />}</span>;
    }, className: 'w-20' },
    { key: 'unit_cost', header: 'Unit Cost', render: (p) => <span className="text-surface-300">P{p.unit_cost.toLocaleString()}</span>, className: 'w-24' },
    { key: 'vendor_name', header: 'Vendor', render: (p) => <span className="text-surface-400">{p.vendor_name || '-'}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search parts..." className="w-64" />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200">
          <option value="">All Categories</option>
          <option value="spare">Spare Parts</option><option value="expendable">Expendables</option><option value="consumable">Consumables</option><option value="accessory">Accessories</option>
        </select>
        <div className="flex-1" />
        <Button onClick={() => navigate('/parts/adjust')} variant="secondary">Stock Adjustment</Button>
        <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Part</Button>
      </div>
      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} onRowClick={(p) => navigate(`/parts/${p.id}`)} loading={loading} emptyMessage="No parts found" />
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Part" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <div><label className="block text-xs font-medium text-surface-400 mb-1">Category</label><select value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100"><option value="spare">Spare</option><option value="expendable">Expendable</option><option value="consumable">Consumable</option><option value="accessory">Accessory</option></select></div>
            <Input label="Unit Cost" type="number" value={form.unit_cost} onChange={(e) => set('unit_cost', parseFloat(e.target.value) || 0)} />
            <Input label="Initial Stock" type="number" value={form.initial_stock} onChange={(e) => set('initial_stock', parseInt(e.target.value) || 0)} />
            <Input label="Reorder Point" type="number" value={form.reorder_point} onChange={(e) => set('reorder_point', parseInt(e.target.value) || 0)} />
            <Input label="Reorder Qty" type="number" value={form.reorder_qty} onChange={(e) => set('reorder_qty', parseInt(e.target.value) || 0)} />
          </div>
          <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
          <div className="flex gap-3 justify-end"><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleCreate} loading={saving}>Create Part</Button></div>
        </div>
      </Modal>
    </div>
  );
}
