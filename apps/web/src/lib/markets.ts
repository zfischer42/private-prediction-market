import { supabase, rpc, read, type Result } from './supabase';
import type {
  Market,
  MarketKind,
  MarketOdds,
  MarketOption,
  MarketStatus,
  Timestamp,
  Uuid,
} from './types';

// A market is a question plus a list of options. Everyone in the circle
// stakes coins on one option; the pot is split among the winners.

// ---------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------

export interface CreateMarketInput {
  circleId: number;
  question: string;
  kind: MarketKind;

  // Omit for a standing bet with nothing to schedule in advance ("who blacks
  // out first") - betting then never auto-closes, and anyone can propose a
  // result the moment it actually happens.
  closesAt?: Date | Timestamp;

  // 'multi' only: at least 2, and near-duplicates are rejected
  // ("Yes " and "yes" count as the same option).
  options?: string[];

  // 'over_under' only: must be a half-number like 8.5, so a tie is
  // impossible and there is always a winner.
  line?: number;

  // Tag the market at a person ("Will Zach show up late?"). They are then
  // blocked from betting on it. Must be a member of the circle.
  subjectId?: Uuid;

  // Defaults to now, i.e. betting opens immediately.
  opensAt?: Date | Timestamp;

  // When the thing happens, and when it is over and knowable.
  //
  // eventEndAt matters: nobody can propose a resolution before it passes, and
  // once one is proposed, later bets on the winning side are voided at
  // settlement. So it cannot be earlier than closesAt - the server rejects
  // that with "The event cannot end before betting closes" rather than let you
  // build a market that quietly refuses to pay anyone.
  eventStartAt?: Date | Timestamp;
  eventEndAt?: Date | Timestamp;

  imageUrl?: string;
}

// Converts to an ISO string. Returns null when unset, and `false` when the
// value is not a usable date.
//
// That third case matters: Date.prototype.toISOString() throws RangeError on
// an invalid date, and `new Date('')` from a half-filled date field is an
// invalid date. Without this the whole module could throw instead of
// returning { error }, which is the one thing every caller relies on.
function iso(t: Date | Timestamp | undefined): string | null | false {
  if (t == null) return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isNaN(d.getTime()) ? false : d.toISOString();
}

// Converts a batch of date fields at once, naming the first bad one so the
// error points at the field the caller actually passed.
function isoFields<K extends string>(
  fields: Record<K, Date | Timestamp | undefined>,
): { ok: true; values: Record<K, string | null> } | { ok: false; error: string } {
  const values = {} as Record<K, string | null>;
  for (const key of Object.keys(fields) as K[]) {
    const v = iso(fields[key]);
    if (v === false) return { ok: false, error: `${key} is not a valid date` };
    values[key] = v;
  }
  return { ok: true, values };
}

// Creates a market and returns its id.
//
// Options depend on the kind:
//   binary      Yes / No, made for you
//   over_under  Over N / Under N, made for you - pass `line`
//   multi       pass `options`, at least 2 of them
//   open        members add their own, up to 15 min before betting closes
export async function createMarket(
  input: CreateMarketInput,
): Promise<Result<number>> {
  const t = isoFields({
    closesAt: input.closesAt,
    opensAt: input.opensAt,
    eventStartAt: input.eventStartAt,
    eventEndAt: input.eventEndAt,
  });
  if (!t.ok) return { error: t.error };

  return rpc('create_market', {
    _circle_id: input.circleId,
    _question: input.question,
    _kind: input.kind,
    _closes_at: t.values.closesAt,
    _options: input.options ?? null,
    _line: input.line ?? null,
    _subject_id: input.subjectId ?? null,
    _opens_at: t.values.opensAt,
    _event_start_at: t.values.eventStartAt,
    _event_end_at: t.values.eventEndAt,
    _image_url: input.imageUrl ?? null,
  });
}

// Edits a market. Anything you leave out stays as it is.
//
// The rules tighten the moment someone bets: after the first bet the
// question, timing and subject freeze, only the image stays editable, and
// only an admin can move the event timing. Expect these to come back as
// errors rather than checking for them here.
export async function updateMarket(
  marketId: number,
  changes: {
    question?: string;
    imageUrl?: string;
    closesAt?: Date | Timestamp;
    opensAt?: Date | Timestamp;
    eventStartAt?: Date | Timestamp;
    eventEndAt?: Date | Timestamp;
    subjectId?: Uuid;
  },
): Promise<Result<null>> {
  const t = isoFields({
    closesAt: changes.closesAt,
    opensAt: changes.opensAt,
    eventStartAt: changes.eventStartAt,
    eventEndAt: changes.eventEndAt,
  });
  if (!t.ok) return { error: t.error };

  return rpc('update_market', {
    _market_id: marketId,
    _question: changes.question ?? null,
    _image_url: changes.imageUrl ?? null,
    _closes_at: t.values.closesAt,
    _opens_at: t.values.opensAt,
    _event_start_at: t.values.eventStartAt,
    _event_end_at: t.values.eventEndAt,
    _subject_id: changes.subjectId ?? null,
  });
}

