import { useState, type FormEvent } from 'react';
import {
  createMarket,
  getEvidenceUploadStatus,
  getMembers,
  type CreateMarketInput,
  type MarketKind,
} from '../lib';
import { useMe, useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { KIND_HELP, KIND_LABEL, toLocalInput } from '../format';
import { useToast } from '../ui';
import PhotoInput from './market/PhotoInput';
import { uploadPhotos } from './market/photos';

const KINDS: MarketKind[] = ['binary', 'over_under', 'multi', 'open'];

export default function NewMarket({ circleId }: { circleId: number }) {
  const me = useMe();
  const members = useResource(() => getMembers(circleId), [circleId]);
  const runner = useRunner();
  const toast = useToast();

  const [question, setQuestion] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [kind, setKind] = useState<MarketKind>('binary');
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [noEndDate, setNoEndDate] = useState(false);
  const [line, setLine] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [subjectId, setSubjectId] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [eventEnd, setEventEnd] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input: CreateMarketInput = {
      circleId,
      question: question.trim(),
      kind,
    };
    if (!noEndDate) input.closesAt = new Date(closesAt);
    if (kind === 'over_under') input.line = Number(line);
    if (kind === 'multi') input.options = options.map((o) => o.trim()).filter(Boolean);
    if (subjectId) input.subjectId = subjectId;
    if (opensAt) input.opensAt = new Date(opensAt);
    if (eventEnd) input.eventEndAt = new Date(eventEnd);

    const res = await runner.run(() => createMarket(input));
    if (res.error !== undefined) return;
    const marketId = res.data;

    // The photo can only go up once the market has an id to attach to, so this is a
    // second step after creation rather than part of it. The market itself is already
    // made at this point either way - a failure here shows up as a photo, not a bet.
    if (photo) {
      const status = await getEvidenceUploadStatus(marketId);
      if (status.error !== undefined) {
        toast(`Market created, but the photo could not be added: ${status.error}`, 'error');
      } else if (!status.data.allowed) {
        toast(`Market created, but the photo could not be added: ${status.data.reason ?? 'not allowed'}`, 'error');
      } else {
        const up = await uploadPhotos([photo], { marketId, maxBytes: status.data.max_file_bytes });
        if (up.error !== undefined) {
          toast(`Market created, but the photo could not be added: ${up.error}`, 'error');
        }
      }
    }

    navigate(`/market/${marketId}`);
  }

  const setOption = (i: number, value: string) =>
    setOptions((list) => list.map((o, j) => (j === i ? value : o)));

  return (
    <form className="stack" onSubmit={onSubmit}>
      <Link to={`/circle/${circleId}`} className="back">&larr; Back to circle</Link>
      <h1>New market</h1>

      <label className="field">
        <span>Question</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder="Will Sam show up on time?"
          required
        />
      </label>

      <div className="field">
        <span>Photo (optional)</span>
        <div className="row">
          <PhotoInput max={1} onPick={([f]) => setPhoto(f)}>
            {photo ? 'Change photo' : 'Attach a photo'}
          </PhotoInput>
          {photo && (
            <button type="button" className="chip" onClick={() => setPhoto(null)}>
              {photo.name} (remove)
            </button>
          )}
        </div>
        <small className="hint">
          Goes up right after the market is created. It's shrunk for you, and its location data
          is removed.
        </small>
      </div>

      <div className="field">
        <span id="kind-label">Type</span>
        <div className="chips" role="radiogroup" aria-labelledby="kind-label">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`chip${kind === k ? ' on' : ''}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <small className="hint">{KIND_HELP[kind]}</small>
      </div>

      {kind === 'over_under' && (
        <label className="field">
          <span>Line</span>
          <input
            type="number"
            step={0.5}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="8.5"
            required
          />
        </label>
      )}

      {kind === 'multi' && (
        <div className="field">
          <span>Choices</span>
          <div className="stack">
            {options.map((o, i) => (
              <div key={i} className="row">
                <input
                  className="grow"
                  value={o}
                  onChange={(e) => setOption(i, e.target.value)}
                  maxLength={100}
                  placeholder={`Choice ${i + 1}`}
                  aria-label={`Choice ${i + 1}`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn small" onClick={() => setOptions((l) => [...l, ''])}>
              Add a choice
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <span>Betting closes</span>
        <div className="row">
          {!noEndDate && (
            <input
              type="datetime-local"
              className="grow"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              required
            />
          )}
          <button
            type="button"
            className={`chip${noEndDate ? ' on' : ''}`}
            aria-pressed={noEndDate}
            onClick={() => setNoEndDate((v) => !v)}
          >
            No end date
          </button>
        </div>
        {noEndDate && (
          <small className="hint">
            Betting stays open until someone reports what happened - good for bets like "next
            person to..." where there's nothing to schedule in advance.
          </small>
        )}
      </div>

      <details className="card">
        <summary>More options</summary>
        <div className="stack">
          <label className="field">
            <span>Betting opens</span>
            <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            <small className="hint">Leave blank to open right away.</small>
          </label>
          <label className="field">
            <span>Result is known by</span>
            <input type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
            <small className="hint">
              Nobody can propose a result before this.{' '}
              {noEndDate
                ? "Blank means no minimum wait - anyone can propose the moment it happens."
                : 'Blank means when betting closes; it cannot be earlier than that.'}
            </small>
          </label>
          <label className="field">
            <span>About someone</span>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Nobody in particular</option>
              {members.data
                ?.filter((m) => m.user_id !== me.id)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name ?? 'Someone'}
                  </option>
                ))}
            </select>
            <small className="hint">They are blocked from betting on a market about themselves.</small>
          </label>
        </div>
      </details>

      <button className="btn primary block" disabled={runner.busy || question.trim().length < 3}>
        {runner.busy ? 'Creating...' : 'Create market'}
      </button>
    </form>
  );
}
