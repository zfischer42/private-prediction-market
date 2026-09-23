import { supabase, currentUserId, rpc, read, type Result } from './supabase';
import type { Comment, EvidenceUploadStatus, MarketEvidence, Notification } from './types';

// Comments, evidence and notifications. These are the only tables the
// browser is allowed to write to directly - everything else goes through
// a database function.

// ---------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------

// One running chat per circle - not tied to any one market.
export function getComments(circleId: number): Promise<Result<Comment[]>> {
  return read(
    supabase
      .from('comments')
      .select('*')
      .eq('circle_id', circleId)
      .order('created_at'),
  );
}

// Posts a comment. Up to 1000 characters.
export async function addComment(
  circleId: number,
  body: string,
): Promise<Result<Comment>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };
  return read(
    supabase
      .from('comments')
      .insert({ circle_id: circleId, user_id: userId, body })
      .select()
      .single(),
  );
}

// Deletes your own comment.
//
// The .select() is what makes this honest. Row-level security filters the
// delete rather than rejecting it, so removing someone else's comment
// matches zero rows and would otherwise come back as a success. Asking for
// the deleted rows lets us tell "gone" apart from "was never yours".
export async function deleteComment(commentId: number): Promise<Result<null>> {
  const { data, error } = await read<Comment[]>(
    supabase.from('comments').delete().eq('id', commentId).select(),
  );
  if (error) return { error };
  if (!data?.length) return { error: 'That comment is not yours to delete' };
  return { data: null };
}

// ---------------------------------------------------------------------
// Evidence
//
// Photos and video backing up a resolution. Lives in the private
// 'evidence' storage bucket.
// ---------------------------------------------------------------------

// A v4 UUID for the filename.
//
// crypto.randomUUID() only exists in a secure context, so it is undefined
// when the app is served over plain http from a LAN address - which is
// exactly how you test a mobile-first PWA on your phone. crypto.getRandomValues
// has no such restriction, so fall back to it rather than throwing on the
// one device the app is designed for.
function randomId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getEvidence(
  marketId: number,
): Promise<Result<MarketEvidence[]>> {
  return read(
    supabase
      .from('market_evidence')
      .select('*')
      .eq('market_id', marketId)
      .order('created_at'),
  );
}

// Asks the database whether a photo can be added to this market right now, and what the
// limits are: how many photos it has, how full the circle is, the largest file. Call it
// before showing a picker, so a full market says so in a sentence up front.
export function getEvidenceUploadStatus(
  marketId: number,
): Promise<Result<EvidenceUploadStatus>> {
  return rpc('evidence_upload_status', { _market_id: marketId });
}

// Sentences for the ways Storage itself can turn a file away. These only show if someone
// gets past the checks in uploadEvidence(), but a raw "mime type ... is not supported"
// should not reach a screen either.
function uploadMessage(message: string): string {
  if (/maximum allowed size|payload too large|too large/i.test(message)) {
    return 'That photo is too large.';
  }
  if (/mime type|not supported|invalid_mime_type/i.test(message)) {
    return 'Only JPEG photos are accepted.';
  }
  if (/row-level security|unauthorized/i.test(message)) {
    return 'That photo cannot be added right now. The market may have just filled up or settled.';
  }
  return message;
}

