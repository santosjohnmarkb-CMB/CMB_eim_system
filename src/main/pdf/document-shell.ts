import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { COMPANY } from '../../shared/forms/document';

// Main-process equivalent of the renderer's print.ts letterhead + CSS wrapper.
// Both wrap the SAME body HTML (built by src/shared/forms/*) so the PDF archived
// to Google Drive matches what the user prints on screen. The logo is embedded as
// a base64 data URL read from a bundled resource file rather than a Vite asset.

let cachedLogoDataUrl: string | null | undefined;

function getLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources', 'cmb-letterhead.png'),
    path.join(__dirname, '../../../resources/cmb-letterhead.png'),
    path.join(__dirname, '../../resources/cmb-letterhead.png'),
  ];
  if (app?.isPackaged) {
    candidates.unshift(path.join((process as any).resourcesPath, 'resources', 'cmb-letterhead.png'));
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function logoDataUrl(): string | null {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl ?? null;
  const p = getLogoPath();
  if (!p) {
    cachedLogoDataUrl = null;
    return null;
  }
  try {
    const b64 = fs.readFileSync(p).toString('base64');
    cachedLogoDataUrl = `data:image/png;base64,${b64}`;
  } catch {
    cachedLogoDataUrl = null;
  }
  return cachedLogoDataUrl ?? null;
}

// Wrap a document body in the full company-letterhead HTML page. Mirrors
// `printHtml` in src/renderer/lib/print.ts (same CSS, letterhead, footer).
export function wrapDocument(title: string, bodyHtml: string): string {
  const logoUrl = logoDataUrl();
  const printedOn = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const brandMark = logoUrl
    ? `<img src="${logoUrl}" alt="${COMPANY.name}" />`
    : `<div style="font-family:'Helvetica Neue',Arial,sans-serif; font-size:18px; font-weight:700; color:#1a1f2b;">${COMPANY.name}</div>`;

  const letterhead = `
    <header class="letterhead">
      <div class="brand">
        ${brandMark}
        <div class="tagline">${COMPANY.tagline}</div>
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

  return `<!DOCTYPE html>
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
  .letterhead .brand { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .letterhead img { height: 50px; width: auto; max-width: 320px; object-fit: contain; }
  .letterhead .tagline {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
    color: #7a8190;
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
</style>
</head>
<body>
<div class="sheet">
${letterhead}
${bodyHtml}
${footer}
</div>
</body>
</html>`;
}
