import type {
  ApiHealthResponse,
  BetSummary,
  CircleSummary,
  CommentSummary,
  MarketOptionDetail,
  MarketOddsDetail,
  MarketSummary,
  NotificationSummary,
  ProposalSummary,
} from '@ppm/types';

export type BackendHealth = ApiHealthResponse;

export type MarketListResponse = {
  count: number;
  markets: MarketSummary[];
};

export type CircleListResponse = {
  count: number;
  circles: CircleSummary[];
};

export type BetListResponse = {
  count: number;
  marketId: string | null;
  bets: BetSummary[];
};

export type MarketOptionsResponse = {
  count: number;
  marketId: string;
  options: MarketOptionDetail[];
};

export type MarketOddsResponse = {
  count: number;
  marketId: string;
  odds: MarketOddsDetail[];
};

export type ProposalListResponse = {
  count: number;
  marketId: string;
  proposals: ProposalSummary[];
};

export type CommentListResponse = {
  count: number;
  marketId: string;
  comments: CommentSummary[];
};

export type NotificationListResponse = {
  count: number;
  notifications: NotificationSummary[];
};

export async function getBackendHealth(): Promise<BackendHealth> {
  const response = await fetch('http://localhost:3001/api/health');

  if (!response.ok) {
    throw new Error('Backend health check failed');
  }

  return (await response.json()) as BackendHealth;
}

export async function getMarkets(): Promise<MarketListResponse> {
  const response = await fetch('http://localhost:3001/api/markets');

  if (!response.ok) {
    throw new Error('Failed to load markets');
  }

  return (await response.json()) as MarketListResponse;
}

export async function getCircles(): Promise<CircleListResponse> {
  const response = await fetch('http://localhost:3001/api/circles');

  if (!response.ok) {
    throw new Error('Failed to load circles');
  }

  return (await response.json()) as CircleListResponse;
}

export async function getMarketBets(marketId: string): Promise<BetListResponse> {
  const response = await fetch(`http://localhost:3001/api/bets?marketId=${encodeURIComponent(marketId)}`);

  if (!response.ok) {
    throw new Error('Failed to load bets');
  }

  return (await response.json()) as BetListResponse;
}

export async function getMarketOptions(marketId: string): Promise<MarketOptionsResponse> {
  const response = await fetch(`http://localhost:3001/api/markets/${encodeURIComponent(marketId)}/options`);

  if (!response.ok) {
    throw new Error('Failed to load market options');
  }

  return (await response.json()) as MarketOptionsResponse;
}

export async function getMarketOdds(marketId: string): Promise<MarketOddsResponse> {
  const response = await fetch(`http://localhost:3001/api/markets/${encodeURIComponent(marketId)}/odds`);

  if (!response.ok) {
    throw new Error('Failed to load market odds');
  }

  return (await response.json()) as MarketOddsResponse;
}

export async function placeBet(marketId: string, optionId: string, amount: number): Promise<{ success: boolean; bet: BetSummary }> {
  const response = await fetch('http://localhost:3001/api/bets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId, optionId, amount }),
  });

  if (!response.ok) {
    throw new Error('Failed to place bet');
  }

  return (await response.json()) as { success: boolean; bet: BetSummary };
}

export async function getMarketProposals(marketId: string): Promise<ProposalListResponse> {
  const response = await fetch(`http://localhost:3001/api/markets/${encodeURIComponent(marketId)}/proposals`);

  if (!response.ok) {
    throw new Error('Failed to load proposals');
  }

  return (await response.json()) as ProposalListResponse;
}

export async function getMarketComments(marketId: string): Promise<CommentListResponse> {
  const response = await fetch(`http://localhost:3001/api/markets/${encodeURIComponent(marketId)}/comments`);

  if (!response.ok) {
    throw new Error('Failed to load comments');
  }

  return (await response.json()) as CommentListResponse;
}

export async function addMarketComment(marketId: string, user: string, body: string): Promise<{ success: boolean; comment: CommentSummary }> {
  const response = await fetch(`http://localhost:3001/api/markets/${encodeURIComponent(marketId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, body }),
  });

  if (!response.ok) {
    throw new Error('Failed to add comment');
  }

  return (await response.json()) as { success: boolean; comment: CommentSummary };
}

export async function getNotifications(): Promise<NotificationListResponse> {
  const response = await fetch('http://localhost:3001/api/notifications');

  if (!response.ok) {
    throw new Error('Failed to load notifications');
  }

  return (await response.json()) as NotificationListResponse;
}
