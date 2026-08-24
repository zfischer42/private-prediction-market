import { supabase, currentUserId, rpc, read, type Result } from './supabase';
import type { Comment, MarketEvidence, MediaType, Notification } from './types';

// Comments, evidence and notifications. These are the only tables the
// browser is allowed to write to directly - everything else goes through
// a database function.

// ---------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------

export function getComments(marketId: number): Promise<Result<Comment[]>> {
  return read(
    supabase
      .from('comments')
      .select('*')
      .eq('market_id', marketId)
      .order('created_at'),
  );
}

// Posts a comment. Up to 1000 characters.
export async function addComment(
  marketId: number,
  body: string,
): Promise<Result<Comment>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };
  return read(
    supabase
      .from('comments')
      .insert({ market_id: marketId, user_id: userId, body })
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

// Uploads a file and records it against the market.
//
// The storage path must be exactly `<circle_id>/<market_id>/<uuid>.<ext>`
// because the bucket's access rules parse the path to work out which
// circle the file belongs to. Any other shape is rejected.
//
// The circle id is looked up from the market rather than taken as an argument.
// It used to be a parameter, which made "which circle?" a question the CALLER
// had to get right about a file whose market already answers it - and getting
// it wrong put the photo in a folder the market's own circle could not read,
// while handing it to an unrelated circle. The storage policies now reject a
// mismatch outright, so a wrong value is no longer silent, but it would surface
// as a raw row-level-security error rather than a sentence. Deriving it removes
// the question instead of validating the answer.
//
// Both the upload and the row are blocked once the market has settled,
// which keeps the proof behind a payout from being deleted after the fact.
export async function uploadEvidence(
  file: File,
  opts: {
    marketId: number;
    proposalId?: number;
    caption?: string;
  },
): Promise<Result<MarketEvidence>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };

  // media_type only allows 'image' or 'video'. Decide it from the MIME
  // type and refuse anything else up front - defaulting a PDF to 'image'
  // would satisfy the constraint while recording something untrue.
  const mediaType: MediaType | null =
    file.type.startsWith('video/') ? 'video'
    : file.type.startsWith('image/') ? 'image'
    : null;
  if (!mediaType) {
    return { error: `Evidence must be an image or a video (got "${file.type || 'unknown'}")` };
  }

  // RLS hides markets in circles you are not in, so a missing row here is also
  // the "not your circle" case - same as getMarket().
  const { data: market, error: marketError } = await read<{ circle_id: number } | null>(
    supabase.from('markets').select('circle_id').eq('id', opts.marketId).maybeSingle(),
  );
  if (marketError) return { error: marketError };
  if (!market) return { error: 'Market not found' };

  // Only treat a trailing segment as an extension if the name actually has
  // one - "photo".split('.').pop() returns "photo", not undefined, which
  // would otherwise produce a path ending ".photo".
  const dot = file.name.lastIndexOf('.');
  const raw = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const ext = /^[a-z0-9]{1,8}$/.test(raw) ? raw : 'bin';
  const path = `${market.circle_id}/${opts.marketId}/${randomId()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('evidence')
    .upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const result = await read<MarketEvidence>(
    supabase
      .from('market_evidence')
      .insert({
        market_id: opts.marketId,
        proposal_id: opts.proposalId ?? null,
        uploader_id: userId,
        storage_path: path,
        media_type: mediaType,
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

// Retracts your own upload. Not allowed once the market has settled.
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
    return { error: 'That evidence is not yours to delete, or the market has settled' };
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
