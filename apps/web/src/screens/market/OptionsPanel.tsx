import { useState, type FormEvent } from 'react';
import { canSubmitOption, submitOption, type Bet, type Market } from '../../lib';
import { useRunner } from '../../hooks';
import { plural, when } from '../../format';
import { Money } from '../../num';
import { OddsBars } from '../../oddsbars';
import { computeOddsHistory, OddsHistoryChart } from '../../sparkline';
import type { OptionRow } from './types';

function OddsOverTime({ rows, bets }: { rows: OptionRow[]; bets: Bet[] }) {
  const history = computeOddsHistory(
    rows.map((r) => ({ id: r.id, label: r.label })),
    bets,
  );
  return (
    <div className="stack tight">
      <h3>Odds over time</h3>
      {history ? (
        <OddsHistoryChart series={history} />
      ) : (
        <p className="hint">Once a couple more bets come in, you'll see how the odds moved.</p>
      )}
    </div>
  );
}

export default function OptionsPanel({
  market,
  rows,
  bets,
  now,
  onChanged,
}: {
  market: Market;
  rows: OptionRow[];
  bets: Bet[];
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
        <OddsBars
          winningOptionId={market.winning_option_id}
          rows={rows.map((r) => ({
            id: r.id,
            label: r.label,
            pct: r.pct,
            meta: (
              <>
                <Money value={r.pool} /> from {plural(r.betCount, 'bet')}
              </>
            ),
          }))}
        />
      )}

      {rows.length > 0 && <OddsOverTime rows={rows} bets={bets} />}

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
