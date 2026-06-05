import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useEquipmentStore } from '../stores/equipment.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { useToast, useDepartmentFilter } from '../hooks';
import { Search, X, Plus, Trash2, FileText, Wrench, RefreshCw } from 'lucide-react';
import type { EquipmentWithAsset } from '../../shared/types';

interface ActionRow {
  key: number;
  action_date: string;
  action_taken: string;
  remarks: string;
  personnel: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

let rowKeySeq = 0;

const inputClass =
  'w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500';

const labelClass = 'block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1';

export function MaintenanceNewPage() {
  const { create, addAction } = useMaintenanceStore();
  const { items: allItems, fetchAll } = useEquipmentStore();
  const { isEquipmentInDepartment } = useDepartmentFilter();
  const items = useMemo(() => allItems.filter((i) => isEquipmentInDepartment(i.category_id)), [allItems, isEquipmentInDepartment]);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const toast = useToast();

  const [documentType, setDocumentType] = useState<'maintenance' | 'repair' | 'update'>('repair');
  const [projectName, setProjectName] = useState('');
  const [productionName, setProductionName] = useState('');
  const [projectDate, setProjectDate] = useState('');
  const [reportedBy, setReportedBy] = useState(user?.full_name || '');
  const [verifiedBy, setVerifiedBy] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [maintenanceType, setMaintenanceType] = useState('repair');
  const [issueDescription, setIssueDescription] = useState('');
  const [actionRows, setActionRows] = useState<ActionRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentWithAsset | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setEquipmentOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredEquipment = useMemo(() => {
    if (!equipmentSearch.trim()) return [];
    const q = equipmentSearch.toLowerCase();
    return items
      .filter(
        (eq) =>
          eq.name.toLowerCase().includes(q) ||
          eq.equipment_code.toLowerCase().includes(q) ||
          eq.brand.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [equipmentSearch, items]);

  const selectEquipment = (eq: EquipmentWithAsset) => {
    setSelectedEquipment(eq);
    setEquipmentId(eq.id);
    setEquipmentSearch('');
    setEquipmentOpen(false);
  };

  const clearEquipment = () => {
    setSelectedEquipment(null);
    setEquipmentId('');
    setEquipmentSearch('');
  };

  const addRow = () => {
    setActionRows((prev) => [
      ...prev,
      { key: ++rowKeySeq, action_date: todayISO(), action_taken: '', remarks: '', personnel: '' },
    ]);
  };

  const updateRow = (key: number, field: keyof ActionRow, value: string) => {
    setActionRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const removeRow = (key: number) => {
    setActionRows((prev) => prev.filter((r) => r.key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipmentId) {
      toast.error('Please select equipment');
      return;
    }
    if (!issueDescription.trim()) {
      toast.error('Please describe the issue');
      return;
    }

    setSaving(true);
    try {
      const ticket = await create({
        equipment_id: equipmentId,
        issue_description: issueDescription,
        maintenance_type: maintenanceType,
        reported_by: reportedBy,
        project_name: projectName,
        production_name: productionName,
        project_date: projectDate || null,
        verified_by: verifiedBy,
        document_type: documentType,
      });

      for (const row of actionRows) {
        if (row.action_taken.trim()) {
          await addAction({
            ticket_id: ticket.id,
            action_date: row.action_date,
            action_taken: row.action_taken,
            remarks: row.remarks,
            personnel: row.personnel,
          });
        }
      }

      toast.success('Incident report created');
      navigate('/maintenance');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create report');
    }
    setSaving(false);
  };

  return (
    <div className="min-h-full bg-surface-950 flex justify-center py-8 px-4">
      <form onSubmit={handleSubmit} className="max-w-4xl w-full">
        <div className="bg-[#faf8f0] rounded-lg shadow-2xl text-gray-900 overflow-hidden">
          {/* Document Header */}
          <div className="bg-[#f0ead6] border-b border-gray-300 px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-gray-800 tracking-wide">
                  INCIDENT / MAINTENANCE REPORT
                </h1>
                <p className="text-xs text-gray-500 mt-1">
                  CMB Equipment Information Management System
                </p>
              </div>
              <div className="flex gap-1 rounded-lg overflow-hidden border border-gray-300">
                <button
                  type="button"
                  onClick={() => setDocumentType('repair')}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
                    documentType === 'repair'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Wrench size={14} />
                  Repair
                </button>
                <button
                  type="button"
                  onClick={() => setDocumentType('maintenance')}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
                    documentType === 'maintenance'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <FileText size={14} />
                  Maintenance
                </button>
                <button
                  type="button"
                  onClick={() => setDocumentType('update')}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
                    documentType === 'update'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <RefreshCw size={14} />
                  Update
                </button>
              </div>
            </div>
          </div>

          {/* Project Details Section */}
          <div className="px-8 py-5 border-b border-gray-200">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
              Project Details
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <label className={labelClass}>Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className={inputClass}
                  placeholder="Enter project name"
                />
              </div>
              <div>
                <label className={labelClass}>Production Name</label>
                <input
                  type="text"
                  value={productionName}
                  onChange={(e) => setProductionName(e.target.value)}
                  className={inputClass}
                  placeholder="Enter production name"
                />
              </div>
              <div>
                <label className={labelClass}>Project Date</label>
                <input
                  type="date"
                  value={projectDate}
                  onChange={(e) => setProjectDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Date Reported</label>
                <input
                  type="date"
                  value={todayISO()}
                  readOnly
                  className={`${inputClass} bg-gray-100 cursor-not-allowed`}
                />
              </div>
            </div>
          </div>

          {/* Personnel Section */}
          <div className="px-8 py-5 border-b border-gray-200">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
              Personnel
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <label className={labelClass}>Reported By</label>
                <input
                  type="text"
                  value={reportedBy}
                  onChange={(e) => setReportedBy(e.target.value)}
                  className={inputClass}
                  placeholder="Name of reporter"
                />
              </div>
              <div>
                <label className={labelClass}>Verified By</label>
                <input
                  type="text"
                  value={verifiedBy}
                  onChange={(e) => setVerifiedBy(e.target.value)}
                  className={inputClass}
                  placeholder="Name of verifier"
                />
              </div>
            </div>
          </div>

          {/* Equipment & Classification Section */}
          <div className="px-8 py-5 border-b border-gray-200">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
              Equipment &amp; Classification
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div className="col-span-2" ref={comboRef}>
                <label className={labelClass}>Equipment *</label>
                {selectedEquipment ? (
                  <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-300 rounded text-sm">
                    <span>
                      <span className="font-semibold">{selectedEquipment.equipment_code}</span>
                      {' — '}
                      {selectedEquipment.name}
                      <span className="text-gray-500 ml-2">({selectedEquipment.brand})</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearEquipment}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        type="text"
                        value={equipmentSearch}
                        onChange={(e) => {
                          setEquipmentSearch(e.target.value);
                          setEquipmentOpen(true);
                        }}
                        onFocus={() => equipmentSearch.trim() && setEquipmentOpen(true)}
                        className={`${inputClass} pl-9`}
                        placeholder="Search by name, code, or brand..."
                      />
                    </div>
                    {equipmentOpen && filteredEquipment.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredEquipment.map((eq) => (
                          <button
                            key={eq.id}
                            type="button"
                            onClick={() => selectEquipment(eq)}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-50 transition-colors border-b border-gray-100 last:border-0"
                          >
                            <span className="font-medium text-gray-800">
                              {eq.equipment_code}
                            </span>
                            <span className="text-gray-600"> — {eq.name}</span>
                            <span className="text-gray-400 text-xs ml-2">{eq.brand}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {equipmentOpen && equipmentSearch.trim() && filteredEquipment.length === 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-500">
                        No equipment found
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className={labelClass}>Maintenance Type</label>
                <select
                  value={maintenanceType}
                  onChange={(e) => setMaintenanceType(e.target.value)}
                  className={inputClass}
                >
                  <option value="routine_maintenance">Routine Maintenance</option>
                  <option value="update">Update</option>
                  <option value="repair">Repair</option>
                </select>
              </div>
            </div>
          </div>

          {/* Issue Description Section */}
          <div className="px-8 py-5 border-b border-gray-200">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
              Issue / Description *
            </h2>
            <textarea
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              rows={5}
              className={`${inputClass} resize-y`}
              placeholder="Describe the issue or maintenance requirement in detail..."
            />
          </div>

          {/* Action Log Section */}
          <div className="px-8 py-5 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                Action Log
              </h2>
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 transition-colors"
              >
                <Plus size={14} />
                Add Row
              </button>
            </div>
            <div className="border border-gray-300 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f0ead6] text-gray-600">
                    <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide w-[130px]">
                      Date
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide">
                      Action Taken
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide">
                      Remarks
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide w-[150px]">
                      Personnel
                    </th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {actionRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">
                        No action entries yet — click "Add Row" to begin.
                      </td>
                    </tr>
                  )}
                  {actionRows.map((row) => (
                    <tr key={row.key} className="border-t border-gray-200 bg-white">
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={row.action_date}
                          onChange={(e) => updateRow(row.key, 'action_date', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={row.action_taken}
                          onChange={(e) => updateRow(row.key, 'action_taken', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="Describe action..."
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={row.remarks}
                          onChange={(e) => updateRow(row.key, 'remarks', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="Remarks..."
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={row.personnel}
                          onChange={(e) => updateRow(row.key, 'personnel', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="Name..."
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer / Submit Bar */}
          <div className="bg-[#f0ead6] border-t border-gray-300 px-8 py-4 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              All fields marked with * are required.
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/maintenance')}
                className="!bg-white !text-gray-700 border border-gray-300 hover:!bg-gray-50"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={saving}
                className="!bg-amber-600 hover:!bg-amber-700 !text-white"
              >
                Submit Report
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
