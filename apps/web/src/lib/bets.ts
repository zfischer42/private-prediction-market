import { supabase, currentUserId, rpc, read, type Result } from './supabase';
import type { Bet, BetStatus, Market, MarketOption } from './types';

// Bets are pool-based, not an order book. Everyone's stake goes into one
// pot and the winners split it in proportion to what they put in - so the
// odds you see when you bet are not the odds you get paid at.

// Puts coins on an option. Returns your new balance.
//
// The balance check and the deduction happen in one statement server-side,
// so double-tapping cannot spend the same coins twice - the second call
// just comes back "Not enough dollars".
//
// Expect: "Betting has closed" / "Betting has not opened yet" /
// "Not enough dollars" / "You cannot bet on a market about yourself".
export function placeBet(
  marketId: number,
  optionId: number,
  amount: number,
): Promise<Result<number>> {
  return rpc('place_bet', {
    _market_id: marketId,
    _option_id: optionId,
    _amount: amount,
  });
}

// Every bet on a market, so you can show who is on which side.
export function getMarketBets(marketId: number): Promise<Result<Bet[]>> {
  return read(
    supabase
      .from('bets')
      .select('*')
      .eq('market_id', marketId)
      .is('voided_at', null)
      .order('created_at', { ascending: false }),
  );
}

// Your bets on one market. Usually 0 or 1, but nothing stops someone
// betting twice, or spreading stakes across options.
export async function getMyBetsOnMarket(
  marketId: number,
): Promise<Result<Bet[]>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };
  return read(
    supabase
      .from('bets')
      .select('*')
      .eq('market_id', marketId)
      .eq('user_id', userId)
      .is('voided_at', null)
      .order('created_at', { ascending: false }),
  );
}

// Your betting history, newest first, with the market and option attached
// so a history screen does not need a second query per row.
//
// Pass a circleId to scope it to one circle - bets are not stored with a
// circle id, so this filters through the market they belong to.
export async function getMyBets(
  opts: { circleId?: number; status?: BetStatus; limit?: number } = {},
): Promise<Result<Array<Bet & { market: Market; option: MarketOption }>>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };

  // The !bets_option_id_fkey hint is required: bets reaches market_options
  // through two constraints (the plain option_id one, plus the composite
  // (option_id, market_id) integrity check), and an unhinted embed is
  // rejected as ambiguous. Aliasing to market/option also means the rows
  // come back already shaped, with no flattening pass afterwards.
  let query = supabase
    .from('bets')
    .select('*, market:markets!inner(*), option:market_options!bets_option_id_fkey(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.circleId) query = query.eq('market.circle_id', opts.circleId);
  if (opts.status) query = query.eq('status', opts.status);

  return read(query);
}

// What one bet is currently worth if its option wins, given the pot right now.
//
// Mirrors the server, which settles at stake + floor(stake / winPool * losePool).
// Written in that shape deliberately rather than the algebraically equal
// floor(stake / optionPool * totalPool): the two agree in exact arithmetic but
// not in float64, because dividing first discards bits that multiplying back
// cannot recover. That form was off by one coin on roughly one bet in two
// hundred - projectedPayout(7, 10, 90) promised 62 and the market paid 63.
// Keeping the division last, over an integer numerator, is exact for any pot
// this app can hold.
//
// Still label it an estimate in the UI. The pot moves with every new bet, and
// at resolution the rounding remainder is handed to the single largest winning
// stake, so that one bettor can come out a coin or two ahead.
export function projectedPayout(
  stake: number,
  optionPool: number,
  totalPool: number,
): number {
  if (optionPool <= 0) return 0;
  const losePool = totalPool - optionPool;
  return stake + Math.floor((stake * losePool) / optionPool);
}

// Everyone who has money riding on a circle right now.
//
// Bets carry no circle_id of their own, so the !inner join is how the
// filter reaches one. That join also comes back on every row, hence the
// extra `market` key in the return type.
export function getOpenBets(
  circleId: number,
): Promise<Result<Array<Bet & { market: { circle_id: number } }>>> {
  return read(
    supabase
      .from('bets')
      .select('*, market:markets!inner(circle_id)')
      .eq('market.circle_id', circleId)
      .eq('status', 'pending')
      .is('voided_at', null),
  );
}

// Admin only: cancels one person's bet and refunds them, leaving the rest
// of the market alone. Fails once the market has paid out.
export function voidBet(betId: number, reason: string): Promise<Result<null>> {
  return rpc('void_bet', { _bet_id: betId, _reason: reason });
}
