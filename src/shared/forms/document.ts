// Shared, DOM-free document helpers used by both the renderer print pipeline
// (src/renderer/lib/print.ts) and the main-process PDF pipeline
// (src/main/pdf/document-shell.ts). Keeping these here guarantees the documents
// users print on screen and the PDFs archived to Google Drive are built from the
// exact same markup.

// Company identity printed on the letterhead of every generated document.
// Adjust here to update all printed forms/reports at once.
export const COMPANY = {
  name: 'CMB Film Services, Inc.',
  tagline: 'Equipment Inventory Management',
  addressLines: [
    'Equipment & Maintenance Division',
  ],
  contact: 'info@cmbfilmservices.com',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
