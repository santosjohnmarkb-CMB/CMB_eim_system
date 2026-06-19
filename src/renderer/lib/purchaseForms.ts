import { printHtml, escapeHtml, COMPANY } from './print';
import { DEPARTMENT_CONFIG, REQUEST_TYPE_CONFIG } from '../../shared/constants';
import type { PurchaseRequest } from '../../shared/types';

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function fmtAmount(n: number | null | undefined): string {
  const value = Number(n || 0);
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A hand-signed approval line. Pre-fills the typed name above the rule when known.
function signBlock(label: string, name: string): string {
  return `
    <div style="flex:1; text-align:center;">
      <div style="min-height:18px; margin-bottom:4px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; color:#1a1f2b;">${escapeHtml(name || '')}</div>
      <div style="border-top:1px solid #1a1f2b; padding-top:5px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:#6b7280;">${escapeHtml(label)}</div>
    </div>`;
}

// Builds the printable HTML body for a purchase request. The document is submitted
// for management approval before the purchase is made.
export function buildPurchaseRequestForm(req: PurchaseRequest): string {
  const typeLabel = REQUEST_TYPE_CONFIG[req.request_type]?.label || req.request_type;
  const estTotal = Number(req.amount || 0) * Number(req.requested_quantity || 0);

  return `
    <div class="header">
      <h1>Equipment Purchase Request</h1>
      <p class="muted">${escapeHtml(req.request_number)} · ${escapeHtml(DEPARTMENT_CONFIG[req.department].label)}</p>
    </div>

    <p>This form requests approval to purchase the item detailed below as part of regular ${escapeHtml(DEPARTMENT_CONFIG[req.department].label)} operations.</p>

    <h2>Request Details</h2>
    <div class="grid">
      <div class="field"><label>Date of Request</label><span>${escapeHtml(fmtDate(req.request_date))}</span></div>
      <div class="field"><label>Department</label><span>${escapeHtml(DEPARTMENT_CONFIG[req.department].label)}</span></div>
      <div class="field"><label>Requested Asset / Item</label><span>${escapeHtml(req.requested_asset)}</span></div>
      <div class="field"><label>Request Type</label><span>${escapeHtml(typeLabel)}</span></div>
      <div class="field"><label>Current Quantity On Hand</label><span>${escapeHtml(String(req.current_quantity))}</span></div>
      <div class="field"><label>Requested Quantity</label><span>${escapeHtml(String(req.requested_quantity))}</span></div>
      <div class="field"><label>Supplier</label><span>${escapeHtml(req.supplier || '') || '—'}</span></div>
      <div class="field"><label>Requested By</label><span>${escapeHtml(req.created_by || '') || '—'}</span></div>
    </div>

    <h2>Cost Estimate</h2>
    <table>
      <thead><tr><th>Item</th><th style="width:70px; text-align:center;">Qty</th><th style="width:130px; text-align:right;">Unit Amount</th><th style="width:140px; text-align:right;">Estimated Total</th></tr></thead>
      <tbody>
        <tr>
          <td>${escapeHtml(req.requested_asset)}</td>
          <td style="text-align:center;">${escapeHtml(String(req.requested_quantity))}</td>
          <td style="text-align:right;">${fmtAmount(req.amount)}</td>
          <td style="text-align:right;">${fmtAmount(estTotal)}</td>
        </tr>
        <tr>
          <td colspan="3" style="text-align:right; font-weight:700;">Estimated Total</td>
          <td style="text-align:right; font-weight:700;">${fmtAmount(estTotal)}</td>
        </tr>
      </tbody>
    </table>

    ${req.reason ? `<h2>Reason for Request</h2><p>${escapeHtml(req.reason)}</p>` : ''}

    ${req.photo_data ? `<h2>Equipment Photo</h2>
    <div style="margin-top:10px; page-break-inside:avoid;">
      <img src="${escapeHtml(req.photo_data)}" alt="Requested equipment" style="max-width:320px; max-height:300px; border:1px solid #d4d8e0; object-fit:contain;" />
    </div>` : ''}

    <h2>Approval</h2>
    <p>The undersigned confirm that this purchase request has been reviewed and is approved for procurement. All purchased items remain the property of ${escapeHtml(COMPANY.name)}.</p>

    <div style="margin-top:44px; display:flex; gap:48px;">
      ${signBlock('Requested By', req.created_by || '')}
      ${signBlock('Reviewed By', '')}
      ${signBlock('Approved By', '')}
    </div>`;
}

export function printPurchaseRequestForm(req: PurchaseRequest): void {
  printHtml(`Purchase Request ${req.request_number}`, buildPurchaseRequestForm(req));
}
