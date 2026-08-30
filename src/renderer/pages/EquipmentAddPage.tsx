import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import {
  latestDepartments,
  categoryOptionsForDepartment,
  subcategoryChoices,
  subSubChoices,
  categoryNameForSubcategory,
  pathForSubSub,
} from '../lib/catalogHierarchy';
import { CatalogCombobox } from '../components/common/CatalogCombobox';
import { Badge } from '../components/common/Badge';
import { buildSkuPrefix, formatUnitCode, nextUnitCounts, trailingUnitCount } from '../../shared/equipment-code';
import { unitActionLabel } from '../../shared/equipment-unit';

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
    departments, categories, subcategories, items,
    fetchAll, fetchDepartments, fetchCategories, fetchSubcategories, createEquipment,
  } = useEquipmentStore();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const userDept = user?.department as Department | null;

  const catalogDepts = useMemo(
    () => latestDepartments(departments, userDept, categories),
    [departments, userDept, categories],
  );

  const defaultDeptId = useMemo(() => {
    const preferred = userDept ? DEPARTMENT_CONFIG[userDept].categories[0] : catalogDepts[0]?.name;
    return catalogDepts.find((d) => d.name === preferred)?.id || catalogDepts[0]?.id || '';
  }, [catalogDepts, userDept]);

  const [form, setForm] = useState<Record<string, any>>({
    name: '', department_id: '', category_id: '', subcategory_id: '', sub_subcategory: '',
    brand: '', model: '', pricing_type: 'per_day', base_price: 0, quantity: 1,
    notes: '', item_type: 'standalone',
  });
  const [units, setUnits] = useState<UnitRow[]>([emptyUnit()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); fetchDepartments(); fetchCategories(); fetchSubcategories(); }, [fetchAll, fetchDepartments, fetchCategories, fetchSubcategories]);

  useEffect(() => {
    if (!form.department_id && defaultDeptId) setForm((p) => ({ ...p, department_id: defaultDeptId }));
  }, [defaultDeptId, form.department_id]);

  const departmentLocked = catalogDepts.length <= 1;
  const selectedDept = catalogDepts.find((d) => d.id === form.department_id)
    || departments.find((d) => d.id === form.department_id);
  const filteredCats = categoryOptionsForDepartment(categories, departments, form.department_id);
  const selectedCat = filteredCats.find((c) => c.id === form.category_id)
    || filteredCats.find((c) => c.name === form.category_id);
  const filteredSubs = subcategoryChoices(
    subcategories, departments, form.department_id, form.category_id, categories,
  );
  const selectedSub = filteredSubs.find((s) => s.id === form.subcategory_id)
    || subcategories.find((s) => s.id === form.subcategory_id)
    || (form.subcategory_id ? { id: form.subcategory_id, name: form.subcategory_id } : undefined);
  const subSubOptions = subSubChoices(selectedDept?.name, selectedCat?.name, selectedSub?.name, items, selectedCat?.id, selectedSub?.id);
  const set = (field: string, value: any) => setForm((p) => ({ ...p, [field]: value }));

  const setCategory = (name: string) => {
    const match = filteredCats.find((c) => c.name === name);
    setForm((p) => ({
      ...p,
      category_id: match?.id || name,
      subcategory_id: '',
      sub_subcategory: '',
    }));
  };

  const setSubcategory = (name: string) => {
    const match = filteredSubs.find((s) => s.name === name);
    const catName = selectedDept && name ? categoryNameForSubcategory(selectedDept.name, name) : undefined;
    const cat = catName ? filteredCats.find((c) => c.name === catName) : undefined;
    setForm((p) => ({
      ...p,
      subcategory_id: match?.id || name,
      sub_subcategory: '',
      category_id: p.category_id || cat?.id || p.category_id,
    }));
  };

  const setSubSubcategory = (name: string) => {
    const path = name ? pathForSubSub(name) : undefined;
    const cat = path ? filteredCats.find((c) => c.name === path.category) : undefined;
    const subMatch = path
      ? filteredSubs.find((s) => s.name === path.subcategory)
      : undefined;
    setForm((p) => ({
      ...p,
      sub_subcategory: name,
      category_id: p.category_id || cat?.id || p.category_id,
      subcategory_id: p.subcategory_id || subMatch?.id || (path ? path.subcategory : p.subcategory_id),
    }));
  };

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

  const codePreview = useMemo(() => {
    const prefix = buildSkuPrefix({
      departmentName: selectedDept?.name,
      categoryName: selectedCat?.name,
      brand: form.brand,
      model: form.model,
    });
    const existing = items.find((i) =>
      i.department_id === form.department_id
      && i.category_id === form.category_id
      && (i.brand || '').trim().toLowerCase() === (form.brand || '').trim().toLowerCase()
      && (i.model || '').trim().toLowerCase() === (form.model || '').trim().toLowerCase(),
    );
    const used = (existing?.assets || []).map((a) => trailingUnitCount(a.equipment_code) ?? 0).filter((n) => n > 0);
    const counts = nextUnitCounts(used, units.length);
    return { prefix, counts, appending: Boolean(existing) };
  }, [selectedDept?.name, selectedCat?.name, form.brand, form.model, form.department_id, form.category_id, items, units.length]);

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
              {catalogDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <CatalogCombobox
            label="Category *"
            value={selectedCat?.name || form.category_id}
            onChange={setCategory}
            options={filteredCats.map((c) => c.name)}
            placeholder="Select or type a category"
            allowCreate
          />
          <CatalogCombobox
            label="Sub category"
            value={selectedSub?.name || ''}
            onChange={setSubcategory}
            options={filteredSubs.map((s) => s.name)}
            placeholder="Select or type a sub category"
            allowCreate
          />
          <CatalogCombobox
            label="Sub-sub category"
            value={form.sub_subcategory || ''}
            onChange={setSubSubcategory}
            options={subSubOptions}
            placeholder="Select or type a sub-sub category"
            allowCreate
          />
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
          <div className="col-span-2">
            <p className="text-xs font-medium text-surface-400 mb-1">Equipment code</p>
            <p className="font-mono text-sm text-surface-200">{codePreview.prefix}</p>
            <p className="text-xs text-surface-500 mt-0.5">
              {codePreview.appending
                ? `This brand/model already exists — new units continue the count (${formatUnitCode(codePreview.prefix, codePreview.counts[0] || 1)} …).`
                : 'Generated from department, category, brand, and model. Each unit gets a count suffix.'}
            </p>
          </div>
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
          <p className="text-xs text-surface-500 mt-0.5">Each unit of quantity has its own serial number, supplier, and delivery date. Status and action are set later by Maintenance and Loaned Equipment. Leave blank to fill in later.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-500 border-b border-surface-700/60">
                <th className="py-2 pr-3 font-medium w-10">#</th>
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Serial Number</th>
                <th className="py-2 pr-3 font-medium">Supplier</th>
                <th className="py-2 pr-3 font-medium">Delivered Date</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, idx) => (
                <tr key={idx} className="border-b border-surface-800/60">
                  <td className="py-2 pr-3 text-surface-500">{idx + 1}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-surface-300 whitespace-nowrap">
                    {formatUnitCode(codePreview.prefix, codePreview.counts[idx] || idx + 1)}
                  </td>
                  <td className="py-2 pr-3">
                    <input value={u.serial_number} onChange={(e) => setUnit(idx, 'serial_number', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" placeholder="Serial" />
                  </td>
                  <td className="py-2 pr-3">
                    <input value={u.vendor_name} onChange={(e) => setUnit(idx, 'vendor_name', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" placeholder="Supplier" />
                  </td>
                    <td className="py-2 pr-3">
                      <input type="date" value={u.delivered_date} onChange={(e) => setUnit(idx, 'delivered_date', e.target.value)} className="w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" />
                    </td>
                    <td className="py-2 pr-3"><Badge variant="success">Available</Badge></td>
                    <td className="py-2 pr-3 text-surface-400">{unitActionLabel({ current_status: 'AVAILABLE' })}</td>
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
