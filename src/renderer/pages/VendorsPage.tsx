import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useVendorsStore } from '../stores/vendors.store';
import { Button } from '../components/common/Button';
import { DataTable, type Column } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { Input } from '../components/common/Input';
import { SearchBox } from '../components/common/SearchBox';
import { useToast } from '../hooks';
import { useDepartmentStore } from '../stores/department.store';
import type { Vendor } from '../../shared/types';

export function VendorsPage() {
  const { vendors: allVendors, loading, fetchAll, create } = useVendorsStore();
  const activeDepartment = useDepartmentStore((s) => s.activeDepartment);
  const vendors = allVendors.filter((v) => !activeDepartment || !v.department || v.department === activeDepartment);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const set = (f: string, v: string) => setForm((p) => ({ ...p, [f]: v }));

  const filtered = vendors.filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try { await create({ ...form, department: activeDepartment }); toast.success('Vendor created'); setShowAdd(false); setForm({ name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', notes: '' }); }
    catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const columns: Column<Vendor>[] = [
    { key: 'name', header: 'Name', render: (v) => <span className="font-medium text-surface-100">{v.name}</span> },
    { key: 'contact_person', header: 'Contact', render: (v) => <span className="text-surface-400">{v.contact_person || '-'}</span> },
    { key: 'phone', header: 'Phone', render: (v) => <span className="text-surface-400">{v.phone || '-'}</span> },
    { key: 'email', header: 'Email', render: (v) => <span className="text-surface-400">{v.email || '-'}</span> },
    { key: 'payment_terms', header: 'Terms', render: (v) => <span className="text-surface-400">{v.payment_terms || '-'}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search vendors..." className="w-64" />
        <div className="flex-1" />
        <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add Vendor</Button>
      </div>
      <div className="glass-panel rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="No vendors found" />
      </div>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Vendor" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input label="Contact Person" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input label="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label="Payment Terms" value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} />
            <Input label="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <Input label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          <div className="flex gap-3 justify-end"><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleCreate} loading={saving}>Create Vendor</Button></div>
        </div>
      </Modal>
    </div>
  );
}
