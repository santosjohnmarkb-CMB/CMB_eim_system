import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast, useDepartmentFilter } from '../hooks';

interface UnitRow { serial_number: string; vendor_name: string; delivered_date: string; }

const emptyUnit = (): UnitRow => ({ serial_number: '', vendor_name: '', delivered_date: '' });

export function EquipmentAddPage() {
  const { categories, subcategories, fetchCategories, fetchSubcategories, createEquipment } = useEquipmentStore();
  const { isEquipmentInDepartment } = useDepartmentFilter();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<Record<string, any>>({
    name: '', display_name: '', category_id: '', subcategory_id: '', brand: '', model: '',
    description: '', pricing_type: 'per_day', base_price: 0, quantity: 1,
    notes: '', item_type: 'standalone',
  });
  const [units, setUnits] = useState<UnitRow[]>([emptyUnit()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchCategories(); fetchSubcategories(); }, [fetchCategories, fetchSubcategories]);

  const filteredSubs = subcategories.filter((s) => s.category_id === form.category_id);
  const set = (field: string, value: any) => setForm((p) => ({ ...p, [field]: value }));

  // Keep the per-unit rows in sync with the quantity field (at least one unit).
  // Allow the field to be cleared / mid-typed without snapping back to 1, so a
  // single digit can be replaced (e.g. clear "1" then type "2").
  const setQuantity = (raw: string) => {
    if (raw === '') { set('quantity', ''); return; }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const q = Math.max(1, parsed);
    set('quantity', q);
    setUnits((prev) => {
      if (q === prev.length) return prev;
      if (q > prev.length) return [...prev, ...Array.from({ length: q - prev.length }, emptyUnit)];
      return prev.slice(0, q);
    });
  };

  // Normalize an empty / invalid quantity back to the current unit count on blur.
  const normalizeQuantity = () => {
    const n = parseInt(String(form.quantity), 10);
    if (Number.isNaN(n) || n < 1) setQuantity(String(Math.max(1, units.length)));
  };

  const setUnit = (idx: number, field: keyof UnitRow, value: string) => {
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, [field]: value } : u)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category_id || !form.subcategory_id) { toast.error('Name, category, and subcategory are required'); return; }
    setSaving(true);
    try {
      await createEquipment({
        ...form,
        display_name: form.display_name || form.name,
        units: units.map((u) => ({
          serial_number: u.serial_number,
          vendor_name: u.vendor_name || null,
          delivered_date: u.delivered_date || null,
        })),
      });
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
          <Input label="Quantity" type="number" min={1} value={form.quantity} onChange={(e) => setQuantity(e.target.value)} onBlur={normalizeQuantity} />
        </div>
        <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="glass-panel rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-surface-300">Units ({units.length})</h3>
          <p className="text-xs text-surface-500 mt-0.5">Each unit of quantity has its own serial number, supplier, and delivery date. Leave blank to fill in later.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-500 border-b border-surface-700/60">
                <th className="py-2 pr-3 font-medium w-10">#</th>
                <th className="py-2 pr-3 font-medium">Serial Number</th>
                <th className="py-2 pr-3 font-medium">Supplier</th>
                <th className="py-2 pr-3 font-medium">Delivered Date</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, idx) => (
                <tr key={idx} className="border-b border-surface-800/60">
                  <td className="py-2 pr-3 text-surface-500">{idx + 1}</td>
                  <td className="py-2 pr-3">
                    <input value={u.serial_number} onChange={(e) => setUnit(idx, 'serial_number', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" placeholder="Serial" />
                  </td>
                  <td className="py-2 pr-3">
                    <input value={u.vendor_name} onChange={(e) => setUnit(idx, 'vendor_name', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" placeholder="Supplier" />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="date" value={u.delivered_date} onChange={(e) => setUnit(idx, 'delivered_date', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
