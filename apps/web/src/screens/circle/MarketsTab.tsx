import { useEffect } from 'react';
import {
  getMarkets,
  getOddsForMarkets,
  onCircleMarkets,
  type Market,
  type MarketOdds,
  type MarketOption,
} from '../../lib';
import { useNow, useResource } from '../../hooks';
import { Link } from '../../router';
import { kindLabel, money, percent, phaseOf, plural, sideOf, type Phase } from '../../format';
import { Empty, ErrorNote, Loading } from '../../ui';

type MarketRow = Market & { options: MarketOption[] };

const SECTIONS: Array<{ phase: Phase; title: string }> = [
  { phase: 'open', title: 'Open' },
  { phase: 'awaiting', title: 'Waiting for a result' },
  { phase: 'upcoming', title: 'Coming up' },
  { phase: 'resolved', title: 'Settled' },
];

const MAX_OUTCOMES = 3;

export default function MarketsTab({ circleId }: { circleId: number }) {
  const markets = useResource(() => getMarkets(circleId, { limit: 100 }), [circleId]);
  const ids = (markets.data ?? []).map((m) => m.id);
  const odds = useResource(() => getOddsForMarkets(ids), [ids.join(',')]);
  const now = useNow();

  useEffect(
    () =>
      onCircleMarkets(
        circleId,
        () => {
          void markets.reload();
          void odds.reload();
        },
        { onError: console.warn },
      ),
    [circleId, markets.reload, odds.reload],
  );

  if (markets.loading) return <Loading />;
  if (!markets.data) {
    return <ErrorNote message={markets.error ?? 'Could not load markets.'} onRetry={markets.reload} />;
  }

  const oddsByMarket = new Map<number, MarketOdds[]>();
  for (const o of odds.data ?? []) {
    const list = oddsByMarket.get(o.market_id) ?? [];
    list.push(o);
    oddsByMarket.set(o.market_id, list);
  }

  const byPhase = (phase: Phase): MarketRow[] =>
    markets.data!.filter((m) => {
      const p = phaseOf(m, now).key;
      // Voided markets sit with the settled ones.
      return phase === 'resolved' ? p === 'resolved' || p === 'voided' : p === phase;
    });

  return (
    <div className="stack">
      <Link to={`/circle/${circleId}/new-market`} className="btn block">
        + New market
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
            <div className="section-head">
              <h2>{title}</h2>
              <span className="muted small">{items.length}</span>
            </div>
            <ul className="list">
              {items.map((m) => (
                <li key={m.id}>
                  <MarketCard market={m} odds={oddsByMarket.get(m.id) ?? []} now={now} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MarketCard({ market, odds, now }: { market: MarketRow; odds: MarketOdds[]; now: Date }) {
  const phase = phaseOf(market, now);
  // sort_order, not insertion order - matches every other options list in the app.
  const options = [...market.options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => {
      const od = odds.find((x) => x.option_id === o.id);
      return { ...o, pct: od?.pct ?? null, pool: od?.pool ?? 0 };
    });
  const pool = options.reduce((sum, o) => sum + Number(o.pool), 0);
  const betCount = odds.reduce((sum, o) => sum + Number(o.bet_count), 0);
  const paired = market.kind === 'binary' || market.kind === 'over_under';
  const winner = options.find((o) => o.id === market.winning_option_id);
  const settled = phase.key === 'resolved' || phase.key === 'voided';

  // Paired markets lead with the first side's chance, the way Kalshi shows "63% chance".
  const lead = paired ? options[0] : null;

  const ranked = [...options].sort((a, b) => Number(b.pct ?? 0) - Number(a.pct ?? 0));
  const shown = ranked.slice(0, MAX_OUTCOMES);

  return (
    <Link to={`/market/${market.id}`} className="mcard">
      <div className="mcard-top">
        <span className="mcard-q">{market.question}</span>
        {lead && !settled && (
          <span className="chance">
            <strong>{lead.pct === null ? '-' : percent(lead.pct)}</strong>
            <span>{market.kind === 'binary' ? 'chance' : lead.label}</span>
          </span>
        )}
      </div>

      {settled ? (
        <div className="outcomes">
          {phase.key === 'voided' ? (
            <span className="muted small">Voided - every stake refunded</span>
          ) : winner ? (
            <div className="outcome winner">
              <span className="label-text">✓ {winner.label}</span>
              <span className="pct muted small">Winner</span>
            </div>
          ) : null}
        </div>
      ) : options.length === 0 ? (
        <span className="muted small">No options yet - be the first to add one</span>
      ) : paired ? (
        <div className="sides">
          {options.slice(0, 2).map((o, i) => (
            <span key={o.id} className={`side ${sideOf(market.kind, i) ?? 'neutral'}`}>
              <span>{o.label}</span>
              <span>{percent(o.pct)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="outcomes">
          {shown.map((o) => (
            <div key={o.id} className="outcome">
              <span className="label-text">{o.label}</span>
              <span className="pct">{percent(o.pct)}</span>
              <div className="bar neutral" role="presentation">
                <span style={{ width: `${o.pct ?? 0}%` }} />
              </div>
            </div>
          ))}
          {ranked.length > MAX_OUTCOMES && (
            <span className="muted small">+{ranked.length - MAX_OUTCOMES} more</span>
          )}
        </div>
      )}

      <div className="mcard-meta">
        <span>{money(pool)} pool</span>
        <span className="dot" />
        <span>{plural(betCount, 'bet')}</span>
        <span className="dot" />
        <span className={phase.key === 'open' ? 'live' : undefined}>{phase.label}</span>
        {!paired && (
          <>
            <span className="dot" />
            <span>{kindLabel(market)}</span>
          </>
        )}
      </div>
    </Link>
  );
}
