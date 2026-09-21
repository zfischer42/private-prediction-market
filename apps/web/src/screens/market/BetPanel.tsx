import { useState, type FormEvent } from 'react';
import { placeBet, projectedPayout, type Market } from '../../lib';
import { useRunner } from '../../hooks';
import { coins, percent } from '../../format';
import { useToast } from '../../ui';
import type { OptionRow } from './types';

const QUICK_AMOUNTS = [10, 25, 50, 100];

export default function BetPanel({
  market,
  rows,
  balance,
  blockedReason,
  onPlaced,
}: {
  market: Market;
  rows: OptionRow[];
  balance: number;
  blockedReason: string | null;
  onPlaced: () => void;
}) {
  const toast = useToast();
  const runner = useRunner();
  const [optionId, setOptionId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');

  if (blockedReason || rows.length === 0) {
    return (
      <section className="card stack">
        <h2>Place a bet</h2>
        <p className="hint">
          {blockedReason ?? 'Nobody has added an option yet, so there is nothing to bet on.'}
        </p>
      </section>
    );
  }

  const stake = Number(amount);
  const validStake = Number.isInteger(stake) && stake > 0;
  const chosen = rows.find((r) => r.id === optionId);
  const totalPool = rows.reduce((sum, r) => sum + r.pool, 0);
  // The new stake joins its own option's pool and the total before it is paid out of.
  const estimate =
    chosen && validStake ? projectedPayout(stake, chosen.pool + stake, totalPool + stake) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (optionId === null) {
      toast('Pick an option first.', 'error');
      return;
    }
    if (!validStake) {
      toast('Enter a whole number of coins.', 'error');
      return;
    }
    const res = await runner.run(() => placeBet(market.id, optionId, stake));
    if (res.error === undefined) {
      toast(`Bet placed. You have ${coins(res.data)} left.`);
      setAmount('');
      onPlaced();
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div className="spread">
        <h2>Place a bet</h2>
        <span className="muted">You have {coins(balance)}</span>
      </div>

      <div className="chips" role="radiogroup" aria-label="Option">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={optionId === r.id}
            className={`chip${optionId === r.id ? ' on' : ''}`}
            onClick={() => setOptionId(r.id)}
          >
            {r.label}
            {r.pct !== null && <span className="muted"> {percent(r.pct)}</span>}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Coins</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="25"
        />
      </label>

      <div className="chips">
        {QUICK_AMOUNTS.filter((q) => q <= balance).map((q) => (
          <button key={q} type="button" className="chip" onClick={() => setAmount(String(q))}>
            {q}
          </button>
        ))}
      </div>

      {chosen && estimate !== null && (
        <p className="hint">
          If {chosen.label} wins you would collect about {coins(estimate)}
          {estimate === stake ? ' - nobody has bet against it yet, so that is just your stake back' : ''}.
          It moves as others bet.
        </p>
      )}

      <button className="btn primary" disabled={runner.busy || optionId === null || !validStake}>
        {runner.busy ? 'Placing...' : 'Place bet'}
      </button>
    </form>
  );
}
