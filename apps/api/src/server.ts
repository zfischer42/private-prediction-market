import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
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

const marketSummaries: MarketSummary[] = [
  {
    id: 'mkt-1',
    question: 'Will the market ship by Friday?',
    status: 'open',
    closesAt: '2026-09-01T18:00:00.000Z',
    options: [
      { id: 'yes', label: 'Yes', odds: 0.65 },
      { id: 'no', label: 'No', odds: 0.35 },
    ],
  },
  {
    id: 'mkt-2',
    question: 'Will the team finish the API migration?',
    status: 'open',
    closesAt: '2026-09-05T18:00:00.000Z',
    options: [
      { id: 'yes', label: 'Yes', odds: 0.58 },
      { id: 'no', label: 'No', odds: 0.42 },
    ],
  },
];

const circleSummaries: CircleSummary[] = [
  {
    id: 'circle-1',
    name: 'Friend Circle',
    memberCount: 4,
    season: 'Summer League',
  },
  {
    id: 'circle-2',
    name: 'Office Bets',
    memberCount: 6,
    season: 'Q4 Predictions',
  },
];

const marketOptions: Record<string, MarketOptionDetail[]> = {
  'mkt-1': [
    { id: 'opt-yes-1', marketId: 'mkt-1', label: 'Yes', sortOrder: 1, createdAt: '2026-08-19T12:00:00.000Z' },
    { id: 'opt-no-1', marketId: 'mkt-1', label: 'No', sortOrder: 2, createdAt: '2026-08-19T12:05:00.000Z' },
  ],
  'mkt-2': [
    { id: 'opt-yes-2', marketId: 'mkt-2', label: 'Yes', sortOrder: 1, createdAt: '2026-08-20T12:00:00.000Z' },
    { id: 'opt-no-2', marketId: 'mkt-2', label: 'No', sortOrder: 2, createdAt: '2026-08-20T12:05:00.000Z' },
  ],
};

const marketOdds: Record<string, MarketOddsDetail[]> = {
  'mkt-1': [
    { marketId: 'mkt-1', optionId: 'opt-yes-1', label: 'Yes', sortOrder: 1, pool: 72, betCount: 3, pct: 0.64 },
    { marketId: 'mkt-1', optionId: 'opt-no-1', label: 'No', sortOrder: 2, pool: 41, betCount: 2, pct: 0.36 },
  ],
  'mkt-2': [
    { marketId: 'mkt-2', optionId: 'opt-yes-2', label: 'Yes', sortOrder: 1, pool: 58, betCount: 2, pct: 0.58 },
    { marketId: 'mkt-2', optionId: 'opt-no-2', label: 'No', sortOrder: 2, pool: 42, betCount: 2, pct: 0.42 },
  ],
};

const betSummaries: Record<string, BetSummary[]> = {
  'mkt-1': [
    {
      id: 'bet-1',
      marketId: 'mkt-1',
      optionId: 'yes',
      optionLabel: 'Yes',
      amount: 25,
      status: 'pending',
      createdAt: '2026-08-20T16:00:00.000Z',
    },
    {
      id: 'bet-2',
      marketId: 'mkt-1',
      optionId: 'no',
      optionLabel: 'No',
      amount: 15,
      status: 'pending',
      createdAt: '2026-08-21T10:30:00.000Z',
    },
  ],
  'mkt-2': [
    {
      id: 'bet-3',
      marketId: 'mkt-2',
      optionId: 'yes',
      optionLabel: 'Yes',
      amount: 30,
      status: 'won',
      createdAt: '2026-08-22T12:15:00.000Z',
    },
  ],
};

const proposalSummaries: Record<string, ProposalSummary[]> = {
  'mkt-1': [
    {
      id: 'proposal-1',
      marketId: 'mkt-1',
      proposer: 'Alicia',
      proposedOptionId: 'yes',
      proposedOptionLabel: 'Yes',
      status: 'pending',
      note: 'The team shipped the core flow.',
      createdAt: '2026-08-23T09:30:00.000Z',
    },
  ],
};

const commentSummaries: Record<string, CommentSummary[]> = {
  'mkt-1': [
    {
      id: 'comment-1',
      marketId: 'mkt-1',
      user: 'Zach',
      body: 'We are ready to launch this once the invite flow lands.',
      createdAt: '2026-08-24T08:00:00.000Z',
    },
  ],
};

