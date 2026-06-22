import { COMPANY, escapeHtml } from './document';
import { DEPARTMENT_CONFIG } from '../constants';
import type { Department } from '../constants';

export interface ReleaseFormItem {
  code?: string | null;
  name: string;
}

export interface ReleaseFormInput {
  loan_number: string;
  department: Department;
  person_or_org: string;
  purpose?: string | null;
  location?: string | null;
  loaned_date?: string | null;
  tentative_return_date?: string | null;
  duration?: string | null;
  remarks?: string | null;
  released_by?: string | null;
  items: ReleaseFormItem[];
}

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : '—';
}

// A hand-signed acknowledgment line. Pre-fills the typed name above the rule when known.
function signBlock(label: string, name: string): string {
  return `
    <div style="flex:1; text-align:center;">
      <div style="min-height:18px; margin-bottom:4px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1a1f2b;">${escapeHtml(name || '')}</div>
      <div style="border-top:1px solid #1a1f2b; padding-top:5px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280;">${escapeHtml(label)}</div>
    </div>`;
}

// Builds the printable HTML body for an equipment release form. The document doubles as the
// release record signed by the authorized person the equipment is loaned out to.
export function buildLoanReleaseForm(input: ReleaseFormInput): string {
  const rows = input.items.map((it, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td>${escapeHtml(it.code || '—')}</td>
      <td>${escapeHtml(it.name || '—')}</td>
      <td style="text-align:center;">1</td>
      <td></td>
    </tr>`).join('');

  return `
    <div class="header">
      <h1>Equipment Release Form</h1>
      <p class="muted">${escapeHtml(input.loan_number)} · ${escapeHtml(DEPARTMENT_CONFIG[input.department].label)}</p>
    </div>

    <p>This form certifies that the equipment listed below has been released by ${escapeHtml(COMPANY.name)} and received by the undersigned authorized representative.</p>

    <h2>Release Details</h2>
    <div class="grid">
      <div class="field"><label>Released To</label><span>${escapeHtml(input.person_or_org)}</span></div>
      <div class="field"><label>Department</label><span>${escapeHtml(DEPARTMENT_CONFIG[input.department].label)}</span></div>
      <div class="field"><label>Date Released</label><span>${escapeHtml(fmtDate(input.loaned_date))}</span></div>
      <div class="field"><label>Expected Return</label><span>${escapeHtml(fmtDate(input.tentative_return_date))}</span></div>
      <div class="field"><label>Purpose</label><span>${escapeHtml(input.purpose || '') || '—'}</span></div>
      <div class="field"><label>Location / Destination</label><span>${escapeHtml(input.location || '') || '—'}</span></div>
      <div class="field"><label>Duration</label><span>${escapeHtml(input.duration || '') || '—'}</span></div>
      <div class="field"><label>Released By</label><span>${escapeHtml(input.released_by || '') || '—'}</span></div>
    </div>

    <h2>Released Equipment (${input.items.length})</h2>
    <table>
      <thead><tr><th style="width:32px;">#</th><th style="width:110px;">Code</th><th>Equipment Description</th><th style="width:48px;">Qty</th><th style="width:150px;">Condition on Release</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No equipment listed</td></tr>'}</tbody>
    </table>

    ${input.remarks ? `<h2>Remarks</h2><p>${escapeHtml(input.remarks)}</p>` : ''}

    <h2>Acknowledgment</h2>
    <p>I, the undersigned, acknowledge that I have received the equipment listed above in good working condition and accept full responsibility for its safekeeping. I agree to return all items on or before the expected return date and to report any loss or damage immediately. All equipment remains the property of ${escapeHtml(COMPANY.name)} at all times.</p>

    <div style="margin-top:44px; display:flex; gap:48px;">
      ${signBlock('Released By', input.released_by || '')}
      ${signBlock('Received By (Authorized Person)', input.person_or_org || '')}
      ${signBlock('Approved By', '')}
    </div>`;
}
