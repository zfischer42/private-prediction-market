import { supabase, currentUserId, rpc, read, type Result } from './supabase';
import type {
  Circle,
  CircleMember,
  LeaderboardRow,
  LedgerEntry,
  MemberRole,
  Season,
  SeasonLeaderboardRow,
  Uuid,
} from './types';

// A circle is a private friend group with its own coin economy. You get
// into one by creating it or by typing its 6-character join code.

// ---------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------

// Creates a circle and makes you its admin. Returns the new circle id.
// The join code is generated server-side - read it back with getCircle().
export function createCircle(name: string): Promise<Result<number>> {
  return rpc('create_circle', { _name: name });
}

// Joins by code and grants you the circle's starting balance.
// Safe to call twice: it will not hand out a second balance, and it does
// not care about capitalisation or stray spaces in the code.
export function joinCircle(joinCode: string): Promise<Result<number>> {
  return rpc('join_circle', { _join_code: joinCode });
}

// Leaves for good. Refused while you still have money tied up - open bets
// or a resolution bond in escrow - and the circle's creator can never leave.
export function leaveCircle(circleId: number): Promise<Result<null>> {
  return rpc('leave_circle', { _circle_id: circleId });
}

// Changes the name shown next to you in this circle. It auto-fills from
// your Google account when you join, so this is only for overriding that.
export function renameMember(
  circleId: number,
  displayName: string,
): Promise<Result<null>> {
  return rpc('rename_member', {
    _circle_id: circleId,
    _display_name: displayName,
  });
}

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

// Every circle you belong to, with your role and balance in each.
// Good for a circle switcher or the app's home screen.
export async function getMyCircles(): Promise<
  Result<Array<CircleMember & { circle: Circle }>>
> {
  // The .eq('user_id') is load-bearing. RLS on circle_members grants you
  // every member row of every circle you belong to - that is deliberate,
  // it powers the member list - so without this filter a three-person
  // circle comes back as three rows and [0] is somebody else's balance.
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };

  // `circle:circles(*)` aliases the embed, so rows arrive already shaped.
  return read(
    supabase
      .from('circle_members')
      .select('circle_id, user_id, role, balance, display_name, joined_at, circle:circles(*)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false }),
  );
}

// One circle, including its join code and economy settings.
export async function getCircle(circleId: number): Promise<Result<Circle>> {
  const { data, error } = await read<Circle | null>(
    supabase.from('circles').select('*').eq('id', circleId).maybeSingle(),
  );
  if (error) return { error };
  // Also the "you are not in this circle" case - RLS hides the row rather
  // than refusing the read, so the two are indistinguishable from here.
  if (!data) return { error: 'Circle not found' };
  return { data };
}

// Everyone in the circle, with balances. Sorted by name for a member list.
export function getMembers(circleId: number): Promise<Result<CircleMember[]>> {
  return read(
    supabase
      .from('circle_members')
      .select('*')
      .eq('circle_id', circleId)
      .order('display_name'),
  );
}

// Your own membership row - the quickest way to read your balance and
// find out whether you are an admin here.
export async function getMyMembership(
  circleId: number,
): Promise<Result<CircleMember | null>> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Not signed in' };
  return read(
    supabase
      .from('circle_members')
      .select('*')
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
}

// Standings, best first. Ranked by net_profit rather than balance, because
// balance includes any coins an admin handed out.
export async function getLeaderboard(
  circleId: number,
): Promise<Result<LeaderboardRow[]>> {
  return read(
    supabase
      .from('leaderboard')
      .select('*')
      .eq('circle_id', circleId)
      .order('net_profit', { ascending: false }),
  );
}

// Same, but for one season only.
export function getSeasonLeaderboard(
  seasonId: number,
): Promise<Result<SeasonLeaderboardRow[]>> {
  return read(
    supabase
      .from('season_leaderboard')
      .select('*')
      .eq('season_id', seasonId)
      .order('net_profit', { ascending: false }),
  );
}

// Every season this circle has played, newest first.
export function getSeasons(circleId: number): Promise<Result<Season[]>> {
  return read(
    supabase
      .from('seasons')
      .select('*')
      .eq('circle_id', circleId)
      .order('starts_at', { ascending: false }),
  );
}

// Every coin that has ever moved in this circle, newest first. Pass a
// userId to narrow it to one person's history.
export function getLedger(
  circleId: number,
  opts: { userId?: Uuid; limit?: number } = {},
): Promise<Result<LedgerEntry[]>> {
  let query = supabase
    .from('coin_ledger')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.userId) query = query.eq('user_id', opts.userId);
  return read(query);
}

// ---------------------------------------------------------------------
// Admin only
//
// These all fail server-side for non-admins, so hiding the buttons is a
// courtesy to the user rather than the thing keeping them out.
// ---------------------------------------------------------------------

// Promotes or demotes someone. The circle's creator can never be demoted,
// and a circle always keeps at least one admin.
export function setMemberRole(
  circleId: number,
  userId: Uuid,
  role: MemberRole,
): Promise<Result<null>> {
  return rpc('set_member_role', {
    _circle_id: circleId,
    _user_id: userId,
    _role: role,
  });
}

// Kicks someone out. Refused if they have open bets or a bond in escrow.
// To remove yourself, use leaveCircle() instead.
export function removeMember(
  circleId: number,
  userId: Uuid,
): Promise<Result<null>> {
  return rpc('remove_member', { _circle_id: circleId, _user_id: userId });
}

// Hands out or takes away coins. Negative amounts take them away, and it
// refuses to push anyone below zero. Returns their new balance.
export function adminAdjustCoins(
  circleId: number,
  userId: Uuid,
  amount: number,
  note: string,
): Promise<Result<number>> {
  return rpc('admin_adjust_coins', {
    _circle_id: circleId,
    _user_id: userId,
    _amount: amount,
    _note: note,
  });
}

// Changes the circle's name and economy. Anything you leave out stays as
// it is. Changing starting_balance only affects people who join later.
export function setCircleSettings(
  circleId: number,
  settings: {
    name?: string;
    startingBalance?: number;
    proposalBond?: number;
  },
): Promise<Result<null>> {
  return rpc('set_circle_settings', {
    _circle_id: circleId,
    _starting_balance: settings.startingBalance ?? null,
    _proposal_bond: settings.proposalBond ?? null,
    _name: settings.name ?? null,
  });
}

// Wipes the slate: everyone goes back to the starting balance and a new
// season begins. Refused while any market is unresolved or any proposal
// is still pending, so nobody loses money mid-flight.
export function resetSeason(
  circleId: number,
  newName: string,
): Promise<Result<number>> {
  return rpc('reset_season', { _circle_id: circleId, _new_name: newName });
}
