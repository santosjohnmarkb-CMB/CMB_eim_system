import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, Plus } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import { latestDepartments, categoryOptionsForDepartment, subcategoryChoices, subSubChoices, categoryNameForSubcategory, pathForSubSub } from '../lib/catalogHierarchy';
import { CatalogCombobox } from '../components/common/CatalogCombobox';
import { useToast } from '../hooks';
import { useAuthStore } from '../stores/auth.store';
import type { Department } from '../../shared/constants';
import type { EquipmentStatus, AssetStatusLogEntry, EquipmentAsset } from '../../shared/types';
import { buildSkuPrefix, formatUnitCode, nextUnitCounts, trailingUnitCount } from '../../shared/equipment-code';
import { isLiveUnitStatus, isUnitLocked, unitActionLabel } from '../../shared/equipment-unit';

const statusVariantMap: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'default'> = {
  AVAILABLE: 'success', DEPLOYED: 'info', IN_REPAIR: 'warning', ON_HOLD: 'default',
  IN_TRANSIT: 'info', RETIRED: 'default', MISSING: 'danger', FOR_INSPECTION: 'purple',
};

const unitInputClass = 'w-full px-2.5 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100';

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

interface EditUnitRow {
  key: string;
  id?: string;
  equipment_code?: string | null;
  serial_number: string;
  vendor_name: string;
  delivered_date: string;
  current_status?: string;
  open_loan_number?: string | null;
  open_ticket_number?: string | null;
  open_ticket_type?: string | null;
}

const emptyEditUnit = (): EditUnitRow => ({
  key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  serial_number: '',
  vendor_name: '',
  delivered_date: '',
  current_status: 'AVAILABLE',
});

function toEditUnit(asset: EquipmentAsset): EditUnitRow {
  return {
    key: asset.id,
    id: asset.id,
    equipment_code: asset.equipment_code,
    serial_number: asset.serial_number || '',
    vendor_name: asset.vendor_name || '',
    delivered_date: (asset.delivered_date || '').slice(0, 10),
    current_status: asset.current_status || 'AVAILABLE',
    open_loan_number: asset.open_loan_number,
    open_ticket_number: asset.open_ticket_number,
    open_ticket_type: asset.open_ticket_type,
  };
}

