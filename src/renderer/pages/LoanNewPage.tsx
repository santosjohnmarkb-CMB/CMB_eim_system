import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, PackageCheck, ArrowDownLeft, ArrowUpRight, FileSignature } from 'lucide-react';
import { useLoansStore } from '../stores/loans.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { useToast } from '../hooks';
import { printLoanReleaseForm } from '../lib/loanForms';
import { DEPARTMENT_CONFIG, CATEGORY_TO_DEPARTMENT, LOAN_DIRECTION_CONFIG } from '../../shared/constants';
import type { Department } from '../../shared/constants';
import type { EquipmentWithAsset, LoanDirection } from '../../shared/types';

const todayISO = () => new Date().toISOString().slice(0, 10);

let rowKeySeq = 0;
interface ItemRow {
  key: number;
  equipment?: EquipmentWithAsset;
  quantity?: number;
  search?: string;
  itemName?: string;
  notes?: string;
}

const blankRow = (): ItemRow => ({ key: ++rowKeySeq, quantity: 1, search: '' });

export function LoanNewPage() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const toast = useToast();
  const { create } = useLoansStore();
  const { items: allItems, fetchAll } = useEquipmentStore();
  const user = useAuthStore((s) => s.user);

  const lockedDept = user?.role !== 'admin' ? (user?.department as Department | null) : null;

  // Department users only ever see their own department; admins can pick either.
  const availableDepts = useMemo<Department[]>(
    () => (lockedDept ? [lockedDept] : (Object.keys(DEPARTMENT_CONFIG) as Department[])),
    [lockedDept],
  );

  // The list page hands off which department/direction process the user came from so the
  // new-loan form opens in the same context (department users stay locked regardless).
  const navState = (routerLocation.state || {}) as { department?: Department; direction?: LoanDirection };

  const [direction, setDirection] = useState<LoanDirection>(navState.direction || 'OUTWARD');
  const [department, setDepartment] = useState<Department>(lockedDept || navState.department || 'camera');
  const [personOrOrg, setPersonOrOrg] = useState('');
  const [purpose, setPurpose] = useState('');
  const [location, setLocation] = useState('');
  const [loanedDate, setLoanedDate] = useState(todayISO());
  const [duration, setDuration] = useState('');
  const [tentativeReturn, setTentativeReturn] = useState('');
  const [remarks, setRemarks] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [rows, setRows] = useState<ItemRow[]>(() =>
    (navState.direction || 'OUTWARD') === 'OUTWARD' ? [blankRow()] : [],
  );
  const [saving, setSaving] = useState(false);

  // Which outward row's equipment dropdown is currently open.
  const [openRowKey, setOpenRowKey] = useState<number | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);

  // Inward free-text item entry.
  const [inwardName, setInwardName] = useState('');
  const [inwardNotes, setInwardNotes] = useState('');

  const isOutward = direction === 'OUTWARD';

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpenRowKey(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Equipment scoped to the chosen department.
  const deptItems = useMemo(
    () => allItems.filter((i) => i.category_name && CATEGORY_TO_DEPARTMENT[i.category_name] === department),
    [allItems, department],
  );

  // Total units across all selected equipment rows (each row can loan a quantity).
  const totalUnits = useMemo(
    () => rows.reduce((s, r) => s + (r.equipment ? (r.quantity ?? 1) : 0), 0),
    [rows],
  );

  // Units of an equipment already claimed by the *other* rows, so a row's own
  // quantity isn't counted against itself when computing what's still available.
  const otherRowsCount = (eqId: string, rowKey: number) =>
    rows.reduce((s, r) => (r.equipment?.id === eqId && r.key !== rowKey ? s + (r.quantity ?? 1) : s), 0);

  const availableForRow = (eq: EquipmentWithAsset, rowKey: number) =>
    (eq.available_qty || 0) - otherRowsCount(eq.id, rowKey);

  // Equipment suggestions for a single row's search box (only items with units left).
  const filteredForRow = (row: ItemRow) => {
    const q = (row.search || '').trim().toLowerCase();
    if (!q) return [];
    return deptItems
      .filter((eq) => availableForRow(eq, row.key) > 0)
      .filter((eq) =>
        eq.name.toLowerCase().includes(q) ||
        eq.equipment_code.toLowerCase().includes(q) ||
        (eq.brand || '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  };

  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (key: number) => setRows((prev) => prev.filter((r) => r.key !== key));
  const clearRow = (key: number) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, equipment: undefined, quantity: 1, search: '' } : r)));
  const setRowSearch = (key: number, value: string) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, search: value } : r)));
  const selectRowEquipment = (key: number, eq: EquipmentWithAsset) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, equipment: eq, quantity: 1, search: '' } : r)));
    setOpenRowKey(null);
  };
  const setRowQuantity = (key: number, qty: number) =>
    setRows((prev) => prev.map((r) => {
      if (r.key !== key || !r.equipment) return r;
      const max = Math.max(1, availableForRow(r.equipment, r.key));
      const n = Number.isNaN(qty) ? 1 : Math.min(Math.max(1, qty), max);
      return { ...r, quantity: n };
    }));

  const addInwardItem = () => {
    if (!inwardName.trim()) { toast.error('Enter the item name'); return; }
    setRows((prev) => [...prev, { key: ++rowKeySeq, itemName: inwardName.trim(), notes: inwardNotes.trim() || undefined }]);
    setInwardName('');
    setInwardNotes('');
  };

  const changeDirection = (dir: LoanDirection) => {
    setDirection(dir);
    setRows(dir === 'OUTWARD' ? [blankRow()] : []);
    setOpenRowKey(null);
    setInwardName('');
    setInwardNotes('');
  };

  const changeDepartment = (dept: Department) => {
    setDepartment(dept);
    setRows(isOutward ? [blankRow()] : []);
    setOpenRowKey(null);
  };

  const submitLoan = async (withRelease: boolean) => {
    if (!personOrOrg.trim()) {
      toast.error(isOutward ? 'Person or organization is required' : 'Lender is required');
      return;
    }
    const equipmentRows = rows.filter((r) => r.equipment);
    if (isOutward ? equipmentRows.length === 0 : rows.length === 0) {
      toast.error(isOutward ? 'Add at least one equipment' : 'Add at least one item');
      return;
    }

    setSaving(true);
    try {
      const loan = await create({
        direction,
        department,
        person_or_org: personOrOrg,
        purpose,
        location,
        loaned_date: loanedDate,
        duration,
        tentative_return_date: tentativeReturn || null,
        remarks,
        internal_notes: internalNotes,
        items: isOutward
          ? equipmentRows.flatMap((r) =>
              Array.from({ length: r.quantity ?? 1 }, () => ({ equipment_id: r.equipment!.id })),
            )
          : rows.map((r) => ({ item_name: r.itemName, notes: r.notes || null })),
      });

      // The release form is the signed hand-off for equipment we loan out (outward only).
      if (withRelease && isOutward) {
        printLoanReleaseForm({
          loan_number: loan.loan_number,
          department,
          person_or_org: personOrOrg,
          purpose,
          location,
          loaned_date: loanedDate,
          tentative_return_date: tentativeReturn || null,
          duration,
          remarks,
          released_by: user?.full_name || null,
          items: equipmentRows.flatMap((r) =>
            Array.from({ length: r.quantity ?? 1 }, () => ({
              code: r.equipment!.equipment_code,
              name: r.equipment!.name || '',
            })),
          ),
        });
      }

      toast.success(isOutward ? 'Loan recorded' : 'Inward loan recorded');
      navigate(`/loans/${loan.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to record loan');
    }
    setSaving(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitLoan(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/10">
          <PackageCheck size={20} className="text-primary-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-surface-100">New Equipment Loan</h1>
          <p className="text-sm text-surface-500">
            {isOutward ? 'Loan our equipment out for an event, training, or workshop' : 'Record equipment loaned to us by an external party'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Direction */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">Loan Type</h2>
          <div className="grid grid-cols-2 gap-3">
            {(['OUTWARD', 'INWARD'] as LoanDirection[]).map((dir) => {
              const cfg = LOAN_DIRECTION_CONFIG[dir];
              const Icon = dir === 'OUTWARD' ? ArrowUpRight : ArrowDownLeft;
              const active = direction === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  onClick={() => changeDirection(dir)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-primary-600/20 border-primary-500/40'
                      : 'bg-surface-800 border-surface-700 hover:border-surface-600'
                  }`}
                >
                  <Icon size={18} className={active ? 'text-primary-300 mt-0.5' : 'text-surface-400 mt-0.5'} />
                  <div>
                    <p className={`text-sm font-semibold ${active ? 'text-primary-200' : 'text-surface-200'}`}>{cfg.label}</p>
                    <p className="text-xs text-surface-500">{cfg.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Loan details */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">Loan Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="w-full">
              <label className="block text-xs font-medium text-surface-400 mb-1">Department</label>
              <div className="flex gap-2">
                {availableDepts.map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => changeDepartment(dept)}
                    className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      department === dept
                        ? 'bg-primary-600/20 border-primary-500/40 text-primary-300'
                        : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {DEPARTMENT_CONFIG[dept].shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <Input
              label={isOutward ? 'Person / Organization *' : 'Lent By (Person / Organization) *'}
              value={personOrOrg}
              onChange={(e) => setPersonOrOrg(e.target.value)}
              placeholder="e.g. ABS-CBN / John Doe"
            />
            <Input label={isOutward ? 'Loaned Date' : 'Received Date'} type="date" value={loanedDate} onChange={(e) => setLoanedDate(e.target.value)} />
            <Input label={isOutward ? 'Tentative Return Date' : 'Return-by Date'} type="date" value={tentativeReturn} onChange={(e) => setTentativeReturn(e.target.value)} />
            <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Workshop, training, event" />
            <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={isOutward ? 'Where the equipment is used' : 'Where the equipment is kept'} />
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
            {isOutward && <p className="mt-1 text-xs text-surface-500">Appears on the printed release form.</p>}
          </div>

          <div className="w-full">
            <label className="block text-xs font-medium text-surface-400 mb-1">Internal Notes</label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
              placeholder="Internal monitoring notes — follow-ups, reminders, status, etc."
            />
            <p className="mt-1 text-xs text-surface-500">For internal monitoring only — not shown on the release form.</p>
          </div>
        </div>

        {/* Items */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-surface-500 uppercase tracking-widest">
            {isOutward ? `Equipment (${totalUnits})` : `Items (${rows.length})`}
          </h2>

          {isOutward ? (
            <div ref={comboRef} className="space-y-3">
              {rows.map((row) => {
                const maxQty = row.equipment ? Math.max(1, availableForRow(row.equipment, row.key)) : 1;
                const results = filteredForRow(row);
                return (
                  <div key={row.key} className="flex items-start gap-2">
                    <div className="flex-1 relative">
                      {row.equipment ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg">
                          <div className="min-w-0 truncate">
                            <span className="font-mono text-xs text-primary-400">{row.equipment.equipment_code}</span>
                            <span className="text-surface-200 text-sm ml-2">{row.equipment.name}</span>
                            {row.equipment.brand && <span className="text-surface-500 text-xs ml-2">· {row.equipment.brand}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => clearRow(row.key)}
                            className="shrink-0 text-xs font-medium text-surface-400 hover:text-primary-300 transition-colors"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                          <input
                            type="text"
                            value={row.search || ''}
                            onChange={(e) => { setRowSearch(row.key, e.target.value); setOpenRowKey(row.key); }}
                            onFocus={() => setOpenRowKey(row.key)}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            placeholder={`Search available ${DEPARTMENT_CONFIG[department].shortLabel} equipment...`}
                          />
                          {openRowKey === row.key && results.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {results.map((eq) => (
                                <button
                                  key={eq.id}
                                  type="button"
                                  onClick={() => selectRowEquipment(row.key, eq)}
                                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-700/60 transition-colors border-b border-surface-700/50 last:border-0"
                                >
                                  <span className="font-medium text-surface-100">{eq.equipment_code}</span>
                                  <span className="text-surface-300"> — {eq.name}</span>
                                  <span className="text-surface-500 text-xs ml-2">{availableForRow(eq, row.key)} available</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {openRowKey === row.key && (row.search || '').trim() && results.length === 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-lg px-4 py-3 text-sm text-surface-500">
                              No available equipment found
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="w-20 shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={maxQty}
                        value={row.quantity ?? 1}
                        disabled={!row.equipment}
                        onChange={(e) => setRowQuantity(row.key, parseInt(e.target.value, 10))}
                        className="w-full px-2 py-2 text-sm text-center bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 disabled:opacity-40"
                        title="Quantity"
                      />
                      {row.equipment && <p className="mt-1 text-[10px] text-surface-500 text-center">{maxQty} avail.</p>}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length === 1}
                      className="mt-2 text-surface-500 hover:text-danger-400 transition-colors disabled:opacity-30 disabled:hover:text-surface-500"
                      title="Remove equipment"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 border border-dashed border-surface-700 hover:border-primary-500/50 rounded-lg transition-colors"
              >
                <Plus size={16} /> More Equipment
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-surface-400 mb-1">Item name</label>
                  <input
                    type="text"
                    value={inwardName}
                    onChange={(e) => setInwardName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInwardItem(); } }}
                    className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                    placeholder="e.g. Sony FX9 body, Aputure 600d"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-surface-400 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={inwardNotes}
                    onChange={(e) => setInwardNotes(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInwardItem(); } }}
                    className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                    placeholder="Serial #, condition, accessories..."
                  />
                </div>
                <Button type="button" variant="secondary" onClick={addInwardItem}><Plus size={16} /> Add</Button>
              </div>

              <div className="border border-surface-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-900/60 text-surface-400">
                      <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Item</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Notes</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/60">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-surface-500 text-sm">
                          No items added yet — enter item details above.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.key}>
                          <td className="px-4 py-2.5 text-surface-200">{r.itemName}</td>
                          <td className="px-4 py-2.5 text-surface-400">{r.notes || '-'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <button type="button" onClick={() => removeRow(r.key)} className="text-surface-500 hover:text-danger-400 transition-colors">
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/loans')}>Cancel</Button>
          {isOutward && (
            <Button type="button" variant="secondary" loading={saving} onClick={() => void submitLoan(true)}>
              <FileSignature size={16} /> Record &amp; Print Release Form
            </Button>
          )}
          <Button type="submit" loading={saving}><Plus size={16} /> Record Loan</Button>
        </div>
      </form>
    </div>
  );
}
