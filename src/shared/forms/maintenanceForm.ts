import { COMPANY, escapeHtml } from './document';
import {
  REPAIR_STATUS_CONFIG,
  COMPLETION_OUTCOME_CONFIG,
  DOCUMENT_TYPE_CONFIG,
} from '../constants';
import type { CompletionOutcomeType, RepairStatusType } from '../constants';

export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  routine_maintenance: 'Routine Maintenance',
  update: 'Update',
  repair: 'Repair',
  corrective: 'Corrective',
  preventive: 'Preventive',
  predictive: 'Predictive',
};

// The ticket fields the document needs. Mirrors a maintenance_tickets row joined
// with the equipment name/code (as returned by db:maintenance:getById).
export interface MaintenanceFormTicket {
  ticket_number: string;
  repair_status: RepairStatusType | string;
  completion_outcome?: CompletionOutcomeType | string | null;
  maintenance_type: string;
  document_type: string;
  equipment_name?: string | null;
  equipment_code?: string | null;
  project_name?: string | null;
  production_name?: string | null;
  project_date?: string | null;
  reported_date?: string | null;
  reported_by?: string | null;
  verified_by?: string | null;
  issue_description?: string | null;
  diagnosis?: string | null;
}

export interface MaintenanceFormAction {
  action_date?: string | null;
  action_taken?: string | null;
  remarks?: string | null;
  personnel?: string | null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Builds the printable HTML body for a maintenance/repair/update/loss ticket. The
// document doubles as the closure record signed off at completion.
export function buildMaintenanceForm(
  ticket: MaintenanceFormTicket,
  actions: MaintenanceFormAction[],
): string {
  const statusLabel =
    REPAIR_STATUS_CONFIG[ticket.repair_status as RepairStatusType]?.label ?? ticket.repair_status;
  const outcomeLabel = ticket.completion_outcome
    ? (COMPLETION_OUTCOME_CONFIG[ticket.completion_outcome as CompletionOutcomeType]?.label
        ?? ticket.completion_outcome)
    : null;
  const mtLabel = MAINTENANCE_TYPE_LABELS[ticket.maintenance_type] || ticket.maintenance_type;
  const docTypeLabel = DOCUMENT_TYPE_CONFIG[ticket.document_type]?.reportTitle ?? 'Repair Report';

  const field = (label: string, value: string | null | undefined) =>
    `<div class="field"><label>${escapeHtml(label)}</label><span>${escapeHtml(value || '—')}</span></div>`;

  const actionRows = actions.map((a, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(fmtDate(a.action_date))}</td>
        <td>${escapeHtml(a.action_taken || '—')}</td>
        <td>${escapeHtml(a.remarks || '—')}</td>
        <td>${escapeHtml(a.personnel || '—')}</td>
      </tr>`).join('');

  const signBlock = (label: string, name: string) => `
      <div style="flex:1; text-align:center;">
        <div style="min-height:18px; margin-bottom:4px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1a1f2b;">${escapeHtml(name || '')}</div>
        <div style="border-top:1px solid #1a1f2b; padding-top:5px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280;">${escapeHtml(label)}</div>
      </div>`;

  return `
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
        ${field('Project Date', fmtDate(ticket.project_date))}
        ${field('Date Reported', fmtDate(ticket.reported_date))}
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
}

export { COMPANY };