export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const userDept = useAuthStore((s) => s.user?.department) as Department | null;
  const { items, loading, fetchAll, departments, categories, subcategories, getStatusLog, updateEquipment, fetchDepartments, fetchCategories, fetchSubcategories } = useEquipmentStore();
  const [statusLog, setStatusLog] = useState<AssetStatusLogEntry[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editUnits, setEditUnits] = useState<EditUnitRow[]>([]);

  const equipment = items.find((i) => i.id === id);

  useEffect(() => {
    if (id) { getStatusLog(id).then(setStatusLog).catch(() => {}); }
  }, [id, getStatusLog]);

  useEffect(() => { fetchDepartments(); fetchCategories(); fetchSubcategories(); }, [fetchDepartments, fetchCategories, fetchSubcategories]);

  // Deep-linking straight to this page (or reloading) can arrive before the
  // equipment list has been fetched; pull it in so we don't hang on the spinner.
  useEffect(() => { if (items.length === 0) fetchAll(); }, [items.length, fetchAll]);

  // Still loading the list → spinner. Loaded but this id isn't present → the
  // item genuinely doesn't exist (or isn't in this user's department).
  if (!equipment) {
    if (loading || items.length === 0) return <LoadingSpinner size="lg" className="py-24" />;
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/equipment')}><ArrowLeft size={16} /> Back</Button>
        <div className="glass-panel rounded-xl p-8 text-center">
          <p className="text-surface-300">This equipment could not be found. It may have been deleted or belongs to another department.</p>
        </div>
      </div>
    );
  }

  const units = equipment.assets ?? (equipment.asset ? [equipment.asset] : []);
  const canEdit = role === 'admin' || role === 'equipment_manager';

  const openEdit = () => {
    const current = equipment.assets ?? (equipment.asset ? [equipment.asset] : []);
    setEditForm({
      name: equipment.name || '',
      department_id: equipment.department_id || '',
      category_id: equipment.category_id || '',
      subcategory_id: equipment.subcategory_id || '',
      sub_subcategory: equipment.sub_subcategory || '',
      item_type: equipment.item_type || 'standalone',
      brand: equipment.brand || '',
      model: equipment.model || '',
      quantity: equipment.quantity ?? current.filter((a) => isLiveUnitStatus(a.current_status)).length,
      notes: equipment.notes || '',
      base_price: equipment.base_price ?? 0,
      pricing_type: equipment.pricing_type || 'per_day',
    });
    setEditUnits(current.map(toEditUnit));
    setShowEditModal(true);
  };

  const setEdit = (field: string, value: any) => setEditForm((p) => ({ ...p, [field]: value }));

  const applyEditUnits = (next: EditUnitRow[]) => {
    setEditUnits(next);
    setEditForm((p) => ({ ...p, quantity: next.filter((u) => isLiveUnitStatus(u.current_status)).length }));
  };

  const setEditUnit = (key: string, field: keyof EditUnitRow, value: string) => {
    setEditUnits((prev) => prev.map((u) => (u.key === key ? { ...u, [field]: value } : u)));
  };

  const addEditUnit = () => applyEditUnits([...editUnits, emptyEditUnit()]);

  const setEditQuantity = (raw: string) => {
    if (raw === '') { setEdit('quantity', ''); return; }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const q = Math.max(0, parsed);
    const live = editUnits.filter((u) => isLiveUnitStatus(u.current_status));
    const dead = editUnits.filter((u) => !isLiveUnitStatus(u.current_status));
    if (q === live.length) {
      setEdit('quantity', q);
      return;
    }
    if (q > live.length) {
      applyEditUnits([...live, ...Array.from({ length: q - live.length }, emptyEditUnit), ...dead]);
      return;
    }
    const nextLive = [...live];
    while (nextLive.length > q) {
      const idx = [...nextLive].reverse().findIndex((u) => !isUnitLocked(u));
      if (idx < 0) break;
      nextLive.splice(nextLive.length - 1 - idx, 1);
    }
    applyEditUnits([...nextLive, ...dead]);
  };

  const handleEditSave = async () => {
    if (!editForm.name || !editForm.category_id) {
      toast.error('Name and category are required');
      return;
    }
    setSavingEdit(true);
    try {
      await updateEquipment(equipment.id, {
        name: editForm.name,
        department_id: editForm.department_id,
        category_id: editForm.category_id,
        subcategory_id: editForm.subcategory_id || null,
        sub_subcategory: editForm.sub_subcategory || null,
        item_type: editForm.item_type,
        brand: editForm.brand,
        model: editForm.model,
        notes: editForm.notes,
        units: editUnits.map((u) => ({
          ...(u.id ? { id: u.id } : {}),
          serial_number: u.serial_number,
          vendor_name: u.vendor_name || null,
          delivered_date: u.delivered_date || null,
        })),
        // Admin-only pricing: managers omit these so the stored price is preserved.
        ...(role === 'admin' ? { base_price: Number(editForm.base_price) || 0, pricing_type: editForm.pricing_type } : {}),
      });
      setShowEditModal(false);
      toast.success('Equipment updated');
    } catch (err: any) { toast.error(err.message || 'Failed to update equipment'); }
    setSavingEdit(false);
  };

  const catalogDepts = latestDepartments(departments, userDept, categories);
  const selectedDept = catalogDepts.find((d) => d.id === editForm.department_id)
    || departments.find((d) => d.id === editForm.department_id);
  const editCategories = categoryOptionsForDepartment(categories, departments, editForm.department_id);
  const selectedCat = editCategories.find((c) => c.id === editForm.category_id)
    || editCategories.find((c) => c.name === editForm.category_id);
  const editSubcategories = subcategoryChoices(
    subcategories, departments, editForm.department_id, editForm.category_id, categories,
  );
  const selectedSub = editSubcategories.find((s) => s.id === editForm.subcategory_id)
    || subcategories.find((s) => s.id === editForm.subcategory_id)
    || (editForm.subcategory_id ? { id: editForm.subcategory_id, name: editForm.subcategory_id } : undefined);
  const editSubSubs = subSubChoices(selectedDept?.name, selectedCat?.name, selectedSub?.name, items, selectedCat?.id, selectedSub?.id);

  const editPrefix = buildSkuPrefix({
    departmentName: selectedDept?.name || equipment.department_name,
    categoryName: selectedCat?.name || equipment.category_name,
    brand: editForm.brand,
    model: editForm.model,
  });
  const newUnitCounts = nextUnitCounts(
    editUnits.map((u) => trailingUnitCount(u.equipment_code) ?? 0).filter((n) => n > 0),
    editUnits.filter((u) => !u.id).length,
  );

  const setEditSubcategory = (name: string) => {
    const match = editSubcategories.find((s) => s.name === name);
    const catName = selectedDept && name ? categoryNameForSubcategory(selectedDept.name, name) : undefined;
    const cat = catName ? editCategories.find((c) => c.name === catName) : undefined;
    setEditForm((p) => ({
      ...p,
      subcategory_id: match?.id || name,
      sub_subcategory: '',
      category_id: p.category_id || cat?.id || p.category_id,
    }));
  };

  const setEditSubSubcategory = (name: string) => {
    const path = name ? pathForSubSub(name) : undefined;
    const cat = path ? editCategories.find((c) => c.name === path.category) : undefined;
    const subMatch = path ? editSubcategories.find((s) => s.name === path.subcategory) : undefined;
    setEditForm((p) => ({
      ...p,
      sub_subcategory: name,
      category_id: p.category_id || cat?.id || p.category_id,
      subcategory_id: p.subcategory_id || subMatch?.id || (path ? path.subcategory : p.subcategory_id),
    }));
  };

  let newUnitPreviewIdx = 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/equipment')}><ArrowLeft size={16} /> Back</Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-surface-100">{equipment.name}</h2>
          <p className="text-sm font-mono text-surface-400">{equipment.equipment_code}</p>
        </div>
        {canEdit && <Button variant="secondary" size="sm" onClick={openEdit}><Edit2 size={14} /> Edit Details</Button>}
      </div>

      <div className="glass-panel rounded-xl p-5 space-y-3 max-w-2xl">
        <h3 className="text-sm font-semibold text-surface-300">Equipment Info</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-surface-500">Brand</span><span className="text-surface-200">{equipment.brand || '-'}</span>
          <span className="text-surface-500">Model</span><span className="text-surface-200">{equipment.model || '-'}</span>
          <span className="text-surface-500">Department</span><span className="text-surface-200">{equipment.department_name || '-'}</span>
          <span className="text-surface-500">Category</span><span className="text-surface-200">{equipment.category_name}</span>
          <span className="text-surface-500">Subcategory</span><span className="text-surface-200">{equipment.subcategory_name || '-'}</span>
          <span className="text-surface-500">Sub-sub category</span><span className="text-surface-200">{equipment.sub_subcategory || '-'}</span>
          <span className="text-surface-500">Quantity</span><span className="text-surface-200">{equipment.quantity ?? units.length}</span>
          <span className="text-surface-500">Available</span><span className={`${(equipment.available_qty ?? 0) === 0 ? 'text-danger-400' : 'text-surface-200'}`}>{equipment.available_qty ?? 0} of {equipment.quantity ?? units.length}</span>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-5">
        <h3 className="text-sm font-semibold text-surface-300 mb-4">Units ({units.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-surface-500 border-b border-surface-700/60">
                <th className="py-2 pr-4 font-medium w-10">#</th>
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Serial Number</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium">Delivered</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {units.length === 0 ? (
                <tr><td colSpan={7} className="py-4 text-surface-500">No units recorded</td></tr>
              ) : units.map((a, idx) => {
                const status = a.current_status || 'AVAILABLE';
                const config = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus];
                return (
                  <tr key={a.id} className="border-b border-surface-800/60">
                    <td className="py-2.5 pr-4 text-surface-500">{idx + 1}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-surface-200 whitespace-nowrap">{a.equipment_code || '—'}</td>
                    <td className="py-2.5 pr-4 text-surface-200">{a.serial_number || '—'}</td>
                    <td className="py-2.5 pr-4 text-surface-300">{a.vendor_name || '—'}</td>
                    <td className="py-2.5 pr-4 text-surface-300">{fmtDate(a.delivered_date)}</td>
                    <td className="py-2.5 pr-4"><Badge variant={statusVariantMap[status] || 'default'}>{config?.label || status}</Badge></td>
                    <td className="py-2.5 pr-4 text-surface-300">{unitActionLabel(a)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <p className="text-xs text-surface-500 mt-3">Serial number, supplier, and delivered date are edited from Edit Details. Status and action follow Maintenance and Loaned Equipment.</p>
        )}
      </div>

      <div className="glass-panel rounded-xl p-5">
        <h3 className="text-sm font-semibold text-surface-300 mb-4">Status History</h3>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {statusLog.length === 0 ? <p className="text-sm text-surface-500">No status changes recorded</p> : (
            statusLog.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 text-sm border-l-2 border-surface-700 pl-3">
                <div>
                  <p className="text-surface-300"><span className="text-warning-400">{entry.previous_status}</span> → <span className="text-success-400">{entry.new_status}</span></p>
                  <p className="text-surface-500 text-xs">{entry.changed_by} — {entry.reason}</p>
                  <p className="text-surface-600 text-xs">{new Date(entry.changed_at).toLocaleString()}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Equipment Details" size="xl">
        <div className="space-y-5">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Equipment Info</h4>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Name *" value={editForm.name} onChange={(e) => setEdit('name', e.target.value)} required />
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Department *</label>
                <select value={editForm.department_id} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 disabled:opacity-60" disabled>
                  <option value="">Select department</option>
                  {catalogDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <p className="text-xs text-surface-500 mt-1">Department cannot be changed after create.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Category *</label>
                <select value={editForm.category_id} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 disabled:opacity-60" disabled>
                  <option value="">Select category</option>
                  {editCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-surface-500 mt-1">Category cannot be changed after create.</p>
              </div>
              <CatalogCombobox
                label="Sub category"
                value={selectedSub?.name || ''}
                onChange={setEditSubcategory}
                options={editSubcategories.map((s) => s.name)}
                placeholder="Select or type a sub category"
                allowCreate
              />
              <CatalogCombobox
                label="Sub-sub category"
                value={editForm.sub_subcategory || ''}
                onChange={setEditSubSubcategory}
                options={editSubSubs}
                placeholder="Select or type a sub-sub category"
                allowCreate
              />
              <Input label="Brand" value={editForm.brand} onChange={(e) => setEdit('brand', e.target.value)} />
              <Input label="Model" value={editForm.model} onChange={(e) => setEdit('model', e.target.value)} />
              <Input label="Quantity" type="number" min={0} value={editForm.quantity} onChange={(e) => setEditQuantity(e.target.value)} />
              {role === 'admin' && (
                <>
                  <Input label="Price (₱)" type="number" min={0} step="0.01" value={editForm.base_price} onChange={(e) => setEdit('base_price', e.target.value === '' ? '' : parseFloat(e.target.value))} placeholder="0.00" />
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1">Pricing Type</label>
                    <select value={editForm.pricing_type} onChange={(e) => setEdit('pricing_type', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                      <option value="per_day">Per Day</option>
                      <option value="per_project">Per Project</option>
                      <option value="package_rate">Package Rate</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <Input label="Notes" value={editForm.notes} onChange={(e) => setEdit('notes', e.target.value)} />
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Units ({editUnits.length})</h4>
                <p className="text-xs text-surface-500 mt-0.5">Add or edit serial number, supplier, and delivered date for each unit. Status and action come from Maintenance and Loaned Equipment.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={addEditUnit}><Plus size={14} /> Add unit</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-surface-500 border-b border-surface-700/60">
                    <th className="py-2 pr-3 font-medium w-10">#</th>
                    <th className="py-2 pr-3 font-medium">Code</th>
                    <th className="py-2 pr-3 font-medium">Serial Number</th>
                    <th className="py-2 pr-3 font-medium">Supplier</th>
                    <th className="py-2 pr-3 font-medium">Delivered</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {editUnits.length === 0 ? (
                    <tr><td colSpan={7} className="py-4 text-surface-500">No units. Add a unit or increase quantity.</td></tr>
                  ) : editUnits.map((u, idx) => {
                    const status = u.current_status || 'AVAILABLE';
                    const config = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus];
                    const code = u.id
                      ? (u.equipment_code || '—')
                      : formatUnitCode(editPrefix, newUnitCounts[newUnitPreviewIdx++] || idx + 1);
                    return (
                      <tr key={u.key} className="border-b border-surface-800/60">
                        <td className="py-2 pr-3 text-surface-500">{idx + 1}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-surface-300 whitespace-nowrap">{code}</td>
                        <td className="py-2 pr-3">
                          <input value={u.serial_number} onChange={(e) => setEditUnit(u.key, 'serial_number', e.target.value)} className={unitInputClass} placeholder="Serial" />
                        </td>
                        <td className="py-2 pr-3">
                          <input value={u.vendor_name} onChange={(e) => setEditUnit(u.key, 'vendor_name', e.target.value)} className={unitInputClass} placeholder="Supplier" />
                        </td>
                        <td className="py-2 pr-3">
                          <input type="date" value={u.delivered_date} onChange={(e) => setEditUnit(u.key, 'delivered_date', e.target.value)} className={unitInputClass} />
                        </td>
                        <td className="py-2 pr-3"><Badge variant={statusVariantMap[status] || 'default'}>{config?.label || status}</Badge></td>
                        <td className="py-2 pr-3 text-surface-400 whitespace-nowrap">{unitActionLabel(u)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={handleEditSave} loading={savingEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
