import { COMPANY, escapeHtml } from './document';
import { MAINTENANCE_TYPE_LABELS } from './maintenanceForm';

// Fields the Equipment Repair Release Form needs. Mirrors a maintenance_tickets
// row (joined with equipment name/code/serial as returned by db:maintenance:getById)
// plus the operator-supplied "in charge of repair" and the initiating user.
export interface RepairReleaseFormInput {
  ticket_number: string;
  equipment_name?: string | null;
  equipment_code?: string | null;
  asset_serial?: string | null;
  category_name?: string | null;
  maintenance_type?: string | null;
  issue_description?: string | null;
  // Most recent action-log entry (the "last action" taken on the ticket).
  last_action_date?: string | null;
  last_action_taken?: string | null;
  last_action_personnel?: string | null;
  // Manually entered when the release form is generated.
  in_charge_of_repair: string;
  // The logged-in account that initiated the release (Prepared By).
  prepared_by: string;
  prepared_date?: string | null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// A hand-signed acknowledgment line. Pre-fills the typed name above the rule when known,
// while always leaving the ruled line for a physical signature.
function signBlock(label: string, name: string): string {
  return `
    <div style="flex:1; text-align:center;">
      <div style="min-height:18px; margin-bottom:4px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1a1f2b;">${escapeHtml(name || '')}</div>
      <div style="border-top:1px solid #1a1f2b; padding-top:5px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280;">${escapeHtml(label)}</div>
    </div>`;
}

// Builds the printable HTML body for an Equipment Repair - Release Form. This document
// releases a piece of equipment into someone's custody for repair/maintenance while a
// ticket is still open, and doubles as the signed hand-off record.
export function buildRepairReleaseForm(input: RepairReleaseFormInput): string {
  const mtLabel = input.maintenance_type
    ? (MAINTENANCE_TYPE_LABELS[input.maintenance_type] || input.maintenance_type)
    : '—';

  const field = (label: string, value: string | null | undefined) =>
    `<div class="field"><label>${escapeHtml(label)}</label><span>${escapeHtml(value || '—')}</span></div>`;

  const lastAction = input.last_action_taken
    ? `${input.last_action_taken}${input.last_action_date ? ` (${fmtDate(input.last_action_date)})` : ''}${input.last_action_personnel ? ` — ${input.last_action_personnel}` : ''}`
    : 'No action recorded yet';

  return `
    <div class="header">
      <h1>Equipment Repair — Release Form</h1>
      <p class="muted">${escapeHtml(input.ticket_number)}${input.category_name ? ` · ${escapeHtml(input.category_name)}` : ''}</p>
    </div>

    <p>This form certifies that the equipment described below has been released by ${escapeHtml(COMPANY.name)} into the custody of the person named as receiving party, for the purpose of repair or maintenance under the referenced ticket. All equipment remains the property of ${escapeHtml(COMPANY.name)} at all times.</p>

    <h2>Equipment Details</h2>
    <div class="grid">
      ${field('Equipment Name', input.equipment_name)}
      ${field('Equipment Code', input.equipment_code)}
      ${field('Serial Number', input.asset_serial)}
      ${field('Category', input.category_name)}
      ${field('Ticket Number', input.ticket_number)}
      ${field('Maintenance Type', mtLabel)}
    </div>

    <h2>Issue</h2>
    <p>${escapeHtml(input.issue_description || '—')}</p>

    <h2>Last Action Taken</h2>
    <p>${escapeHtml(lastAction)}</p>

    <h2>Repair Assignment</h2>
    <div class="grid">
      ${field('In Charge of Repair', input.in_charge_of_repair)}
      ${field('Date Released', fmtDate(input.prepared_date))}
    </div>

    <h2>Acknowledgment</h2>
    <p>The receiving party acknowledges that the equipment listed above was received in the condition described and accepts responsibility for its safekeeping while in their custody for repair. Any additional damage, loss, or change in condition is to be reported to ${escapeHtml(COMPANY.name)} immediately.</p>

    <div style="margin-top:44px; display:flex; gap:48px;">
      ${signBlock('Prepared By', input.prepared_by || '')}
      ${signBlock('Approved By', '')}
      ${signBlock('Received By (In Charge of Repair)', input.in_charge_of_repair || '')}
    </div>`;
}