// Deletes a market outright. Only works while nobody has bet on it.
// Once there are bets, use voidMarket() to refund everyone instead.
export function cancelMarket(marketId: number): Promise<Result<null>> {
  return rpc('cancel_market', { _market_id: marketId });
}

// Adds an option to an 'open' market. Submissions close 15 minutes before
// betting does, which is what stops someone adding the winning answer at
// the last second.
export function submitOption(
  marketId: number,
  label: string,
): Promise<Result<number>> {
  return rpc('submit_option', { _market_id: marketId, _label: label });
}

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

// Markets in a circle, newest close date first.
//
// Careful with `status`: a cron job advances it, so it can lag by a minute
// or two. For "can I still bet on this?" compare closes_at to now instead,
// which is what the server does.
// Options come along for the ride - a market list is not useful to look at
// without knowing what a person would actually be picking between.
export function getMarkets(
  circleId: number,
  opts: { status?: MarketStatus | MarketStatus[]; limit?: number } = {},
): Promise<Result<Array<Market & { options: MarketOption[] }>>> {
  let query = supabase
    .from('markets')
    .select('*, options:market_options!market_options_market_id_fkey(*)')
    .eq('circle_id', circleId)
    .order('closes_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (Array.isArray(opts.status)) query = query.in('status', opts.status);
  else if (opts.status) query = query.eq('status', opts.status);
  return read(query);
}

// One market on its own.
//
// .maybeSingle() rather than .single(): a row that does not exist, or that
// RLS is hiding because you are not in that circle, makes .single() fail with
// PostgREST's own wording ("JSON object requested, multiple (or no) rows
// returned"). Every other error in this folder is safe to show a user, and
// this one has to be too.
export async function getMarket(marketId: number): Promise<Result<Market>> {
  const { data, error } = await read<Market | null>(
    supabase.from('markets').select('*').eq('id', marketId).maybeSingle(),
  );
  if (error) return { error };
  if (!data) return { error: 'Market not found' };
  return { data };
}

// A market plus its options in one round trip - what a detail page wants.
//
// The !market_options_market_id_fkey hint is load-bearing, not decoration.
// markets and market_options point at each other - options.market_id one
// way, markets.winning_option_id the other - so without naming the
// constraint the API refuses the embed as ambiguous.
// Same not-found handling as getMarket above.
export async function getMarketWithOptions(
  marketId: number,
): Promise<Result<Market & { options: MarketOption[] }>> {
  const { data, error } = await read<(Market & { options: MarketOption[] }) | null>(
    supabase
      .from('markets')
      .select('*, options:market_options!market_options_market_id_fkey(*)')
      .eq('id', marketId)
      .maybeSingle(),
  );
  if (error) return { error };
  if (!data) return { error: 'Market not found' };
  return { data };
}

export function getOptions(marketId: number): Promise<Result<MarketOption[]>> {
  return read(
    supabase
      .from('market_options')
      .select('*')
      .eq('market_id', marketId)
      .order('sort_order'),
  );
}

// Live odds: how the pot is split across the options right now.
// `pct` is null until the first bet lands, so guard before formatting it.
export function getOdds(marketId: number): Promise<Result<MarketOdds[]>> {
  return read(
    supabase
      .from('market_odds')
      .select('*')
      .eq('market_id', marketId)
      .order('sort_order'),
  );
}

// ---------------------------------------------------------------------
// Timing helpers
//
// The server is the authority on all of this - these just save the UI from
// re-deriving the same booleans in five places.
// ---------------------------------------------------------------------

export function isBettingOpen(market: Market, now: Date = new Date()): boolean {
  if (market.status === 'resolved' || market.status === 'voided') return false;
  if (now < new Date(market.opens_at)) return false;
  // No closes_at means no scheduled close: open until someone reports a result.
  return market.closes_at === null || now < new Date(market.closes_at);
}

export function isSettled(market: Market): boolean {
  return market.status === 'resolved' || market.status === 'voided';
}

// Whether members can still add options to an 'open' market.
export function canSubmitOption(market: Market, now: Date = new Date()): boolean {
  if (market.kind !== 'open' || isSettled(market)) return false;
  if (now < new Date(market.opens_at)) return false;
  const lock = market.options_lock_at ?? market.closes_at;
  return lock === null || now < new Date(lock);
}

// Resolutions cannot be proposed until the event is over and knowable.
// When a market has no event_end_at the server falls back to closes_at,
// so this mirrors that rather than letting the proposal through early.
export function canProposeResolution(
  market: Market,
  now: Date = new Date(),
): boolean {
  if (isSettled(market)) return false;
  const knownAt = market.event_end_at ?? market.closes_at;
  // Nothing to wait for on a standing bet - the "event" is only known once
  // someone reports it.
  return knownAt === null || now >= new Date(knownAt);
}
