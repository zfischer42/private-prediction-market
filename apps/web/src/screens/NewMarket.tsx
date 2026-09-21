import { useState, type FormEvent } from 'react';
import { createMarket, getMembers, type CreateMarketInput, type MarketKind } from '../lib';
import { useMe, useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { KIND_HELP, KIND_LABEL, toLocalInput } from '../format';

const KINDS: MarketKind[] = ['binary', 'over_under', 'multi', 'open'];

export default function NewMarket({ circleId }: { circleId: number }) {
  const me = useMe();
  const members = useResource(() => getMembers(circleId), [circleId]);
  const runner = useRunner();

  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<MarketKind>('binary');
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)));
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
      closesAt: new Date(closesAt),
    };
    if (kind === 'over_under') input.line = Number(line);
    if (kind === 'multi') input.options = options.map((o) => o.trim()).filter(Boolean);
    if (subjectId) input.subjectId = subjectId;
    if (opensAt) input.opensAt = new Date(opensAt);
    if (eventEnd) input.eventEndAt = new Date(eventEnd);

    const res = await runner.run(() => createMarket(input));
    if (res.error === undefined) navigate(`/market/${res.data}`);
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

      <label className="field">
        <span>Betting closes</span>
        <input
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          required
        />
      </label>

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
              Nobody can propose a result before this. Blank means when betting closes; it cannot
              be earlier than that.
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
