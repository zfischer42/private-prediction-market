import type { MarketOption } from '../../lib';

// An option joined with its current share of the pot.
export type OptionRow = MarketOption & {
  pool: number;
  betCount: number;
  pct: number | null;
};

export type NameOf = (userId: string) => string;
