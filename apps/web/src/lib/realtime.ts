import { supabase } from './supabase';
import type { Bet, Comment, Market, ProposalVote } from './types';

// Live updates. The schema publishes four tables for this - bets, markets,
// comments and proposal_votes - so odds can move on screen without anyone
// hitting refresh.
//
// Row-level security applies here exactly as it does to a normal read: you
// only receive changes for circles you belong to.
//
// THE PATTERN: treat these as a nudge, not as data. The payload carries one
// row, but the thing you want to show - the odds split, the running total -
// is an aggregate across every row. Refetch on the nudge:
//
//   useEffect(() => onMarketBets(marketId, () => refetchOdds()), [marketId]);
//
// Trying to patch local state from the payload means reimplementing the
// pool maths in the browser, which is how the number on screen ends up
// disagreeing with the number in the database.

export interface Change<T> {
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  // The new row. Null on DELETE.
  row: T | null;
  // The previous row. Postgres only sends the primary key here unless the
  // table's replica identity is set to FULL, so do not rely on its other
  // fields being populated.
  previous: Partial<T> | null;
}

// What a subscription can tell you besides "a row changed".
//
// Every other function in this folder returns { data } or { error }. These
// return an unsubscribe function, so a failure has nowhere to go - and a
// realtime subscription fails in ways that look exactly like "nothing has
// happened yet": the table missing from the supabase_realtime publication, RLS
// refusing the channel, the project's concurrent-connection cap, a dropped
// socket. Without this, the symptom is odds that silently stop moving and no
// way to tell that from a quiet market.
export interface SubscribeOptions {
  // Called when the channel itself fails. Not called on normal unsubscribe.
  // The message is for a developer, not a user - log it, or surface a "live
  // updates unavailable" badge and fall back to polling.
  onError?: (message: string) => void;
  // Called once the channel is live. Useful for clearing that badge again.
  onSubscribed?: () => void;
}

// Channel names have to be unique per subscription, or two components
// watching the same market would collide on one channel.
let channelSeq = 0;

function subscribe<T>(
  table: string,
  filter: string,
  callback: (change: Change<T>) => void,
  opts: SubscribeOptions = {},
): () => void {
  const channel = supabase
    .channel(`${table}:${filter}:${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter },
      (payload) => {
        callback({
          event: payload.eventType as Change<T>['event'],
          row: (payload.new && Object.keys(payload.new).length
            ? (payload.new as T)
            : null),
          previous: (payload.old && Object.keys(payload.old).length
            ? (payload.old as Partial<T>)
            : null),
        });
      },
    )
    .subscribe((status, err) => {
      // 'CLOSED' is also what a normal unsubscribe reports, so it is not an
      // error - reporting it would fire on every component unmount.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        opts.onError?.(
          `Live updates for ${table} (${filter}) failed: ${status}` +
          (err?.message ? ` - ${err.message}` : ''),
        );
      } else if (status === 'SUBSCRIBED') {
        opts.onSubscribed?.();
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

// Someone bet on this market. Refetch getOdds() and getMarketBets().
export function onMarketBets(
  marketId: number,
  callback: (change: Change<Bet>) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribe('bets', `market_id=eq.${marketId}`, callback, opts);
}

// This market changed - most often the cron job advancing its status, or
// an admin resolving it. Refetch the market.
export function onMarketChange(
  marketId: number,
  callback: (change: Change<Market>) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribe('markets', `id=eq.${marketId}`, callback, opts);
}

// A market in this circle was created or changed. For keeping a list
// screen live without polling.
export function onCircleMarkets(
  circleId: number,
  callback: (change: Change<Market>) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribe('markets', `circle_id=eq.${circleId}`, callback, opts);
}

// New trash talk on a market.
export function onMarketComments(
  marketId: number,
  callback: (change: Change<Comment>) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribe('comments', `market_id=eq.${marketId}`, callback, opts);
}

// Someone voted on a resolution proposal. Refetch getVoteTally().
export function onProposalVotes(
  proposalId: number,
  callback: (change: Change<ProposalVote>) => void,
  opts?: SubscribeOptions,
): () => void {
  return subscribe('proposal_votes', `proposal_id=eq.${proposalId}`, callback, opts);
}
