import { supabase, currentUserId, rpc, read, type Result } from './supabase';
import type {
  MarketOption,
  ProposalAction,
  ProposalStatus,
  ProposalVote,
  ProposalVoteTally,
  ResolutionProposal,
  Vote,
} from './types';

// How a market settles:
//   1. Anyone proposes an outcome, putting up a refundable bond.
//   2. Members vote on it - advisory only, it binds nothing.
//   3. An admin reviews it and that settles the market.
//
// Proposing does NOT stop betting. It only timestamps the market so late
// bets can be quarantined if the proposal is approved.
//
// There is no quorum. The first admin to approve settles it in the same
// transaction; a second admin's click returns "already reviewed".

// ---------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------

// Claims an outcome. Costs the circle's proposal_bond, refunded if the
// proposal is approved and forfeited if it was a false alarm - which is
// what stops this being a griefing tool.
//
// The bond amount is read server-side from the circle, deliberately not a
// parameter here. Fails with "The event has not finished yet" until the
// market's event_end_at (or closes_at) has passed.
export function proposeResolution(
  marketId: number,
  optionId: number,
  note?: string,
): Promise<Result<number>> {
  return rpc('propose_resolution', {
    _market_id: marketId,
    _option_id: optionId,
    _note: note ?? null,
  });
}

// Proposals on a market, newest first. One pending proposal per person.
//
// The proposed option comes back embedded, so a review screen can say
// "Bob proposes: Yes" without a second lookup. The FK hint is required -
// resolution_proposals reaches market_options through two constraints
// (proposed_option_id, plus the composite market-integrity one), and an
// unhinted embed is rejected as ambiguous.
//
// The proposer's name is not embeddable: proposer_id points at auth.users,
// not at circle_members. Map it yourself from getMembers(circleId).
export function getProposals(
  marketId: number,
  opts: { status?: ProposalStatus } = {},
): Promise<Result<Array<ResolutionProposal & { option: MarketOption }>>> {
  let query = supabase
    .from('resolution_proposals')
    .select('*, option:market_options!resolution_proposals_proposed_option_id_fkey(*)')
    .eq('market_id', marketId)
    .order('created_at', { ascending: false });
  if (opts.status) query = query.eq('status', opts.status);
  return read(query);
}

// ---------------------------------------------------------------------
// Voting (advisory)
// ---------------------------------------------------------------------

// Registers approval or disapproval. Calling it again changes your vote.
// This is a sentiment poll for the admin to look at - it decides nothing.
export function voteOnProposal(
  proposalId: number,
  vote: Vote,
): Promise<Result<null>> {
  return rpc('vote_on_proposal', { _proposal_id: proposalId, _vote: vote });
}

// Takes your vote back.
export function clearProposalVote(proposalId: number): Promise<Result<null>> {
  return rpc('clear_proposal_vote', { _proposal_id: proposalId });
}

// Running counts for one proposal.
export async function getVoteTally(
  proposalId: number,
): Promise<Result<ProposalVoteTally>> {
  const { data, error } = await read<ProposalVoteTally | null>(
    supabase
      .from('proposal_vote_tally')
      .select('*')
      .eq('proposal_id', proposalId)
      .maybeSingle(),
  );
  if (error) return { error };
  if (!data) return { error: 'Proposal not found' };
  return { data };
}

// Who voted which way - for showing the split rather than just the count.
export function getProposalVotes(
  proposalId: number,
): Promise<Result<ProposalVote[]>> {
  return read(
    supabase.from('proposal_votes').select('*').eq('proposal_id', proposalId),
  );
}

// Your own vote on a proposal, or null if you have not voted.
export async function getMyVote(
  proposalId: number,
): Promise<Result<ProposalVote | null>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };
  return read(
    supabase
      .from('proposal_votes')
      .select('*')
      .eq('proposal_id', proposalId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
}

// ---------------------------------------------------------------------
// Admin only
// ---------------------------------------------------------------------

// Rules on a proposal. This is the main way markets get settled.
//
//   approve       pays out immediately, bond refunded
//   reject_reopen false alarm - betting continues, bond forfeited. Also clears
//                 the quarantine line, so bets placed from here on are normal
//                 bets rather than late ones (unless another proposal is still
//                 pending, in which case the line stays)
//   reject_close  betting stops, market stays unresolved
//   void_market   everyone refunded, all bonds returned
export function reviewProposal(
  proposalId: number,
  action: ProposalAction,
): Promise<Result<null>> {
  return rpc('review_proposal', {
    _proposal_id: proposalId,
    _action: action,
  });
}

// Settles a market directly, skipping the proposal flow entirely.
// Pays out everyone who backed the winning option.
export function resolveMarket(
  marketId: number,
  winningOptionId: number,
): Promise<Result<null>> {
  return rpc('resolve_market', {
    _market_id: marketId,
    _winning_option_id: winningOptionId,
  });
}

// Calls the whole thing off and refunds every stake. Nobody wins.
// Use this rather than cancelMarket() once bets exist.
export function voidMarket(
  marketId: number,
  reason: string,
): Promise<Result<null>> {
  return rpc('void_market', { _market_id: marketId, _reason: reason });
}
