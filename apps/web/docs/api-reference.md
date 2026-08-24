# Frontend API Reference

Every function in [`apps/web/src/lib`](../src/lib), what it takes, what it
returns, and how it fails. 70 functions.

New to the project? Read the [quickstart](../src/lib/README.md) first — it
covers the auth loop and the gotchas. This file is the lookup table.

```ts
import { placeBet, getOdds, onAuthChange } from './lib';
```

---

## Contents

- [Conventions](#conventions)
- [Auth](#auth) — 6, plus the client
- [Circles](#circles) — 12
- [Circle admin](#circle-admin) — 5
- [Markets](#markets) — 9
- [Market helpers](#market-helpers) — 4 (pure, no network)
- [Betting](#betting) — 7
- [Resolution](#resolution) — 10
- [Comments](#comments) — 3
- [Evidence](#evidence) — 4
- [Notifications](#notifications) — 3
- [Realtime](#realtime) — 5
- [Escape hatch](#escape-hatch) — 2
- [Types](#types)

---

## Conventions

**Every function returns `{ data }` or `{ error }`.** Never both, never a throw.

```ts
const { data, error } = await placeBet(marketId, optionId, 100);
if (error) return showToast(error);
setBalance(data);
```

`error` is a plain-English sentence written for a user — show it as-is. Each
function below lists the exact strings it can produce.

**Nothing here throws.** A network failure, an invalid `Date`, a missing row —
all of them come back as `{ error }`. If the request never reached the server
you get `Could not reach the server. Check your connection and try again.`
rather than the browser's `TypeError: Failed to fetch`.

**Length limits read as sentences too.** These live as Postgres constraints
rather than as checks inside the functions, so they'd otherwise surface as
`violates check constraint "markets_question_check"`. They're translated:

| Field | Limit | Error |
|---|---|---|
| Circle name | 1–60 chars | `A circle name must be 1 to 60 characters.` |
| Market question | 3–300 chars | `A question must be 3 to 300 characters.` |
| Option label | 1–100 chars | `An option must be 1 to 100 characters.` |
| Comment body | 1–1000 chars | `A comment must be 1 to 1000 characters.` |
| Starting balance | 1–1,000,000 | `The starting balance must be between 1 and 1,000,000.` |
| Proposal bond | 0–100,000 | `The proposal bond must be between 0 and 100,000.` |

Anything unmapped falls back to `That value isn't valid. Check the form and
try again.` — raw Postgres never reaches the user.

Exceptions: `getCurrentUser`, `getSession`, `currentUserId` return the value or
`null`. The pure helpers and `onAuthChange`/realtime subscriptions return their
value directly.

**Ids are numbers.** Circles, markets, bets, options and proposals are Postgres
`bigint`. Only `user_id` is a UUID string (`Uuid`).

**Timestamps** accept a `Date` or an ISO-8601 string; they always come back as
ISO strings.

**Permissions are server-side.** Nothing here checks whether you're allowed to
do something — the database does, on every call. A forbidden action returns an
`error`. Hiding a button is a courtesy, not a security boundary.

---

## Auth

### `onAuthChange(callback)`

Fires whenever the user signs in or out, including on return from Google. Fires
once on subscribe with the session restored from storage. **This is how you get
a user into the app** — `signInWithGoogle` alone won't update React state.

```ts
onAuthChange(callback: (user: User | null) => void): () => void
```

**Returns** — an unsubscribe function. Return it straight from `useEffect`.

Don't also call `getCurrentUser()` on mount: it double-fires, and the manual
read can land after a sign-out and overwrite it with a stale user.

```tsx
const [user, setUser] = useState<User | null | undefined>(undefined);
useEffect(() => onAuthChange(setUser), []);
// undefined = still checking · null = signed out · User = signed in
```

### `signInWithGoogle(redirectTo?)`

Redirects to Google's sign-in screen, then back. On success the browser
navigates away, so nothing after this call runs.

```ts
signInWithGoogle(redirectTo: string = window.location.origin): Promise<Result<null>>
```

**Params** — `redirectTo` defaults to the current origin. Whatever you pass must
be listed in Supabase → Authentication → URL Configuration.

### `signOut()`

Signs out and clears the stored session.

```ts
signOut(): Promise<Result<null>>
```

### `getCurrentUser()`

```ts
getCurrentUser(): Promise<User | null>
```

For one-off reads. Prefer `onAuthChange` for anything held in state.

### `getSession()`

The whole session, if you need the access token.

```ts
getSession(): Promise<Session | null>
```

### `currentUserId()`

The signed-in user's id, or `null`.

```ts
currentUserId(): Promise<string | null>
```

### `supabase`

The raw client, exported for the cases below that need it directly.

---

## Circles

A circle is a private friend group with its own coin economy. You get into one
by creating it or by typing its 6-character join code.

### `createCircle(name)`

Creates a circle and makes you its admin.

```ts
createCircle(name: string): Promise<Result<number>>
```

**Returns** — the new circle id. The join code is generated server-side; read it
back with `getCircle()`.

**Errors** — `Not signed in` · `Could not generate a unique join code, please try again`

### `joinCircle(joinCode)`

Joins by code and grants the circle's current starting balance. **Idempotent** —
case-insensitive, whitespace-tolerant, and joining twice does not grant a second
balance. Your display name auto-fills from your Google account.

```ts
joinCircle(joinCode: string): Promise<Result<number>>
```

**Returns** — the circle id.

**Errors** — `Not signed in` · `Invalid join code`

### `leaveCircle(circleId)`

Leaves for good.

```ts
leaveCircle(circleId: number): Promise<Result<null>>
```

**Errors** — `The circle creator cannot leave…` · `You still have open bets…` ·
`You have a resolution bond in escrow…` · `Promote another admin before you leave` ·
`You are not a member of this circle`

### `renameMember(circleId, displayName)`

Changes the name shown next to you in this circle.

```ts
renameMember(circleId: number, displayName: string): Promise<Result<null>>
```

**Errors** — `Display name too long` · `You are not a member of this circle`

### `getMyCircles()`

Every circle you belong to, with your role and balance in each. For a circle
switcher or the home screen.

```ts
getMyCircles(): Promise<Result<Array<CircleMember & { circle: Circle }>>>
```

**Returns** — one row per circle, already flattened so `row.circle.name` works.

### `getCircle(circleId)`

One circle, including its `join_code` and economy settings.

```ts
getCircle(circleId: number): Promise<Result<Circle>>
```

**Errors** — `Circle not found`, which also covers "you're not in this circle":
RLS hides the row rather than refusing the read, so the two are
indistinguishable from the client.

### `getMembers(circleId)`

Everyone in the circle, with balances, sorted by display name.

```ts
getMembers(circleId: number): Promise<Result<CircleMember[]>>
```

Also your lookup table for turning a `user_id` into a name — bets, comments and
proposals all carry ids, not names.

### `getMyMembership(circleId)`

Your own membership row. The quickest way to read your balance and find out
whether you're an admin here.

```ts
getMyMembership(circleId: number): Promise<Result<CircleMember | null>>
```

**Returns** — `null` if you're not a member.

### `getLeaderboard(circleId)`

Standings, best first.

```ts
getLeaderboard(circleId: number): Promise<Result<LeaderboardRow[]>>
```

Ranked by `net_profit`, **not** balance — balance includes admin handouts.
`win_pct` is `null` until someone has a settled bet.

### `getSeasonLeaderboard(seasonId)`

Same, scoped to one season.

```ts
getSeasonLeaderboard(seasonId: number): Promise<Result<SeasonLeaderboardRow[]>>
```

### `getSeasons(circleId)`

Every season this circle has played, newest first.

```ts
getSeasons(circleId: number): Promise<Result<Season[]>>
```

### `getLedger(circleId, opts?)`

Every coin that has ever moved in this circle, newest first. Append-only — this
is the audit trail that settles arguments.

```ts
getLedger(
  circleId: number,
  opts?: { userId?: Uuid; limit?: number },   // limit defaults to 100
): Promise<Result<LedgerEntry[]>>
```

---

## Circle admin

These all fail server-side for non-admins.

### `setMemberRole(circleId, userId, role)`

```ts
setMemberRole(circleId: number, userId: Uuid, role: 'member' | 'admin'): Promise<Result<null>>
```

The creator can never be demoted, and a circle always keeps at least one admin.
Any admin can promote or demote any non-creator, including themselves.

**Errors** — `Only circle admins can change roles` · `Invalid role` ·
`The original circle creator cannot be demoted` ·
`A circle must keep at least one admin` · `That user is not in this circle`

### `removeMember(circleId, userId)`

Kicks someone out. To remove yourself, use `leaveCircle()`.

```ts
removeMember(circleId: number, userId: Uuid): Promise<Result<null>>
```

**Errors** — `Only circle admins can remove members` ·
`Use leave_circle() to remove yourself` · `The circle creator cannot be removed` ·
`That member has open bets…` · `That member has a resolution bond in escrow…`

### `adminAdjustCoins(circleId, userId, amount, note)`

Hands out or takes away coins. Negative amounts take them away. Every change is
ledgered with your id as the actor.

```ts
adminAdjustCoins(
  circleId: number, userId: Uuid, amount: number, note: string,
): Promise<Result<number>>
```

**Returns** — their new balance.

**Errors** — `Amount cannot be zero` · `Only circle admins can adjust coins` ·
`That would put their balance below zero` · `That user is not in this circle`

### `setCircleSettings(circleId, settings)`

Anything you leave out stays as it is.

```ts
setCircleSettings(
  circleId: number,
  settings: { name?: string; startingBalance?: number; proposalBond?: number },
): Promise<Result<null>>
```

Changing `startingBalance` only affects people who join later.

**Errors** — `Only circle admins can change settings` · `Circle not found`

### `resetSeason(circleId, newName)`

Wipes the slate: everyone back to the starting balance, new season begins.

```ts
resetSeason(circleId: number, newName: string): Promise<Result<number>>
```

**Returns** — the new season id.

**Errors** — `Only circle admins can start a new season` ·
`Resolve or void every open market…` · `Review every pending resolution proposal…`

---

## Markets

A market is a question plus a list of options.

| `kind` | Options |
|---|---|
| `binary` | Yes / No, created for you |
| `over_under` | Over N / Under N, created for you — pass `line` |
| `multi` | Yours, via `options`, at least 2 |
| `open` | Members submit their own until 15 min before betting closes |

### `createMarket(input)`

```ts
createMarket(input: CreateMarketInput): Promise<Result<number>>

interface CreateMarketInput {
  circleId: number;
  question: string;
  kind: 'binary' | 'over_under' | 'multi' | 'open';
  closesAt: Date | string;      // betting ends
  options?: string[];           // 'multi' only, min 2
  line?: number;                // 'over_under' only, must be a half-number
  subjectId?: Uuid;             // tag a person; they cannot bet on it
  opensAt?: Date | string;      // defaults to now
  eventStartAt?: Date | string;
  eventEndAt?: Date | string;   // gates proposeResolution
  imageUrl?: string;
}
```

**Returns** — the new market id.

`line` must be a half-number (8.5) so a tie is impossible. `eventEndAt` matters:
nobody can propose a resolution until it passes — and if you omit it, the server
falls back to `closesAt`. It cannot be **earlier than `closesAt`**; an event that
is already over while betting is live lets a resolution be proposed mid-market,
and every bet placed after that point on the winning side is voided at
settlement.

**Errors** — `closesAt is not a valid date` (or `opensAt` / `eventStartAt` /
`eventEndAt`) · `Not a member of this circle` · `Betting must close after it opens` ·
`The event cannot end before betting closes` · `The event cannot start after it ends` ·
`The tagged person is not in this circle` · `Over/under needs a line` ·
`Use a half number for the line…` · `Multiple choice needs at least 2 options` ·
`Unknown market kind` · `Duplicate option: "x"…`

### `updateMarket(marketId, changes)`

Anything you leave out stays as it is.

```ts
updateMarket(
  marketId: number,
  changes: {
    question?: string; imageUrl?: string;
    closesAt?: Date | string; opensAt?: Date | string;
    eventStartAt?: Date | string; eventEndAt?: Date | string;
    subjectId?: Uuid;
  },
): Promise<Result<null>>
```

**The rules tighten once anyone bets.** Before the first bet, the creator or an
admin can change anything. After it, the question, window and subject freeze —
only the image stays editable, and only an admin can adjust event timing.

**Errors** — `closesAt is not a valid date` (or any other date field) ·
`Market not found` · `That market has already settled` ·
`Only the market creator or a circle admin can edit this` ·
`Bets have been placed. Only the image can be changed now…` ·
`Bets have been placed. Only a circle admin can change the event timing now.`

### `cancelMarket(marketId)`

Deletes a market outright. Only while nobody has bet — once bets exist, use
[`voidMarket()`](#voidmarketmarketid-reason) to refund everyone instead.

```ts
cancelMarket(marketId: number): Promise<Result<null>>
```

**Errors** — `Market not found` ·
`That market has already settled and cannot be cancelled` ·
`Only the market creator or a circle admin can cancel this` ·
`Bets have been placed. Use void_market() to refund everyone instead.`

### `submitOption(marketId, label)`

Adds an option to an `open` market.

```ts
submitOption(marketId: number, label: string): Promise<Result<number>>
```

**Returns** — the new option id.

Submissions close 15 minutes before betting does, which is what stops someone
adding the winning answer at the last second. Duplicates are rejected
case- and whitespace-insensitively.

**Errors** — `This market has fixed options` · `This market has settled` ·
`Option submissions have closed` · `This market has not opened yet` ·
`Betting has closed` · `Not a member` · `That option already exists`

### `getMarkets(circleId, opts?)`

```ts
getMarkets(
  circleId: number,
  opts?: {
    status?: MarketStatus | MarketStatus[];
    limit?: number;                            // defaults to 50
  },
): Promise<Result<Market[]>>
```

Newest close date first. **Careful with `status`** — a cron job advances it, so
it can lag a minute or two. For "can I still bet?" use
[`isBettingOpen()`](#isbettingopenmarket-now).

### `getMarket(marketId)`

```ts
getMarket(marketId: number): Promise<Result<Market>>
```

**Errors** — `Market not found`, which also covers a market in a circle you're
not a member of.

### `getMarketWithOptions(marketId)`

Market plus its options in one round trip — what a detail page wants.

```ts
getMarketWithOptions(marketId: number): Promise<Result<Market & { options: MarketOption[] }>>
```

**Errors** — `Market not found`

### `getOptions(marketId)`

```ts
getOptions(marketId: number): Promise<Result<MarketOption[]>>
```

### `getOdds(marketId)`

Live odds: how the pot splits across the options right now.

```ts
getOdds(marketId: number): Promise<Result<MarketOdds[]>>
```

Each row has `pool`, `bet_count` and `pct`. **`pct` is `null` until the first
bet lands** — guard before formatting it. Voided bets are excluded.

---

## Market helpers

Pure functions, no network. The server is the authority on all of this; these
just save the UI from re-deriving the same booleans in five places.

### `isBettingOpen(market, now?)`

```ts
isBettingOpen(market: Market, now?: Date): boolean
```

Compares timestamps the way the server does. **Use this instead of
`status === 'open'`.**

### `isSettled(market)`

```ts
isSettled(market: Market): boolean
```

True for `resolved` or `voided`.

### `canSubmitOption(market, now?)`

```ts
canSubmitOption(market: Market, now?: Date): boolean
```

Whether members can still add options — `open` markets only, before
`options_lock_at`.

### `canProposeResolution(market, now?)`

```ts
canProposeResolution(market: Market, now?: Date): boolean
```

Mirrors the server: `event_end_at`, falling back to `closes_at` when it's unset.

---

## Betting

Pool-based, not an order book. Everyone's stake goes into one pot and the
winners split it in proportion to what they put in — **so the odds you see when
you bet are not the odds you get paid at.**

### `placeBet(marketId, optionId, amount)`

```ts
placeBet(marketId: number, optionId: number, amount: number): Promise<Result<number>>
```

**Returns** — your new balance.

The balance check and deduction happen in one statement server-side, so
double-tapping cannot spend the same coins twice.

**Errors** — `Amount must be positive` · `This market has already settled` ·
`Betting has closed` · `Betting has not opened yet` · `Not a member of this circle` ·
`You cannot bet on a market about yourself` ·
`That option does not belong to this market` · `Not enough coins`

### `getMarketBets(marketId)`

Every live bet on a market, so you can show who's on which side.

```ts
getMarketBets(marketId: number): Promise<Result<Bet[]>>
```

### `getMyBetsOnMarket(marketId)`

```ts
getMyBetsOnMarket(marketId: number): Promise<Result<Bet[]>>
```

Usually 0 or 1, but nothing stops someone betting twice or spreading stakes
across options.

### `getMyBets(opts?)`

Your betting history, newest first, with the market and option attached so a
history screen doesn't need a query per row.

```ts
getMyBets(opts?: {
  circleId?: number;      // bets carry no circle id; this filters via the market
  status?: BetStatus;
  limit?: number;         // defaults to 100
}): Promise<Result<Array<Bet & { market: Market; option: MarketOption }>>>
```

### `getOpenBets(circleId)`

Everyone who has money riding on this circle right now.

```ts
getOpenBets(circleId: number): Promise<Result<Array<Bet & { market: { circle_id: number } }>>>
```

### `projectedPayout(stake, optionPool, totalPool)`

What a bet is worth if its option wins, given the pot right now.

```ts
projectedPayout(stake: number, optionPool: number, totalPool: number): number
```

Matches the server's formula exactly. **Still label it an estimate** — the pot
moves with every new bet, and at settlement the rounding remainder goes to the
single largest winning stake, so that one bettor can come out a coin or two
ahead.

### `voidBet(betId, reason)`

**Admin only.** Cancels one person's bet and refunds them, leaving the rest of
the market alone.

```ts
voidBet(betId: number, reason: string): Promise<Result<null>>
```

**Errors** — `Only circle admins can void bets` · `That market has already paid out` ·
`Bet not found or already voided`

---

## Resolution

1. Anyone proposes an outcome, putting up a refundable bond.
2. Members vote — **advisory only**, it binds nothing.
3. An admin reviews, and that settles the market.

Proposing does **not** stop betting. It timestamps the market so late bets can
be quarantined if the proposal is approved. **There is no quorum** — the first
admin to approve settles it in the same transaction.

### `proposeResolution(marketId, optionId, note?)`

```ts
proposeResolution(marketId: number, optionId: number, note?: string): Promise<Result<number>>
```

**Returns** — the new proposal id.

Costs the circle's `proposal_bond`, refunded if approved and forfeited if it was
a false alarm. The bond amount is read server-side and is deliberately not a
parameter. One pending proposal per person per market.

**Errors** — `This market is already settled` · `Not a member` ·
`The event has not finished yet` · `That option does not belong to this market` ·
`Not enough coins to post the bond`

### `getProposals(marketId, opts?)`

```ts
getProposals(
  marketId: number,
  opts?: { status?: 'pending' | 'approved' | 'rejected' },
): Promise<Result<Array<ResolutionProposal & { option: MarketOption }>>>
```

The proposed option comes back embedded, so you can render "Bob proposes: Yes"
without a second lookup. The **proposer's name is not embeddable** —
`proposer_id` points at `auth.users`, not `circle_members`. Map it from
`getMembers(circleId)`.

### `voteOnProposal(proposalId, vote)`

```ts
voteOnProposal(proposalId: number, vote: 'approve' | 'disapprove'): Promise<Result<null>>
```

Calling it again changes your vote.

**Errors** — `Invalid vote` · `Not a member of this circle` ·
`This proposal has already been reviewed`

### `clearProposalVote(proposalId)`

```ts
clearProposalVote(proposalId: number): Promise<Result<null>>
```

### `getVoteTally(proposalId)`

```ts
getVoteTally(proposalId: number): Promise<Result<ProposalVoteTally>>
```

`approve_count`, `disapprove_count`, `total_votes`.

**Errors** — `Proposal not found`

### `getProposalVotes(proposalId)`

Who voted which way, for showing the split rather than just the count.

```ts
getProposalVotes(proposalId: number): Promise<Result<ProposalVote[]>>
```

### `getMyVote(proposalId)`

```ts
getMyVote(proposalId: number): Promise<Result<ProposalVote | null>>
```

`null` if you haven't voted.

### `reviewProposal(proposalId, action)`

**Admin only.** The main way markets get settled.

```ts
reviewProposal(proposalId: number, action: ProposalAction): Promise<Result<null>>
```

| `action` | Effect |
|---|---|
| `approve` | Pays out immediately. Bond refunded |
| `reject_reopen` | False alarm — betting continues, bond forfeited. Clears the quarantine line, so bets from here on are normal bets |
| `reject_close` | Betting stops, market stays unresolved |
| `void_market` | Everyone refunded, all bonds returned |

**Errors** — `Unknown action` · `Proposal not found or already reviewed` ·
`Only circle admins can review proposals`

### `resolveMarket(marketId, winningOptionId)`

**Admin only.** Settles directly, skipping the proposal flow.

```ts
resolveMarket(marketId: number, winningOptionId: number): Promise<Result<null>>
```

Winners get their stake back plus a floored share of the losing pool. If nobody
picked the winner, everyone is refunded.

**Errors** — `Market already settled` · `Only circle admins can resolve markets` ·
`That option does not belong to this market`

### `voidMarket(marketId, reason)`

**Admin only.** Calls it off and refunds every stake. Nobody wins.

```ts
voidMarket(marketId: number, reason: string): Promise<Result<null>>
```

**Errors** — `Market already settled` · `Only circle admins can void a market`

---

## Comments

### `getComments(marketId)`

```ts
getComments(marketId: number): Promise<Result<Comment[]>>
```

Oldest first. Carries `user_id`, not a name — map it from `getMembers()`.

### `addComment(marketId, body)`

```ts
addComment(marketId: number, body: string): Promise<Result<Comment>>
```

Up to 1000 characters. **Returns** — the created row.

### `deleteComment(commentId)`

```ts
deleteComment(commentId: number): Promise<Result<null>>
```

**Errors** — `That comment is not yours to delete`

---

## Evidence

Photos and video backing up a resolution, in the private `evidence` bucket.

### `getEvidence(marketId)`

```ts
getEvidence(marketId: number): Promise<Result<MarketEvidence[]>>
```

### `uploadEvidence(file, opts)`

```ts
uploadEvidence(file: File, opts: {
  marketId: number;
  proposalId?: number;
  caption?: string;
}): Promise<Result<MarketEvidence>>
```

Uploads the file and records it in one call. The storage path is built for you
as `<circle_id>/<market_id>/<uuid>.<ext>`; the circle is looked up from the
market, so there is no way for the two halves of that path to disagree. If
recording fails, the uploaded file is cleaned up rather than orphaned.

Both the upload and the row are blocked once the market settles, which keeps the
proof behind a payout intact.

**Errors** — `Not signed in` · `Market not found` ·
`Evidence must be an image or a video (got "…")` · plus any storage error

### `getEvidenceUrl(storagePath, expiresInSeconds?)`

The bucket is private, so files need a temporary signed URL to display.

```ts
getEvidenceUrl(storagePath: string, expiresInSeconds = 3600): Promise<Result<string>>
```

### `deleteEvidence(evidence)`

Retracts your own upload. Takes the whole row, because it needs the
`storage_path` to remove the file too.

```ts
deleteEvidence(evidence: MarketEvidence): Promise<Result<null>>
```

**Errors** — `That evidence is not yours to delete, or the market has settled`

---

## Notifications

### `getNotifications(opts?)`

```ts
getNotifications(opts?: {
  unreadOnly?: boolean;   // for a badge count
  limit?: number;         // defaults to 50
}): Promise<Result<Notification[]>>
```

Newest first, always scoped to you.

### `markNotificationRead(notificationId)`

```ts
markNotificationRead(notificationId: number): Promise<Result<null>>
```

Goes through a function — there's no direct update on this table, so writing
`read_at` yourself is denied.

### `markAllNotificationsRead()`

```ts
markAllNotificationsRead(): Promise<Result<null>>
```

---

## Realtime

Four tables are published for live updates. Row-level security applies exactly
as it does to a normal read.

**Treat these as a nudge, not as data.** The payload is one row, but what you're
showing — the odds split, the running pot — is an aggregate over all of them.
Refetch on the nudge. Patching state from the payload means reimplementing the
pool maths in the browser, which is how the number on screen ends up
disagreeing with the database.

```tsx
useEffect(() => onMarketBets(marketId, () => refetchOdds()), [marketId]);
```

All five return an unsubscribe function.

```ts
onMarketBets(marketId: number, cb: (c: Change<Bet>) => void): () => void
onMarketChange(marketId: number, cb: (c: Change<Market>) => void): () => void
onCircleMarkets(circleId: number, cb: (c: Change<Market>) => void): () => void
onMarketComments(marketId: number, cb: (c: Change<Comment>) => void): () => void
onProposalVotes(proposalId: number, cb: (c: Change<ProposalVote>) => void): () => void
```

| Function | Fires when | Refetch |
|---|---|---|
| `onMarketBets` | Someone bets on this market | `getOdds`, `getMarketBets` |
| `onMarketChange` | This market changes — usually cron advancing status, or a resolution | `getMarket` |
| `onCircleMarkets` | A market in this circle is created or changed | `getMarkets` |
| `onMarketComments` | New comment | `getComments` |
| `onProposalVotes` | Someone votes | `getVoteTally` |

```ts
interface Change<T> {
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  row: T | null;               // null on DELETE
  previous: Partial<T> | null; // primary key only, unless replica identity is FULL
}
```

---

## Escape hatch

If you need a query this folder doesn't cover, use these rather than calling
`supabase` directly — you keep the `{ data } | { error }` shape.

### `read(query)`

```ts
read<T>(query): Promise<Result<T>>

const { data, error } = await read<Comment[]>(
  supabase.from('comments').select('*').eq('user_id', me),
);
```

**Row-level security scopes rows to your *circle*, not to *you*.** A bare query
against `circle_members`, `bets` or `comments` returns every row for every
circle you belong to. "Just mine" needs an explicit `.eq('user_id', …)`.

### `rpc(fn, args)`

```ts
rpc<T>(fn: string, args?: Record<string, unknown>): Promise<Result<T>>
```

Parameter names are the SQL ones, prefixed with `_`. See
[BACKEND.md §4](../../../supabase/BACKEND.md).

---

## Types

Every row shape lives in [`types.ts`](../src/lib/types.ts) and mirrors the
database exactly — verified on each test run by `sandbox/check-types.mjs`, which
compares each interface against the real columns including nullability.

**Tables** — `Circle` `Season` `CircleMember` `Market` `MarketOption` `Bet`
`ResolutionProposal` `MarketEvidence` `LedgerEntry` `Comment` `Notification`
`ProposalVote`

**Views** — `MarketOdds` `LeaderboardRow` `SeasonLeaderboardRow`
`ProposalVoteTally` `CircleReconciliation`

**Unions** — `MarketKind` `MarketStatus` `BetStatus` `MemberRole`
`ProposalStatus` `ProposalAction` `Vote` `MediaType` `LedgerReason`

A few worth knowing:

| Field | Note |
|---|---|
| `CircleMember.balance` | Per circle. Broke in one, rich in another |
| `Market.status` | Cosmetic and lagging. Use the timestamp helpers |
| `Market.options_lock_at` | Derived: `closes_at − 15 min`, `open` markets only |
| `MarketOdds.pct` | `null` until the first bet |
| `LeaderboardRow.net_profit` | The ranking field, not `balance` |
| `Bet.payout` | Includes the original stake |
| `CircleReconciliation.drift` | Must always be 0 |
