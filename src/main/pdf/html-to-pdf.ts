import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { wrapDocument } from './document-shell';

/**
 * Render a document body (HTML produced by src/shared/forms/*) to a PDF Buffer in
 * the main process, using an offscreen BrowserWindow + `webContents.printToPDF`.
 *
 * This is the headless equivalent of the renderer's hidden-iframe `window.print()`
 * flow: it runs without any document being on screen, so it can be triggered
 * automatically when a ticket is closed / loan returned / request fulfilled.
 */
export async function renderDocumentToPdf(title: string, bodyHtml: string): Promise<Buffer> {
  const fullHtml = wrapDocument(title, bodyHtml);

  const tmpDir = path.join(app.getPath('userData'), 'temp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpHtml = path.join(tmpDir, `archive-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpHtml, fullHtml, 'utf-8');

  const win = new BrowserWindow({
    width: 816,
    height: 1056,
    show: false,
    webPreferences: { offscreen: true },
  });

  try {
    await win.loadFile(tmpHtml);
    // Give the renderer a brief moment to lay out (fonts/inline image decode).
    await new Promise((resolve) => setTimeout(resolve, 400));

    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
    });
    return Buffer.from(data);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(tmpHtml); } catch { /* ignore */ }
  }
}
