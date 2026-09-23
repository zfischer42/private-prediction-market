import { useEffect } from 'react';
import { getMarkets, onCircleMarkets, type Market, type MarketOption } from '../../lib';
import { useNow, useResource } from '../../hooks';
import { Link } from '../../router';
import { kindLabel, phaseOf, type Phase } from '../../format';
import { Empty, ErrorNote, Loading, Pill } from '../../ui';

type MarketRow = Market & { options: MarketOption[] };

const SECTIONS: Array<{ phase: Phase; title: string }> = [
  { phase: 'open', title: 'Open for betting' },
  { phase: 'awaiting', title: 'Waiting for a result' },
  { phase: 'upcoming', title: 'Coming up' },
  { phase: 'resolved', title: 'Settled' },
];

export default function MarketsTab({ circleId }: { circleId: number }) {
  const markets = useResource(() => getMarkets(circleId, { limit: 100 }), [circleId]);
  const now = useNow();

  useEffect(
    () => onCircleMarkets(circleId, () => void markets.reload(), { onError: console.warn }),
    [circleId, markets.reload],
  );

  if (markets.loading) return <Loading />;
  if (!markets.data) {
    return <ErrorNote message={markets.error ?? 'Could not load markets.'} onRetry={markets.reload} />;
  }

  const byPhase = (phase: Phase): MarketRow[] =>
    markets.data!.filter((m) => {
      const p = phaseOf(m, now).key;
      // Voided markets sit with the settled ones.
      return phase === 'resolved' ? p === 'resolved' || p === 'voided' : p === phase;
    });

  return (
    <div className="stack">
      <Link to={`/circle/${circleId}/new-market`} className="btn primary block">
        New market
      </Link>

      {markets.data.length === 0 && (
        <Empty>No markets yet. Ask the group a question worth betting on.</Empty>
      )}

      {SECTIONS.map(({ phase, title }) => {
        const items = byPhase(phase);
        if (items.length === 0) return null;
        // Soonest deadline first while it matters; newest first once settled.
        // A standing bet (no closes_at) has no deadline pressure, so it sorts
        // after everything that does rather than accidentally claiming first
        // place (new Date(null) is the epoch, which is always "soonest").
        if (phase === 'open' || phase === 'upcoming') {
          const deadline = (m: (typeof items)[number]) =>
            m.closes_at === null ? Infinity : new Date(m.closes_at).getTime();
          items.sort((a, b) => deadline(a) - deadline(b));
        }
        return (
          <section key={phase} className="stack">
            <h2>{title}</h2>
            <ul className="list">
              {items.map((m) => {
                const p = phaseOf(m, now);
                // sort_order, not insertion order - matches every other options list in the app.
                const options = [...m.options].sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <li key={m.id}>
                    <Link to={`/market/${m.id}`} className="card link">
                      <strong>{m.question}</strong>
                      <div className="row">
                        <Pill tone={p.tone}>{p.label}</Pill>
                        <Pill tone="muted">{kindLabel(m)}</Pill>
                      </div>
                      {options.length === 0 ? (
                        <span className="muted small">No options yet</span>
                      ) : (
                        <div className="row">
                          {options.map((o) => (
                            <Pill
                              key={o.id}
                              tone={o.id === m.winning_option_id ? 'good' : 'muted'}
                              className="wrap"
                            >
                              {o.label}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
