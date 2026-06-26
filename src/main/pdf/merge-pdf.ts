import { PDFDocument } from 'pdf-lib';

// A4 page size in PDF points (72 dpi): 595.28 x 841.89.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 36; // 0.5 inch

interface DecodedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

function decodeDataUrl(dataUrl: string): DecodedDataUrl | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match || match[1] == null || match[2] == null) return null;
  const mime = match[1];
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  return { mime, bytes };
}

/**
 * Append an operator-uploaded attachment (image or PDF, supplied as a base64 data
 * URL) onto the end of an already-rendered document PDF, returning a single combined
 * PDF buffer.
 *
 * - PDF attachments have all their pages copied and appended.
 * - Image attachments (JPEG/PNG) are embedded on a new A4 page, scaled to fit within
 *   the page margins.
 *
 * Never throws: if the attachment can't be parsed/embedded the original PDF is
 * returned unchanged so archiving still succeeds.
 */
export async function appendAttachmentToPdf(
  mainPdf: Buffer,
  attachmentDataUrl: string | null | undefined,
): Promise<Buffer> {
  if (!attachmentDataUrl) return mainPdf;

  try {
    const decoded = decodeDataUrl(attachmentDataUrl);
    if (!decoded) return mainPdf;

    const doc = await PDFDocument.load(mainPdf);

    if (decoded.mime === 'application/pdf') {
      const src = await PDFDocument.load(decoded.bytes);
      const pages = await doc.copyPages(src, src.getPageIndices());
      for (const page of pages) doc.addPage(page);
    } else if (decoded.mime.startsWith('image/')) {
      const image = decoded.mime.includes('png')
        ? await doc.embedPng(decoded.bytes)
        : await doc.embedJpg(decoded.bytes);
      const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      const maxWidth = A4_WIDTH - PAGE_MARGIN * 2;
      const maxHeight = A4_HEIGHT - PAGE_MARGIN * 2;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, {
        x: (A4_WIDTH - width) / 2,
        y: (A4_HEIGHT - height) / 2,
        width,
        height,
      });
    } else {
      return mainPdf;
    }

    const merged = await doc.save();
    return Buffer.from(merged);
  } catch (err) {
    console.error('[Archive] failed to merge attachment, archiving without it:', err instanceof Error ? err.message : err);
    return mainPdf;
  }
}
