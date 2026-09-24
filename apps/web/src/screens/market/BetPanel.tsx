import { useState, type FormEvent } from 'react';
import { placeBet, projectedPayout, type Market } from '../../lib';
import { useRunner } from '../../hooks';
import { money, percent, sideOf } from '../../format';
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
      toast('Enter a whole number of dollars.', 'error');
      return;
    }
    const res = await runner.run(() => placeBet(market.id, optionId, stake));
    if (res.error === undefined) {
      toast(`Bet placed. You have ${money(res.data)} left.`);
      setAmount('');
      onPlaced();
    }
  }

  const paired = market.kind === 'binary' || market.kind === 'over_under';
  const chosenIndex = rows.findIndex((r) => r.id === optionId);
  const chosenSide = chosenIndex >= 0 ? sideOf(market.kind, chosenIndex) : null;
  const overBalance = validStake && stake > balance;

  let cta = 'Pick a side';
  if (runner.busy) cta = 'Placing...';
  else if (chosen && overBalance) cta = 'Not enough dollars';
  else if (chosen && validStake) cta = `Bet ${money(stake)} on ${chosen.label}`;
  else if (chosen) cta = 'Enter an amount';

  const sideButton = (r: OptionRow, i: number) => (
    <button
      key={r.id}
      type="button"
      role="radio"
      aria-checked={optionId === r.id}
      className={`side lg ${sideOf(market.kind, i) ?? 'neutral'}${optionId === r.id ? ' on' : ''}`}
      onClick={() => setOptionId(r.id)}
    >
      <span>{r.label}</span>
      <span>{percent(r.pct)}</span>
    </button>
  );

  return (
    <form className="card ticket" onSubmit={onSubmit}>
      <div className="spread">
        <h2>Place a bet</h2>
        <span className="muted small tnum">Balance {money(balance)}</span>
      </div>

      <div className={paired ? 'sides' : 'side-list'} role="radiogroup" aria-label="Pick a side">
        {rows.map(sideButton)}
      </div>

      <div className="stack tight">
        <label className="amount">
          <span aria-hidden>$</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            aria-label="Amount in dollars"
          />
        </label>
        <div className="chips">
          {QUICK_AMOUNTS.filter((q) => q <= balance).map((q) => (
            <button key={q} type="button" className="chip" onClick={() => setAmount(String(q))}>
              ${q}
            </button>
          ))}
          {balance > 0 && (
            <button type="button" className="chip" onClick={() => setAmount(String(balance))}>
              Max
            </button>
          )}
        </div>
      </div>

      {chosen && estimate !== null && !overBalance && (
        <dl className="summary">
          <div>
            <dt>Payout if {chosen.label} wins</dt>
            <dd className="gain">{money(estimate)}</dd>
          </div>
          <div>
            <dt>Profit</dt>
            <dd>{estimate === stake ? 'Stake back only' : `+${money(estimate - stake)}`}</dd>
          </div>
          <div>
            <dt className="small">Estimate - winners split the pot, so it moves as others bet.</dt>
          </div>
        </dl>
      )}

      <button
        className={`btn block ${chosenSide === 'no' ? 'no' : 'primary'}`}
        style={{ minHeight: '3.25rem' }}
        disabled={runner.busy || optionId === null || !validStake || overBalance}
      >
        {cta}
      </button>
    </form>
  );
}