const notificationSummaries: NotificationSummary[] = [
  {
    id: 'notif-1',
    title: 'Bet settled',
    body: 'Your Q4 market on Friday landed in your favor.',
    unread: true,
    createdAt: '2026-08-24T09:15:00.000Z',
  },
  {
    id: 'notif-2',
    title: 'Invite accepted',
    body: 'Jared joined your private prediction circle.',
    unread: false,
    createdAt: '2026-08-23T18:45:00.000Z',
  },
];

export const app = Fastify({ logger: false });

app.get('/health', async () => ({ status: 'ok' as const }));
app.get('/api/health', async (): Promise<ApiHealthResponse> => ({
  status: 'ok',
  backend: 'fastify',
}));

app.get('/api/markets', async () => ({
  count: marketSummaries.length,
  markets: marketSummaries,
}));

app.get('/api/circles', async () => ({
  count: circleSummaries.length,
  circles: circleSummaries,
}));

app.get<{ Params: { marketId: string } }>('/api/markets/:marketId/options', async (request) => {
  const { marketId } = request.params;
  const options = marketOptions[marketId] ?? [];
  return {
    count: options.length,
    marketId,
    options,
  };
});

app.get<{ Params: { marketId: string } }>('/api/markets/:marketId/odds', async (request) => {
  const { marketId } = request.params;
  const odds = marketOdds[marketId] ?? [];
  return {
    count: odds.length,
    marketId,
    odds,
  };
});

app.get<{ Querystring: { marketId?: string } }>('/api/bets', async (request) => {
  const marketId = request.query.marketId ?? null;
  const bets = marketId ? betSummaries[marketId] ?? [] : [];
  return {
    count: bets.length,
    marketId,
    bets,
  };
});

app.get<{ Params: { marketId: string } }>('/api/bets/:marketId', async (request) => {
  const { marketId } = request.params;
  const bets = betSummaries[marketId] ?? [];
  return {
    count: bets.length,
    marketId,
    bets,
  };
});

app.post<{ Body: { marketId: string; optionId: string; amount: number } }>('/api/bets', async (request) => {
  const { marketId, optionId, amount } = request.body;
  const nextBet: BetSummary = {
    id: `bet-${Date.now()}`,
    marketId,
    optionId,
    optionLabel: optionId === 'yes' ? 'Yes' : 'No',
    amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  const existing = betSummaries[marketId] ?? [];
  betSummaries[marketId] = [...existing, nextBet];
  return { success: true, bet: nextBet };
});

app.get<{ Params: { marketId: string } }>('/api/markets/:marketId/proposals', async (request) => {
  const { marketId } = request.params;
  const proposals = proposalSummaries[marketId] ?? [];
  return {
    count: proposals.length,
    marketId,
    proposals,
  };
});

app.post<{ Params: { marketId: string }; Body: { proposer: string; optionId: string; note?: string } }>('/api/markets/:marketId/proposals', async (request) => {
  const { marketId } = request.params;
  const { proposer, optionId, note } = request.body;
  const nextProposal: ProposalSummary = {
    id: `proposal-${Date.now()}`,
    marketId,
    proposer,
    proposedOptionId: optionId,
    proposedOptionLabel: optionId === 'yes' ? 'Yes' : 'No',
    status: 'pending',
    note,
    createdAt: new Date().toISOString(),
  };
  const existing = proposalSummaries[marketId] ?? [];
  proposalSummaries[marketId] = [...existing, nextProposal];
  return { success: true, proposal: nextProposal };
});

app.get<{ Params: { marketId: string } }>('/api/markets/:marketId/comments', async (request) => {
  const { marketId } = request.params;
  const comments = commentSummaries[marketId] ?? [];
  return {
    count: comments.length,
    marketId,
    comments,
  };
});

app.post<{ Params: { marketId: string }; Body: { user: string; body: string } }>('/api/markets/:marketId/comments', async (request) => {
  const { marketId } = request.params;
  const { user, body } = request.body;
  const nextComment: CommentSummary = {
    id: `comment-${Date.now()}`,
    marketId,
    user,
    body,
    createdAt: new Date().toISOString(),
  };
  const existing = commentSummaries[marketId] ?? [];
  commentSummaries[marketId] = [...existing, nextComment];
  return { success: true, comment: nextComment };
});

app.get('/api/notifications', async () => ({
  count: notificationSummaries.length,
  notifications: notificationSummaries,
}));

export async function startServer() {
  await app.listen({ port: 3001, host: '0.0.0.0' });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
