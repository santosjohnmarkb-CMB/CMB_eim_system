import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast, useDepartmentFilter } from '../hooks';

export function EquipmentAddPage() {
  const { categories, subcategories, fetchCategories, fetchSubcategories, createEquipment } = useEquipmentStore();
  const { isEquipmentInDepartment } = useDepartmentFilter();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<Record<string, any>>({
    name: '', display_name: '', category_id: '', subcategory_id: '', brand: '', model: '',
    description: '', pricing_type: 'per_day', base_price: 0, quantity: 1, serial_number: '',
    purchase_date: '', delivered_date: '', purchase_price: 0, vendor_name: '', warranty_expiry: '',
    notes: '', item_type: 'standalone',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchCategories(); fetchSubcategories(); }, [fetchCategories, fetchSubcategories]);

  const filteredSubs = subcategories.filter((s) => s.category_id === form.category_id);
  const set = (field: string, value: any) => setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category_id || !form.subcategory_id) { toast.error('Name, category, and subcategory are required'); return; }
    setSaving(true);
    try {
      await createEquipment({ ...form, display_name: form.display_name || form.name });
      toast.success('Equipment added successfully');
      navigate('/equipment');
    } catch (err: any) { toast.error(err.message || 'Failed to add equipment'); }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-surface-300 mb-2">Equipment Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          <Input label="Display Name" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="Auto-generated if empty" />
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Category *</label>
            <select value={form.category_id} onChange={(e) => { set('category_id', e.target.value); set('subcategory_id', ''); }} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" required>
              <option value="">Select category</option>
              {categories.filter((c) => isEquipmentInDepartment(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Subcategory *</label>
            <select value={form.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" required>
              <option value="">Select subcategory</option>
              {filteredSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Input label="Brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          <Input label="Model" value={form.model} onChange={(e) => set('model', e.target.value)} />
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Pricing Type</label>
            <select value={form.pricing_type} onChange={(e) => set('pricing_type', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
              <option value="per_day">Per Day</option><option value="per_project">Per Project</option><option value="package_rate">Package Rate</option>
            </select>
          </div>
          <Input label="Base Price" type="number" value={form.base_price} onChange={(e) => set('base_price', parseFloat(e.target.value) || 0)} />
          <Input label="Quantity" type="number" value={form.quantity} onChange={(e) => set('quantity', Math.max(0, parseInt(e.target.value) || 0))} />
        </div>
        <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-surface-300 mb-2">Asset Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Serial Number" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
          <Input label="Supplier" value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} placeholder="Optional" />
          <Input label="Purchase Date" type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          <Input label="Delivered Date" type="date" value={form.delivered_date} onChange={(e) => set('delivered_date', e.target.value)} />
          <Input label="Purchase Price" type="number" value={form.purchase_price} onChange={(e) => set('purchase_price', parseFloat(e.target.value) || 0)} />
          <Input label="Warranty Expiry" type="date" value={form.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} />
        </div>
        <Input label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="flex gap-3">
        <Button type="submit" loading={saving}>Save Equipment</Button>
        <Button variant="secondary" type="button" onClick={() => navigate('/equipment')}>Cancel</Button>
      </div>
    </form>
  );
}
