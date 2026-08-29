export type Identifier = string;

export type ApiHealthResponse = {
  status: 'ok';
  backend: 'fastify';
};

export type MarketOption = {
  id: string;
  label: string;
  odds: number;
};

export type MarketSummary = {
  id: string;
  question: string;
  status: 'open' | 'closed' | 'resolved';
  closesAt: string;
  options: MarketOption[];
};

export type MarketOptionDetail = {
  id: string;
  marketId: string;
  label: string;
  sortOrder: number;
  createdAt: string;
};

export type MarketOddsDetail = {
  marketId: string;
  optionId: string;
  label: string;
  sortOrder: number;
  pool: number;
  betCount: number;
  pct: number | null;
};

export type CircleSummary = {
  id: string;
  name: string;
  memberCount: number;
  season: string;
};

export type BetSummary = {
  id: string;
  marketId: string;
  optionId: string;
  optionLabel: string;
  amount: number;
  status: 'pending' | 'won' | 'lost' | 'void' | 'refunded';
  createdAt: string;
};

export type ProposalSummary = {
  id: string;
  marketId: string;
  proposer: string;
  proposedOptionId: string;
  proposedOptionLabel: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  createdAt: string;
};

export type CommentSummary = {
  id: string;
  marketId: string;
  user: string;
  body: string;
  createdAt: string;
};

export type NotificationSummary = {
  id: string;
  title: string;
  body: string;
  unread: boolean;
  createdAt: string;
};