// Uploads a photo and records it against the market.
//
// Photos only, and JPEG only: pass a picked file through preparePhoto() first, which
// shrinks it well under the limit. Anything else is refused here with a sentence, and
// by the bucket itself if someone bypasses this function.
//
// The storage path must be exactly `<circle_id>/<market_id>/<uuid>.jpg`, because the
// bucket's access rules parse the path to work out which circle the file belongs to.
// The circle id is looked up from the market rather than taken as an argument, so the
// two cannot disagree (the storage policies reject a mismatch anyway).
//
// The market's file count and the circle's storage are capped; getEvidenceUploadStatus()
// says where things stand. Both the upload and the row are blocked once the market has
// settled, which keeps the proof behind a payout from changing after the fact.
export async function uploadEvidence(
  photo: Blob,
  opts: {
    marketId: number;
    proposalId?: number;
    caption?: string;
  },
): Promise<Result<MarketEvidence>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };

  if (photo.type !== 'image/jpeg') {
    return { error: 'Evidence must be a photo. Pick a picture and it is converted for you.' };
  }

  // Ask first, so "this market already has 6 photos" is a sentence rather than a policy
  // error. RLS hides markets in circles you are not in, so a missing market reads as
  // "Market not found" here - the "not your circle" case too.
  const status = await getEvidenceUploadStatus(opts.marketId);
  if (status.error !== undefined) return { error: status.error };
  if (!status.data.allowed) {
    return { error: status.data.reason ?? 'Photos cannot be added to this market.' };
  }
  if (photo.size > status.data.max_file_bytes) return { error: 'That photo is too large.' };

  const { data: market, error: marketError } = await read<{ circle_id: number } | null>(
    supabase.from('markets').select('circle_id').eq('id', opts.marketId).maybeSingle(),
  );
  if (marketError) return { error: marketError };
  if (!market) return { error: 'Market not found' };

  const path = `${market.circle_id}/${opts.marketId}/${randomId()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('evidence')
    .upload(path, photo, { contentType: 'image/jpeg' });
  if (uploadError) return { error: uploadMessage(uploadError.message) };

  const result = await read<MarketEvidence>(
    supabase
      .from('market_evidence')
      .insert({
        market_id: opts.marketId,
        proposal_id: opts.proposalId ?? null,
        uploader_id: userId,
        storage_path: path,
        media_type: 'image',
        caption: opts.caption ?? null,
      })
      .select()
      .single(),
  );

  // If recording it failed, do not leave the file orphaned in the bucket.
  if (result.error) await supabase.storage.from('evidence').remove([path]);
  return result;
}

// The bucket is private, so files need a temporary signed URL to display.
// Defaults to an hour, which is plenty for one page view.
export async function getEvidenceUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<Result<string>> {
  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return { error: error.message };
  return { data: data.signedUrl };
}

// Signed URLs for a whole gallery in one round trip. A path that cannot be signed (the
// file is gone, or you may not see it) is simply left out of the result.
export async function getEvidenceUrls(
  storagePaths: string[],
  expiresInSeconds = 3600,
): Promise<Result<Record<string, string>>> {
  if (storagePaths.length === 0) return { data: {} };
  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUrls(storagePaths, expiresInSeconds);
  if (error) return { error: error.message };
  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return { data: urls };
}

// Deletes every photo on a market, files and rows. Only its creator or a circle admin may,
// and only while it is unsettled.
//
// Call this BEFORE cancelMarket(). Once the market row is gone nobody is allowed to delete
// its files, so they would sit in the bucket unreachable and still counting against the
// quota - and deleting them with SQL does not free the space either (Supabase leaves the
// object behind). The rows go first, the way deleteEvidence() does it: a stray file is a
// cheaper mistake than a row that points at nothing. Files are found by listing the folder
// as well as from the rows, so one whose row never got written is not missed.
export async function removeMarketFiles(marketId: number): Promise<Result<null>> {
  const { data: market, error: marketError } = await read<{ circle_id: number } | null>(
    supabase.from('markets').select('circle_id').eq('id', marketId).maybeSingle(),
  );
  if (marketError) return { error: marketError };
  if (!market) return { error: 'Market not found' };

  const rows = await read<MarketEvidence[]>(
    supabase.from('market_evidence').delete().eq('market_id', marketId).select(),
  );
  if (rows.error !== undefined) return { error: rows.error };

  const folder = `${market.circle_id}/${marketId}`;
  const listed = await supabase.storage.from('evidence').list(folder, { limit: 100 });
  const paths = new Set(rows.data.map((row) => row.storage_path));
  for (const file of listed.data ?? []) {
    if (file.id) paths.add(`${folder}/${file.name}`);
  }
  if (paths.size === 0) return { data: null };

  const { error } = await supabase.storage.from('evidence').remove([...paths]);
  if (error) return { error: error.message };
  return { data: null };
}

// Deletes one photo: your own, or any on a market you created or administer. Once the market
// has settled, only a circle admin, and only 30 days later.
//
// Same .select() reasoning as deleteComment: without it, an upload that
// RLS refused to delete would report success and we would then delete the
// file out from under a row that still exists. The row goes first for that
// reason - an orphaned file is a much cheaper mistake than a row pointing
// at storage that is gone.
//
// Which makes the file removal best-effort by design: the row is already gone,
// so the caller's request HAS been honoured and reporting an error here would
// be a lie in the other direction. It is still worth a console warning rather
// than nothing - a bucket quietly accumulating files nobody can reach is the
// kind of thing you want a breadcrumb for.
export async function deleteEvidence(
  evidence: MarketEvidence,
): Promise<Result<null>> {
  const { data, error } = await read<MarketEvidence[]>(
    supabase.from('market_evidence').delete().eq('id', evidence.id).select(),
  );
  if (error) return { error };
  if (!data?.length) {
    return { error: 'That photo cannot be deleted by you, or the market has settled' };
  }
  const { error: removeError } = await supabase.storage
    .from('evidence')
    .remove([evidence.storage_path]);
  if (removeError) {
    console.warn(
      `Evidence row ${evidence.id} was deleted but its file could not be removed ` +
      `("${evidence.storage_path}"): ${removeError.message}`,
    );
  }
  return { data: null };
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

// Your notifications, newest first. Pass unreadOnly for a badge count.
export function getNotifications(
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Result<Notification[]>> {
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.unreadOnly) query = query.is('read_at', null);
  return read(query);
}

// Marking read goes through a function - there is no direct update on
// this table, so writing read_at yourself will be denied.
export function markNotificationRead(
  notificationId: number,
): Promise<Result<null>> {
  return rpc('mark_notification_read', { _notification_id: notificationId });
}

export function markAllNotificationsRead(): Promise<Result<null>> {
  return rpc('mark_all_notifications_read');
}
