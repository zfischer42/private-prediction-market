import { useEffect, useState, type FormEvent } from 'react';
import { addComment, deleteComment, getComments, onCircleComments } from '../../lib';
import { useResource, useRunner } from '../../hooks';
import { when } from '../../format';
import { ConfirmButton, ErrorNote, Loading } from '../../ui';

type NameOf = (userId: string) => string;

// One running chat for the whole circle - not attached to any one market.
// v9 replaced per-market "trash talk" with this: most of what people typed
// there was never actually about the bet it happened to be posted under.
export default function ChatTab({
  circleId,
  nameOf,
  myId,
}: {
  circleId: number;
  nameOf: NameOf;
  myId: string;
}) {
  const comments = useResource(() => getComments(circleId), [circleId]);
  const [body, setBody] = useState('');
  const posting = useRunner();
  const deleting = useRunner();

  useEffect(
    () => onCircleComments(circleId, () => void comments.reload(), { onError: console.warn }),
    [circleId, comments.reload],
  );

  async function onPost(e: FormEvent) {
    e.preventDefault();
    const res = await posting.run(() => addComment(circleId, body.trim()));
    if (res.error === undefined) {
      setBody('');
      void comments.reload();
    }
  }

  async function onDelete(id: number) {
    const res = await deleting.run(() => deleteComment(id));
    if (res.error === undefined) void comments.reload();
  }

  return (
    <section className="card stack">
      {comments.loading ? (
        <Loading />
      ) : !comments.data ? (
        <ErrorNote message={comments.error ?? 'Could not load the chat.'} onRetry={comments.reload} />
      ) : comments.data.length === 0 ? (
        <p className="hint">Nothing yet. Be the first.</p>
      ) : (
        <ul className="list">
          {comments.data.map((c) => (
            <li key={c.id} className="stack tight">
              <div className="spread">
                <span>
                  <strong>{nameOf(c.user_id)}</strong>{' '}
                  <span className="muted small">{when(c.created_at)}</span>
                </span>
                {c.user_id === myId && (
                  <ConfirmButton
                    className="btn small ghost"
                    confirmLabel="Delete?"
                    onConfirm={() => void onDelete(c.id)}
                    disabled={deleting.busy}
                  >
                    Delete
                  </ConfirmButton>
                )}
              </div>
              <p className="note-text">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="stack" onSubmit={onPost}>
        <label className="field">
          <span>Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Say something to the circle"
          />
        </label>
        <button className="btn" disabled={posting.busy || !body.trim()}>
          Post
        </button>
      </form>
    </section>
  );
}
