import type { Result } from './supabase';

// Longest side of a photo after shrinking. Plenty for a screenshot or a snapshot
// on a phone, and it is what keeps a picture near 200-400 KB instead of 3-5 MB.
const MAX_EDGE = 1600;
const QUALITIES = [0.82, 0.72, 0.62, 0.5];

// Turns whatever the person picked into a JPEG that fits under `maxBytes`.
//
// Re-drawing through a canvas also drops everything the file carried besides the
// pixels - notably the GPS location phones write into a photo's EXIF data - so what
// reaches storage, and everyone else in the circle, is only the picture.
//
// The database and the bucket enforce the real limits; this is what makes a normal
// photo fit under them. Browser only: it needs createImageBitmap and a canvas.
export async function preparePhoto(file: Blob, maxBytes: number): Promise<Result<Blob>> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { error: 'This browser cannot prepare photos for upload.' };
  }

  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the rotation phones store in EXIF, so a portrait shot is not
    // uploaded sideways. Older Safari rejects the option; fall back to the plain call.
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }
  } catch {
    return { error: 'That file could not be read as a photo. Try a JPEG or PNG.' };
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'This browser cannot prepare photos for upload.' };

    // JPEG has no transparency: a see-through PNG would otherwise turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob && blob.size <= maxBytes) return { data: blob };
    }
    return { error: 'That photo is too large even after shrinking it. Try a smaller one.' };
  } finally {
    bitmap.close();
  }
}
