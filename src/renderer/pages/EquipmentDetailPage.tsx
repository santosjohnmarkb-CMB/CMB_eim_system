import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, RefreshCw, Pencil } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import { useToast, useDepartmentFilter } from '../hooks';
import { useAuthStore } from '../stores/auth.store';
import type { EquipmentStatus, AssetStatusLogEntry, EquipmentAsset } from '../../shared/types';

const statusVariantMap: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'default'> = {
  AVAILABLE: 'success', DEPLOYED: 'info', IN_REPAIR: 'warning', ON_HOLD: 'default',
  IN_TRANSIT: 'info', RETIRED: 'default', MISSING: 'danger', FOR_INSPECTION: 'purple',
};

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const { items, loading, fetchAll, categories, subcategories, getStatusLog, updateEquipment, updateAsset, updateAssetStatus, fetchCategories, fetchSubcategories } = useEquipmentStore();
  const { isEquipmentInDepartment } = useDepartmentFilter();
  const [statusLog, setStatusLog] = useState<AssetStatusLogEntry[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  // Per-unit detail edit (serial number, supplier, delivery date).
  const [unitForm, setUnitForm] = useState<{ asset_id: string; serial_number: string; vendor_name: string; delivered_date: string } | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);

  // Per-unit status change.
  const [statusAsset, setStatusAsset] = useState<EquipmentAsset | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [reason, setReason] = useState('');

  const equipment = items.find((i) => i.id === id);

  useEffect(() => {
    if (id) { getStatusLog(id).then(setStatusLog).catch(() => {}); }
  }, [id, getStatusLog]);

  useEffect(() => { fetchCategories(); fetchSubcategories(); }, [fetchCategories, fetchSubcategories]);

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
  const canEdit = role === 'admin' || role === 'inventory_manager';

  const openEdit = () => {
    setEditForm({
      name: equipment.name || '',
      display_name: equipment.display_name || '',
      category_id: equipment.category_id || '',
      subcategory_id: equipment.subcategory_id || '',
      brand: equipment.brand || '',
      model: equipment.model || '',
      quantity: equipment.quantity ?? 1,
      description: equipment.description || '',
      notes: equipment.notes || '',
    });
    setShowEditModal(true);
  };

  const setEdit = (field: string, value: any) => setEditForm((p) => ({ ...p, [field]: value }));

  const handleEditSave = async () => {
    if (!editForm.name || !editForm.category_id || !editForm.subcategory_id) {
      toast.error('Name, category, and subcategory are required');
      return;
    }
    setSavingEdit(true);
    try {
      await updateEquipment(equipment.id, {
        name: editForm.name,
        display_name: editForm.display_name || editForm.name,
        category_id: editForm.category_id,
        subcategory_id: editForm.subcategory_id,
        brand: editForm.brand,
        model: editForm.model,
        quantity: Math.max(0, parseInt(editForm.quantity, 10) || 0),
        description: editForm.description,
        notes: editForm.notes,
      });
      setShowEditModal(false);
      toast.success('Equipment updated');
    } catch (err: any) { toast.error(err.message || 'Failed to update equipment'); }
    setSavingEdit(false);
  };

  const openUnitEdit = (asset: EquipmentAsset) => {
    setUnitForm({
      asset_id: asset.id,
      serial_number: asset.serial_number || '',
      vendor_name: asset.vendor_name || '',
      delivered_date: (asset.delivered_date || '').slice(0, 10),
    });
  };

  const handleUnitSave = async () => {
    if (!unitForm) return;
    setSavingUnit(true);
    try {
      await updateAsset({
        asset_id: unitForm.asset_id,
        serial_number: unitForm.serial_number,
        vendor_name: unitForm.vendor_name || null,
        delivered_date: unitForm.delivered_date || null,
      });
      setUnitForm(null);
      toast.success('Unit updated');
    } catch (err: any) { toast.error(err.message || 'Failed to update unit'); }
    setSavingUnit(false);
  };

  const openStatus = (asset: EquipmentAsset) => {
    setStatusAsset(asset);
    setNewStatus('');
    setReason('');
  };

  const handleStatusChange = async () => {
    if (!statusAsset) return;
    if (!newStatus || !reason) { toast.error('Status and reason are required'); return; }
    try {
      await updateAssetStatus({ asset_id: statusAsset.id, status: newStatus, reason });
      setStatusAsset(null);
      setNewStatus('');
      setReason('');
      toast.success('Unit status updated');
      if (id) getStatusLog(id).then(setStatusLog);
    } catch (err: any) { toast.error(err.message); }
  };

  const editSubcategories = subcategories.filter((s) => s.category_id === editForm.category_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/equipment')}><ArrowLeft size={16} /> Back</Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-surface-100">{equipment.display_name || equipment.name}</h2>
          <p className="text-sm text-surface-500">{equipment.equipment_code}</p>
        </div>
        {canEdit && <Button variant="secondary" size="sm" onClick={openEdit}><Edit2 size={14} /> Edit Details</Button>}
      </div>

      <div className="glass-panel rounded-xl p-5 space-y-3 max-w-2xl">
        <h3 className="text-sm font-semibold text-surface-300">Equipment Info</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-surface-500">Brand</span><span className="text-surface-200">{equipment.brand || '-'}</span>
          <span className="text-surface-500">Model</span><span className="text-surface-200">{equipment.model || '-'}</span>
          <span className="text-surface-500">Category</span><span className="text-surface-200">{equipment.category_name}</span>
          <span className="text-surface-500">Subcategory</span><span className="text-surface-200">{equipment.subcategory_name}</span>
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
                <th className="py-2 pr-4 font-medium">Serial Number</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium">Delivered</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canEdit && <th className="py-2 pr-4 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {units.length === 0 ? (
                <tr><td colSpan={canEdit ? 6 : 5} className="py-4 text-surface-500">No units recorded</td></tr>
              ) : units.map((a, idx) => {
                const status = a.current_status || 'AVAILABLE';
                const config = EQUIPMENT_STATUS_CONFIG[status as EquipmentStatus];
                return (
                  <tr key={a.id} className="border-b border-surface-800/60">
                    <td className="py-2.5 pr-4 text-surface-500">{idx + 1}</td>
                    <td className="py-2.5 pr-4 text-surface-200">{a.serial_number || '—'}</td>
                    <td className="py-2.5 pr-4 text-surface-300">{a.vendor_name || '—'}</td>
                    <td className="py-2.5 pr-4 text-surface-300">{fmtDate(a.delivered_date)}</td>
                    <td className="py-2.5 pr-4"><Badge variant={statusVariantMap[status] || 'default'}>{config?.label || status}</Badge></td>
                    {canEdit && (
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => openUnitEdit(a)}><Pencil size={13} /> Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => openStatus(a)}><RefreshCw size={13} /> Status</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
              <Input label="Display Name" value={editForm.display_name} onChange={(e) => setEdit('display_name', e.target.value)} placeholder="Defaults to name if empty" />
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Category *</label>
                <select value={editForm.category_id} onChange={(e) => { setEdit('category_id', e.target.value); setEdit('subcategory_id', ''); }} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                  <option value="">Select category</option>
                  {categories.filter((c) => isEquipmentInDepartment(c.id) || c.id === editForm.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Subcategory *</label>
                <select value={editForm.subcategory_id} onChange={(e) => setEdit('subcategory_id', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                  <option value="">Select subcategory</option>
                  {editSubcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <Input label="Brand" value={editForm.brand} onChange={(e) => setEdit('brand', e.target.value)} />
              <Input label="Model" value={editForm.model} onChange={(e) => setEdit('model', e.target.value)} />
              <Input label="Quantity" type="number" value={editForm.quantity} onChange={(e) => setEdit('quantity', e.target.value)} />
            </div>
            <Input label="Description" value={editForm.description} onChange={(e) => setEdit('description', e.target.value)} />
            <Input label="Notes" value={editForm.notes} onChange={(e) => setEdit('notes', e.target.value)} />
            <p className="text-xs text-surface-500">Changing quantity adds or removes units below. Per-unit serial number, supplier, and delivery date are edited in the Units table.</p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={handleEditSave} loading={savingEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!unitForm} onClose={() => setUnitForm(null)} title="Edit Unit Details">
        {unitForm && (
          <div className="space-y-4">
            <Input label="Serial Number" value={unitForm.serial_number} onChange={(e) => setUnitForm({ ...unitForm, serial_number: e.target.value })} />
            <Input label="Supplier" value={unitForm.vendor_name} onChange={(e) => setUnitForm({ ...unitForm, vendor_name: e.target.value })} placeholder="Optional" />
            <Input label="Delivered Date" type="date" value={unitForm.delivered_date} onChange={(e) => setUnitForm({ ...unitForm, delivered_date: e.target.value })} />
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setUnitForm(null)}>Cancel</Button>
              <Button onClick={handleUnitSave} loading={savingUnit}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!statusAsset} onClose={() => setStatusAsset(null)} title="Change Unit Status">
        {statusAsset && (
          <div className="space-y-4">
            <p className="text-sm text-surface-400">
              Unit: <span className="text-surface-200">{statusAsset.serial_number || 'No serial'}</span>
              {' · '}Current: <span className="text-surface-200">{EQUIPMENT_STATUS_CONFIG[(statusAsset.current_status || 'AVAILABLE') as EquipmentStatus]?.label}</span>
            </p>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">New Status</label>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
                <option value="">Select status</option>
                {Object.entries(EQUIPMENT_STATUS_CONFIG).filter(([k]) => k !== statusAsset.current_status).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Reason *</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500" placeholder="Reason for status change..." />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setStatusAsset(null)}>Cancel</Button>
              <Button onClick={handleStatusChange}>Update Status</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
