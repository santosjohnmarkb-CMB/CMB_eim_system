import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, RefreshCw } from 'lucide-react';
import { useEquipmentStore } from '../stores/equipment.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { EQUIPMENT_STATUS_CONFIG } from '../lib/constants';
import { useToast } from '../hooks';
import { useAuthStore } from '../stores/auth.store';
import type { EquipmentWithAsset, EquipmentStatus, AssetStatusLogEntry } from '../../shared/types';

const statusVariantMap: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'default'> = {
  AVAILABLE: 'success', DEPLOYED: 'info', IN_REPAIR: 'warning', ON_HOLD: 'default',
  IN_TRANSIT: 'info', RETIRED: 'default', MISSING: 'danger', FOR_INSPECTION: 'purple',
};

export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const { items, updateStatus, getStatusLog } = useEquipmentStore();
  const [statusLog, setStatusLog] = useState<AssetStatusLogEntry[]>([]);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [reason, setReason] = useState('');

  const equipment = items.find((i) => i.id === id);

  useEffect(() => {
    if (id) { getStatusLog(id).then(setStatusLog).catch(() => {}); }
  }, [id, getStatusLog]);

  if (!equipment) return <LoadingSpinner size="lg" className="py-24" />;

  const currentStatus = equipment.asset?.current_status || 'AVAILABLE';
  const statusConfig = EQUIPMENT_STATUS_CONFIG[currentStatus as EquipmentStatus];
  const canEdit = role === 'admin' || role === 'inventory_manager';

  const handleStatusChange = async () => {
    if (!newStatus || !reason) { toast.error('Status and reason are required'); return; }
    try {
      await updateStatus(equipment.id, newStatus, reason);
      setShowStatusModal(false);
      setNewStatus('');
      setReason('');
      toast.success('Status updated');
      getStatusLog(id!).then(setStatusLog);
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/equipment')}><ArrowLeft size={16} /> Back</Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-surface-100">{equipment.display_name || equipment.name}</h2>
          <p className="text-sm text-surface-500">{equipment.equipment_code}</p>
        </div>
        {canEdit && <Button variant="secondary" size="sm" onClick={() => setShowStatusModal(true)}><RefreshCw size={14} /> Change Status</Button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-surface-300">Equipment Info</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-surface-500">Brand</span><span className="text-surface-200">{equipment.brand || '-'}</span>
            <span className="text-surface-500">Model</span><span className="text-surface-200">{equipment.model || '-'}</span>
            <span className="text-surface-500">Category</span><span className="text-surface-200">{equipment.category_name}</span>
            <span className="text-surface-500">Subcategory</span><span className="text-surface-200">{equipment.subcategory_name}</span>
            <span className="text-surface-500">Quantity</span><span className="text-surface-200">{equipment.quantity ?? 1}</span>
            <span className="text-surface-500">Available</span><span className={`${(equipment.available_qty ?? 1) === 0 ? 'text-danger-400' : 'text-surface-200'}`}>{equipment.available_qty ?? 1} of {equipment.quantity ?? 1}</span>
            <span className="text-surface-500">Status</span><Badge variant={statusVariantMap[currentStatus] || 'default'}>{statusConfig?.label}</Badge>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-surface-300">Asset Details</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-surface-500">Serial Number</span><span className="text-surface-200">{equipment.asset?.serial_number || '-'}</span>
            <span className="text-surface-500">Asset Tag</span><span className="text-surface-200">{equipment.asset?.asset_tag || '-'}</span>
            <span className="text-surface-500">Location</span><span className="text-surface-200">{equipment.asset?.current_location || '-'}</span>
            <span className="text-surface-500">Supplier</span><span className="text-surface-200">{equipment.asset?.vendor_name || '-'}</span>
            <span className="text-surface-500">Purchase Date</span><span className="text-surface-200">{equipment.asset?.purchase_date || '-'}</span>
            <span className="text-surface-500">Delivered Date</span><span className="text-surface-200">{equipment.asset?.delivered_date || '-'}</span>
            <span className="text-surface-500">Purchase Price</span><span className="text-surface-200">{equipment.asset?.purchase_price ? `P${equipment.asset.purchase_price.toLocaleString()}` : '-'}</span>
            <span className="text-surface-500">Warranty</span><span className="text-surface-200">{equipment.asset?.warranty_expiry || '-'}</span>
          </div>
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

      <Modal isOpen={showStatusModal} onClose={() => setShowStatusModal(false)} title="Change Equipment Status">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">New Status</label>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
              <option value="">Select status</option>
              {Object.entries(EQUIPMENT_STATUS_CONFIG).filter(([k]) => k !== currentStatus).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">Reason *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500" placeholder="Reason for status change..." />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setShowStatusModal(false)}>Cancel</Button>
            <Button onClick={handleStatusChange}>Update Status</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
