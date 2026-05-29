import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePartsStore } from '../stores/parts.store';
import { useAuthStore } from '../stores/auth.store';
import { useDepartmentStore } from '../stores/department.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';

export function StockAdjustmentPage() {
  const { items: allItems, fetchAll, adjustStock } = usePartsStore();
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const items = useMemo(() => allItems.filter((p) => !activeDepartment || !p.department || p.department === activeDepartment), [allItems, activeDepartment]);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ part_id: '', quantity: 0, reason: 'received' as string, notes: '', performed_by: user?.full_name || '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const set = (f: string, v: any) => setForm((p) => ({ ...p, [f]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.part_id || form.quantity === 0) { toast.error('Select a part and enter quantity'); return; }
    setSaving(true);
    try { await adjustStock(form); toast.success('Stock adjusted'); navigate('/parts'); }
    catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
      <div className="glass-panel rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-surface-300">Stock Adjustment</h3>
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1">Part *</label>
          <select value={form.part_id} onChange={(e) => set('part_id', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100" required>
            <option value="">Select part</option>
            {items.map((p) => <option key={p.id} value={p.id}>{p.part_code} — {p.name} (Stock: {p.qty_on_hand ?? 0})</option>)}
          </select>
        </div>
        <Input label="Quantity (+ to add, - to subtract)" type="number" value={form.quantity} onChange={(e) => set('quantity', parseInt(e.target.value) || 0)} required />
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1">Reason</label>
          <select value={form.reason} onChange={(e) => set('reason', e.target.value)} className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100">
            <option value="received">Received</option><option value="damaged">Damaged</option><option value="shrinkage">Shrinkage</option><option value="audit_correction">Audit Correction</option><option value="return">Return</option>
          </select>
        </div>
        <Input label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={saving}>Submit Adjustment</Button>
        <Button variant="secondary" type="button" onClick={() => navigate('/parts')}>Cancel</Button>
      </div>
    </form>
  );
}
