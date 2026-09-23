# sandbox

Runs the whole backend in-process and exercises `apps/web/src/lib` against it.
No Docker, no Supabase project, no network. Nothing here ships to production.

```bash
cd sandbox && npm install && npm test
```

Three passes run in order — parameter names, column types, then behaviour.
Expected tail: `NO PARAM MISMATCHES`, `NO TYPE MISMATCHES`, `the count printed at the end`.

## Demo: the whole app, no accounts

```bash
cd sandbox && npm install   # once
cd .. && pnpm install       # once
pnpm demo                   # http://localhost:5175
```

Runs the real web app against the same in-browser Postgres, with a seeded circle and three
fake users. Use the DEMO bar (bottom left) to switch between Alice (admin), Bob and Cara;
"Continue with Google" signs in as Alice. Data lives in the tab, so a reload resets it.
Realtime is not simulated: a screen refreshes after your own actions, not when another
user acts. The real `apps/web/.env` is never loaded, so the demo cannot touch a real project.

## How it works

| Piece | What it is |
|---|---|
| [PGlite](https://pglite.dev) | Real Postgres 18, compiled to WASM, running in Node |
| `shim.sql` | The bits of Supabase the schema needs: `auth.users`, `auth.uid()`, the `anon`/`authenticated`/`service_role` roles, a `storage` stub, the realtime publication |
| `fakeclient.mjs` | Stands in for `supabase-js`, translating the query builder into SQL |
| `build.mjs` | Bundles `apps/web/src/lib` and points `@supabase/supabase-js` at the fake client |
| `run.mjs` | The tests |
| `check-params.py` | Static pass: diffs every `rpc()` call's parameter names against the SQL signatures. Catches a renamed or misspelled `_param` without running anything |
| `check-types.mjs` | Compares every interface in `types.ts` against the real columns, including nullability. `tsc` cannot catch this — reads are cast, not validated, so a wrong field name is silently `undefined` at runtime |

`supabase/migrations/0001_initial.sql` is loaded **unmodified**. The schema's
own self-test raises on failure, so a clean install is itself an assertion.

Every call runs as `set role authenticated` with `request.jwt.claim.sub` set to
a test user, so RLS applies exactly as it does in production. Running as the
superuser would bypass it and quietly make every privacy test meaningless.

## What this does and doesn't prove

**Covered — 56 of the 70 exported functions.** All 23 RPCs with the exact
parameter names the lib sends; the full create → join → bet → propose → vote
→ resolve → pay out lifecycle; direct resolution, market editing and its
post-bet freeze rules, void/cancel/leave/remove and their guards; the money
invariants (`circle_reconciliation.drift` stays 0); RLS actually hiding other
circles; every documented error string.

**The 14 not exercised**, and why:

| Function(s) | Why |
|---|---|
| `rpc`, `currentUserId` | Internal helpers. Every other function goes through them, so all 203 assertions cover them |
| `signInWithGoogle`, `signOut`, `getCurrentUser`, `getSession`, `onAuthChange` | Need GoTrue. The sandbox fakes sessions by setting the JWT claim directly |
| `getEvidenceUrl`, `deleteEvidence` | Need Storage, which is stubbed out. `uploadEvidence` is exercised only up to the storage call |
| the five `realtime.ts` subscriptions | Need the Realtime service; `channel()` is stubbed so imports stay safe |

**Also not covered** — the real PostgREST. The fake client mimics its SQL
translation, including refusing an ambiguous embed the way the real one does,
but it is a reimplementation. Web push and `pg_cron` never run.

### Where the fake client is knowingly more permissive

These are the places a test can pass here and behave differently in
production. None is currently reached by `lib/`, but they are the traps to
know about before adding a query.

| Divergence | Consequence |
|---|---|
| Embedded column lists are ignored — an embed always returns every column | `market:markets!inner(circle_id)` yields the whole market row here, only `circle_id` in production. Never assert on a column you did not select |
| `!inner` is ignored on one-to-many embeds | Real PostgREST drops parent rows with no children; here the parent survives with `[]` |
| Filtering on a one-to-many embedded column is unsupported | Real PostgREST allows it; here it would generate invalid SQL |
| `.single()` on zero rows says `expected 1 row, got 0` | Real PostgREST says `JSON object requested, multiple (or no) rows returned`. `lib/` uses `.maybeSingle()` on reads for exactly this reason |
| No `status` on responses | The offline path (`status === 0`) is covered by a direct unit test instead |

Treat a green run as "the logic is right", not "this is deployed and working".
First run against a real Supabase project is still the real test.

## If a test fails

Assertions use `check()`; setup steps use `must()`, which exits immediately
rather than letting a silent failure invalidate everything downstream. If you
see `SETUP FAILED`, fix that first — the assertions after it mean nothing.

Two things worth knowing when writing new tests:

- **Betting needs an open market.** To settle one, create it open, place the
  bets, then backdate `opens_at`/`closes_at`/`event_end_at` in SQL. Backdate
  `opens_at` too or the `closes_at > opens_at` constraint fires.
- **Option dedup normalises case and surrounding whitespace**, not internal
  spacing. `'A wildcard'` and `'  a wildcard  '` collide; `'a  wildcard'` does not.
