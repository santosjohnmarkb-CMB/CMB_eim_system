import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG, subSubsFor, opsDepartmentOf } from '../../shared/constants';
import type { Department } from '../../shared/constants';

const PRICING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_project', label: 'Per Project' },
  { value: 'package_rate', label: 'Package Rate' },
];

const ITEM_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'standalone', label: 'Standalone' },
  { value: 'package_main', label: 'Package Main' },
  { value: 'package_component', label: 'Package Component' },
  { value: 'add_on', label: 'Add-on' },
];

interface UnitRow { serial_number: string; vendor_name: string; delivered_date: string; }

const emptyUnit = (): UnitRow => ({ serial_number: '', vendor_name: '', delivered_date: '' });

export function EquipmentAddPage() {
  const {
    departments, categories, subcategories,
    fetchDepartments, fetchCategories, fetchSubcategories, createEquipment,
  } = useEquipmentStore();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const userDept = user?.department as Department | null;

  const defaultDeptId = useMemo(() => {
    const lockedName = userDept ? DEPARTMENT_CONFIG[userDept].categories[0] : 'Camera';
    return departments.find((d) => d.name === lockedName)?.id || '';
  }, [departments, userDept]);

  const [form, setForm] = useState<Record<string, any>>({
    name: '', department_id: '', category_id: '', subcategory_id: '', sub_subcategory: '',
    brand: '', model: '', pricing_type: 'per_day', base_price: 0, quantity: 1,
    notes: '', item_type: 'standalone',
  });
  const [units, setUnits] = useState<UnitRow[]>([emptyUnit()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchDepartments(); fetchCategories(); fetchSubcategories(); }, [fetchDepartments, fetchCategories, fetchSubcategories]);

  useEffect(() => {
    if (!form.department_id && defaultDeptId) setForm((p) => ({ ...p, department_id: defaultDeptId }));
  }, [defaultDeptId, form.department_id]);

  const departmentLocked = !!userDept;
  const filteredCats = categories.filter((c) => c.department_id === form.department_id);
  const filteredSubs = subcategories.filter((s) => s.category_id === form.category_id);
  const selectedCat = categories.find((c) => c.id === form.category_id);
  const selectedSub = subcategories.find((s) => s.id === form.subcategory_id);
  const subSubOptions = selectedCat && selectedSub ? subSubsFor(selectedCat.name, selectedSub.name) : [];
  const set = (field: string, value: any) => setForm((p) => ({ ...p, [field]: value }));

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

  const normalizeQuantity = () => {
    const n = parseInt(String(form.quantity), 10);
    if (Number.isNaN(n) || n < 1) setQuantity(String(Math.max(1, units.length)));
  };

  const setUnit = (idx: number, field: keyof UnitRow, value: string) => {
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, [field]: value } : u)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.department_id || !form.category_id) {
      toast.error('Name, department, and category are required');
      return;
    }
    const itemType = form.item_type;
    const pricingType = itemType === 'package_main' ? 'package_rate' : form.pricing_type;
    setSaving(true);
    try {
      await createEquipment({
        ...form,
        subcategory_id: form.subcategory_id || null,
        sub_subcategory: form.sub_subcategory || null,
        pricing_type: pricingType,
        base_price: Number(form.base_price) || 0,
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

  const selectClass = 'w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100';

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-surface-300 mb-2">Equipment Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Department *</label>
            <select
              value={form.department_id}
              onChange={(e) => { set('department_id', e.target.value); set('category_id', ''); set('subcategory_id', ''); set('sub_subcategory', ''); }}
              className={selectClass}
              required
              disabled={departmentLocked}
            >
              <option value="">Select department</option>
              {departments
                .filter((d) => !userDept || opsDepartmentOf(d.name, null) === userDept)
                .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Category *</label>
            <select value={form.category_id} onChange={(e) => { set('category_id', e.target.value); set('subcategory_id', ''); set('sub_subcategory', ''); }} className={selectClass} required>
              <option value="">Select category</option>
              {filteredCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Sub category</label>
            <select value={form.subcategory_id} onChange={(e) => { set('subcategory_id', e.target.value); set('sub_subcategory', ''); }} className={selectClass}>
              <option value="">None</option>
              {filteredSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Sub-sub category</label>
            {subSubOptions.length > 0 ? (
              <select value={form.sub_subcategory} onChange={(e) => set('sub_subcategory', e.target.value)} className={selectClass}>
                <option value="">None</option>
                {subSubOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            ) : (
              <Input label="" value={form.sub_subcategory} onChange={(e) => set('sub_subcategory', e.target.value)} placeholder="Optional" />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Item type</label>
            <select value={form.item_type} onChange={(e) => {
              set('item_type', e.target.value);
              if (e.target.value === 'package_main') set('pricing_type', 'package_rate');
            }} className={selectClass}>
              {ITEM_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Input label="Brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          <Input label="Model" value={form.model} onChange={(e) => set('model', e.target.value)} />
          <Input label="Quantity" type="number" min={1} value={form.quantity} onChange={(e) => setQuantity(e.target.value)} onBlur={normalizeQuantity} />
          {isAdmin && (
            <>
              <Input label="Price (₱)" type="number" min={0} step="0.01" value={form.base_price} onChange={(e) => set('base_price', e.target.value === '' ? '' : parseFloat(e.target.value))} placeholder="0.00" />
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Pricing Type</label>
                <select value={form.pricing_type} onChange={(e) => set('pricing_type', e.target.value)} className={selectClass} disabled={form.item_type === 'package_main'}>
                  {PRICING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
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
