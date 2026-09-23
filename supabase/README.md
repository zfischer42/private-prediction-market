# Supabase

Everything the app's backend is: one schema file, one storage bucket, one auth
provider. There is no server to deploy — the browser talks to Postgres directly
through PostgREST.

- **What the schema does and why** — [`BACKEND.md`](BACKEND.md)
- **The functions the app calls** — [`../apps/web/docs/api-reference.md`](../apps/web/docs/api-reference.md)
- **Running it all without a Supabase project** — [`../sandbox/README.md`](../sandbox/README.md)

---

## Setup, in order

Roughly 20 minutes on a fresh project. Steps 1–3 are the backend, 4–5 are auth,
6 gets the app talking to it.

### 0. Before you touch the dashboard

Run the test suite. It installs this exact schema file into an in-process
Postgres and exercises the whole lifecycle, so a failure here is a problem with
the code, not with your project:

```bash
cd sandbox && npm install && npm test
```

Expect `232 passed, 0 failed`.

### 1. Create (or reset) the project

New project: <https://supabase.com/dashboard> → **New project**. Pick a region
near your friends, save the database password somewhere real.

Already ran an earlier version? The schema is written to be re-run — tables use
`if not exists`, functions are `create or replace`, constraints are dropped and
re-added — so you can run the new file straight on top. **While you have no
users, prefer a clean reset** (Settings → General → Reset database): it costs
nothing now and removes any doubt about leftover state from v1–v4.

### 2. Enable `pg_cron`

Dashboard → **Database → Extensions** → search `pg_cron` → enable.

Do this *before* step 3. The schema's section 12 checks for the extension and
skips silently with a notice if it is missing, which leaves `markets.status`
frozen forever. Betting still works — every eligibility check reads timestamps,
not `status` — but list filters and badges will lie.

**Do not enable `pg_net` yet.** Section 12 only schedules the push-delivery job
when `pg_net` is present, and that job calls an edge function that does not
exist yet. Turning it on now buys you a cron job failing every minute. Enable it
when you build push, alongside the Vault secrets named in section 12.

### 3. Run the schema

Dashboard → **SQL Editor** → New query → paste all of
[`migrations/0001_initial.sql`](migrations/0001_initial.sql) → Run.

Look for this in the output:

```
SELF-TEST PASSED: RLS on all tables, 5 guards live, Data API grants correct ...
```

The self-test raises on failure, so anything other than that line is a real
problem — read the message, it names what is wrong. It checks that RLS is on
every table, all five immutability triggers are attached, no function is
callable by `anon`, every `SECURITY DEFINER` pins `search_path`, the Data API
grants are right, and no circle has ledger drift.

This step also creates the private `evidence` storage bucket and its policies.
Nothing to do by hand in Storage.

### 4. Google sign-in

Two halves, and they point at each other.

**Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 client
→ **Authorised redirect URIs**, add:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

**Supabase** → Authentication → **Sign In / Providers** → Google → enable, then
paste the client ID and client secret.

> The client **secret** belongs here and nowhere else. The root `.env` in this
> repo is a notes file — gitignored, never committed (checked), and not in
> `KEY=VALUE` form, so nothing actually loads it. Once the secret is in the
> dashboard, delete it from disk. If it has ever been pasted into a chat or an
> email, rotate it in Google Cloud Console instead.

### 5. Redirect URLs

Authentication → **URL Configuration**:

- **Site URL**: `http://localhost:5173`
- **Redirect URLs**: add `http://localhost:5173/**`, plus your LAN address
  (`http://192.168.x.x:5173/**`) if you want to test the PWA on a phone.

`signInWithGoogle()` passes `redirectTo` explicitly, but Supabase only honours a
value matching this allowlist — otherwise it falls back to the Site URL and the
user lands somewhere they did not start.

### 6. Point the app at it

```bash
cp apps/web/.env.example apps/web/.env
```

Fill in both values from Settings → **API**:

| Variable | Where |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | `anon` / publishable key |

Both ship in the browser bundle and that is fine — the anon key is a public
identifier, and every rule that protects data is enforced in Postgres. **Never
put the `service_role` key here**; it bypasses RLS entirely.

Then:

```bash
pnpm install && pnpm dev
```

Vite reads `.env` once at startup, so restart the dev server after editing it.

---

## Verifying it worked

Run these in the SQL Editor. All three should be boring.

```sql
-- 1. Money is balanced. Must be 0 on every circle, forever.
select * from public.circle_reconciliation;

-- 2. The cron jobs exist (empty means step 2 was skipped).
select jobname, schedule, active from cron.job;

-- 3. The four realtime tables are published.
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
-- expect: bets, markets, comments, proposal_votes
```

Then the round trip that proves auth, RLS and the RPC layer at once: sign in
through the app, create a circle, and check it comes back with you as admin on
the starting balance.

---

## Things that will confuse you

**"permission denied for table X"** — the Data API grants in section 2.5 did not
apply. Re-run the schema. The self-test asserts these specifically because this
failure once looked like a clean install.

**Status never changes** — `pg_cron` is not enabled. See step 2.

**Realtime is silent** — pass `onError` to any subscription in
`apps/web/src/lib/realtime.ts`. The channel reports `CHANNEL_ERROR` or
`TIMED_OUT` rather than failing loudly on its own.

**Sign-in redirects to the wrong page** — the URL is not in the step 5
allowlist.

**A market refuses to pay out** — impossible as of schema v5, which stops
`event_end_at` being set before `closes_at`. If you see it on a market created
under v4, void it and refund everyone.

---

## Changing the schema later

Edit `migrations/0001_initial.sql` and re-run the whole file. It is idempotent
by construction (verified: three consecutive runs over live data are a no-op).

The one trap: **`create or replace function` cannot change a parameter list.**
Postgres either errors or quietly creates a second overload beside the old one,
and PostgREST then cannot tell which you meant. When you add or rename an
argument, drop the old signature explicitly first — there is a worked example at
`propose_resolution` in section 8.1.

After any change, re-run `cd sandbox && npm test` before touching the dashboard.
