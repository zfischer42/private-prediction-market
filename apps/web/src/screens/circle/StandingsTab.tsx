import { useState } from 'react';
import { getLeaderboard, getSeasonLeaderboard, getSeasons, type Result } from '../../lib';
import { useResource } from '../../hooks';
import { money, percent, signedMoney } from '../../format';
import { Empty, ErrorNote, Loading } from '../../ui';

// The all-time and per-season boards share these columns.
type Standing = {
  user_id: string;
  display_name: string | null;
  net_profit: number;
  bets_won: number;
  bets_settled: number;
  win_pct: number | null;
  balance?: number;
};

type Scope = 'all' | number;

async function loadStandings(circleId: number, scope: Scope): Promise<Result<Standing[]>> {
  return scope === 'all' ? getLeaderboard(circleId) : getSeasonLeaderboard(scope);
}

export default function StandingsTab({ circleId, myId }: { circleId: number; myId: string }) {
  const seasons = useResource(() => getSeasons(circleId), [circleId]);
  const [scope, setScope] = useState<Scope>('all');
  const board = useResource(() => loadStandings(circleId, scope), [circleId, scope]);

  return (
    <div className="stack">
      <p className="hint">Ranked by profit from bets, not balance - dollars an admin hands out do not count.</p>

      {seasons.data && seasons.data.length > 0 && (
        <div className="chips" role="radiogroup" aria-label="Scope">
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'all'}
            className={`chip${scope === 'all' ? ' on' : ''}`}
            onClick={() => setScope('all')}
          >
            All time
          </button>
          {seasons.data.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={scope === s.id}
              className={`chip${scope === s.id ? ' on' : ''}`}
              onClick={() => setScope(s.id)}
            >
              {s.name}
              {s.is_active ? ' (current)' : ''}
            </button>
          ))}
        </div>
      )}

      {board.loading ? (
        <Loading />
      ) : !board.data ? (
        <ErrorNote message={board.error ?? 'Could not load standings.'} onRetry={board.reload} />
      ) : board.data.length === 0 ? (
        <Empty>Nobody is on the board yet.</Empty>
      ) : (
        <ol className="list standings">
          {board.data.map((row, i) => (
            <li key={row.user_id} className={`card${row.user_id === myId ? ' me' : ''}`}>
              <span className="rank">{i + 1}</span>
              <div className="grow">
                <strong>{row.display_name ?? 'Someone'}</strong>
                {row.user_id === myId && <span className="muted"> (you)</span>}
                <p className="muted">
                  {row.bets_settled === 0
                    ? 'No settled bets yet'
                    : `${row.bets_won} of ${row.bets_settled} won (${percent(row.win_pct)})`}
                  {row.balance !== undefined && ` - ${money(row.balance)}`}
                </p>
              </div>
              <strong className={row.net_profit > 0 ? 'gain' : row.net_profit < 0 ? 'loss' : ''}>
                {signedMoney(row.net_profit)}
              </strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
