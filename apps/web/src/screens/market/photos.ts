import { preparePhoto, uploadEvidence } from '../../lib';

// Photos a person can pick in one go. The market's own limit still applies on top.
export const MAX_PICK = 3;

export interface PhotoUploadResult {
  added: number;
  error?: string;
}

// Shrinks and uploads photos one after another. It stops at the first one that fails, so
// a full market or circle is reported once rather than once per photo.
export async function uploadPhotos(
  files: File[],
  opts: { marketId: number; proposalId?: number; caption?: string; maxBytes: number },
  onProgress?: (added: number) => void,
): Promise<PhotoUploadResult> {
  let added = 0;
  for (const file of files) {
    const prepared = await preparePhoto(file, opts.maxBytes);
    if (prepared.error !== undefined) return { added, error: prepared.error };

    const res = await uploadEvidence(prepared.data, {
      marketId: opts.marketId,
      proposalId: opts.proposalId,
      caption: opts.caption?.trim() || undefined,
    });
    if (res.error !== undefined) return { added, error: res.error };

    added++;
    onProgress?.(added);
  }
  return { added };
}

export const photoWord = (n: number): string => (n === 1 ? 'photo' : 'photos');
