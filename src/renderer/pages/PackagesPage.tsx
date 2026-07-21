import { useEffect, useState, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Package as PackageIcon, Plus, Trash2, Pencil, Upload, Download, Search,
} from 'lucide-react';
import { usePackageStore, type PackageInput } from '../stores/package.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { useToast } from '../hooks';
import { ipcInvoke } from '../lib/ipc';
import { IPC_CHANNELS } from '../lib/constants';
import type { PackageDefinition, EquipmentWithAsset, BulkImportResult } from '../../shared/types';

// EIM catalog prices are Philippine pesos. Kept local to avoid a shared dep just
// for one screen; mirrors the rental app's currency presentation.
function formatCurrency(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(n);
}

export function PackagesPage() {
  const { packages, isLoading, fetchAll, createPackage, updatePackage, deletePackage } = usePackageStore();
  const toast = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  // Admins and equipment managers can manage packages within their department;
  // pricing edits are still admin-only (enforced in the form + backend).
  const canManage = role === 'admin' || role === 'equipment_manager';

  const [showCreate, setShowCreate] = useState(false);
  const [editingPkg, setEditingPkg] = useState<PackageDefinition | null>(null);
  const [deletingPkg, setDeletingPkg] = useState<PackageDefinition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUploadCsv = async () => {
    setIsImporting(true);
    try {
      const csvContent = await ipcInvoke<string | null>(IPC_CHANNELS.PACKAGES_READ_CSV_FILE);
      if (!csvContent) { setIsImporting(false); return; }
      const result = await ipcInvoke<BulkImportResult>(IPC_CHANNELS.PACKAGES_BULK_IMPORT, csvContent);
      setImportResult(result);
      if (result.imported > 0) {
        toast.success(`Imported ${result.imported} package${result.imported > 1 ? 's' : ''}`);
        fetchAll();
      }
      if (result.errors.length > 0 && result.imported === 0) {
        toast.error('Import failed — see error details');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const filePath = await ipcInvoke<string | null>(IPC_CHANNELS.PACKAGES_DOWNLOAD_TEMPLATE);
      if (filePath) toast.success(`Template saved to ${filePath}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download template');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-surface-400">
          Equipment packages bundle a main item with its included components.
          {!isAdmin && canManage && ' Prices are managed by an administrator.'}
        </p>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={handleDownloadTemplate} loading={isDownloadingTemplate}>
              <Download size={14} /> Template
            </Button>
            <Button variant="secondary" size="sm" onClick={handleUploadCsv} loading={isImporting}>
              <Upload size={14} /> Upload CSV
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Create Package
            </Button>
          </div>
        )}
      </div>

      {isLoading && packages.length === 0 ? (
        <div className="flex items-center justify-center h-52">
          <div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" />
        </div>
      ) : packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 text-surface-500">
          <PackageIcon className="h-10 w-10 mb-3 text-surface-600" />
          <p className="text-sm">No packages yet.{canManage ? ' Create one to get started.' : ''}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              canManage={canManage}
              onEdit={() => setEditingPkg(pkg)}
              onDelete={() => setDeletingPkg(pkg)}
            />
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Package" size="xl">
        <PackageForm
          isAdmin={isAdmin}
          onSubmit={async (data) => {
            await createPackage(data);
            setShowCreate(false);
            toast.success('Package created successfully');
          }}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      <Modal isOpen={!!editingPkg} onClose={() => setEditingPkg(null)} title="Edit Package" size="xl">
        {editingPkg && (
          <PackageForm
            key={editingPkg.id}
            isAdmin={isAdmin}
            initial={editingPkg}
            submitLabel="Save Changes"
            onSubmit={async (data) => {
              try {
                await updatePackage(editingPkg.id, data);
                toast.success('Package updated');
                setEditingPkg(null);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to update package');
              }
            }}
            onCancel={() => setEditingPkg(null)}
          />
        )}
      </Modal>

      <Modal isOpen={!!deletingPkg} onClose={() => !isDeleting && setDeletingPkg(null)} title="Delete Package" size="sm">
        {deletingPkg && (
          <>
            <p className="text-sm text-surface-300">
              Delete package <strong className="text-surface-100">{deletingPkg.name}</strong>?
            </p>
            <p className="mt-2 text-xs text-surface-500">
              This is a soft delete: the package is hidden from the list and pickers, but historical records that
              reference it remain intact. The component equipment items are not affected.
            </p>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-surface-800/60">
              <Button variant="secondary" onClick={() => setDeletingPkg(null)} disabled={isDeleting}>Cancel</Button>
              <Button
                variant="danger"
                loading={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deletePackage(deletingPkg.id);
                    toast.success('Package deleted');
                    setDeletingPkg(null);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to delete package');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal isOpen={!!importResult} onClose={() => setImportResult(null)} title="Import Results" size="lg">
        {importResult && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="glass-panel rounded-lg p-4 flex-1">
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">Imported</p>
                <p className="text-2xl font-bold text-success-400">{importResult.imported}</p>
              </div>
              <div className="glass-panel rounded-lg p-4 flex-1">
                <p className="text-xs text-surface-400 uppercase tracking-wider mb-1">Errors</p>
                <p className="text-2xl font-bold text-danger-400">{importResult.errors.length}</p>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-surface-200 mb-2">Error Details</h4>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {importResult.errors.map((err, i) => (
                    <div key={i} className="flex gap-3 text-xs py-1.5 px-3 rounded bg-surface-800/50">
                      <span className="text-surface-500 shrink-0">Row {err.row}</span>
                      <span className="text-danger-400">{err.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setImportResult(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PackageCard({ pkg, canManage, onEdit, onDelete }: {
  pkg: PackageDefinition; canManage: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-800/30 transition-colors">
        <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-4 min-w-0 flex-1 text-left">
          <div className="w-9 h-9 rounded-lg bg-primary-500/15 flex items-center justify-center shrink-0">
            <PackageIcon className="h-[18px] w-[18px] text-primary-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-surface-100 truncate">{pkg.name}</h3>
            {pkg.description && <p className="text-xs text-surface-400 mt-0.5 truncate">{pkg.description}</p>}
          </div>
        </button>
        <div className="flex items-center gap-3 shrink-0 pl-4">
          {pkg.main_item && (
            <span className="text-xs font-semibold text-primary-400 tabular-nums">{formatCurrency(pkg.main_item.base_price)}</span>
          )}
          <Badge variant={pkg.is_active ? 'success' : 'default'}>{pkg.is_active ? 'Active' : 'Inactive'}</Badge>
          {pkg.items && (
            <span className="text-xs text-surface-500">{pkg.items.length} component{pkg.items.length !== 1 ? 's' : ''}</span>
          )}
          {canManage && (
            <div className="flex items-center gap-1 ml-1">
              <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit package"
                className="h-7 w-7 rounded-md flex items-center justify-center text-surface-400 hover:text-primary-400 hover:bg-primary-500/10 transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete package"
                className="h-7 w-7 rounded-md flex items-center justify-center text-surface-400 hover:text-danger-400 hover:bg-danger-500/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-surface-500 hover:text-surface-300 transition-colors" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && pkg.items && pkg.items.length > 0 && (
        <div className="border-t border-surface-800/60 px-5 py-3">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-surface-500 uppercase tracking-wider">
                <th className="text-left py-2 font-medium">Component</th>
                <th className="text-left py-2 font-medium">Brand</th>
                <th className="text-center py-2 font-medium">Qty</th>
                <th className="text-center py-2 font-medium">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/40">
              {pkg.items.map((pkgItem) => (
                <tr key={pkgItem.id} className="text-sm">
                  <td className="py-2.5 text-surface-200">{pkgItem.component?.display_name || pkgItem.component?.name || '—'}</td>
                  <td className="py-2.5 text-surface-400">{pkgItem.component?.brand || '—'}</td>
                  <td className="py-2.5 text-center tabular-nums text-surface-300">{pkgItem.included_qty}</td>
                  <td className="py-2.5 text-center">
                    <Badge variant={pkgItem.is_required ? 'info' : 'default'}>{pkgItem.is_required ? 'Yes' : 'Optional'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {expanded && (!pkg.items || pkg.items.length === 0) && (
        <div className="border-t border-surface-800/60 px-5 py-6 text-center text-sm text-surface-500">
          No components defined for this package.
        </div>
      )}
    </div>
  );
}

// ── Package Form ──

interface ComponentLine {
  id: string;
  equipment: EquipmentWithAsset | null;
  qty: number;
  is_required: boolean;
}

let lineIdCounter = 0;
const nextLineId = () => `line-${++lineIdCounter}`;

function PackageForm({ onSubmit, onCancel, initial, submitLabel = 'Create Package', isAdmin }: {
  onSubmit: (data: PackageInput) => Promise<void>;
  onCancel: () => void;
  initial?: PackageDefinition | null;
  submitLabel?: string;
  isAdmin: boolean;
}) {
  const initialMain = (initial?.main_item as EquipmentWithAsset | undefined) ?? null;
  const initialLines: ComponentLine[] = useMemo(() => {
    if (!initial?.items?.length) return [];
    return initial.items.map((it) => ({
      id: nextLineId(),
      equipment: (it.component ?? null) as EquipmentWithAsset | null,
      qty: it.included_qty,
      is_required: !!it.is_required,
    }));
  }, [initial]);

  const [mainItem, setMainItem] = useState<EquipmentWithAsset | null>(initialMain);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [packageCost, setPackageCost] = useState(initialMain ? String(initialMain.base_price ?? '') : '');
  const [lines, setLines] = useState<ComponentLine[]>(initialLines);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mainPickerOpen, setMainPickerOpen] = useState(false);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);

  const usedEquipmentIds = useMemo(() => {
    const ids = new Set<string>();
    if (mainItem) ids.add(mainItem.id);
    for (const line of lines) if (line.equipment) ids.add(line.equipment.id);
    return ids;
  }, [mainItem, lines]);

  const removeLine = (lineId: string) => setLines((prev) => prev.filter((l) => l.id !== lineId));
  const updateLine = (lineId: string, updates: Partial<ComponentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...updates } : l)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!mainItem) { setError('Select a main equipment item.'); return; }
    if (!name.trim()) { setError('Package name is required.'); return; }
    // Non-admins can't set price: send 0 (backend preserves the existing price).
    const costNum = isAdmin ? parseFloat(packageCost) : 0;
    if (isAdmin && (!packageCost || isNaN(costNum) || costNum < 0)) { setError('Enter a valid package cost.'); return; }
    const validComponents = lines.filter((l) => l.equipment !== null);
    if (validComponents.length === 0) { setError('Add at least one component.'); return; }

    setIsSubmitting(true);
    try {
      await onSubmit({
        main_item_id: mainItem.id,
        name: name.trim(),
        description: description.trim(),
        package_cost: isAdmin ? costNum : 0,
        components: validComponents.map((l) => ({ equipment_id: l.equipment!.id, qty: l.qty, is_required: l.is_required })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save package');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = 'w-full bg-surface-800 text-surface-100 placeholder:text-surface-500 border border-surface-700 rounded-lg h-9 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500';
  const labelClass = 'block text-xs font-medium text-surface-400 uppercase tracking-wider mb-1.5';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-danger-500/10 border border-danger-500/20 text-sm text-danger-400">{error}</div>
      )}

      <div>
        <label className={labelClass}>Main Equipment *</label>
        {mainItem ? (
          <div className="flex items-center gap-2 bg-surface-800 border border-surface-700 rounded-lg h-9 px-3">
            <span className="text-sm text-surface-200 truncate flex-1">{mainItem.display_name || mainItem.name}</span>
            <span className="text-xs text-surface-500">{mainItem.brand}</span>
            {isAdmin && <span className="text-xs font-semibold text-primary-400">{formatCurrency(mainItem.base_price)}</span>}
            <button type="button" onClick={() => setMainItem(null)} className="ml-1 p-0.5 rounded text-surface-500 hover:text-surface-300">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setMainPickerOpen(true)}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-sm border border-dashed border-surface-600 text-surface-400 hover:border-primary-500/50 hover:text-primary-400 hover:bg-primary-500/5 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Select Main Equipment
          </button>
        )}
        <p className="mt-1 text-xs text-surface-500">The primary item this package is built around.</p>
      </div>

      <div className={isAdmin ? 'grid grid-cols-[1fr_160px_1fr] gap-4' : 'grid grid-cols-2 gap-4'}>
        <div>
          <label className={labelClass}>Package Name *</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alexa Mini LF Package" required />
        </div>
        {isAdmin && (
          <div>
            <label className={labelClass}>Package Cost *</label>
            <input className={inputClass} type="number" min="0" step="0.01" value={packageCost} onChange={(e) => setPackageCost(e.target.value)} placeholder="0.00" required />
          </div>
        )}
        <div>
          <label className={labelClass}>Description</label>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description..." />
        </div>
      </div>

      {!isAdmin && (
        <p className="text-xs text-surface-500 -mt-2">Package pricing is set by an administrator.</p>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelClass + ' mb-0'}>Package Components *</label>
          <span className="text-xs text-surface-500">{lines.filter((l) => l.equipment).length} item{lines.filter((l) => l.equipment).length !== 1 ? 's' : ''}</span>
        </div>

        {lines.filter((l) => l.equipment).length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="grid grid-cols-[1fr_70px_80px_36px] gap-2 px-1">
              <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Equipment</span>
              <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider text-center">Qty</span>
              <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider text-center">Required</span>
              <span />
            </div>
            {lines.filter((l) => l.equipment).map((line) => (
              <div key={line.id} className="grid grid-cols-[1fr_70px_80px_36px] gap-2 items-center">
                <div className="flex items-center gap-2 bg-surface-800 border border-surface-700 rounded-lg h-9 px-3">
                  <span className="text-sm text-surface-200 truncate flex-1">{line.equipment!.display_name || line.equipment!.name}</span>
                  <span className="text-xs text-surface-500">{line.equipment!.brand}</span>
                </div>
                <input type="number" min={1} value={line.qty}
                  onChange={(e) => updateLine(line.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                  className={inputClass + ' text-center px-1'} />
                <button type="button" onClick={() => updateLine(line.id, { is_required: !line.is_required })}
                  className={'h-9 rounded-lg text-xs font-medium border transition-all duration-150 ' + (line.is_required
                    ? 'bg-primary-600/15 text-primary-400 border-primary-500/30'
                    : 'bg-surface-800 text-surface-400 border-surface-700 hover:text-surface-200')}>
                  {line.is_required ? 'Yes' : 'No'}
                </button>
                <button type="button" onClick={() => removeLine(line.id)}
                  className="h-9 w-9 rounded-lg flex items-center justify-center transition-colors text-surface-500 hover:text-danger-400 hover:bg-danger-500/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={() => setComponentPickerOpen(true)}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-sm border border-dashed border-surface-600 text-surface-400 hover:border-primary-500/50 hover:text-primary-400 hover:bg-primary-500/5 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add Components
        </button>
      </div>

      <div className="flex justify-end gap-3 pt-3 border-t border-surface-800/80">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
      </div>

      {mainPickerOpen && (
        <EquipmentPickerModal
          title="Select Main Equipment"
          multi={false}
          excludeIds={usedEquipmentIds}
          onConfirm={(items) => {
            const first = items[0];
            if (first) {
              setMainItem(first.equipment);
              if (!name) setName(first.equipment.display_name || first.equipment.name);
              if (isAdmin && !packageCost && (first.equipment.base_price ?? 0) > 0) setPackageCost(String(first.equipment.base_price));
            }
            setMainPickerOpen(false);
          }}
          onClose={() => setMainPickerOpen(false)}
        />
      )}
      {componentPickerOpen && (
        <EquipmentPickerModal
          title="Add Components"
          multi
          excludeIds={usedEquipmentIds}
          onConfirm={(items) => {
            setLines((prev) => [
              ...prev,
              ...items.map(({ equipment, qty }) => ({ id: nextLineId(), equipment, qty, is_required: true })),
            ]);
            setComponentPickerOpen(false);
          }}
          onClose={() => setComponentPickerOpen(false)}
        />
      )}
    </form>
  );
}

// ── Equipment Picker ──
// Sources the department-scoped equipment list from the equipment store (the
// backend already filters to the caller's department), so managers can only pick
// items from their own department.

function EquipmentPickerModal({ title, multi, excludeIds, onConfirm, onClose }: {
  title: string;
  multi: boolean;
  excludeIds: Set<string>;
  onConfirm: (items: { equipment: EquipmentWithAsset; qty: number }[]) => void;
  onClose: () => void;
}) {
  const { items, fetchAll, fetchCategories } = useEquipmentStore();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => { fetchAll(); fetchCategories(); }, [fetchAll, fetchCategories]);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => !excludeIds.has(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.display_name || '').toLowerCase().includes(q)
        || (i.equipment_code || '').toLowerCase().includes(q) || (i.brand || '').toLowerCase().includes(q));
  }, [items, excludeIds, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (!multi) return { [id]: 1 };
      return { ...prev, [id]: 1 };
    });
  };

  const setQty = (id: string, qty: number) => setSelected((prev) => ({ ...prev, [id]: Math.max(1, qty) }));

  const confirm = () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const chosen = Object.entries(selected)
      .map(([id, qty]) => ({ equipment: byId.get(id)!, qty }))
      .filter((x) => x.equipment);
    onConfirm(chosen);
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search equipment..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500" />
        </div>

        <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
          {available.length === 0 ? (
            <p className="text-sm text-surface-500 text-center py-8">No equipment found.</p>
          ) : available.map((item) => {
            const isSel = item.id in selected;
            return (
              <div key={item.id}
                className={'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer ' + (isSel
                  ? 'border-primary-500/40 bg-primary-500/10'
                  : 'border-surface-700 hover:bg-surface-800/60')}
                onClick={() => toggle(item.id)}>
                <div className={'h-4 w-4 rounded border flex items-center justify-center shrink-0 ' + (isSel ? 'bg-primary-500 border-primary-500' : 'border-surface-600')}>
                  {isSel && <div className="h-2 w-2 rounded-sm bg-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-surface-100 truncate">{item.display_name || item.name}</p>
                  <p className="text-xs text-surface-500 truncate">{[item.equipment_code, item.brand, item.model].filter(Boolean).join(' · ')}</p>
                </div>
                {multi && isSel && (
                  <input type="number" min={1} value={selected[item.id]} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setQty(item.id, parseInt(e.target.value) || 1)}
                    className="w-16 text-center bg-surface-900 border border-surface-700 rounded-md h-8 text-sm text-surface-100" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-surface-800/60">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={confirm} disabled={Object.keys(selected).length === 0}>
            {multi ? `Add ${Object.keys(selected).length || ''} Item${Object.keys(selected).length === 1 ? '' : 's'}`.trim() : 'Select'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
