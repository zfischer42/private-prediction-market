// Shapes the database hands back. These mirror the tables in
// supabase/migrations/0001_initial.sql - if a column changes there, change it here.
//
// Note: ids are numbers (Postgres bigint), except user ids, which are uuid strings.

export type Uuid = string;
export type Timestamp = string; // ISO-8601

export type MarketKind = 'binary' | 'over_under' | 'multi' | 'open';
export type MarketStatus = 'scheduled' | 'open' | 'closed' | 'resolved' | 'voided';
export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'refunded';
export type MemberRole = 'member' | 'admin';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';
export type Vote = 'approve' | 'disapprove';
export type MediaType = 'image' | 'video';

// What an admin can do with a resolution proposal.
//   approve       - pays out immediately, proposer's bond refunded
//   reject_reopen - false alarm, betting continues, bond forfeited
//   reject_close  - betting stops, market stays unresolved
//   void_market   - everyone refunded, all bonds returned
export type ProposalAction = 'approve' | 'reject_reopen' | 'reject_close' | 'void_market';

export type LedgerReason =
  | 'initial_grant'
  | 'admin_grant'
  | 'bet'
  | 'payout'
  | 'refund'
  | 'void_refund'
  | 'late_void_refund'
  | 'proposal_bond'
  | 'bond_refund'
  | 'daily_bonus'
  | 'season_reset'
  | 'member_removed';

export interface Circle {
  id: number;
  name: string;
  join_code: string;
  created_by: Uuid | null;
  starting_balance: number;
  proposal_bond: number;
  created_at: Timestamp;
}

export interface Season {
  id: number;
  circle_id: number;
  name: string;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  is_active: boolean;
  created_at: Timestamp;
}

// Balance lives here, not on the user. You can be broke in one circle
// and rich in another.
export interface CircleMember {
  circle_id: number;
  user_id: Uuid;
  role: MemberRole;
  balance: number;
  display_name: string | null;
  joined_at: Timestamp;
}

// Four timestamps, each doing one job:
//   opens_at        betting starts
//   closes_at       betting ends
//   event_start_at  the thing happens
//   event_end_at    the thing is over and knowable (gates proposeResolution)
//   options_lock_at derived, closes_at - 15min, only for 'open' markets
//
// `status` is cosmetic - a cron job advances it. Eligibility checks on the
// server read the timestamps directly, so never gate a bet on status alone.
export interface Market {
  id: number;
  circle_id: number;
  season_id: number | null;
  creator_id: Uuid;
  question: string;
  kind: MarketKind;
  line: number | null;
  image_url: string | null;
  subject_id: Uuid | null;
  opens_at: Timestamp;
  closes_at: Timestamp;
  event_start_at: Timestamp | null;
  event_end_at: Timestamp | null;
  options_lock_at: Timestamp | null;
  status: MarketStatus;
  review_started_at: Timestamp | null;
  winning_option_id: number | null;
  resolved_at: Timestamp | null;
  resolved_by: Uuid | null;
  created_at: Timestamp;
}

export interface MarketOption {
  id: number;
  market_id: number;
  label: string;
  sort_order: number;
  created_by: Uuid | null;
  created_at: Timestamp;
}

export interface Bet {
  id: number;
  market_id: number;
  option_id: number;
  user_id: Uuid;
  amount: number;
  status: BetStatus;
  payout: number;
  was_late: boolean;
  voided_at: Timestamp | null;
  voided_by: Uuid | null;
  void_reason: string | null;
  created_at: Timestamp;
}

export interface ResolutionProposal {
  id: number;
  market_id: number;
  proposer_id: Uuid;
  proposed_option_id: number;
  note: string | null;
  bond: number;
  status: ProposalStatus;
  reviewed_by: Uuid | null;
  reviewed_at: Timestamp | null;
  created_at: Timestamp;
}

export interface MarketEvidence {
  id: number;
  market_id: number;
  proposal_id: number | null;
  uploader_id: Uuid;
  storage_path: string;
  media_type: MediaType;
  caption: string | null;
  created_at: Timestamp;
}

// Append-only. This is the audit trail that settles arguments.
export interface LedgerEntry {
  id: number;
  circle_id: number;
  user_id: Uuid;
  amount: number;
  reason: LedgerReason;
  market_id: number | null;
  bet_id: number | null;
  actor_id: Uuid | null;
  note: string | null;
  created_at: Timestamp;
}

export interface Comment {
  id: number;
  market_id: number;
  user_id: Uuid;
  body: string;
  created_at: Timestamp;
}

export interface Notification {
  id: number;
  user_id: Uuid;
  title: string;
  body: string;
  url: string | null;
  sent_at: Timestamp | null;
  read_at: Timestamp | null;
  created_at: Timestamp;
}

export interface ProposalVote {
  proposal_id: number;
  user_id: Uuid;
  vote: Vote;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ---- Views (read-only) ----------------------------------------------

// Each option's share of the pot. `pct` is null until someone bets.
export interface MarketOdds {
  market_id: number;
  option_id: number;
  label: string;
  sort_order: number;
  pool: number;
  bet_count: number;
  pct: number | null;
}

// Ranked by net_profit, NOT balance - balance includes admin handouts.
export interface LeaderboardRow {
  circle_id: number;
  user_id: Uuid;
  display_name: string | null;
  role: MemberRole;
  balance: number;
  bets_settled: number;
  bets_won: number;
  bets_lost: number;
  bets_open: number;
  coins_staked: number;
  coins_won: number;
  bet_profit: number;
  bond_net: number;
  net_profit: number;
  win_pct: number | null;
  biggest_win: number;
}

export interface SeasonLeaderboardRow {
  circle_id: number;
  season_id: number;
  season_name: string;
  is_active: boolean;
  user_id: Uuid;
  display_name: string | null;
  bets_settled: number;
  bets_won: number;
  bets_lost: number;
  bets_open: number;
  coins_staked: number;
  net_profit: number;
  win_pct: number | null;
  biggest_win: number;
}

// Advisory only. The admin still decides; these votes bind nothing.
export interface ProposalVoteTally {
  proposal_id: number;
  market_id: number;
  approve_count: number;
  disapprove_count: number;
  total_votes: number;
}

// Audit view. `drift` must always be 0. If it isn't, coins moved somewhere
// without being recorded and something is badly wrong.
export interface CircleReconciliation {
  circle_id: number;
  circle_name: string;
  sum_balances: number;
  sum_ledger: number;
  coins_in_open_bets: number;
  coins_in_bonds: number;
  drift: number;
}
