import { useEffect, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { useVendorsStore } from '../stores/vendors.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { DataTable, type Column } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { Input } from '../components/common/Input';
import { SearchBox } from '../components/common/SearchBox';
import { useToast } from '../hooks';
import { useDepartmentStore } from '../stores/department.store';
import { DEPARTMENT_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { Vendor } from '../../shared/types';

export function VendorsPage() {
  const { vendors: allVendors, loading, fetchAll, create } = useVendorsStore();
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const isViewer = useAuthStore((s) => s.user?.role === 'viewer');
  // Admins (no active department) see every supplier; department users see their
  // own plus shared/general suppliers.
  const vendors = allVendors.filter((v) => !activeDepartment || !v.department || v.department === activeDepartment);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ name: string; contact_person: string; phone: string; email: string; address: string; payment_terms: string; notes: string; department: Department | '' }>({
    name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '',
    department: activeDepartment ?? '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const set = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  const filtered = vendors.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await create({ ...form, department: form.department || null });
      toast.success('Supplier created');
      setShowAdd(false);
      setForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '', department: activeDepartment ?? '' });
    } catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const columns: Column<Vendor>[] = [
    { key: 'name', header: 'Name', render: (v) => <span className="font-medium text-surface-100">{v.name}</span> },
    { key: 'department', header: 'Department', render: (v) => (
      <span className="text-surface-400">{v.department ? (DEPARTMENT_CONFIG[v.department as Department]?.shortLabel ?? v.department) : 'General'}</span>
    )},
    { key: 'contact_person', header: 'Contact', render: (v) => <span className="text-surface-400">{v.contact_person || '-'}</span> },
    { key: 'phone', header: 'Phone', render: (v) => <span className="text-surface-400">{v.phone || '-'}</span> },
    { key: 'email', header: 'Email', render: (v) => <span className="text-surface-400">{v.email || '-'}</span> },
    { key: 'payment_terms', header: 'Terms', render: (v) => <span className="text-surface-400">{v.payment_terms || '-'}</span> },
  ];

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Truck size={22} className="text-primary-400" />
          <h1 className="text-2xl font-bold text-surface-100">Suppliers</h1>
        </div>
        <p className="text-sm text-surface-500 mt-1">Supplier &amp; vendor directory</p>
      </div>

      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search suppliers..." className="w-64" />
        <div className="flex-1" />
        {!isViewer && <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Supplier</Button>}
      </div>
      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="No suppliers found" />
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Supplier" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">Department</label>
              <select
                value={form.department}
                onChange={(e) => set('department', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100"
              >
                <option value="">General (all departments)</option>
                {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((d) => (
                  <option key={d} value={d}>{DEPARTMENT_CONFIG[d].shortLabel}</option>
                ))}
              </select>
            </div>
            <Input label="Contact Person" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input label="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Payment Terms" value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} />
            <Input label="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <Input label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          <div className="flex gap-3 justify-end"><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleCreate} loading={saving}>Create Supplier</Button></div>
        </div>
      </Modal>
    </div>
  );
}
