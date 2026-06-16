// Renders standalone HTML in a hidden iframe and triggers the browser print dialog.
// Used for loan documents and the loaned-equipment list, since the global app
// chrome (sidebar/topbar) is not print-friendly.
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

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .muted { color: #777; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; margin-top: 8px; }
  .field label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
  .field span { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th { text-align: left; background: #f0ead6; padding: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; border: 1px solid #ddd; }
  td { padding: 8px; border: 1px solid #ddd; }
  .header { border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 4px; }
  @media print { body { margin: 16px; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  doc.close();

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 500);
  };

  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    cleanup();
  }, 250);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
