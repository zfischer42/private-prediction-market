import { useState } from 'react';
import {
  deleteEvidence,
  getEvidenceUrls,
  isSettled,
  type EvidenceUploadStatus,
  type Market,
  type MarketEvidence,
} from '../../lib';
import { useRunner, useResource, type Resource } from '../../hooks';
import { when } from '../../format';
import { ConfirmButton, ErrorNote, Loading, useToast } from '../../ui';
import PhotoInput from './PhotoInput';
import { MAX_PICK, photoWord, uploadPhotos } from './photos';
import type { NameOf } from './types';

const DAY_MS = 86_400_000;

export default function EvidencePanel({
  market,
  evidence,
  status,
  nameOf,
  myId,
  isAdmin,
  now,
  onChanged,
}: {
  market: Market;
  evidence: Resource<MarketEvidence[]>;
  status: Resource<EvidenceUploadStatus>;
  nameOf: NameOf;
  myId: string;
  isAdmin: boolean;
  now: Date;
  // Reload the photo list and the limits after anything is added or removed.
  onChanged: () => void;
}) {
  const toast = useToast();
  const removing = useRunner();
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  const list = evidence.data ?? [];
  const paths = list.map((e) => e.storage_path);
  const urls = useResource(() => getEvidenceUrls(paths), [paths.join('|')]);

  if (evidence.loading) return <Loading />;
  if (!evidence.data) {
    return <ErrorNote message={evidence.error ?? 'Could not load photos.'} onRetry={evidence.reload} />;
  }

  const st = status.data;
  const room = st ? Math.max(0, st.max_files - st.files) : 0;
  const nearlyFull = st && st.circle_bytes >= st.max_circle_bytes * 0.8;

  // The same rule the database applies: before settlement, whoever uploaded it, the
  // market's creator or an admin; after, only an admin, and only once the window has passed.
  function canDelete(item: MarketEvidence): boolean {
    if (isSettled(market)) {
      const days = st?.purge_after_days ?? 30;
      return (
        isAdmin &&
        !!market.resolved_at &&
        now.getTime() - new Date(market.resolved_at).getTime() > days * DAY_MS
      );
    }
    return item.uploader_id === myId || market.creator_id === myId || isAdmin;
  }

  async function onPick(files: File[]) {
    if (!st) return;
    const chosen = files.slice(0, room);
    if (files.length > chosen.length) {
      toast(`Only ${room} more ${photoWord(room)} fit on this market.`, 'error');
    }
    if (chosen.length === 0) return;

    setProgress(`Adding photo 1 of ${chosen.length}...`);
    const res = await uploadPhotos(
      chosen,
      { marketId: market.id, caption, maxBytes: st.max_file_bytes },
      (added) => setProgress(added < chosen.length ? `Adding photo ${added + 1} of ${chosen.length}...` : null),
    );
    setProgress(null);

    if (res.error !== undefined) {
      toast(res.added > 0 ? `${res.added} added. ${res.error}` : res.error, 'error');
    } else {
      toast(`${res.added} ${photoWord(res.added)} added`);
      setCaption('');
    }
    if (res.added > 0) onChanged();
  }

  async function onDelete(item: MarketEvidence) {
    const res = await removing.run(() => deleteEvidence(item), 'Photo deleted');
    if (res.error === undefined) onChanged();
  }

  return (
    <section className="card stack">
      <div className="spread">
        <h2>Photos</h2>
        {st && (
          <span className="muted small">
            {st.files} of {st.max_files}
          </span>
        )}
      </div>

      {list.length === 0 ? (
        <p className="hint">No photos yet.</p>
      ) : (
        <ul className="gallery">
          {list.map((item) => {
            const url = urls.data?.[item.storage_path];
            return (
              <li key={item.id} className="photo">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={item.caption ?? 'Evidence photo'} loading="lazy" />
                  </a>
                ) : (
                  <div className="photo-missing" role="img" aria-label="Photo unavailable" />
                )}
                <p className="small">
                  {item.caption && <span className="note-text">{item.caption} </span>}
                  <span className="muted">
                    {nameOf(item.uploader_id)} - {when(item.created_at)}
                    {item.proposal_id ? ' - with a proposed result' : ''}
                  </span>
                </p>
                {canDelete(item) && (
                  <ConfirmButton
                    className="btn small ghost"
                    confirmLabel="Delete?"
                    onConfirm={() => void onDelete(item)}
                    disabled={removing.busy}
                  >
                    Delete
                  </ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {st?.allowed && (
        <div className="stack">
          <label className="field">
            <span>Caption (optional)</span>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={140}
              placeholder="Sam, 7:58pm"
            />
          </label>
          <div className="row">
            <PhotoInput max={Math.min(MAX_PICK, room)} disabled={progress !== null} onPick={(f) => void onPick(f)}>
              Add photos
            </PhotoInput>
            <span className="hint" role="status">
              {progress ?? 'Big photos are shrunk for you, and their location data is removed.'}
            </span>
          </div>
        </div>
      )}
      {st && !st.allowed && st.reason && <p className="hint">{st.reason}.</p>}
      {st?.allowed && nearlyFull && (
        <p className="hint">This circle's photo storage is nearly full. An admin can delete old photos to free space.</p>
      )}
    </section>
  );
}
