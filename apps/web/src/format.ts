import { isBettingOpen, type Bet, type Market, type MarketKind } from './lib';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'muted';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// All money in this app is play money - whole dollars, no real transactions -
// but it's still shown with a $ so it reads as an amount rather than a score.
export const money = (n: number): string => `$${n.toLocaleString()}`;

export function signedMoney(n: number): string {
  if (n > 0) return `+$${n.toLocaleString()}`;
  if (n < 0) return `-$${Math.abs(n).toLocaleString()}`;
  return '$0';
}

// The odds view returns numeric(…,1), which arrives as a string like "70.0".
export function percent(n: number | string | null | undefined): string {
  if (n == null) return '-';
  const v = Number(n);
  if (v > 0 && v < 1) return '<1%';
  if (v < 100 && v > 99) return '>99%';
  return `${Math.round(v)}%`;
}

// Yes/No and Over/Under read as the two sides of a trade, so they get the
// green/red treatment. Multiple-choice and open markets have no such pair.
export function sideOf(kind: MarketKind, index: number): 'yes' | 'no' | null {
  if (kind !== 'binary' && kind !== 'over_under') return null;
  if (index === 0) return 'yes';
  if (index === 1) return 'no';
  return null;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function when(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '-';
}

// "in 3h 12m" / "2d ago"
export function relative(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'never';
  const ms = new Date(iso).getTime() - now.getTime();
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 1) return 'just now';

  const pair = (big: number, bigUnit: string, rest: number, restUnit: string) =>
    rest === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${rest}${restUnit}`;

  const span =
    mins < 60 ? `${mins}m`
    : mins < 60 * 24 ? pair(Math.floor(mins / 60), 'h', mins % 60, 'm')
    : pair(Math.floor(mins / 1440), 'd', Math.floor((mins % 1440) / 60), 'h');

  return ms > 0 ? `in ${span}` : `${span} ago`;
}

// The value a <input type="datetime-local"> wants: local time, no zone.
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const KIND_LABEL: Record<MarketKind, string> = {
  binary: 'Yes / No',
  over_under: 'Over / Under',
  multi: 'Multiple choice',
  open: 'Open entries',
};

// KIND_LABEL alone doesn't say what an over/under market is actually over or
// under - "Over / Under" with no number told nobody anything. This is the one
// badge that needs the market's own data, so every screen that shows a kind
// badge should go through this instead of indexing KIND_LABEL directly.
export function kindLabel(market: Pick<Market, 'kind' | 'line'>): string {
  if (market.kind === 'over_under' && market.line !== null) {
    return `Over / Under ${market.line}`;
  }
  return KIND_LABEL[market.kind];
}

export const KIND_HELP: Record<MarketKind, string> = {
  binary: 'Two options: Yes and No.',
  over_under: 'Bet over or under a number you set. Use a half number like 8.5 so a tie is impossible.',
  multi: 'You list the choices - at least two.',
  open: 'Members add their own options until 15 minutes before betting closes.',
};

export type Phase = 'upcoming' | 'open' | 'awaiting' | 'resolved' | 'voided';

// Works from the timestamps rather than market.status: status is advanced by a
// cron job and can lag, while these are what the server checks.
export function phaseOf(
  market: Market,
  now: Date = new Date(),
): { key: Phase; label: string; tone: Tone } {
  if (market.status === 'resolved') return { key: 'resolved', label: 'Resolved', tone: 'good' };
  if (market.status === 'voided') return { key: 'voided', label: 'Voided', tone: 'muted' };
  if (isBettingOpen(market, now)) {
    return market.closes_at === null
      ? { key: 'open', label: 'Open - no end date', tone: 'accent' }
      : { key: 'open', label: `Closes ${relative(market.closes_at, now)}`, tone: 'accent' };
  }
  if (now < new Date(market.opens_at)) {
    return { key: 'upcoming', label: `Opens ${relative(market.opens_at, now)}`, tone: 'neutral' };
  }
  return {
    key: 'awaiting',
    label: market.review_started_at ? 'Result under review' : 'Waiting for a result',
    tone: 'warn',
  };
}

export function betStatus(bet: Bet): { label: string; tone: Tone } {
  switch (bet.status) {
    case 'won': return { label: 'Won', tone: 'good' };
    case 'lost': return { label: 'Lost', tone: 'bad' };
    case 'void':
    case 'refunded': return { label: 'Refunded', tone: 'muted' };
    default: return { label: 'Open', tone: 'accent' };
  }
}
