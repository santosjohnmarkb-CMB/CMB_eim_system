import { COMPANY, escapeHtml } from './document';
import { DEPARTMENT_CONFIG, REQUEST_TYPE_CONFIG } from '../constants';
import type { PurchaseRequest, PurchaseRequestItem } from '../types';

// Older single-item requests may not carry an items array; rebuild one line item
// from the mirrored parent columns so the printed form always renders.
function resolveItems(req: PurchaseRequest): PurchaseRequestItem[] {
  if (req.items && req.items.length > 0) return req.items;
  return [{
    id: `${req.id}-legacy`,
    request_id: req.id,
    requested_asset: req.requested_asset,
    request_type: req.request_type,
    current_quantity: req.current_quantity,
    requested_quantity: req.requested_quantity,
    supplier: req.supplier,
    amount: req.amount,
    photo_data: req.photo_data,
    sort_order: 0,
    created_at: req.created_at,
  }];
}

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
  const items = resolveItems(req);
  const multiple = items.length > 1;
  const grandTotal = items.reduce(
    (sum, i) => sum + Number(i.amount || 0) * Number(i.requested_quantity || 0),
    0,
  );

  const detailRows = items
    .map((item, idx) => {
      const typeLabel = REQUEST_TYPE_CONFIG[item.request_type]?.label || item.request_type;
      const heading = multiple ? `<h3 style="margin:14px 0 6px;">Equipment ${idx + 1}</h3>` : '';
      return `${heading}
        <div class="grid">
          <div class="field"><label>Requested Asset / Item</label><span>${escapeHtml(item.requested_asset)}</span></div>
          <div class="field"><label>Request Type</label><span>${escapeHtml(typeLabel)}</span></div>
          <div class="field"><label>Current Quantity On Hand</label><span>${escapeHtml(String(item.current_quantity))}</span></div>
          <div class="field"><label>Requested Quantity</label><span>${escapeHtml(String(item.requested_quantity))}</span></div>
          <div class="field"><label>Supplier</label><span>${escapeHtml(item.supplier || '') || '—'}</span></div>
        </div>`;
    })
    .join('');

  const costRows = items
    .map((item) => {
      const lineTotal = Number(item.amount || 0) * Number(item.requested_quantity || 0);
      return `
        <tr>
          <td>${escapeHtml(item.requested_asset)}</td>
          <td style="text-align:center;">${escapeHtml(String(item.requested_quantity))}</td>
          <td style="text-align:right;">${fmtAmount(item.amount)}</td>
          <td style="text-align:right;">${fmtAmount(lineTotal)}</td>
        </tr>`;
    })
    .join('');

  const photos = items.filter((i) => i.photo_data);
  const photoBlock = photos.length
    ? `<h2>Equipment Photo${photos.length > 1 ? 's' : ''}</h2>
      <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:12px; page-break-inside:avoid;">
        ${photos
          .map((item) => `
          <div style="text-align:center;">
            <img src="${escapeHtml(item.photo_data as string)}" alt="${escapeHtml(item.requested_asset)}" style="max-width:180px; max-height:150px; border:1px solid #d4d8e0; object-fit:contain;" />
            <div style="font-size:10px; color:#6b7280; margin-top:3px;">${escapeHtml(item.requested_asset)}</div>
          </div>`)
          .join('')}
      </div>`
    : '';

  return `
    <div class="header">
      <h1>Equipment Purchase Request</h1>
      <p class="muted">${escapeHtml(req.request_number)} · ${escapeHtml(DEPARTMENT_CONFIG[req.department].label)}</p>
    </div>

    <p>This form requests approval to purchase the ${multiple ? `${items.length} items` : 'item'} detailed below as part of regular ${escapeHtml(DEPARTMENT_CONFIG[req.department].label)} operations.</p>

    <h2>Request Details</h2>
    <div class="grid">
      <div class="field"><label>Date of Request</label><span>${escapeHtml(fmtDate(req.request_date))}</span></div>
      <div class="field"><label>Department</label><span>${escapeHtml(DEPARTMENT_CONFIG[req.department].label)}</span></div>
      <div class="field"><label>Requested By</label><span>${escapeHtml(req.created_by || '') || '—'}</span></div>
    </div>

    <h2>Equipment</h2>
    ${detailRows}

    <h2>Cost Estimate</h2>
    <table>
      <thead><tr><th>Item</th><th style="width:70px; text-align:center;">Qty</th><th style="width:130px; text-align:right;">Unit Amount</th><th style="width:140px; text-align:right;">Estimated Total</th></tr></thead>
      <tbody>
        ${costRows}
        <tr>
          <td colspan="3" style="text-align:right; font-weight:700;">Estimated Total</td>
          <td style="text-align:right; font-weight:700;">${fmtAmount(grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    ${req.reason ? `<h2>Reason for Request</h2><p>${escapeHtml(req.reason)}</p>` : ''}

    ${photoBlock}

    <h2>Approval</h2>
    <p>The undersigned confirm that this purchase request has been reviewed and is approved for procurement. All purchased items remain the property of ${escapeHtml(COMPANY.name)}.</p>

    <div style="margin-top:44px; display:flex; gap:48px;">
      ${signBlock('Requested By', req.created_by || '')}
      ${signBlock('Reviewed By', '')}
      ${signBlock('Approved By', '')}
    </div>`;
}
