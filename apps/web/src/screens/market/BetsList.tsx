import { useEffect, useRef } from 'react';
import { voidBet, type Bet } from '../../lib';
import { useRunner } from '../../hooks';
import { betStatus, money, when } from '../../format';
import { ConfirmButton, Pill } from '../../ui';
import { Money, SignedMoney } from '../../num';
import { celebrateWin } from '../../celebrate';
import type { NameOf, OptionRow } from './types';

const CELEBRATED_KEY = 'ppm_celebrated_wins';

function loadCelebrated(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveCelebrated(ids: Set<number>) {
  try {
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...ids]));
  } catch {
    // No storage (private mode, etc.) - the celebration just replays next visit.
  }
}

export function MyBets({ bets, rows }: { bets: Bet[]; rows: OptionRow[] }) {
  // Fires once, the first time this browser sees each of your bets as won -
  // not on every refetch, and not for wins you already knew about.
  const seenIds = useRef<string>('');
  useEffect(() => {
    const won = bets.filter((b) => b.status === 'won').map((b) => b.id);
    const key = won.join(',');
    if (key === seenIds.current) return;
    seenIds.current = key;
    if (won.length === 0) return;
    const celebrated = loadCelebrated();
    const fresh = won.filter((id) => !celebrated.has(id));
    if (fresh.length === 0) return;
    celebrateWin();
    fresh.forEach((id) => celebrated.add(id));
    saveCelebrated(celebrated);
  }, [bets]);

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
                  <strong>{labels.get(b.option_id) ?? 'Option'}</strong> - <Money value={b.amount} />
                </span>
                <span className="row">
                  {b.status === 'pending' && b.was_late && <Pill tone="warn">Late</Pill>}
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {b.status === 'won' && (
                    <span className="gain">
                      <SignedMoney value={b.payout - b.amount} />
                    </span>
                  )}
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
                {money(b.amount)}
                <span className="muted small"> {when(b.created_at)}</span>
              </span>
              {b.status === 'void' && <Pill tone="muted">{betStatus(b).label}</Pill>}
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
