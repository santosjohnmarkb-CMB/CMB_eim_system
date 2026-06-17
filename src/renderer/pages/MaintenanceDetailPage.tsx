import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Printer,
  Pencil,
} from 'lucide-react';
import { useMaintenanceStore } from '../stores/maintenance.store';
import { useAuthStore } from '../stores/auth.store';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { REPAIR_STATUS_CONFIG, COMPLETION_OUTCOME_CONFIG, DOCUMENT_TYPE_CONFIG } from '../lib/constants';
import { printHtml, escapeHtml } from '../lib/print';
import { useToast } from '../hooks';
import type { MaintenanceTicket, MaintenanceNote, TicketAction, CompletionOutcome } from '../../shared/types';

const OUTCOME_OPTIONS: Record<'repair' | 'loss', CompletionOutcome[]> = {
  repair: ['repaired', 'unrepairable', 'total_loss'],
  loss: ['found', 'not_found'],
};

const PIPELINE = ['REPORTED', 'ASSESSED', 'IN_PROGRESS', 'COMPLETED'] as const;

const MAINTENANCE_TYPE_OPTIONS = ['routine_maintenance', 'update', 'repair'] as const;

const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  routine_maintenance: 'Routine Maintenance',
  update: 'Update',
  repair: 'Repair',
  corrective: 'Corrective',
  preventive: 'Preventive',
  predictive: 'Predictive',
};

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateInput(d: string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const iso = date.toISOString().split('T')[0];
  return iso ?? '';
}

function InlineField({
  label,
  value,
  field,
  type = 'text',
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  field: string;
  type?: 'text' | 'date';
  onSave: (field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(type === 'date' ? formatDateInput(value) : (value || ''));
    setEditing(true);
  };

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const newVal = draft.trim();
    const oldVal = type === 'date' ? formatDateInput(value) : (value || '');
    if (newVal !== oldVal) onSave(field, newVal);
  };

  const display = type === 'date' ? formatDate(value) : (value || '—');

  return (
    <div className="py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-amber-800/60 font-semibold mb-0.5">
        {label}
      </dt>
      <dd>
        {editing ? (
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-full px-2 py-1 text-sm border border-amber-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 text-gray-900"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="group w-full text-left px-2 py-1 -mx-2 text-sm text-gray-800 rounded hover:bg-amber-50 transition-colors cursor-text flex items-center gap-1"
          >
            <span className="flex-1">{display}</span>
            <Pencil size={12} className="opacity-0 group-hover:opacity-40 text-amber-700 flex-shrink-0 transition-opacity" />
          </button>
        )}
      </dd>
    </div>
  );
}

function InlineTextarea({
  value,
  field,
  onSave,
}: {
  value: string | null | undefined;
  field: string;
  onSave: (field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setDraft(value || '');
    setEditing(true);
  };

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (value || '')) onSave(field, draft.trim());
  };

  return editing ? (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
      className="w-full px-3 py-2 text-sm border border-amber-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 text-gray-900 resize-none min-h-[60px]"
    />
  ) : (
    <button
      type="button"
      onClick={startEdit}
      className="group w-full text-left px-3 py-2 text-sm text-gray-800 rounded hover:bg-amber-50 transition-colors cursor-text"
    >
      <span className="whitespace-pre-wrap">{value || '—'}</span>
      <Pencil size={12} className="inline-block ml-2 opacity-0 group-hover:opacity-40 text-amber-700 transition-opacity" />
    </button>
  );
}

interface ActionRow extends Partial<TicketAction> {
  _isNew?: boolean;
  _dirty?: boolean;
}

