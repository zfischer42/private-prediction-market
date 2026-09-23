# `lib/` — the backend, as functions

Everything the app can do, wrapped so you never write a raw `supabase.rpc()`
call or read the 2,900-line schema.

```ts
import { placeBet, getOdds, onAuthChange } from './lib';
```

**Every function, its parameters and its exact error strings:**
[API reference](../../docs/api-reference.md).

Backend internals live in [`supabase/BACKEND.md`](../../../../supabase/BACKEND.md).

---

## Setup

```bash
cp apps/web/.env.example apps/web/.env   # then fill in the two values
pnpm dev
```

Both values come from Supabase → Project Settings → API, and both are safe in
the browser bundle. If they're missing you get a clear error at startup rather
than a confusing fetch failure later.

---

## The one convention

Every function returns `{ data }` or `{ error }`. Never both, never a throw.

```ts
const { data, error } = await placeBet(marketId, optionId, 100);
if (error) return showToast(error);   // "Not enough dollars"
setBalance(data);                     // new balance
```

`error` is already a plain-English sentence written for a user. Show it as-is;
don't map it to your own copy. The full list per function is in the
[API reference](../../docs/api-reference.md).

**Nothing throws** — not a network failure, not an invalid `Date`, not a missing
row. Being offline reads as `Could not reach the server…`, not
`TypeError: Failed to fetch`. Length limits (question 3–300, comment 1–1000,
circle name 1–60) read as sentences rather than as Postgres constraint names —
the full table is in the [API reference](../../docs/api-reference.md#conventions).

The exceptions are `getCurrentUser`, `getSession`, and `currentUserId`, which
just return the value or `null` — nothing about them can fail in a way you'd
show someone.

---

## Start here: the auth loop

`signInWithGoogle()` alone won't get a user in — after Google redirects back,
nothing tells React the session exists. Subscribe once on app start:

```tsx
const [user, setUser] = useState<User | null | undefined>(undefined);

useEffect(() => onAuthChange(setUser), []);

if (user === undefined) return <Splash />;      // still checking
if (user === null) return <SignIn />;           // signed out
return <App user={user} />;
```

`onAuthChange` fires immediately with the session restored from storage, then
again on every sign-in and sign-out. It returns its own unsubscribe, so
returning it straight from `useEffect` is the whole cleanup.

Don't also call `getCurrentUser()` on mount. It double-fires, and the manual
read can land after a sign-out and overwrite it with a stale user.

---

## Files

| File | What's in it |
|---|---|
| `supabase.ts` | Client, auth, and the `Result` type |
| `circles.ts` | Create/join circles, members, balances, leaderboards, admin |
| `markets.ts` | Create/edit markets, options, live odds, timing helpers |
| `bets.ts` | Place bets, bet history |
| `resolution.ts` | Propose, vote, admin review, resolve, void |
| `social.ts` | Comments, evidence uploads, notifications |
| `realtime.ts` | Live updates for bets, markets, comments, votes |
| `types.ts` | Every row shape, mirroring the schema |

---

## Live updates

Four tables are published for realtime, so odds can move without a refresh:

```tsx
useEffect(() => onMarketBets(marketId, () => refetchOdds()), [marketId]);
```

Treat these as a nudge, not as data. The payload is one row, but what you're
showing — the odds split, the running pot — is an aggregate over all of them.
Refetch on the nudge. Patching local state from the payload means
reimplementing the pool maths in the browser, which is how the number on
screen ends up disagreeing with the database.

---

## Five things that will bite you

**1. `market.status` lags.** A cron job advances it, so it can be a minute or
two stale. Never gate the bet button on `status === 'open'` — use
`isBettingOpen(market)`, which compares the timestamps the way the server does.

**2. Balance is per-circle.** It lives on `circle_members`, not on the user.
Someone can be broke in one circle and rich in another. Always read it via
`getMyMembership(circleId)`.

**3. Ids are numbers, not UUIDs.** Circles, markets, bets and options all use
Postgres `bigint`. Only `user_id` is a UUID string.

**4. Odds are a pool, not a quote.** `getOdds()` shows how the pot splits right
now, and it moves with every new bet, so what a user sees when they tap is not
what they get paid. `projectedPayout()` matches the server's formula exactly,
but still label it an estimate — at resolution the rounding remainder goes to
the single largest winning stake.

**5. RLS scopes rows to your *circle*, not to *you*.** If you write your own
query against `circle_members`, `bets`, or `comments`, you get every row for
every circle you belong to. That's deliberate — it's what powers member lists
and the odds board — but it means "just my rows" needs an explicit
`.eq('user_id', …)`. The `getMy*` functions here already do this.

---

## Permissions

Don't build permission logic. Every rule — admin-only actions, betting windows,
balance checks — is enforced inside the database and re-checked on every call.
Hiding a button is a courtesy to the user, not a security boundary; a call that
shouldn't be allowed comes back as an `error` instead of going through.

For laying out screens, `getMyMembership(circleId)` gives you `role`, and
`markets.ts` exports `isBettingOpen`, `isSettled`, `canSubmitOption`, and
`canProposeResolution`. Use them to grey things out, then let the error path
handle whatever slips through.

---

## Verification status

`cd sandbox && npm test` runs the whole backend in-process and exercises this
folder against it — 232 assertions, no Docker or network needed. See
[`sandbox/README.md`](../../../../sandbox/README.md).

Twelve functions can't be reached there because they need Supabase's hosted
services. These are the ones to smoke-test first on a real project:

- **Auth** — `signInWithGoogle`, `signOut`, `getCurrentUser`, `getSession`, `onAuthChange`
- **Storage** — `getEvidenceUrl`, `deleteEvidence`, and `uploadEvidence` past its validation
- **Realtime** — all five subscriptions in `realtime.ts`

Not built yet: web push. The `push_subscriptions` table and a delivery cron job
exist in the schema, but wiring them up needs VAPID keys and a service worker,
and the architecture spine defers push until the core loop is stable.
