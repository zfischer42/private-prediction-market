import { voidBet, type Bet } from '../../lib';
import { useRunner } from '../../hooks';
import { betStatus, coins, signed, when } from '../../format';
import { ConfirmButton, Pill } from '../../ui';
import type { NameOf, OptionRow } from './types';

export function MyBets({ bets, rows }: { bets: Bet[]; rows: OptionRow[] }) {
  if (bets.length === 0) return null;
  const labels = new Map(rows.map((r) => [r.id, r.label]));

  return (
    <section className="card stack">
      <h2>Your bets</h2>
      <ul className="list">
        {bets.map((b) => {
          const status = betStatus(b);
          return (
            <li key={b.id} className="stack tight">
              <div className="spread">
                <span>
                  <strong>{labels.get(b.option_id) ?? 'Option'}</strong> - {coins(b.amount)}
                </span>
                <span className="row">
                  {b.status === 'pending' && b.was_late && <Pill tone="warn">Late</Pill>}
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {b.status === 'won' && <span className="gain">{signed(b.payout - b.amount)}</span>}
                </span>
              </div>
              {b.status === 'pending' && b.was_late && (
                <p className="hint">
                  Placed after a result was proposed. If that result is approved and you backed the
                  winner, this bet is refunded instead of paid.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AllBets({
  bets,
  rows,
  nameOf,
  canVoid,
  onChanged,
}: {
  bets: Bet[];
  rows: OptionRow[];
  nameOf: NameOf;
  canVoid: boolean;
  onChanged: () => void;
}) {
  const runner = useRunner();
  const labels = new Map(rows.map((r) => [r.id, r.label]));

  async function voidOne(bet: Bet) {
    const res = await runner.run(() => voidBet(bet.id, 'Voided by an admin'), 'Bet voided and refunded');
    if (res.error === undefined) onChanged();
  }

  return (
    <details className="card">
      <summary>Who bet what ({bets.length})</summary>
      {bets.length === 0 ? (
        <p className="hint">No bets yet.</p>
      ) : (
        <ul className="list">
          {bets.map((b) => (
            <li key={b.id} className="spread">
              <span>
                <strong>{nameOf(b.user_id)}</strong> on {labels.get(b.option_id) ?? 'Option'} -{' '}
                {coins(b.amount)}
                <span className="muted small"> {when(b.created_at)}</span>
              </span>
              {canVoid && b.status === 'pending' && (
                <ConfirmButton
                  className="btn small danger"
                  confirmLabel="Confirm void"
                  onConfirm={() => void voidOne(b)}
                  disabled={runner.busy}
                >
                  Void
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
