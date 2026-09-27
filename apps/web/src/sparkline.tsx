// How a market's odds moved as bets came in - reconstructed client-side from
// the same bet rows the rest of the app already fetches, not a new backend
// endpoint. See DESIGN.md's "Motion and delight" table for where this is used.
//
// Chart choice, straight from the dataviz playbook: with several options
// competing for the same pot, "tell distinct series apart" is the job, but a
// tight card only has room to tell one story - the leader pulling ahead. So
// the tiny home-card sparkline draws just the leading option's line (the
// stat-tile trend pattern); the fuller per-market chart draws every option
// but still uses "emphasis" (leader in the accent color, the field in gray)
// rather than a full categorical palette, which this design system doesn't
// have and a betting app with 2-6 near-identical option lines doesn't need.
import { Percent } from './num';

export interface OddsSeries {
  optionId: number;
  label: string;
  points: number[]; // one pct per bet event, oldest first - same length for every series
  leading: boolean;
}

interface HistoryBet {
  option_id: number;
  amount: number;
  created_at: string;
  voided_at: string | null;
}

// null means "not enough happened yet to draw a line" (fewer than two bets
// that still count) - callers should show a plain sentence instead of a chart.
export function computeOddsHistory(
  options: Array<{ id: number; label: string }>,
  bets: HistoryBet[],
): OddsSeries[] | null {
  const live = bets
    .filter((b) => b.voided_at === null)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (live.length < 2 || options.length === 0) return null;

  const totals = new Map(options.map((o) => [o.id, 0]));
  const points = new Map<number, number[]>(options.map((o) => [o.id, []]));
  let grand = 0;

  for (const bet of live) {
    if (!totals.has(bet.option_id)) continue; // defensive: an option row we weren't given
    totals.set(bet.option_id, (totals.get(bet.option_id) ?? 0) + bet.amount);
    grand += bet.amount;
    for (const o of options) {
      const pct = grand > 0 ? ((totals.get(o.id) ?? 0) / grand) * 100 : 0;
      points.get(o.id)!.push(pct);
    }
  }

  let leadingId = options[0].id;
  let bestPct = -1;
  for (const o of options) {
    const last = points.get(o.id)!.at(-1) ?? 0;
    if (last > bestPct) {
      bestPct = last;
      leadingId = o.id;
    }
  }

  return options.map((o) => ({
    optionId: o.id,
    label: o.label,
    points: points.get(o.id)!,
    leading: o.id === leadingId,
  }));
}

// Building block for both chart sizes below - not exported, since a caller
// should reach for computeOddsHistory() and one of the two components rather
// than hand-roll a path.
function scaleX(i: number, n: number, width: number): number {
  return n === 1 ? width / 2 : (i / (n - 1)) * width;
}

function scaleY(v: number, height: number, padY: number): number {
  return height - padY - (Math.max(0, Math.min(100, v)) / 100) * (height - padY * 2);
}

function linePath(values: number[], width: number, height: number, padY: number): string {
  const n = values.length;
  if (n === 0) return '';
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i, n, width).toFixed(1)} ${scaleY(v, height, padY).toFixed(1)}`)
    .join(' ');
}

// The tiny, decorative trend line for a home-card preview - the stat-tile
// pattern (value + trend), so it carries no information the adjacent
// odds/percent text doesn't already say, and needs no legend or interaction.
// `width` is only the virtual coordinate space the path math uses; the
// rendered element always stretches to fill its container (see .sparkline).
export function Sparkline({
  points,
  width = 280,
  height = 64,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const padY = 6;
  const d = linePath(points, width, height, padY);
  const areaD = `${d} L ${width} ${height} L 0 ${height} Z`;
  // As percentages, not SVG coordinates: preserveAspectRatio="none" scales x
  // and y by different factors whenever the card's rendered width doesn't
  // match `width`, which is fine for a line (it's just direction) but turns
  // a circle into an ellipse. An HTML dot laid on top, positioned by
  // percentage, stays round regardless of that stretch.
  const lastXPct = (scaleX(points.length - 1, points.length, width) / width) * 100;
  const lastYPct = (scaleY(points[points.length - 1], height, padY) / height) * 100;
  return (
    <span className="sparkline-wrap" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="sparkline"
        aria-hidden="true"
      >
        <path d={areaD} fill="var(--accent)" opacity="0.1" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* "This is live" - a ping at the current odds, not just a chart of the past. */}
      <span className="sparkline-dot" style={{ left: `${lastXPct}%`, top: `${lastYPct}%` }} aria-hidden="true">
        <span className="sparkline-pulse" />
      </span>
    </span>
  );
}

// The fuller "odds over time" chart for a market's own page - every option,
// emphasis color (leader in --accent, the field in --muted), direct-labeled
// so nothing is locked behind a hover a phone can't do. The chart itself is
// aria-hidden; the paragraph after it is the text-equivalent screen readers
// get instead - not a decoration, the actual accessible version.
export function OddsHistoryChart({
  series,
  width = 320,
  height = 120,
}: {
  series: OddsSeries[];
  width?: number;
  height?: number;
}) {
  if (series.length === 0 || (series[0]?.points.length ?? 0) < 2) return null;
  const rest = series.filter((s) => !s.leading);
  const leader = series.filter((s) => s.leading);

  return (
    <div className="odds-chart">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {rest.map((s) => (
          <path
            key={s.optionId}
            d={linePath(s.points, width, height, 6)}
            fill="none"
            stroke="var(--muted)"
            strokeOpacity="0.55"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {leader.map((s) => (
          <path
            key={s.optionId}
            d={linePath(s.points, width, height, 6)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="odds-chart-legend">
        {series.map((s) => (
          <span key={s.optionId} className="odds-chart-key">
            <i className={s.leading ? 'on' : ''} />
            {s.label} <Percent value={Math.round(s.points.at(-1) ?? 0)} />
          </span>
        ))}
      </div>
      <p className="sr-only">
        Odds over time, from the first bet to now:{' '}
        {series
          .map((s) => `${s.label} went from ${Math.round(s.points[0])}% to ${Math.round(s.points.at(-1) ?? 0)}%`)
          .join('; ')}
        .
      </p>
    </div>
  );
}
