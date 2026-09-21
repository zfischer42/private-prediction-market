// The whole backend, as plain functions.
//
//   import { placeBet, getOdds, onAuthChange } from './lib';
//
// Every call returns { data } or { error }, where error is a message
// already fit to show a user ("Not enough coins", "Betting has closed").
// Permission and money rules are enforced in the database, so a hidden
// button is a courtesy, not a security boundary - and a call that should
// not be allowed will come back as an error rather than going through.

export * from './types';

// `supabase`, `rpc` and `read` are the escape hatch. If you need a query
// this folder does not cover, use read(supabase.from(...)) rather than
// calling supabase directly - you keep the { data } | { error } shape that
// everything else returns.
export {
  supabase,
  rpc,
  read,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  getSession,
  currentUserId,
  onAuthChange,
  type Result,
} from './supabase';

export {
  createCircle,
  joinCircle,
  leaveCircle,
  renameMember,
  getMyCircles,
  getCircle,
  getMembers,
  getMyMembership,
  getLeaderboard,
  getSeasonLeaderboard,
  getSeasons,
  getLedger,
  setMemberRole,
  removeMember,
  adminAdjustCoins,
  setCircleSettings,
  resetSeason,
} from './circles';

export {
  createMarket,
  updateMarket,
  cancelMarket,
  submitOption,
  getMarkets,
  getMarket,
  getMarketWithOptions,
  getOptions,
  getOdds,
  isBettingOpen,
  isSettled,
  canSubmitOption,
  canProposeResolution,
  type CreateMarketInput,
} from './markets';

export {
  placeBet,
  getMarketBets,
  getMyBetsOnMarket,
  getMyBets,
  getOpenBets,
  voidBet,
  projectedPayout,
} from './bets';

export {
  proposeResolution,
  getProposals,
  voteOnProposal,
  clearProposalVote,
  getVoteTally,
  getProposalVotes,
  getMyVote,
  reviewProposal,
  resolveMarket,
  voidMarket,
} from './resolution';

export {
  getComments,
  addComment,
  deleteComment,
  getEvidence,
  uploadEvidence,
  getEvidenceUrl,
  deleteEvidence,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './social';

export {
  onMarketBets,
  onMarketChange,
  onCircleMarkets,
  onMarketComments,
  onProposalVotes,
  type Change,
  type SubscribeOptions,
} from './realtime';
