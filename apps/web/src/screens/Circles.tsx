import { useState, type FormEvent } from 'react';
import {
  getMarketBets,
  getMarkets,
  getOdds,
  isBettingOpen,
  createCircle,
  getMyCircles,
  joinCircle,
  type Bet,
  type Market,
  type MarketOdds,
  type MarketOption,
  type Result,
} from '../lib';
import { useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { money, phaseOf } from '../format';
import { Empty, ErrorNote, Loading, Pill } from '../ui';
import { Percent } from '../num';
import { OddsBars } from '../oddsbars';
import { computeOddsHistory, Sparkline } from '../sparkline';

// The newest market in a circle, plus enough to show its live odds and a
// trend line - three small reads composed into the one thing a home-card
// preview needs, the same way loadStandings() does in StandingsTab.tsx.
type LatestMarket = {
  market: Market & { options: MarketOption[] };
  odds: MarketOdds[];
  bets: Bet[];
};

// Among the circle's recently created markets, an open one wins even if a
// newer market has already been resolved - a settled market's odds are a
// dead number, not the "what's happening" a home card should lead with.
// Falls back to the single newest market when nothing is open right now.
async function loadLatestMarket(circleId: number): Promise<Result<LatestMarket | null>> {
  const markets = await getMarkets(circleId, { orderBy: 'created_at', limit: 20 });
  if (markets.error !== undefined) return { error: markets.error };
  if (markets.data.length === 0) return { data: null };

  const now = new Date();
  const market = markets.data.find((m) => isBettingOpen(m, now)) ?? markets.data[0];

  const [odds, bets] = await Promise.all([getOdds(market.id), getMarketBets(market.id)]);
  if (odds.error !== undefined) return { error: odds.error };
  if (bets.error !== undefined) return { error: bets.error };
  return { data: { market, odds: odds.data, bets: bets.data } };
}

function LatestMarketPreview({ circleId }: { circleId: number }) {
  const preview = useResource(() => loadLatestMarket(circleId), [circleId]);
  if (preview.loading || !preview.data || preview.error) return null;

  const { market, odds, bets } = preview.data;
  const rows = [...market.options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => ({ id: o.id, label: o.label, pct: odds.find((x) => x.option_id === o.id)?.pct ?? null }));

  let leading: { id: number; label: string; pct: number } | null = null;
  for (const r of rows) {
    if (r.pct !== null && (leading === null || r.pct > leading.pct)) {
      leading = { id: r.id, label: r.label, pct: r.pct };
    }
  }

  const history = computeOddsHistory(
    market.options.map((o) => ({ id: o.id, label: o.label })),
    bets,
  );
  const leadingPoints = history?.find((s) => s.optionId === leading?.id)?.points;
  const phase = phaseOf(market);

  return (
    <div className="market-preview">
      <span className="label">Latest market</span>
      <div className="spread">
        <p className="clamp-2 small grow">{market.question}</p>
        <Pill tone={phase.tone}>{phase.label}</Pill>
      </div>
      {leading ? (
        <span className="muted small">
          {leading.label} &middot; <Percent value={Math.round(leading.pct)} />
        </span>
      ) : (
        <span className="hint small">No bets yet.</span>
      )}
      {leadingPoints && <Sparkline points={leadingPoints} />}
      {rows.length > 0 && <OddsBars rows={rows} winningOptionId={market.winning_option_id} />}
    </div>
  );
}

export default function Circles() {
  const circles = useResource(() => getMyCircles(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const creating = useRunner();
  const joining = useRunner();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await creating.run(() => createCircle(name.trim()));
    if (res.error === undefined) navigate(`/circle/${res.data}`);
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    const res = await joining.run(() => joinCircle(code.trim()));
    if (res.error === undefined) navigate(`/circle/${res.data}`);
  }

  let list;
  if (circles.loading) {
    list = <Loading />;
  } else if (!circles.data) {
    list = <ErrorNote message={circles.error ?? 'Could not load your circles.'} onRetry={circles.reload} />;
  } else if (circles.data.length === 0) {
    list = (
      <Empty>
        You are not in any circles yet. Start one below, or join a friend's with their
        6-character code.
      </Empty>
    );
  } else {
    list = (
      <ul className="list">
        {circles.data.map((row) => (
          <li key={row.circle_id}>
            <Link to={`/circle/${row.circle_id}`} className="card link">
              <div className="spread">
                <strong>{row.circle.name}</strong>
                {row.role === 'admin' && <Pill tone="accent">Admin</Pill>}
              </div>
              <p className="muted">{money(row.balance)}</p>
              <LatestMarketPreview circleId={row.circle_id} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stack">
      <h1>Your circles</h1>
      {list}

      <div className="grid-2">
        <form className="card stack" onSubmit={onCreate}>
          <h2>Start a circle</h2>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Friday poker crew"
              required
            />
          </label>
          <button className="btn primary" disabled={creating.busy || !name.trim()}>
            {creating.busy ? 'Creating...' : 'Create circle'}
          </button>
        </form>

        <form className="card stack" onSubmit={onJoin}>
          <h2>Join with a code</h2>
          <label className="field">
            <span>Invite code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={12}
              placeholder="A1B2C3"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <button className="btn primary" disabled={joining.busy || !code.trim()}>
            {joining.busy ? 'Joining...' : 'Join circle'}
          </button>
        </form>
      </div>
    </div>
  );
}
