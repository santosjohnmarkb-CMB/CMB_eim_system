import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, PackageCheck } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { EquipmentWithAsset } from '../../shared/types';

const todayISO = () => new Date().toISOString().slice(0, 10);

let rowKeySeq = 0;
interface ItemRow {
  key: number;
  equipment: EquipmentWithAsset;
}

export function LoanNewPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { create } = useLoansStore();
  const { items: allItems, fetchAll } = useEquipmentStore();
  const user = useAuthStore((s) => s.user);

  const lockedDept = user?.role !== 'admin' ? (user?.department as Department | null) : null;

  const [department, setDepartment] = useState<Department>(lockedDept || 'camera');
  const [personOrOrg, setPersonOrOrg] = useState('');
  const [purpose, setPurpose] = useState('');
  const [location, setLocation] = useState('');
  const [loanedDate, setLoanedDate] = useState(todayISO());
  const [duration, setDuration] = useState('');
  const [tentativeReturn, setTentativeReturn] = useState('');
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Equipment scoped to the chosen department.
  const deptItems = useMemo(
    () => allItems.filter((i) => i.category_name && CATEGORY_TO_DEPARTMENT[i.category_name] === department),
    [allItems, department],
  );

  // How many units of each equipment are already in this draft loan.
  const addedCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.equipment.id] = (map[r.equipment.id] || 0) + 1;
    return map;
  }, [rows]);

  const remainingFor = (eq: EquipmentWithAsset) => (eq.available_qty || 0) - (addedCount[eq.id] || 0);

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return deptItems
      .filter((eq) => remainingFor(eq) > 0)
      .filter((eq) =>
        eq.name.toLowerCase().includes(q) ||
        eq.equipment_code.toLowerCase().includes(q) ||
        (eq.brand || '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [search, deptItems, addedCount]);

  const addItem = (eq: EquipmentWithAsset) => {
    setRows((prev) => [...prev, { key: ++rowKeySeq, equipment: eq }]);
    setSearch('');
    setOpen(false);
  };

  const removeItem = (key: number) => setRows((prev) => prev.filter((r) => r.key !== key));

  const changeDepartment = (dept: Department) => {
    setDepartment(dept);
    setRows([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personOrOrg.trim()) { toast.error('Person or organization is required'); return; }
    if (rows.length === 0) { toast.error('Add at least one equipment item'); return; }

    setSaving(true);
    try {
      const loan = await create({
        department,
        person_or_org: personOrOrg,
        purpose,
        location,
        loaned_date: loanedDate,
        duration,
        tentative_return_date: tentativeReturn || null,
        remarks,
        items: rows.map((r) => ({ equipment_id: r.equipment.id })),
      });
      toast.success('Loan recorded');
      navigate(`/loans/${loan.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to record loan');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <PackageCheck size={20} className="text-primary-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-surface-100">New Equipment Loan</h1>
          <p className="text-sm text-surface-500">Loan equipment out for an event, training, or workshop</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Loan details */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">Loan Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Department</label>
              <div className="flex gap-2">
                {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    disabled={!!lockedDept && lockedDept !== dept}
                    onClick={() => changeDepartment(dept)}
                    className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      department === dept
                        ? 'bg-primary-600/20 border-primary-500/40 text-primary-300'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
                    } ${!!lockedDept && lockedDept !== dept ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {DEPARTMENT_CONFIG[dept].shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <Input label="Person / Organization *" value={personOrOrg} onChange={(e) => setPersonOrOrg(e.target.value)} placeholder="e.g. ABS-CBN / John Doe" />
            <Input label="Loaned Date" type="date" value={loanedDate} onChange={(e) => setLoanedDate(e.target.value)} />
            <Input label="Tentative Return Date" type="date" value={tentativeReturn} onChange={(e) => setTentativeReturn(e.target.value)} />
            <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Workshop, training, event" />
            <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where the equipment is used" />
            <Input label="Duration" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 3 days" />
          </div>

          <div className="w-full">
            <label className="block text-xs font-medium text-surface-400 mb-1">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
              placeholder="Additional notes (duration, return conditions, etc.)"
            />
          </div>
        </div>

        {/* Equipment items */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">Equipment ({rows.length})</h2>

          <div className="relative" ref={comboRef}>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => search.trim() && setOpen(true)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
              placeholder={`Search available ${DEPARTMENT_CONFIG[department].shortLabel} equipment...`}
            />
            {open && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filtered.map((eq) => (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => addItem(eq)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-700/60 transition-colors border-b border-surface-700/50 last:border-0"
                  >
                    <span className="font-medium text-surface-100">{eq.equipment_code}</span>
                    <span className="text-surface-300"> — {eq.name}</span>
                    <span className="text-surface-500 text-xs ml-2">{remainingFor(eq)} available</span>
                  </button>
                ))}
              </div>
            )}
            {open && search.trim() && filtered.length === 0 && (
              <div className="absolute z-10 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-lg px-4 py-3 text-sm text-surface-500">
                No available equipment found
              </div>
            )}
          </div>

          <div className="border border-surface-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-900/60 text-surface-400">
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Code</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Equipment</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Brand</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-surface-500 text-sm">
                      No equipment added yet — search above to add items.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2.5 font-mono text-xs text-primary-400">{r.equipment.equipment_code}</td>
                      <td className="px-4 py-2.5 text-surface-200">{r.equipment.name}</td>
                      <td className="px-4 py-2.5 text-surface-400">{r.equipment.brand || '-'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button type="button" onClick={() => removeItem(r.key)} className="text-surface-500 hover:text-danger-400 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/loans')}>Cancel</Button>
          <Button type="submit" loading={saving}><Plus size={16} /> Record Loan</Button>
        </div>
      </form>
    </div>
  );
}
