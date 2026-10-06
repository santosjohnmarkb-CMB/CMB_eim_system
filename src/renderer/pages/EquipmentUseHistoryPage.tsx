import { useEffect, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { ipcInvoke, ipcOn, ipcRemoveListener } from '../lib/ipc';
import { printHtml, escapeHtml } from '../lib/print';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { useToast } from '../hooks';
import { useAuthStore } from '../stores/auth.store';
import type { Department } from '../../shared/constants';
import type { EquipmentOuting } from '../../shared/types';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const parsed = new Date(d.includes('T') ? d : `${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString();
}

export function EquipmentUseHistoryPage() {
  const navigate = useNavigate();
  const { dept, equipmentId } = useParams<{ dept: string; equipmentId: string }>();
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'viewer';
  const isViewer = user?.role === 'viewer';
  const userDept = user?.department as Department | null;
  const requested = dept === 'camera' || dept === 'lights_grips' ? dept : null;

  const [equipment, setEquipment] = useState<{ id: string; name: string; equipment_code: string; brand: string } | null>(null);
  const [outings, setOutings] = useState<EquipmentOuting[]>([]);
  const [savedRows, setSavedRows] = useState<Record<string, { notes: string; set_number: string; serial_number: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!equipmentId || !requested) return;
    let cancelled = false;
    async function load() {
      try {
        const result = await ipcInvoke<{ equipment: typeof equipment; outings: EquipmentOuting[] } | null>(
          'db:equipment:getUseHistory',
          equipmentId,
        );
        if (cancelled) return;
        const rows = result?.outings || [];
        setEquipment(result?.equipment || null);
        setOutings(rows);
        setSavedRows(Object.fromEntries(rows.map((row) => [row.id, {
          notes: row.notes || '',
          set_number: row.set_number || '',
          serial_number: row.serial_number || '',
        }])));
      } catch {
        if (!cancelled) {
          setEquipment(null);
          setOutings([]);
          setSavedRows({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const onShootChange = (...args: unknown[]) => {
      const table = (args[0] as { table?: string } | undefined)?.table;
      if (table === 'rental_requests' || table === 'rental_shoot_days' || table === 'rental_line_items') {
        void load();
      }
    };
    ipcOn('sync:dataChanged', onShootChange);
    return () => {
      cancelled = true;
      ipcRemoveListener('sync:dataChanged', onShootChange);
    };
  }, [equipmentId, requested]);

  const updateField = (loanId: string, field: 'notes' | 'set_number' | 'serial_number', value: string) => {
    setOutings((prev) => prev.map((row) => (row.id === loanId ? { ...row, [field]: value } : row)));
  };

  const saveField = async (
    loanId: string,
    field: 'notes' | 'setNumber' | 'serialNumber',
    value: string,
  ) => {
    if (!equipmentId || isViewer) return;
    const storedKey = field === 'setNumber' ? 'set_number' : field === 'serialNumber' ? 'serial_number' : 'notes';
    const nextValue = field === 'notes' ? value : value.trim();
    if ((savedRows[loanId]?.[storedKey] ?? '') === nextValue) return;
    try {
      const saved = await ipcInvoke<{ notes: string; set_number: string; serial_number: string }>('db:equipment:saveUseNote', {
        equipmentId,
        loanId,
        [field]: nextValue,
      });
      setSavedRows((prev) => ({
        ...prev,
        [loanId]: {
          notes: prev[loanId]?.notes ?? '',
          set_number: prev[loanId]?.set_number ?? '',
          serial_number: prev[loanId]?.serial_number ?? '',
          [storedKey]: saved[storedKey],
        },
      }));
      setOutings((prev) => prev.map((row) => (
        row.id === loanId ? { ...row, [storedKey]: saved[storedKey] } : row
      )));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const printHistory = () => {
    if (!equipment) return;
    const rows = outings.map((outing, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(fmtDate(outing.loaned_date))}</td>
        <td>${escapeHtml(outing.production_name || '—')}</td>
        <td>${escapeHtml(outing.project_name || '—')}</td>
        <td>${escapeHtml(outing.set_number || '—')}</td>
        <td>${escapeHtml(outing.serial_number || '—')}</td>
        <td>${escapeHtml(outing.notes || '—')}</td>
      </tr>`).join('');
    const body = `
      <div class="header">
        <h1>Equipment Outing History</h1>
        <p class="muted">${escapeHtml(equipment.name)} · ${escapeHtml(equipment.equipment_code)}${equipment.brand ? ` · ${escapeHtml(equipment.brand)}` : ''}</p>
        <p class="muted">${outings.length} shoot${outings.length === 1 ? '' : 's'} on record · Generated ${escapeHtml(new Date().toLocaleString())}</p>
      </div>
      <table>
        <thead><tr><th>#</th><th>Date</th><th>Production</th><th>Project</th><th>Set #</th><th>S/N</th><th>Notes</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No shoots on record yet.</td></tr>'}</tbody>
      </table>`;
    printHtml(`Outing History — ${equipment.equipment_code}`, body);
  };

  if (!requested || !equipmentId) {
    return <Navigate to={userDept ? `/equipment/use-count/${userDept}` : '/equipment'} replace />;
  }
  if (!isAdmin && userDept && requested !== userDept) {
    return <Navigate to={`/equipment/use-count/${userDept}`} replace />;
  }
  if (loading) return <LoadingSpinner size="lg" className="py-24" />;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <button
        onClick={() => navigate(`/equipment/use-count/${requested}`)}
        className="flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        <ArrowLeft size={16} /> Back to Use Count
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-surface-100">{equipment?.name || 'Equipment'}</h1>
          <p className="text-sm text-surface-500 mt-1">
            {equipment?.equipment_code}
            {equipment?.brand ? ` · ${equipment.brand}` : ''}
            {' · '}
            {outings.length} shoot{outings.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={printHistory} disabled={!equipment}>
          <Printer size={14} /> Print
        </Button>
      </div>

      <div className="glass-panel rounded-xl overflow-x-auto">
        {outings.length === 0 ? (
          <p className="text-sm text-surface-500 text-center py-10">No shoots on record yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs text-surface-500 uppercase tracking-wider border-b border-surface-800">
                <th className="px-5 py-3 text-left font-medium">Date</th>
                <th className="px-3 py-3 text-left font-medium">Production</th>
                <th className="px-3 py-3 text-left font-medium">Project</th>
                <th className="px-3 py-3 text-left font-medium">Set #</th>
                <th className="px-3 py-3 text-left font-medium">S/N</th>
                <th className="px-5 py-3 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {outings.map((outing) => (
                <tr key={outing.id} className="border-b border-surface-800/40 last:border-0 align-top">
                  <td className="px-5 py-3 text-surface-200 whitespace-nowrap">{fmtDate(outing.loaned_date)}</td>
                  <td className="px-3 py-3 text-surface-300">{outing.production_name || '—'}</td>
                  <td className="px-3 py-3 text-surface-300">{outing.project_name || '—'}</td>
                  <td className="px-3 py-3">
                    {isViewer ? (
                      <span className="text-surface-300">{outing.set_number || '—'}</span>
                    ) : (
                      <input
                        value={outing.set_number || ''}
                        maxLength={80}
                        placeholder="Set #"
                        onChange={(e) => updateField(outing.id, 'set_number', e.target.value)}
                        onBlur={(e) => { void saveField(outing.id, 'setNumber', e.target.value); }}
                        className="w-24 rounded-md border border-surface-700 bg-surface-900/60 px-2 py-1.5 text-sm text-surface-200 placeholder:text-surface-600 focus:border-primary-500 focus:outline-none"
                      />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {isViewer ? (
                      <span className="text-surface-300">{outing.serial_number || '—'}</span>
                    ) : (
                      <input
                        value={outing.serial_number || ''}
                        maxLength={80}
                        placeholder="S/N"
                        onChange={(e) => updateField(outing.id, 'serial_number', e.target.value)}
                        onBlur={(e) => { void saveField(outing.id, 'serialNumber', e.target.value); }}
                        className="w-36 rounded-md border border-surface-700 bg-surface-900/60 px-2 py-1.5 text-sm text-surface-200 placeholder:text-surface-600 focus:border-primary-500 focus:outline-none"
                      />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {isViewer ? (
                      <span className="text-surface-300 whitespace-pre-wrap">{outing.notes || '—'}</span>
                    ) : (
                      <textarea
                        value={outing.notes || ''}
                        maxLength={2000}
                        rows={2}
                        placeholder="Add a note"
                        onChange={(e) => updateField(outing.id, 'notes', e.target.value)}
                        onBlur={(e) => { void saveField(outing.id, 'notes', e.target.value); }}
                        className="w-full min-w-[180px] rounded-md border border-surface-700 bg-surface-900/60 px-2 py-1.5 text-sm text-surface-200 placeholder:text-surface-600 focus:border-primary-500 focus:outline-none"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
