import { useEffect } from 'react';
import { getMarkets, onCircleMarkets, type Market } from '../../lib';
import { useNow, useResource } from '../../hooks';
import { Link } from '../../router';
import { KIND_LABEL, phaseOf, type Phase } from '../../format';
import { Empty, ErrorNote, Loading, Pill } from '../../ui';

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

  const byPhase = (phase: Phase): Market[] =>
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
        if (phase === 'open' || phase === 'upcoming') {
          items.sort((a, b) => new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime());
        }
        return (
          <section key={phase} className="stack">
            <h2>{title}</h2>
            <ul className="list">
              {items.map((m) => {
                const p = phaseOf(m, now);
                return (
                  <li key={m.id}>
                    <Link to={`/market/${m.id}`} className="card link">
                      <strong>{m.question}</strong>
                      <div className="row">
                        <Pill tone={p.tone}>{p.label}</Pill>
                        <Pill tone="muted">{KIND_LABEL[m.kind]}</Pill>
                      </div>
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