export function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const {
    getById, updateStatus, update, addNote, getNotes, getActions, addAction, updateAction, deleteAction, deleteTicket,
  } = useMaintenanceStore();

  const [ticket, setTicket] = useState<MaintenanceTicket | null>(null);
  const [notes, setNotes] = useState<MaintenanceNote[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [noteText, setNoteText] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionForm, setActionForm] = useState({ action_date: '', action_taken: '', remarks: '', personnel: '' });
  const [savingAction, setSavingAction] = useState(false);
  const cellRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [t, n, a] = await Promise.all([getById(id), getNotes(id), getActions(id)]);
    setTicket(t);
    setNotes(n);
    setActions(a);
  }, [id, getById, getNotes, getActions]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (editingCell && cellRef.current) cellRef.current.focus();
  }, [editingCell]);

  if (!ticket) return <LoadingSpinner size="lg" className="py-24" />;

  const currentIdx = PIPELINE.indexOf(ticket.repair_status as (typeof PIPELINE)[number]);
  const canAdvance = currentIdx >= 0 && currentIdx < PIPELINE.length - 1;
  const nextStatus = canAdvance ? PIPELINE[currentIdx + 1] : null;
  const isLoss = ticket.document_type === 'loss';
  const docTypeLabel = DOCUMENT_TYPE_CONFIG[ticket.document_type]?.reportTitle ?? 'Repair Report';
  const outcomeChoices = OUTCOME_OPTIONS[isLoss ? 'loss' : 'repair'];
  const outcomeCfg = ticket.completion_outcome ? COMPLETION_OUTCOME_CONFIG[ticket.completion_outcome] : null;

  const handleAdvance = async () => {
    if (!nextStatus) return;
    // Completing a ticket requires an explicit outcome.
    if (nextStatus === 'COMPLETED') {
      setShowOutcomeModal(true);
      return;
    }
    try {
      await updateStatus(ticket.id, nextStatus);
      toast.success(`Status → ${REPAIR_STATUS_CONFIG[nextStatus]?.label}`);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleComplete = async (outcome: CompletionOutcome) => {
    try {
      await updateStatus(ticket.id, 'COMPLETED', outcome);
      setShowOutcomeModal(false);
      toast.success(`Completed — ${COMPLETION_OUTCOME_CONFIG[outcome].label}`);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleFieldSave = async (field: string, value: string) => {
    try {
      await update(ticket.id, { [field]: value });
      setTicket((prev) => prev ? { ...prev, [field]: value } : prev);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteTicket = async () => {
    try {
      await deleteTicket(ticket.id);
      toast.success('Ticket deleted');
      navigate('/maintenance');
    } catch (err: any) { toast.error(err.message); }
  };

  // Build a formal company-letterhead document (via the shared print template) rather
  // than screen-printing the live DOM.
  const handlePrint = () => {
    if (!ticket) return;
    const statusLabel = REPAIR_STATUS_CONFIG[ticket.repair_status]?.label ?? ticket.repair_status;
    const outcomeLabel = ticket.completion_outcome
      ? (COMPLETION_OUTCOME_CONFIG[ticket.completion_outcome]?.label ?? ticket.completion_outcome)
      : null;
    const mtLabel = MAINTENANCE_TYPE_LABELS[ticket.maintenance_type] || ticket.maintenance_type;

    const field = (label: string, value: string | null | undefined) =>
      `<div class="field"><label>${escapeHtml(label)}</label><span>${escapeHtml(value || '—')}</span></div>`;

    const printableActions = actions.filter((a) => !(a._isNew && !a.action_taken));
    const actionRows = printableActions.map((a, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(formatDate(a.action_date))}</td>
        <td>${escapeHtml(a.action_taken || '—')}</td>
        <td>${escapeHtml(a.remarks || '—')}</td>
        <td>${escapeHtml(a.personnel || '—')}</td>
      </tr>`).join('');

    const signBlock = (label: string, name: string) => `
      <div style="flex:1; text-align:center;">
        <div style="min-height:18px; margin-bottom:4px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1a1f2b;">${escapeHtml(name || '')}</div>
        <div style="border-top:1px solid #1a1f2b; padding-top:5px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280;">${escapeHtml(label)}</div>
      </div>`;

    const body = `
      <div class="header">
        <h1>${escapeHtml(docTypeLabel)} — ${escapeHtml(ticket.ticket_number)}</h1>
        <p class="muted">Status: ${escapeHtml(statusLabel)}${outcomeLabel ? ` · Outcome: ${escapeHtml(outcomeLabel)}` : ''}</p>
      </div>

      <h2>Equipment</h2>
      <div class="grid">
        ${field('Equipment Name', ticket.equipment_name)}
        ${field('Equipment Code', ticket.equipment_code)}
        ${field('Maintenance Type', mtLabel)}
        ${field('Document Type', docTypeLabel)}
      </div>

      <h2>Project & Reporting Information</h2>
      <div class="grid">
        ${field('Project Name', ticket.project_name)}
        ${field('Production Name', ticket.production_name)}
        ${field('Project Date', formatDate(ticket.project_date))}
        ${field('Date Reported', formatDate(ticket.reported_date))}
        ${field('Reported By', ticket.reported_by)}
        ${field('Verified By', ticket.verified_by)}
      </div>

      <h2>Issue Description</h2>
      <p>${escapeHtml(ticket.issue_description || '—')}</p>
      ${ticket.diagnosis ? `<h2>Diagnosis</h2><p>${escapeHtml(ticket.diagnosis)}</p>` : ''}

      <h2>Action Log</h2>
      <table>
        <thead><tr><th style="width:32px;">#</th><th style="width:96px;">Date</th><th>Action Taken</th><th>Remarks</th><th style="width:120px;">Personnel</th></tr></thead>
        <tbody>${actionRows || '<tr><td colspan="5">No actions recorded yet</td></tr>'}</tbody>
      </table>

      <div style="margin-top:44px; display:flex; gap:48px;">
        ${signBlock('Reported By', ticket.reported_by || '')}
        ${signBlock('Verified By', ticket.verified_by || '')}
        ${signBlock('Approved By', '')}
      </div>`;

    printHtml(`${docTypeLabel} ${ticket.ticket_number}`, body);
  };

  const handleSelectChange = async (field: string, value: string) => {
    try {
      await update(ticket.id, { [field]: value });
      setTicket((prev) => prev ? { ...prev, [field]: value } : prev);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await addNote({
        ticket_id: ticket.id,
        note_text: noteText,
        note_type: 'update',
        author: user?.full_name || 'System',
      });
      setNoteText('');
      const n = await getNotes(ticket.id);
      setNotes(n);
    } catch (err: any) { toast.error(err.message); }
  };

  const openAddActionModal = () => {
    setActionForm({
      action_date: new Date().toISOString().split('T')[0] ?? '',
      action_taken: '',
      remarks: '',
      personnel: user?.full_name || '',
    });
    setShowActionModal(true);
  };

  const handleSaveNewAction = async () => {
    if (!actionForm.action_taken.trim()) { toast.error('Action taken is required'); return; }
    setSavingAction(true);
    try {
      await addAction({
        ticket_id: ticket.id,
        action_date: actionForm.action_date,
        action_taken: actionForm.action_taken,
        remarks: actionForm.remarks,
        personnel: actionForm.personnel,
      });
      const a = await getActions(ticket.id);
      setActions(a);
      setShowActionModal(false);
      toast.success('Action log entry added');
    } catch (err: any) {
      toast.error(err.message);
    }
    setSavingAction(false);
  };

  const commitActionCell = async (rowIdx: number, col: string, value: string) => {
    const row = actions[rowIdx];
    if (!row) return;

    const updated = { ...row, [col]: value, _dirty: true };
    setActions((prev) => prev.map((r, i) => (i === rowIdx ? updated : r)));
    setEditingCell(null);

    try {
      if (row._isNew) {
        if (!updated.action_taken?.trim()) return;
        const saved = await addAction({
          ticket_id: ticket.id,
          action_date: updated.action_date,
          action_taken: updated.action_taken,
          remarks: updated.remarks || '',
          personnel: updated.personnel || '',
        });
        setActions((prev) =>
          prev.map((r, i) => (i === rowIdx ? { ...saved, _isNew: false, _dirty: false } : r)),
        );
      } else {
        await updateAction(row.id!, {
          action_date: updated.action_date,
          action_taken: updated.action_taken,
          remarks: updated.remarks,
          personnel: updated.personnel,
        });
      }
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteAction = async (rowIdx: number) => {
    const row = actions[rowIdx];
    if (!row) return;
    if (row._isNew) {
      setActions((prev) => prev.filter((_, i) => i !== rowIdx));
      return;
    }
    try {
      await deleteAction(row.id!);
      setActions((prev) => prev.filter((_, i) => i !== rowIdx));
    } catch (err: any) { toast.error(err.message); }
  };

  const renderActionCell = (rowIdx: number, col: string, value: string | undefined, wide?: boolean) => {
    const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.col === col;
    if (isEditing) {
      return wide ? (
        <textarea
          ref={cellRef as React.RefObject<HTMLTextAreaElement>}
          defaultValue={value || ''}
          onBlur={(e) => commitActionCell(rowIdx, col, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitActionCell(rowIdx, col, (e.target as HTMLTextAreaElement).value); }
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          rows={2}
        />
      ) : (
        <input
          ref={cellRef as React.RefObject<HTMLInputElement>}
          type={col === 'action_date' ? 'date' : 'text'}
          defaultValue={col === 'action_date' ? formatDateInput(value) : (value || '')}
          onBlur={(e) => commitActionCell(rowIdx, col, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitActionCell(rowIdx, col, (e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => setEditingCell({ rowIdx, col })}
        className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-amber-50 rounded cursor-text transition-colors min-h-[28px]"
      >
        {col === 'action_date' ? formatDate(value) : (value || '\u00A0')}
      </button>
    );
  };

  return (
    <div className="min-h-full bg-surface-950 flex flex-col items-center py-8 px-4">
      {/* Back nav */}
      <div className="max-w-4xl w-full mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/maintenance')}>
          <ArrowLeft size={16} /> Back to Queue
        </Button>
        <div className="flex-1" />
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="print:hidden text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <Trash2 size={14} /> Delete
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrint}
          className="print:hidden"
        >
          <Printer size={14} /> Print
        </Button>
      </div>

      {/* Paper */}
      <div className="max-w-4xl w-full bg-[#faf8f0] rounded-lg shadow-2xl text-gray-900 print:shadow-none print:rounded-none">

        {/* ── 1. Header ── */}
        <div className="px-8 pt-6 pb-4 border-b border-amber-200">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">
                {docTypeLabel}
              </p>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                {ticket.ticket_number}
              </h1>
            </div>
            {ticket.repair_status === 'COMPLETED' && outcomeCfg && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.15em] text-amber-700/70 font-bold mb-1">Outcome</p>
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                  outcomeCfg.writeOff ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {outcomeCfg.label}
                </span>
              </div>
            )}
          </div>

          {/* Status pipeline */}
          <div className="flex items-center gap-0 mt-2">
            {PIPELINE.map((status, i) => {
              const config = REPAIR_STATUS_CONFIG[status];
              const isPast = i < currentIdx;
              const isCurrent = i === currentIdx;
              const isFuture = i > currentIdx;
              const pipelineColors: Record<string, { bg: string; border: string; ring: string; text: string }> = {
                REPORTED:    { bg: 'bg-red-500',    border: 'border-red-500',    ring: 'ring-red-200',    text: 'text-red-700' },
                ASSESSED:    { bg: 'bg-purple-500', border: 'border-purple-500', ring: 'ring-purple-200', text: 'text-purple-700' },
                IN_PROGRESS: { bg: 'bg-blue-500',   border: 'border-blue-500',   ring: 'ring-blue-200',   text: 'text-blue-700' },
                COMPLETED:   { bg: 'bg-green-500',  border: 'border-green-500',  ring: 'ring-green-200',  text: 'text-green-700' },
              };
              const pc = pipelineColors[status] || { bg: 'bg-gray-400', border: 'border-gray-400', ring: 'ring-gray-200', text: 'text-gray-600' };
              return (
                <div key={status} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`
                        w-3 h-3 rounded-full border-2 transition-all
                        ${isPast ? `${pc.bg} ${pc.border}` : ''}
                        ${isCurrent ? `${pc.bg} ${pc.border} ring-4 ${pc.ring}` : ''}
                        ${isFuture ? 'bg-transparent border-gray-400' : ''}
                      `}
                    />
                    <span className={`text-[9px] mt-1 whitespace-nowrap ${isCurrent ? `font-bold ${pc.text}` : isPast ? 'text-gray-500' : 'text-gray-400'}`}>
                      {config?.label}
                    </span>
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 mt-[-12px] ${i < currentIdx ? pc.bg : 'bg-gray-300'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 2. Project & Reporting Fields ── */}
        <div className="px-8 py-5 border-b border-amber-200">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-amber-800/70 font-bold mb-3">
            Project & Reporting Information
          </h2>
          <div className="grid grid-cols-3 gap-x-6 gap-y-1">
            <InlineField label="Project Name" value={ticket.project_name} field="project_name" onSave={handleFieldSave} />
            <InlineField label="Production Name" value={ticket.production_name} field="production_name" onSave={handleFieldSave} />
            <InlineField label="Project Date" value={ticket.project_date} field="project_date" type="date" onSave={handleFieldSave} />
            <InlineField label="Date Reported" value={ticket.reported_date} field="reported_date" type="date" onSave={handleFieldSave} />
            <InlineField label="Reported By" value={ticket.reported_by} field="reported_by" onSave={handleFieldSave} />
            <InlineField label="Verified By" value={ticket.verified_by} field="verified_by" onSave={handleFieldSave} />
          </div>
        </div>

        {/* ── 3. Equipment Info ── */}
        <div className="px-8 py-4 border-b border-amber-200 bg-amber-50/40">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-amber-800/70 font-bold mb-2">
            Equipment
          </h2>
          <div className="flex items-baseline gap-6">
            <div>
              <span className="text-xs text-amber-800/50 mr-1">Name:</span>
              <span className="text-sm font-medium text-gray-900">{ticket.equipment_name || '—'}</span>
            </div>
            <div>
              <span className="text-xs text-amber-800/50 mr-1">Code:</span>
              <span className="text-sm font-mono font-medium text-gray-700">{ticket.equipment_code || '—'}</span>
            </div>
          </div>
        </div>

        {/* ── 4. Maintenance Type ── */}
        <div className="px-8 py-4 border-b border-amber-200">
          <label className="text-[10px] uppercase tracking-[0.15em] text-amber-800/60 font-semibold block mb-1.5">
            Maintenance Type
          </label>
          <span className="px-3 py-1.5 text-sm font-medium text-gray-800">
            {MAINTENANCE_TYPE_LABELS[ticket.maintenance_type] || ticket.maintenance_type}
          </span>
        </div>

        {/* ── 5. Issue / Description ── */}
        <div className="px-8 py-5 border-b border-amber-200">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-amber-800/70 font-bold mb-2">
            Issue Description
          </h2>
          <InlineTextarea value={ticket.issue_description} field="issue_description" onSave={handleFieldSave} />

          {ticket.diagnosis && (
            <div className="mt-4">
              <h2 className="text-[10px] uppercase tracking-[0.15em] text-amber-800/70 font-bold mb-2">
                Diagnosis
              </h2>
              <InlineTextarea value={ticket.diagnosis} field="diagnosis" onSave={handleFieldSave} />
            </div>
          )}
        </div>

        {/* ── 6. Action Log Table ── */}
        <div className="px-8 py-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] uppercase tracking-[0.15em] text-amber-800/70 font-bold">
              Action Log
            </h2>
            <button
              type="button"
              onClick={openAddActionModal}
              className="print:hidden flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium transition-colors"
            >
              <Plus size={14} /> Add Entry
            </button>
          </div>
          <div className="border border-amber-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-100/70">
                  <th className="text-left text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold px-3 py-2 w-28">
                    Date
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold px-3 py-2">
                    Action Taken
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold px-3 py-2">
                    Remarks
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-amber-800/70 font-semibold px-3 py-2 w-32">
                    Personnel
                  </th>
                  <th className="w-10 print:hidden" />
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400 italic">
                      No actions recorded yet
                    </td>
                  </tr>
                )}
                {actions.map((row, idx) => (
                  <tr key={row.id || idx} className="border-t border-amber-100 hover:bg-amber-50/50 transition-colors">
                    <td className="px-1 py-0.5 align-top">{renderActionCell(idx, 'action_date', row.action_date)}</td>
                    <td className="px-1 py-0.5 align-top">{renderActionCell(idx, 'action_taken', row.action_taken, true)}</td>
                    <td className="px-1 py-0.5 align-top">{renderActionCell(idx, 'remarks', row.remarks, true)}</td>
                    <td className="px-1 py-0.5 align-top">{renderActionCell(idx, 'personnel', row.personnel)}</td>
                    <td className="px-1 py-0.5 align-top print:hidden">
                      <button
                        type="button"
                        onClick={() => handleDeleteAction(idx)}
                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded hover:bg-red-50"
                        title="Delete row"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Status Advancement Control ── */}
          <div className="mt-4 pt-4 border-t border-amber-200 print:hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {PIPELINE.map((status, i) => {
                  const isPast = i < currentIdx;
                  const isCurrent = i === currentIdx;
                  const statusStyles: Record<string, { dot: string; ring: string; text: string }> = {
                    REPORTED:    { dot: 'bg-red-500',    ring: 'ring-red-200',    text: 'text-red-700' },
                    ASSESSED:    { dot: 'bg-purple-500', ring: 'ring-purple-200', text: 'text-purple-700' },
                    IN_PROGRESS: { dot: 'bg-blue-500',   ring: 'ring-blue-200',   text: 'text-blue-700' },
                    COMPLETED:   { dot: 'bg-green-500',  ring: 'ring-green-200',  text: 'text-green-700' },
                  };
                  const style = statusStyles[status] || { dot: 'bg-gray-400', ring: 'ring-gray-200', text: 'text-gray-600' };
                  const label = REPAIR_STATUS_CONFIG[status]?.label ?? status;
                  return (
                    <div key={status} className="flex items-center gap-1">
                      <div className={`w-2.5 h-2.5 rounded-full ${(isPast || isCurrent) ? style.dot : 'bg-gray-300'} ${isCurrent ? `ring-2 ${style.ring}` : ''}`} />
                      <span className={`text-[10px] font-medium ${isCurrent ? `${style.text} font-bold` : isPast ? 'text-gray-600' : 'text-gray-400'}`}>
                        {label}
                      </span>
                      {i < PIPELINE.length - 1 && (
                        <ChevronRight size={10} className={`${isPast ? 'text-gray-500' : 'text-gray-300'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!canAdvance}
                onClick={handleAdvance}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  canAdvance
                    ? 'text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 cursor-pointer'
                    : 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
                }`}
              >
                Advance Current Status <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 7. Notes Section (dark, below paper) ── */}
      <div className="max-w-4xl w-full mt-4 print:hidden">
        <button
          type="button"
          onClick={() => setNotesOpen((p) => !p)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-surface-800 hover:bg-surface-750 rounded-t-lg transition-colors text-surface-300"
        >
          <MessageSquare size={16} />
          <span className="text-sm font-medium">Notes & Updates</span>
          {notes.length > 0 && (
            <span className="text-[10px] font-semibold bg-surface-700 text-surface-300 px-2 py-0.5 rounded-full">
              {notes.length}
            </span>
          )}
          <div className="flex-1" />
          {notesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {notesOpen && (
          <div className="bg-surface-900 rounded-b-lg border-t border-surface-700 overflow-hidden">
            <div className="max-h-72 overflow-y-auto p-4 space-y-3">
              {notes.length === 0 ? (
                <p className="text-sm text-surface-500 text-center py-4">No notes yet</p>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-surface-700 flex items-center justify-center text-[10px] font-bold text-surface-300 flex-shrink-0 mt-0.5">
                      {note.author?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-surface-200">{note.author}</span>
                        <span className="text-[10px] text-surface-500">
                          {new Date(note.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-surface-300 mt-0.5 whitespace-pre-wrap">{note.note_text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-surface-700 px-4 py-3 flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note..."
                className="flex-1 px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleAddNote(); }}
              />
              <Button size="sm" onClick={handleAddNote}>
                <Send size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Action Log Entry Modal ── */}
      {showActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden">
          <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-semibold text-surface-100 mb-1">Add Action Log Entry</h3>
            <p className="text-sm text-surface-400 mb-5">Record an action taken on this ticket.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={actionForm.action_date}
                    onChange={(e) => setActionForm((p) => ({ ...p, action_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">Personnel</label>
                  <input
                    type="text"
                    value={actionForm.personnel}
                    onChange={(e) => setActionForm((p) => ({ ...p, personnel: e.target.value }))}
                    placeholder="Name"
                    className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Action Taken *</label>
                <textarea
                  value={actionForm.action_taken}
                  onChange={(e) => setActionForm((p) => ({ ...p, action_taken: e.target.value }))}
                  rows={3}
                  autoFocus
                  placeholder="Describe the action performed..."
                  className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Remarks</label>
                <textarea
                  value={actionForm.remarks}
                  onChange={(e) => setActionForm((p) => ({ ...p, remarks: e.target.value }))}
                  rows={2}
                  placeholder="Additional remarks (optional)"
                  className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 resize-y"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" size="sm" onClick={() => setShowActionModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveNewAction} loading={savingAction}>
                <Plus size={14} /> Add Entry
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Completion Outcome Modal ── */}
      {showOutcomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden">
          <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-surface-100 mb-1">
              {isLoss ? 'Resolve Loss Ticket' : 'Complete Ticket'}
            </h3>
            <p className="text-sm text-surface-400 mb-5">
              {isLoss
                ? 'Select the result of the search effort for this equipment.'
                : 'Select the result of this repair. This determines whether the equipment returns to inventory.'}
            </p>
            <div className="space-y-2.5">
              {outcomeChoices.map((outcome) => {
                const cfg = COMPLETION_OUTCOME_CONFIG[outcome];
                return (
                  <button
                    key={outcome}
                    onClick={() => handleComplete(outcome)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      cfg.writeOff
                        ? 'border-danger-500/30 hover:bg-danger-500/10'
                        : 'border-success-500/30 hover:bg-success-500/10'
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                    <span className="block text-xs text-surface-500 mt-0.5">{cfg.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-5">
              <Button variant="ghost" size="sm" onClick={() => setShowOutcomeModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden">
          <div className="bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-surface-100 mb-2">Delete Ticket</h3>
            <p className="text-sm text-surface-400 mb-1">
              Are you sure you want to permanently delete this ticket?
            </p>
            <p className="text-xs text-surface-500 mb-5 font-mono">{ticket.ticket_number}</p>
            <p className="text-xs text-red-400 mb-5">
              This will remove the ticket, all action log entries, and notes. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <button
                onClick={handleDeleteTicket}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
