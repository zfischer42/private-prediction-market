import { useState, type FormEvent } from 'react';
import { canSubmitOption, submitOption, type Market } from '../../lib';
import { useRunner } from '../../hooks';
import { percent, plural, when } from '../../format';
import { Pill } from '../../ui';
import type { OptionRow } from './types';

export default function OptionsPanel({
  market,
  rows,
  now,
  onChanged,
}: {
  market: Market;
  rows: OptionRow[];
  now: Date;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const runner = useRunner();
  const canAdd = canSubmitOption(market, now);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const res = await runner.run(() => submitOption(market.id, label.trim()), 'Option added');
    if (res.error === undefined) {
      setLabel('');
      onChanged();
    }
  }

  return (
    <section className="card stack">
      <h2>Odds</h2>

      {rows.length === 0 ? (
        <p className="hint">
          {market.kind === 'open' ? 'No options yet - add the first one.' : 'No options yet.'}
        </p>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="option">
              <div className="spread">
                <strong>{r.label}</strong>
                <span className="row">
                  {market.winning_option_id === r.id && <Pill tone="good">Winner</Pill>}
                  {r.pct !== null && <span className="muted">{percent(r.pct)}</span>}
                </span>
              </div>
              <div className="bar" role="presentation">
                <span style={{ width: `${r.pct ?? 0}%` }} />
              </div>
              <p className="muted small">
                {plural(r.pool, 'coin')} from {plural(r.betCount, 'bet')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <>
          <form className="row form-row" onSubmit={onAdd}>
            <label className="field grow">
              <span>Add an option</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                placeholder="Your answer"
              />
            </label>
            <button className="btn" disabled={runner.busy || !label.trim()}>
              Add
            </button>
          </form>
          {market.options_lock_at && (
            <p className="hint">Options can be added until {when(market.options_lock_at)}.</p>
          )}
        </>
      )}
    </section>
  );
}
