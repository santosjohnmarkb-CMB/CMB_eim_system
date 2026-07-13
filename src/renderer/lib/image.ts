// Reads an image file selected by the user and returns a downscaled base64 data URL.
// Downscaling keeps the payload small enough to store in SQLite and embed directly
// into the printed purchase request document. Output is JPEG to keep size compact.
export async function fileToResizedDataUrl(
  file: File,
  maxDimension = 1280,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPEG, PNG, or WebP).');
  }

  // Load the image via a data: URL (read with FileReader) rather than a blob:
  // object URL. The production Content-Security-Policy (main/index.ts) sets
  // `img-src 'self' data: https:` — it does NOT allow `blob:`, so an <img> pointed
  // at a createObjectURL() blob is blocked in packaged builds (works in dev, where
  // no CSP is applied), causing "Could not read the selected image." A data: URL is
  // permitted by the CSP, so this works in both dev and production.
  const sourceDataUrl = await readAsDataUrl(file);
  const img = await loadImage(sourceDataUrl);

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to process the selected image.');
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', quality);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the selected image.'));
    img.src = src;
  });
}
