import eimLogo from '../assets/eim-hor.png';

// Company identity printed on the letterhead of every generated document.
// Adjust here to update all printed forms/reports at once.
const COMPANY = {
  name: 'CMB Film Services, Inc.',
  tagline: 'Equipment Inventory Management',
  addressLines: [
    'Equipment & Maintenance Division',
  ],
  contact: 'info@cmbfilmservices.com',
};

// Resolve the bundled logo to an absolute URL so it loads inside the print iframe
// (whose base URL is about:blank and cannot resolve app-relative asset paths).
function resolveLogoUrl(): string {
  try {
    return new URL(eimLogo, document.baseURI).href;
  } catch {
    return eimLogo;
  }
}

// Renders standalone HTML in a hidden iframe and triggers the browser print dialog.
// The body is wrapped in a formal company letterhead + footer so loan forms, equipment
// lists, and maintenance histories print as professional documents rather than raw screens.
export function printHtml(title: string, bodyHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  const logoUrl = resolveLogoUrl();
  const printedOn = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const letterhead = `
    <header class="letterhead">
      <div class="brand">
        <img src="${logoUrl}" alt="${COMPANY.name}" />
        <div class="brand-text">
          <div class="company">${COMPANY.name}</div>
          <div class="tagline">${COMPANY.tagline}</div>
        </div>
      </div>
      <div class="brand-contact">
        ${COMPANY.addressLines.map((l) => `<div>${l}</div>`).join('')}
        <div>${COMPANY.contact}</div>
      </div>
    </header>`;

  const footer = `
    <footer class="doc-footer">
      <span>${COMPANY.name} — ${COMPANY.tagline}</span>
      <span>Generated ${printedOn} · System-generated document</span>
    </footer>`;

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 16mm 14mm; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1a1f2b;
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }
  .sheet { padding: 0; }

  /* Letterhead */
  .letterhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 14px;
    border-bottom: 2.5px solid #1a1f2b;
  }
  .letterhead .brand { display: flex; align-items: center; gap: 16px; }
  .letterhead img { height: 48px; width: auto; object-fit: contain; }
  .letterhead .company {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 18px; font-weight: 700; letter-spacing: 0.01em; color: #1a1f2b;
  }
  .letterhead .tagline {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
    color: #7a8190; margin-top: 3px;
  }
  .letterhead .brand-contact {
    text-align: right; font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px; color: #6b7280; line-height: 1.6;
  }

  /* Document title block (provided by callers via .header) */
  .header { margin: 22px 0 6px; }
  .header h1 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 17px; font-weight: 700; letter-spacing: 0.01em; margin: 0; color: #1a1f2b;
    text-transform: uppercase;
  }
  .muted { color: #6b7280; font-size: 11px; font-family: 'Helvetica Neue', Arial, sans-serif; margin: 4px 0 0; }

  h2 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #1a1f2b;
    margin: 22px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #d4d8e0; font-weight: 700;
  }

  /* Detail grids (loan/asset fields) */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 36px; margin-top: 10px; }
  .field { border-bottom: 1px dotted #d4d8e0; padding-bottom: 5px; }
  .field label {
    display: block; font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: #9099a8; margin-bottom: 2px;
  }
  .field span { font-size: 13px; color: #1a1f2b; }

  /* Tables */
  table {
    width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11.5px;
    font-family: 'Helvetica Neue', Arial, sans-serif;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th {
    text-align: left; background: #1a1f2b; color: #fff; padding: 8px 9px;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    border: 1px solid #1a1f2b;
  }
  td { padding: 7px 9px; border: 1px solid #d4d8e0; color: #2b3242; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f6f7f9; }

  p { font-size: 12px; }

  /* Footer */
  .doc-footer {
    margin-top: 28px; padding-top: 8px; border-top: 1px solid #d4d8e0;
    display: flex; justify-content: space-between; align-items: center;
    font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9px; color: #9099a8;
    letter-spacing: 0.03em;
  }

  @media print {
    body { margin: 0; }
    .doc-footer { position: fixed; bottom: 0; left: 0; right: 0; }
  }
</style>
</head>
<body>
<div class="sheet">
${letterhead}
${bodyHtml}
${footer}
</div>
</body>
</html>`);
  doc.close();

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 500);
  };

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    cleanup();
  };

  // Wait for the logo (and any other images) to load before printing so the
  // letterhead isn't dropped, with a safety timeout as a fallback.
  const images = Array.from(doc.images || []);
  const pending = images.filter((img) => !img.complete);
  if (pending.length === 0) {
    setTimeout(triggerPrint, 150);
  } else {
    let remaining = pending.length;
    pending.forEach((img) => {
      const onDone = () => {
        img.removeEventListener('load', onDone);
        img.removeEventListener('error', onDone);
        remaining -= 1;
        if (remaining <= 0) setTimeout(triggerPrint, 80);
      };
      img.addEventListener('load', onDone);
      img.addEventListener('error', onDone);
    });
    setTimeout(triggerPrint, 1500);
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
