// Shrink a camera photo on the phone before it goes anywhere.
//
// A raw iPhone photo is 2–6MB. It was uploaded as-is, base64'd on the server
// and sent to the model twice (identify, then score) — so most of a scan's
// wait was moving pixels nobody needed. Vercel also caps a function's request
// body at ~4.5MB, so the largest photos could fail outright. A label is fully
// legible at 1280px on the long edge, which lands around 150–300KB as JPEG.
//
// Any failure (old browser, odd format, canvas refusing) returns the original
// file: a slow scan beats a broken one.

const MAX_EDGE = 1280;
const QUALITY = 0.82;

export async function shrinkImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    // Already small and already JPEG: re-encoding would only lose quality.
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 600_000) {
      close(bitmap);
      return file;
    }
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { close(bitmap); return file; }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    close(bitmap);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// createImageBitmap honours EXIF orientation with this option, so a portrait
// phone photo doesn't come out sideways. Falls back to an <img> where it's
// missing.
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function close(source: ImageBitmap | HTMLImageElement) {
  if ('close' in source && typeof source.close === 'function') source.close();
}
