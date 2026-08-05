-- =====================================================================
-- PRIVATE PREDICTION MARKET - FULL SCHEMA  v4
-- Postgres / Supabase
--
-- Run top to bottom in the Supabase SQL Editor. Copy-paste ready.
-- Look for "SELF-TEST PASSED" in the output; it raises loudly on failure.
--
-- v4 fixes options_lock_at desyncing when update_market moves the betting
-- window, clears orphaned notifications in cancel_market, and adds a hard
-- closes_at ceiling to submit_option.
--
-- v3 added section 2.5 (Data API grants). Supabase no longer grants table
-- access automatically: since 2026-05-30 new projects are created with
-- "Automatically expose new tables" OFF, and on 2026-10-30 that applies to
-- every existing project. Without section 2.5 this schema installs perfectly
-- and then every client read fails with "42501 permission denied for table".
-- The grants are now part of the schema, minimal, and self-test asserted.
--
-- Safe to run on a FRESH project OR on top of v1/v2:
--   - tables use "if not exists"
--   - new columns use "alter table ... add column if not exists"
--   - changed function signatures are explicitly dropped first
--   - constraints are dropped and re-added
--
-- DESIGN RULES
--   1. Users never write to money tables directly. All coin movement
--      goes through SECURITY DEFINER functions. RLS grants SELECT only.
--   2. Every SECURITY DEFINER function pins `set search_path = ''`
--      and schema-qualifies every reference (Supabase lint 0011).
--   3. Policies that read circle_members go through helper functions,
--      otherwise Postgres throws "infinite recursion detected in policy".
--   4. Proposing a resolution does NOT freeze betting. It timestamps
--      the market so late bets can be quarantined if approved.
--   5. Money/state tables have NO direct UPDATE policy. RLS gates rows,
--      not columns, so any such policy would let a user rewrite their
--      own balance/role.
--   6. Every function that moves coins locks the market row (`for update`
--      / `for share`) so concurrent actors cannot double-pay a pot.
--   7. Betting eligibility is decided by TIMESTAMPS, not by the status
--      column. The cron job only keeps status cosmetically in sync.
--   8. Every coin that exists was written to coin_ledger. Verify with
--      the public.circle_reconciliation view: drift must always be 0.
-- =====================================================================


-- =====================================================================
-- 0. EXTENSIONS
--    On Supabase these are normally enabled from Dashboard > Database >
--    Extensions. Wrapped so a permissions error does not abort the run.
-- =====================================================================
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not enabled here - turn it on in Dashboard > Database > Extensions, then re-run section 12';
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net not enabled here - turn it on in Dashboard > Database > Extensions, then re-run section 12';
  end;
end $$;


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 Circles: private friend groups
-- ---------------------------------------------------------------------
create table if not exists public.circles (
  id          bigint generated always as identity primary key,
  name        text        not null check (length(trim(name)) between 1 and 60),
  join_code   text        not null unique,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- v2: economy settings live on the circle, NOT on the client.
alter table public.circles
  add column if not exists starting_balance int not null default 1000;
alter table public.circles
  add column if not exists proposal_bond    int not null default 50;

alter table public.circles drop constraint if exists circles_starting_balance_ck;
alter table public.circles add constraint circles_starting_balance_ck
  check (starting_balance > 0 and starting_balance <= 1000000);
alter table public.circles drop constraint if exists circles_proposal_bond_ck;
alter table public.circles add constraint circles_proposal_bond_ck
  check (proposal_bond >= 0 and proposal_bond <= 100000);

-- ---------------------------------------------------------------------
-- 1.2 Seasons: balance resets. Now actually wired up (see reset_season).
-- ---------------------------------------------------------------------
create table if not exists public.seasons (
  id          bigint generated always as identity primary key,
  circle_id   bigint      not null references public.circles(id) on delete cascade,
  name        text        not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists seasons_one_active
  on public.seasons (circle_id) where is_active;

-- ---------------------------------------------------------------------
-- 1.3 Membership: balance lives HERE, not on the user.
-- ---------------------------------------------------------------------
create table if not exists public.circle_members (
  circle_id    bigint      not null references public.circles(id) on delete cascade,
  user_id      uuid        not null references auth.users(id)     on delete cascade,
  role         text        not null default 'member'
                           check (role in ('member','admin')),
  balance      int         not null default 1000 check (balance >= 0),
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index if not exists circle_members_user on public.circle_members (user_id);

-- ---------------------------------------------------------------------
-- 1.4 Markets
--
--  FOUR TIMESTAMPS, each doing one job:
--    opens_at       betting starts
--    closes_at      betting ends
--    event_start_at the thing happens
--    event_end_at   the thing is over and knowable
--
--  STATUS is cosmetic/derived: scheduled -> open -> closed -> resolved
--                                                          -> voided
--  place_bet() trusts opens_at/closes_at, never the cron-updated status.
-- ---------------------------------------------------------------------
create table if not exists public.markets (
  id                bigint generated always as identity primary key,
  circle_id         bigint      not null references public.circles(id) on delete cascade,
  season_id         bigint      references public.seasons(id) on delete set null,
  creator_id        uuid        not null references auth.users(id) on delete cascade,
  question          text        not null check (length(trim(question)) between 3 and 300),
  kind              text        not null default 'binary'
                                check (kind in ('binary','over_under','multi','open')),
  line              numeric,
  image_url         text,
  subject_id        uuid        references auth.users(id) on delete set null,
  opens_at          timestamptz not null default now(),
  closes_at         timestamptz not null,
  event_start_at    timestamptz,
  event_end_at      timestamptz,
  options_lock_at   timestamptz,
  status            text        not null default 'scheduled'
                                check (status in ('scheduled','open','closed','resolved','voided')),
  review_started_at timestamptz,
  winning_option_id bigint,
  resolved_at       timestamptz,
  resolved_by       uuid        references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint valid_betting_window check (closes_at > opens_at),
  constraint over_under_needs_line check (kind <> 'over_under' or line is not null)
);

create index if not exists markets_timeline
  on public.markets (circle_id, status, closes_at desc);
create index if not exists markets_lifecycle
  on public.markets (status, opens_at, closes_at);

-- ---------------------------------------------------------------------
-- 1.5 Options
-- ---------------------------------------------------------------------
create table if not exists public.market_options (
  id          bigint generated always as identity primary key,
  market_id   bigint      not null references public.markets(id) on delete cascade,
  label       text        not null check (length(trim(label)) between 1 and 100),
  sort_order  int         not null default 0,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists market_options_dedup
  on public.market_options (market_id, lower(trim(label)));
create index if not exists market_options_market
  on public.market_options (market_id, sort_order);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'markets_winning_option_fk'
  ) then
    alter table public.markets
      add constraint markets_winning_option_fk
      foreign key (winning_option_id)
      references public.market_options(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1.6 Bets
-- ---------------------------------------------------------------------
create table if not exists public.bets (
  id          bigint generated always as identity primary key,
  market_id   bigint      not null references public.markets(id)        on delete cascade,
  option_id   bigint      not null references public.market_options(id) on delete cascade,
  user_id     uuid        not null references auth.users(id)            on delete cascade,
  amount      int         not null check (amount > 0),
  status      text        not null default 'pending'
                          check (status in ('pending','won','lost','void','refunded')),
  payout      int         not null default 0 check (payout >= 0),
  was_late    boolean     not null default false,
  voided_at   timestamptz,
  voided_by   uuid        references auth.users(id) on delete set null,
  void_reason text,
  created_at  timestamptz not null default now()
);
create index if not exists bets_market      on public.bets (market_id) where voided_at is null;
create index if not exists bets_user_status on public.bets (user_id, status);
create index if not exists bets_option      on public.bets (option_id) where voided_at is null;
-- v2: makes the "does this member have unsettled money?" guard cheap
create index if not exists bets_user_pending
  on public.bets (user_id, market_id) where status = 'pending' and voided_at is null;

-- ---------------------------------------------------------------------
-- 1.7 Resolution proposals
-- ---------------------------------------------------------------------
create table if not exists public.resolution_proposals (
  id                 bigint generated always as identity primary key,
  market_id          bigint      not null references public.markets(id)        on delete cascade,
  proposer_id        uuid        not null references auth.users(id)            on delete cascade,
  proposed_option_id bigint      not null references public.market_options(id) on delete cascade,
  note               text,
  bond               int         not null default 0 check (bond >= 0),
  status             text        not null default 'pending'
                                 check (status in ('pending','approved','rejected')),
  reviewed_by        uuid        references auth.users(id) on delete set null,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
create unique index if not exists one_pending_proposal_per_user
  on public.resolution_proposals (market_id, proposer_id) where status = 'pending';
create index if not exists proposals_market
  on public.resolution_proposals (market_id, status);

-- ---------------------------------------------------------------------
-- 1.8 Evidence
-- ---------------------------------------------------------------------
create table if not exists public.market_evidence (
  id           bigint generated always as identity primary key,
  market_id    bigint      not null references public.markets(id) on delete cascade,
  proposal_id  bigint      references public.resolution_proposals(id) on delete cascade,
  uploader_id  uuid        not null references auth.users(id) on delete cascade,
  storage_path text        not null unique,
  media_type   text        not null check (media_type in ('image','video')),
  caption      text,
  created_at   timestamptz not null default now()
);
create index if not exists evidence_market   on public.market_evidence (market_id, created_at);
create index if not exists evidence_proposal on public.market_evidence (proposal_id);

-- ---------------------------------------------------------------------
-- 1.9 Ledger: every coin movement, ever.
-- ---------------------------------------------------------------------
create table if not exists public.coin_ledger (
  id         bigint generated always as identity primary key,
  circle_id  bigint      not null references public.circles(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)     on delete cascade,
  amount     int         not null check (amount <> 0),
  reason     text        not null,
  market_id  bigint      references public.markets(id) on delete set null,
  bet_id     bigint      references public.bets(id)    on delete set null,
  actor_id   uuid        references auth.users(id)     on delete set null,
  note       text,
  created_at timestamptz not null default now()
);

-- v2: 'initial_grant' added so joining a circle is recorded like everything
-- else. Drop/re-add so existing installs pick up the new value.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_ck;
alter table public.coin_ledger add constraint coin_ledger_reason_ck check (reason in (
  'initial_grant','admin_grant','bet','payout','refund','void_refund',
  'late_void_refund','proposal_bond','bond_refund','daily_bonus','season_reset',
  'member_removed'
));

create index if not exists ledger_lookup on public.coin_ledger (circle_id, user_id, created_at desc);
create index if not exists ledger_market on public.coin_ledger (market_id);

-- ---------------------------------------------------------------------
-- 1.10 Comments
-- ---------------------------------------------------------------------
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  market_id  bigint      not null references public.markets(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)     on delete cascade,
  body       text        not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_market on public.comments (market_id, created_at);

-- ---------------------------------------------------------------------
-- 1.11 Push
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subscriptions (user_id);

create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null,
  body       text        not null,
  url        text,
  sent_at    timestamptz,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_unsent on public.notifications (created_at) where sent_at is null;
create index if not exists notifications_user   on public.notifications (user_id, created_at desc);
-- v2: the "closing soon" cron does a not-exists on exactly these columns.
-- Without this index that job table-scans notifications every 15 minutes.
create index if not exists notifications_dedupe on public.notifications (user_id, title, url);

-- ---------------------------------------------------------------------
-- 1.12 Proposal votes (non-binding sentiment poll)
-- ---------------------------------------------------------------------
create table if not exists public.proposal_votes (
  proposal_id bigint      not null references public.resolution_proposals(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  vote        text        not null check (vote in ('approve','disapprove')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (proposal_id, user_id)
);
create index if not exists proposal_votes_proposal on public.proposal_votes (proposal_id);


-- =====================================================================
-- 2. HELPER FUNCTIONS
--    SECURITY DEFINER so RLS policies that read circle_members do not
--    recurse into themselves (SQLSTATE 42P17).
-- =====================================================================
create or replace function public.is_circle_member(_circle_id bigint)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = _circle_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_circle_admin(_circle_id bigint)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = _circle_id and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.market_circle(_market_id bigint)
returns bigint language sql security definer stable set search_path = '' as $$
  select circle_id from public.markets where id = _market_id;
$$;

create or replace function public.proposal_circle(_proposal_id bigint)
returns bigint language sql security definer stable set search_path = '' as $$
  select m.circle_id
  from public.resolution_proposals p
  join public.markets m on m.id = p.market_id
  where p.id = _proposal_id;
$$;

-- v2: used to stop evidence being deleted after a market has paid out.
create or replace function public.market_is_settled(_market_id bigint)
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select status in ('resolved','voided') from public.markets where id = _market_id),
    true);
$$;

-- v2: best-effort name from the auth provider so new members are not blank.
create or replace function public.default_display_name()
returns text language sql security definer stable set search_path = '' as $$
  select coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'user_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Player'
  )
  from auth.users u
  where u.id = auth.uid();
$$;

grant execute on function public.is_circle_member(bigint)   to authenticated;
grant execute on function public.is_circle_admin(bigint)    to authenticated;
grant execute on function public.market_circle(bigint)      to authenticated;
grant execute on function public.proposal_circle(bigint)    to authenticated;
grant execute on function public.market_is_settled(bigint)  to authenticated;


-- =====================================================================
-- 2.5 DATA API GRANTS   <-- REQUIRED, DO NOT DELETE
--
--   GRANTS AND RLS ARE TWO SEPARATE LAYERS.
--     GRANT decides whether a role may touch the table AT ALL.
--     RLS  decides which ROWS that role then sees.
--   A perfect set of RLS policies on a table with no GRANT returns
--   "42501 permission denied for table" for every single request.
--
--   This schema used to rely on Supabase's default privileges to supply
--   the GRANT half. That default is GONE. Since 2026-05-30 new projects
--   are created with "Automatically expose new tables" OFF, and from
--   2026-10-30 the setting is applied to every existing project. Tables
--   created in `public` are no longer reachable through the Data API
--   (supabase-js / PostgREST / GraphQL) until you grant them explicitly.
--   Direct Postgres connections (psql, an ORM, a server with a connection
--   string) were never affected -- this is a Data API concern only.
--
--   So the grants live HERE, in the schema, where they are versioned and
--   auditable. The list is deliberately MINIMAL rather than the usual
--   "grant all on all tables", because this app writes through
--   SECURITY DEFINER functions: those run as the function owner, so the
--   caller needs NO table privilege for any of them. The only rows a
--   client writes directly are comments, evidence and push subscriptions.
--
--   Net effect: read-only on everything, write on three tables, and RLS
--   still filters every row on top of that.
-- =====================================================================

-- Schema USAGE. Supabase already does this, but without it the role cannot
-- even resolve a table name (that is the "permission denied for SCHEMA
-- public" error, which is a different failure from the table one).
do $$
begin
  execute 'grant usage on schema public to anon, authenticated, service_role';
exception when others then
  raise notice 'Could not grant usage on schema public (%). If the app reports '
               '"permission denied for schema public", run it manually.', sqlerrm;
end $$;

-- 2.5.1 Start from zero for the browser-facing roles.
--   Old projects were created with SELECT/INSERT/UPDATE/DELETE handed to
--   anon AND authenticated on everything in public. Revoking first means
--   this file produces the SAME end state on an old project and a new one,
--   instead of silently inheriting whatever the project was born with.
do $$
declare _t text;
begin
  for _t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('circles','seasons','circle_members','markets',
                        'market_options','bets','resolution_proposals',
                        'market_evidence','coin_ledger','comments',
                        'push_subscriptions','notifications','proposal_votes')
  loop
    execute format('revoke all on public.%I from anon', _t);
    execute format('revoke all on public.%I from authenticated', _t);
  end loop;
exception when undefined_object then
  raise notice 'anon/authenticated roles not present - not a Supabase database?';
end $$;

-- 2.5.2 READ. Every table a signed-in member may read.
--   RLS then narrows each of these to "only circles you belong to".
grant select on public.circles              to authenticated;
grant select on public.seasons              to authenticated;
grant select on public.circle_members       to authenticated;
grant select on public.markets              to authenticated;
grant select on public.market_options       to authenticated;
grant select on public.bets                 to authenticated;
grant select on public.resolution_proposals to authenticated;
grant select on public.market_evidence      to authenticated;
grant select on public.coin_ledger          to authenticated;
grant select on public.comments             to authenticated;
grant select on public.notifications        to authenticated;
grant select on public.proposal_votes       to authenticated;

--   The five views are security_invoker, so they execute as the CALLING
--   user and need SELECT on the base tables above as well as on the view
--   itself. Granting the view alone is not enough -- that was exactly how
--   the leaderboard failed with "permission denied for table
--   circle_members" while the view itself was readable.
--   (View grants are issued in section 4, where the views exist.)

-- 2.5.3 WRITE. Only the three surfaces a client legitimately writes to.
--   Everything else -- bets, coins, roles, resolutions -- goes through
--   SECURITY DEFINER functions, which is why bets/coin_ledger/markets
--   appear above with SELECT and nothing more.
grant insert, delete        on public.comments           to authenticated;
grant insert, delete        on public.market_evidence    to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
grant select                on public.push_subscriptions to authenticated;

-- 2.5.4 anon gets NOTHING. Every circle is private and requires a session.
--   (Left explicit rather than implied, so a future "grant all" in some
--   other migration is visibly contradicting a stated decision.)

-- 2.5.5 service_role: full table access, matching platform convention.
--   It bypasses RLS, is server-side only, and must never reach a browser.
do $$
declare _t text;
begin
  for _t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('circles','seasons','circle_members','markets',
                        'market_options','bets','resolution_proposals',
                        'market_evidence','coin_ledger','comments',
                        'push_subscriptions','notifications','proposal_votes')
  loop
    execute format('grant select, insert, update, delete on public.%I to service_role', _t);
  end loop;
exception when undefined_object then null;
end $$;

--   NOTE ON SEQUENCES: every id here is `generated always as identity`,
--   whose backing sequence is owned by the column. INSERT on the table is
--   sufficient; no separate sequence GRANT is needed. If you ever swap a
--   column to `serial`, you WILL need to grant usage on its sequence.


-- =====================================================================
-- 3. ROW LEVEL SECURITY
-- =====================================================================
alter table public.circles              enable row level security;
alter table public.seasons              enable row level security;
alter table public.circle_members       enable row level security;
alter table public.markets              enable row level security;
alter table public.market_options       enable row level security;
alter table public.bets                 enable row level security;
alter table public.resolution_proposals enable row level security;
alter table public.market_evidence      enable row level security;
alter table public.coin_ledger          enable row level security;
alter table public.comments             enable row level security;
alter table public.push_subscriptions   enable row level security;
alter table public.notifications        enable row level security;
alter table public.proposal_votes       enable row level security;

drop policy if exists circles_select on public.circles;
create policy circles_select on public.circles
  for select to authenticated using ( public.is_circle_member(id) );

drop policy if exists seasons_select on public.seasons;
create policy seasons_select on public.seasons
  for select to authenticated using ( public.is_circle_member(circle_id) );

drop policy if exists members_select on public.circle_members;
create policy members_select on public.circle_members
  for select to authenticated using ( public.is_circle_member(circle_id) );

-- No direct UPDATE policy on circle_members, deliberately. RLS gates rows,
-- not columns, so "update your own row" would also let a user rewrite their
-- own balance and role. rename_member() is the sanctioned path.
drop policy if exists members_update_own_name on public.circle_members;
revoke update on public.circle_members from anon, authenticated;

drop policy if exists markets_select on public.markets;
create policy markets_select on public.markets
  for select to authenticated using ( public.is_circle_member(circle_id) );

drop policy if exists options_select on public.market_options;
create policy options_select on public.market_options
  for select to authenticated
  using ( public.is_circle_member(public.market_circle(market_id)) );

drop policy if exists bets_select on public.bets;
create policy bets_select on public.bets
  for select to authenticated
  using ( public.is_circle_member(public.market_circle(market_id)) );

drop policy if exists proposals_select on public.resolution_proposals;
create policy proposals_select on public.resolution_proposals
  for select to authenticated
  using ( public.is_circle_member(public.market_circle(market_id)) );

drop policy if exists evidence_select on public.market_evidence;
create policy evidence_select on public.market_evidence
  for select to authenticated
  using ( public.is_circle_member(public.market_circle(market_id)) );

drop policy if exists evidence_insert on public.market_evidence;
create policy evidence_insert on public.market_evidence
  for insert to authenticated
  with check (
    uploader_id = (select auth.uid())
    and public.is_circle_member(public.market_circle(market_id))
    and not public.market_is_settled(market_id)
  );

-- v2: you may retract your own evidence, but NOT after the market settled.
-- Otherwise the proof behind a payout can be deleted after the fact.
drop policy if exists evidence_delete_own on public.market_evidence;
create policy evidence_delete_own on public.market_evidence
  for delete to authenticated
  using (
    uploader_id = (select auth.uid())
    and not public.market_is_settled(market_id)
  );

drop policy if exists ledger_select on public.coin_ledger;
create policy ledger_select on public.coin_ledger
  for select to authenticated using ( public.is_circle_member(circle_id) );

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using ( public.is_circle_member(public.market_circle(market_id)) );

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_circle_member(public.market_circle(market_id))
  );

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete to authenticated using ( user_id = (select auth.uid()) );

drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions
  for all to authenticated
  using      ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select to authenticated using ( user_id = (select auth.uid()) );

drop policy if exists notifications_mark_read on public.notifications;
revoke update on public.notifications from anon, authenticated;

drop policy if exists proposal_votes_select on public.proposal_votes;
create policy proposal_votes_select on public.proposal_votes
  for select to authenticated
  using ( public.is_circle_member(public.proposal_circle(proposal_id)) );


-- =====================================================================
-- 4. VIEWS
--    security_invoker = true is NOT optional. Without it a view runs as
--    its owner and ignores RLS, leaking every circle to every user.
-- =====================================================================

-- 4.1 Live odds: each option's share of the pot.
create or replace view public.market_odds with (security_invoker = true) as
select
  o.market_id,
  o.id                            as option_id,
  o.label,
  o.sort_order,
  coalesce(sum(b.amount), 0)::int as pool,
  count(b.id)                     as bet_count,
  round(
    100.0 * coalesce(sum(b.amount), 0)
    / nullif(sum(sum(coalesce(b.amount, 0))) over (partition by o.market_id), 0)
  , 1)                            as pct
from public.market_options o
left join public.bets b
       on b.option_id = o.id
      and b.voided_at is null
group by o.market_id, o.id, o.label, o.sort_order;

-- ---------------------------------------------------------------------
-- 4.2 Leaderboard, per circle.
--
--  v2: rewritten. The old version joined circle_members -> markets -> bets,
--  which produced one row per member PER MARKET before aggregating
--  (members x markets rows). Bets are now pre-aggregated once, then joined
--  to members, so the row count is linear in members instead of quadratic.
--
--  RANK BY net_profit, NOT balance. Balance includes admin handouts.
--  net_profit now includes forfeited/refunded proposal bonds, so someone
--  who grief-proposes all day actually shows the cost of it.
-- ---------------------------------------------------------------------
create or replace view public.leaderboard with (security_invoker = true) as
with bet_stats as (
  select
    m.circle_id,
    b.user_id,
    count(*) filter (where b.status in ('won','lost'))                as bets_settled,
    count(*) filter (where b.status = 'won')                          as bets_won,
    count(*) filter (where b.status = 'lost')                         as bets_lost,
    count(*) filter (where b.status = 'pending')                      as bets_open,
    coalesce(sum(b.amount) filter (where b.status in ('won','lost')), 0)::int as coins_staked,
    coalesce(sum(b.payout) filter (where b.status = 'won'), 0)::int   as coins_won,
    coalesce(sum(b.payout - b.amount) filter (where b.status in ('won','lost')), 0)::int as bet_profit,
    coalesce(max(b.payout - b.amount) filter (where b.status = 'won'), 0)::int as biggest_win
  from public.bets b
  join public.markets m on m.id = b.market_id
  where b.voided_at is null
  group by m.circle_id, b.user_id
),
bond_stats as (
  select circle_id, user_id, coalesce(sum(amount), 0)::int as bond_net
  from public.coin_ledger
  where reason in ('proposal_bond','bond_refund')
  group by circle_id, user_id
)
select
  cm.circle_id,
  cm.user_id,
  cm.display_name,
  cm.role,
  cm.balance,
  coalesce(s.bets_settled, 0)                       as bets_settled,
  coalesce(s.bets_won, 0)                           as bets_won,
  coalesce(s.bets_lost, 0)                          as bets_lost,
  coalesce(s.bets_open, 0)                          as bets_open,
  coalesce(s.coins_staked, 0)                       as coins_staked,
  coalesce(s.coins_won, 0)                          as coins_won,
  coalesce(s.bet_profit, 0)                         as bet_profit,
  coalesce(bd.bond_net, 0)                          as bond_net,
  coalesce(s.bet_profit, 0) + coalesce(bd.bond_net, 0) as net_profit,
  round(
    100.0 * coalesce(s.bets_won, 0)
    / nullif(coalesce(s.bets_settled, 0), 0)
  , 1)                                              as win_pct,
  coalesce(s.biggest_win, 0)                        as biggest_win
from public.circle_members cm
left join bet_stats  s  on s.circle_id  = cm.circle_id and s.user_id  = cm.user_id
left join bond_stats bd on bd.circle_id = cm.circle_id and bd.user_id = cm.user_id;

-- ---------------------------------------------------------------------
-- 4.3 v2 NEW: per-season leaderboard. season_id was being stamped on every
--     market and then never read by anything. Now it is.
-- ---------------------------------------------------------------------
create or replace view public.season_leaderboard with (security_invoker = true) as
with bet_stats as (
  select
    m.season_id,
    b.user_id,
    count(*) filter (where b.status in ('won','lost'))                as bets_settled,
    count(*) filter (where b.status = 'won')                          as bets_won,
    count(*) filter (where b.status = 'lost')                         as bets_lost,
    count(*) filter (where b.status = 'pending')                      as bets_open,
    coalesce(sum(b.amount) filter (where b.status in ('won','lost')), 0)::int as coins_staked,
    coalesce(sum(b.payout - b.amount) filter (where b.status in ('won','lost')), 0)::int as net_profit,
    coalesce(max(b.payout - b.amount) filter (where b.status = 'won'), 0)::int as biggest_win
  from public.bets b
  join public.markets m on m.id = b.market_id
  where b.voided_at is null and m.season_id is not null
  group by m.season_id, b.user_id
)
select
  se.circle_id,
  se.id                        as season_id,
  se.name                      as season_name,
  se.is_active,
  cm.user_id,
  cm.display_name,
  coalesce(s.bets_settled, 0)  as bets_settled,
  coalesce(s.bets_won, 0)      as bets_won,
  coalesce(s.bets_lost, 0)     as bets_lost,
  coalesce(s.bets_open, 0)     as bets_open,
  coalesce(s.coins_staked, 0)  as coins_staked,
  coalesce(s.net_profit, 0)    as net_profit,
  round(
    100.0 * coalesce(s.bets_won, 0)
    / nullif(coalesce(s.bets_settled, 0), 0)
  , 1)                         as win_pct,
  coalesce(s.biggest_win, 0)   as biggest_win
from public.seasons se
join public.circle_members cm on cm.circle_id = se.circle_id
left join bet_stats s on s.season_id = se.id and s.user_id = cm.user_id;

-- 4.4 Proposal vote tallies
create or replace view public.proposal_vote_tally with (security_invoker = true) as
select
  p.id                                                      as proposal_id,
  p.market_id,
  count(v.proposal_id) filter (where v.vote = 'approve')    as approve_count,
  count(v.proposal_id) filter (where v.vote = 'disapprove') as disapprove_count,
  count(v.proposal_id)                                      as total_votes
from public.resolution_proposals p
left join public.proposal_votes v on v.proposal_id = p.id
group by p.id, p.market_id;

-- ---------------------------------------------------------------------
-- 4.5 v2 NEW: the ledger's whole point is being the tiebreaker in an
--     argument, which only works if it reconciles. drift must be 0.
--     If it is ever non-zero, a code path moved coins without recording it.
-- ---------------------------------------------------------------------
create or replace view public.circle_reconciliation with (security_invoker = true) as
select
  c.id   as circle_id,
  c.name as circle_name,
  (select coalesce(sum(cm.balance), 0)::bigint
     from public.circle_members cm where cm.circle_id = c.id) as sum_balances,
  (select coalesce(sum(l.amount), 0)::bigint
     from public.coin_ledger l where l.circle_id = c.id)      as sum_ledger,
  (select coalesce(sum(b.amount), 0)::bigint
     from public.bets b
     join public.markets m on m.id = b.market_id
    where m.circle_id = c.id and b.status = 'pending' and b.voided_at is null) as coins_in_open_bets,
  (select coalesce(sum(p.bond), 0)::bigint
     from public.resolution_proposals p
     join public.markets m on m.id = p.market_id
    where m.circle_id = c.id and p.status = 'pending')        as coins_in_bonds,
  (select coalesce(sum(cm.balance), 0)::bigint
     from public.circle_members cm where cm.circle_id = c.id)
  - (select coalesce(sum(l.amount), 0)::bigint
       from public.coin_ledger l where l.circle_id = c.id)    as drift
from public.circles c;

grant select on public.market_odds           to authenticated;
grant select on public.leaderboard           to authenticated;
grant select on public.season_leaderboard    to authenticated;
grant select on public.proposal_vote_tally   to authenticated;
grant select on public.circle_reconciliation to authenticated;


-- =====================================================================
-- 5. CIRCLE FUNCTIONS
-- =====================================================================
create or replace function public.create_circle(_name text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _code text; _tries int := 0; _start int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  loop
    _tries := _tries + 1;
    _code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.circles (name, join_code, created_by)
      values (trim(_name), _code, auth.uid())
      returning id, starting_balance into _circle_id, _start;
      exit;
    exception when unique_violation then
      if _tries >= 5 then
        raise exception 'Could not generate a unique join code, please try again';
      end if;
    end;
  end loop;

  -- creator is admin, or the circle has nobody who can resolve anything
  insert into public.circle_members (circle_id, user_id, role, balance, display_name)
  values (_circle_id, auth.uid(), 'admin', _start, public.default_display_name());

  -- v2: the opening balance is a coin movement, so it belongs in the ledger.
  -- Without this row, sum(ledger) <> sum(balances) from day one and the
  -- ledger cannot settle an argument.
  insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
  values (_circle_id, auth.uid(), _start, 'initial_grant', auth.uid(), 'Opening balance');

  insert into public.seasons (circle_id, name, is_active)
  values (_circle_id, 'Season 1', true);

  return _circle_id;
end;
$$;

create or replace function public.join_circle(_join_code text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _start int; _inserted int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select id, starting_balance into _circle_id, _start
  from public.circles where join_code = upper(trim(_join_code));
  if _circle_id is null then raise exception 'Invalid join code'; end if;

  insert into public.circle_members (circle_id, user_id, role, balance, display_name)
  values (_circle_id, auth.uid(), 'member', _start, public.default_display_name())
  on conflict (circle_id, user_id) do nothing;

  get diagnostics _inserted = row_count;

  -- only grant (and log) coins on a genuinely new membership
  if _inserted > 0 then
    insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
    values (_circle_id, auth.uid(), _start, 'initial_grant', auth.uid(), 'Opening balance');
  end if;

  return _circle_id;
end;
$$;

create or replace function public.rename_member(_circle_id bigint, _display_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if _display_name is not null and length(trim(_display_name)) > 60 then
    raise exception 'Display name too long';
  end if;

  update public.circle_members
  set display_name = coalesce(nullif(trim(_display_name), ''), public.default_display_name())
  where circle_id = _circle_id and user_id = auth.uid();

  if not found then raise exception 'You are not a member of this circle'; end if;
end;
$$;

-- v2 NEW: circle economy settings. The proposal bond used to be a client
-- supplied argument, which meant anyone could pass 0 and propose for free.
create or replace function public.set_circle_settings(
  _circle_id bigint,
  _starting_balance int default null,
  _proposal_bond    int default null,
  _name             text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can change settings';
  end if;

  update public.circles
  set starting_balance = coalesce(_starting_balance, starting_balance),
      proposal_bond    = coalesce(_proposal_bond, proposal_bond),
      name             = coalesce(nullif(trim(_name), ''), name)
  where id = _circle_id;

  if not found then raise exception 'Circle not found'; end if;
end;
$$;

create or replace function public.mark_notification_read(_notification_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = _notification_id and user_id = auth.uid();
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
end;
$$;

create or replace function public.set_member_role(
  _circle_id bigint, _user_id uuid, _role text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can change roles';
  end if;
  if _role not in ('member','admin') then
    raise exception 'Invalid role';
  end if;

  -- The original circle creator can never be demoted.
  if _role = 'member'
     and exists (select 1 from public.circles
                 where id = _circle_id and created_by = _user_id)
  then
    raise exception 'The original circle creator cannot be demoted';
  end if;

  -- Never strip the last remaining admin.
  if _role = 'member'
     and (select count(*) from public.circle_members
          where circle_id = _circle_id and role = 'admin') <= 1
     and exists (select 1 from public.circle_members
                 where circle_id = _circle_id and user_id = _user_id and role = 'admin')
  then
    raise exception 'A circle must keep at least one admin';
  end if;

  update public.circle_members
  set role = _role
  where circle_id = _circle_id and user_id = _user_id;

  -- v2: this used to return success when the target was not in the circle.
  if not found then raise exception 'That user is not in this circle'; end if;
end;
$$;

create or replace function public.admin_adjust_coins(
  _circle_id bigint, _user_id uuid, _amount int, _note text default null
)
returns int language plpgsql security definer set search_path = '' as $$
declare _new_balance int;
begin
  if _amount = 0 then raise exception 'Amount cannot be zero'; end if;
  -- the check lives HERE, in the database. Hiding the button is not security.
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can adjust coins';
  end if;

  update public.circle_members
  set balance = balance + _amount
  where circle_id = _circle_id and user_id = _user_id
    and balance + _amount >= 0
  returning balance into _new_balance;

  if _new_balance is null then
    if exists (select 1 from public.circle_members
               where circle_id = _circle_id and user_id = _user_id) then
      raise exception 'That would put their balance below zero';
    else
      raise exception 'That user is not in this circle';
    end if;
  end if;

  insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
  values (_circle_id, _user_id, _amount, 'admin_grant', auth.uid(), _note);

  return _new_balance;
end;
$$;


-- =====================================================================
-- 6. v2 NEW: MEMBERSHIP EXIT + SEASON RESET
-- =====================================================================

-- Leave a circle yourself. Blocked while you have money on the table.
create or replace function public.leave_circle(_circle_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare _is_admin boolean; _admin_count int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  if exists (select 1 from public.circles
             where id = _circle_id and created_by = auth.uid()) then
    raise exception 'The circle creator cannot leave. Transfer or delete the circle instead.';
  end if;

  if exists (
    select 1 from public.bets b
    join public.markets m on m.id = b.market_id
    where m.circle_id = _circle_id and b.user_id = auth.uid()
      and b.status = 'pending' and b.voided_at is null
  ) then
    raise exception 'You still have open bets in this circle. Wait for them to settle.';
  end if;

  -- a posted bond is escrowed money too; leaving would strand it
  if exists (
    select 1 from public.resolution_proposals p
    join public.markets m on m.id = p.market_id
    where m.circle_id = _circle_id and p.proposer_id = auth.uid()
      and p.status = 'pending' and p.bond > 0
  ) then
    raise exception 'You have a resolution bond in escrow. Wait for it to be reviewed.';
  end if;

  select role = 'admin' into _is_admin
  from public.circle_members where circle_id = _circle_id and user_id = auth.uid();
  if _is_admin is null then raise exception 'You are not a member of this circle'; end if;

  if _is_admin then
    select count(*) into _admin_count
    from public.circle_members where circle_id = _circle_id and role = 'admin';
    if _admin_count <= 1 then
      raise exception 'Promote another admin before you leave';
    end if;
  end if;

  -- Lock the row before reading the balance to write it off. Without this,
  -- a concurrent admin_adjust_coins() between the ledger read and the DELETE
  -- would be recorded against a balance that no longer exists -- permanent,
  -- unattributable drift, and the member row is gone so it can't be traced.
  perform 1 from public.circle_members
   where circle_id = _circle_id and user_id = auth.uid() for update;

  -- zero the leaver out in the ledger first, or their historical rows would
  -- outlive their balance and circle_reconciliation.drift would go non-zero
  insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
  select _circle_id, cm.user_id, -cm.balance, 'member_removed', auth.uid(), 'Left the circle'
  from public.circle_members cm
  where cm.circle_id = _circle_id and cm.user_id = auth.uid() and cm.balance <> 0;

  delete from public.circle_members
  where circle_id = _circle_id and user_id = auth.uid();
end;
$$;

-- Admin kicks someone. Same money guard.
create or replace function public.remove_member(_circle_id bigint, _user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can remove members';
  end if;
  if _user_id = auth.uid() then
    raise exception 'Use leave_circle() to remove yourself';
  end if;
  if exists (select 1 from public.circles
             where id = _circle_id and created_by = _user_id) then
    raise exception 'The circle creator cannot be removed';
  end if;
  if exists (
    select 1 from public.bets b
    join public.markets m on m.id = b.market_id
    where m.circle_id = _circle_id and b.user_id = _user_id
      and b.status = 'pending' and b.voided_at is null
  ) then
    raise exception 'That member has open bets. Settle or void them first.';
  end if;

  if exists (
    select 1 from public.resolution_proposals p
    join public.markets m on m.id = p.market_id
    where m.circle_id = _circle_id and p.proposer_id = _user_id
      and p.status = 'pending' and p.bond > 0
  ) then
    raise exception 'That member has a resolution bond in escrow. Review it first.';
  end if;

  -- same TOCTOU lock as leave_circle: freeze the balance we are writing off
  perform 1 from public.circle_members
   where circle_id = _circle_id and user_id = _user_id for update;

  insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
  select _circle_id, cm.user_id, -cm.balance, 'member_removed', auth.uid(), 'Removed from the circle'
  from public.circle_members cm
  where cm.circle_id = _circle_id and cm.user_id = _user_id and cm.balance <> 0;

  delete from public.circle_members
  where circle_id = _circle_id and user_id = _user_id;

  if not found then raise exception 'That user is not in this circle'; end if;
end;
$$;

-- Close the current season, open a new one, reset everyone to the circle's
-- starting balance, and log every delta. seasons existed in v1 but nothing
-- ever ended one, so the table was pure overhead.
create or replace function public.reset_season(_circle_id bigint, _new_name text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare _start int; _new_season bigint; _n int;
begin
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can start a new season';
  end if;

  if exists (
    select 1 from public.bets b
    join public.markets m on m.id = b.market_id
    where m.circle_id = _circle_id and b.status = 'pending' and b.voided_at is null
  ) then
    raise exception 'Resolve or void every open market before resetting the season';
  end if;

  if exists (
    select 1 from public.resolution_proposals p
    join public.markets m on m.id = p.market_id
    where m.circle_id = _circle_id and p.status = 'pending'
  ) then
    raise exception 'Review every pending resolution proposal before resetting the season';
  end if;

  -- Serialize on the CIRCLE row. Without it, two admins tapping "new season"
  -- together both pass the guards, both deactivate, and both insert -- the
  -- seasons_one_active partial unique index stops the second INSERT, but only
  -- after the first has already reset every balance, so the loser aborts with
  -- a raw index violation. Locking here makes the second call a clean no-risk
  -- serial execution instead.
  select starting_balance into _start
  from public.circles where id = _circle_id for update;
  if _start is null then raise exception 'Circle not found'; end if;

  -- Lock EVERY member row before the read-then-write below. reset_season logs
  -- (_start - balance) as the delta and then sets balance = _start in a second
  -- statement; a bet or an admin adjustment landing between those two makes
  -- the logged delta disagree with the actual movement, and the ledger stops
  -- reconciling. Lock order here is circles -> circle_members; place_bet()
  -- uses markets -> circle_members and never touches circles, so the two
  -- orders share only their tail and cannot form a cycle.
  perform 1 from public.circle_members
   where circle_id = _circle_id order by user_id for update;

  update public.seasons
  set is_active = false, ends_at = now()
  where circle_id = _circle_id and is_active;

  select count(*) + 1 into _n from public.seasons where circle_id = _circle_id;

  insert into public.seasons (circle_id, name, is_active)
  values (_circle_id, coalesce(nullif(trim(_new_name), ''), 'Season ' || _n), true)
  returning id into _new_season;

  -- log the delta for every member, then set the balance
  insert into public.coin_ledger (circle_id, user_id, amount, reason, actor_id, note)
  select _circle_id, cm.user_id, _start - cm.balance, 'season_reset', auth.uid(),
         'Balance reset for new season'
  from public.circle_members cm
  where cm.circle_id = _circle_id and cm.balance <> _start;

  update public.circle_members
  set balance = _start
  where circle_id = _circle_id;

  return _new_season;
end;
$$;


-- =====================================================================
-- 7. MARKET FUNCTIONS
-- =====================================================================
create or replace function public.create_market(
  _circle_id       bigint,
  _question        text,
  _kind            text,
  _closes_at       timestamptz,
  _options         text[]      default null,
  _line            numeric     default null,
  _subject_id      uuid        default null,
  _opens_at        timestamptz default null,
  _event_start_at  timestamptz default null,
  _event_end_at    timestamptz default null,
  _image_url       text        default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  _market_id bigint;
  _season_id bigint;
  _opens     timestamptz := coalesce(_opens_at, now());
  _labels    text[];
  _label     text;
  _i         int := 0;
  _dupe      text;
begin
  if not public.is_circle_member(_circle_id) then
    raise exception 'Not a member of this circle';
  end if;
  if _closes_at <= _opens then
    raise exception 'Betting must close after it opens';
  end if;
  if _subject_id is not null and not exists (
       select 1 from public.circle_members
       where circle_id = _circle_id and user_id = _subject_id) then
    raise exception 'The tagged person is not in this circle';
  end if;

  select id into _season_id
  from public.seasons where circle_id = _circle_id and is_active limit 1;

  if _kind = 'binary' then
    _labels := array['Yes','No'];

  elsif _kind = 'over_under' then
    if _line is null then raise exception 'Over/under needs a line'; end if;
    if _line = trunc(_line) then
      raise exception 'Use a half number for the line (e.g. 8.5) so ties are impossible';
    end if;
    _labels := array['Over '  || trim_scale(_line)::text,
                     'Under ' || trim_scale(_line)::text];

  elsif _kind = 'multi' then
    if _options is null or array_length(_options, 1) < 2 then
      raise exception 'Multiple choice needs at least 2 options';
    end if;
    _labels := _options;

  elsif _kind = 'open' then
    _labels := coalesce(_options, array[]::text[]);

  else
    raise exception 'Unknown market kind';
  end if;

  -- v2: the dedup index is case/whitespace-insensitive and the insert loop
  -- used "on conflict do nothing", so ['Yes','yes','Maybe'] silently became
  -- a 2-option market. Tell the user instead of quietly dropping their input.
  select lower(trim(x)) into _dupe
  from unnest(_labels) as x
  group by lower(trim(x))
  having count(*) > 1
  limit 1;
  if _dupe is not null then
    raise exception 'Duplicate option: "%" (options are matched ignoring case and spaces)', _dupe;
  end if;

  insert into public.markets (
    circle_id, season_id, creator_id, question, kind, line, image_url,
    subject_id, opens_at, closes_at, event_start_at, event_end_at,
    options_lock_at, status
  ) values (
    _circle_id, _season_id, auth.uid(), trim(_question), _kind, _line, _image_url,
    _subject_id, _opens, _closes_at, _event_start_at, _event_end_at,
    case when _kind = 'open' then
      case when _closes_at - _opens > interval '15 minutes'
             then _closes_at - interval '15 minutes'
           else _closes_at
      end
    end,
    case when _opens <= now() then 'open' else 'scheduled' end
  )
  returning id into _market_id;

  foreach _label in array _labels loop
    _i := _i + 1;
    insert into public.market_options (market_id, label, sort_order, created_by)
    values (_market_id, trim(_label), _i, auth.uid());
  end loop;

  return _market_id;
end;
$$;

-- v2 NEW: fix a typo before anyone has staked anything.
-- Once a bet exists the question is frozen; only the image can change.
-- (If the question is wrong AND bets exist, void_market is the honest path.)
create or replace function public.update_market(
  _market_id      bigint,
  _question       text        default null,
  _image_url      text        default null,
  _closes_at      timestamptz default null,
  _opens_at       timestamptz default null,
  _event_start_at timestamptz default null,
  _event_end_at   timestamptz default null,
  _subject_id     uuid        default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _creator uuid; _status text; _has_bets boolean;
begin
  select circle_id, creator_id, status
  into _circle_id, _creator, _status
  from public.markets where id = _market_id for update;

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _status in ('resolved','voided') then
    raise exception 'That market has already settled';
  end if;
  if auth.uid() <> _creator and not public.is_circle_admin(_circle_id) then
    raise exception 'Only the market creator or a circle admin can edit this';
  end if;

  select exists (select 1 from public.bets
                 where market_id = _market_id and voided_at is null)
  into _has_bets;

  if _has_bets then
    if _question is not null or _closes_at is not null or _opens_at is not null
       or _subject_id is not null then
      raise exception 'Bets have been placed. Only the image can be changed now - void the market if the question is wrong.';
    end if;

    -- EXPLOIT CLOSED: event_end_at is the gate propose_resolution() checks
    -- (`now() < coalesce(event_end_at, closes_at)` -> "event has not finished
    -- yet"). Leaving it creator-editable after bets exist meant the creator
    -- could push it to 2099 and make the market UNRESOLVABLE BY ANYONE --
    -- a losing creator could stall indefinitely, or force an admin to void
    -- and refund. Editing the event window once money is down is an admin
    -- action; the creator keeps the image, which decides nothing.
    if (_event_end_at is not null or _event_start_at is not null)
       and not public.is_circle_admin(_circle_id) then
      raise exception 'Bets have been placed. Only a circle admin can change the event timing now.';
    end if;

    update public.markets
    set image_url     = coalesce(_image_url, image_url),
        event_end_at  = coalesce(_event_end_at, event_end_at),
        event_start_at= coalesce(_event_start_at, event_start_at)
    where id = _market_id;
    return;
  end if;

  if _subject_id is not null and not exists (
       select 1 from public.circle_members
       where circle_id = _circle_id and user_id = _subject_id) then
    raise exception 'The tagged person is not in this circle';
  end if;

  update public.markets
  set question       = coalesce(nullif(trim(_question), ''), question),
      image_url      = coalesce(_image_url, image_url),
      opens_at       = coalesce(_opens_at, opens_at),
      closes_at      = coalesce(_closes_at, closes_at),
      event_start_at = coalesce(_event_start_at, event_start_at),
      event_end_at   = coalesce(_event_end_at, event_end_at),
      subject_id     = coalesce(_subject_id, subject_id),
      -- RECALCULATE the option-submission deadline. It was set by
      -- create_market as (closes_at - 15 min) and then never revisited here,
      -- so moving closes_at silently desynced it:
      --   EXTEND  1h -> 6h  : lock stayed at the ORIGINAL close, so option
      --                       submissions died 5h15m before betting closed.
      --   SHORTEN 6h -> 2m  : lock ended up AFTER closes_at, so new options
      --                       could be added to a market whose betting had
      --                       already shut. With pg_cron off (the default
      --                       until you enable it) `status` never flips to
      --                       'closed' on its own, so submit_option's only
      --                       remaining guard is this timestamp.
      -- Same expression as create_market, evaluated against the NEW window.
      -- Unqualified column refs in an UPDATE are the OLD values, so each
      -- coalesce() yields the effective post-update value.
      options_lock_at = case when kind = 'open' then
                          case
                            when coalesce(_closes_at, closes_at)
                               - coalesce(_opens_at, opens_at) > interval '15 minutes'
                              then coalesce(_closes_at, closes_at) - interval '15 minutes'
                            else coalesce(_closes_at, closes_at)
                          end
                        end,
      -- keep all three states straight: editing a market whose close time has
      -- already passed must NOT flip it back to 'open' (cron would undo it 5
      -- minutes later anyway, but the badge would lie in the meantime)
      status         = case
                         when coalesce(_closes_at, closes_at) <= now() then 'closed'
                         when coalesce(_opens_at, opens_at)   <= now() then 'open'
                         else 'scheduled'
                       end
  where id = _market_id;
end;
$$;

-- v2 NEW: delete a market that nobody bet on. If bets exist, use void_market.
create or replace function public.cancel_market(_market_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _creator uuid; _status text;
begin
  select circle_id, creator_id, status into _circle_id, _creator, _status
  from public.markets where id = _market_id for update;

  if _circle_id is null then raise exception 'Market not found'; end if;

  -- A market with zero bets can still be RESOLVED (resolve_market handles the
  -- empty-pot case and marks it 'resolved'), so the no-bets check alone let a
  -- settled market be hard-deleted -- erasing the question, its options, its
  -- evidence rows and the resolution record. Settlement is final.
  if _status in ('resolved','voided') then
    raise exception 'That market has already settled and cannot be cancelled';
  end if;

  if auth.uid() <> _creator and not public.is_circle_admin(_circle_id) then
    raise exception 'Only the market creator or a circle admin can cancel this';
  end if;
  if exists (select 1 from public.bets where market_id = _market_id) then
    raise exception 'Bets have been placed. Use void_market() to refund everyone instead.';
  end if;

  -- A market with no bets can still carry bonded resolution proposals, and
  -- resolution_proposals cascades on market delete -- so deleting without this
  -- would silently incinerate those bonds (balance already debited, proposal
  -- row gone, nothing left to refund against).
  with closed as (
    update public.resolution_proposals
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where market_id = _market_id and status = 'pending'
    returning proposer_id, bond
  ),
  refunds as (
    select proposer_id, sum(bond)::int as bond
    from closed where bond > 0 group by proposer_id
  ),
  credited as (
    update public.circle_members cm
    set balance = cm.balance + r.bond
    from refunds r
    where cm.circle_id = _circle_id and cm.user_id = r.proposer_id
    returning cm.user_id, r.bond
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, actor_id, note)
  select _circle_id, c.user_id, c.bond, 'bond_refund', _market_id, auth.uid(),
         'Bond returned: market cancelled'
  from credited c;

  -- Notifications are NOT reachable by foreign key -- they only carry a text
  -- url like '/market/123' -- so nothing cascades them. Deleting the market
  -- without this leaves live "Betting closes soon" alerts pointing at a route
  -- that 404s. Clear them while the id still means something.
  delete from public.notifications where url = '/market/' || _market_id;

  -- ledger rows reference this market; keep them by detaching, not cascading
  -- (coin_ledger.market_id is ON DELETE SET NULL, so history survives).
  -- The bond debit/credit pair above therefore ends up with market_id NULL;
  -- that is why both rows carry an explicit note naming the reason, which is
  -- the only surviving description of what the coins were for.
  delete from public.markets where id = _market_id;
end;
$$;

create or replace function public.submit_option(_market_id bigint, _label text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _kind text; _lock timestamptz;
        _status text; _opens timestamptz; _closes timestamptz; _id bigint;
begin
  select circle_id, kind, coalesce(options_lock_at, closes_at), status, opens_at, closes_at
  into _circle_id, _kind, _lock, _status, _opens, _closes
  from public.markets where id = _market_id
  for update;                              -- serialize sort_order = max()+1

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _kind <> 'open' then raise exception 'This market has fixed options'; end if;

  -- v2: time-driven, not status-driven. See place_bet for the reasoning.
  if _status in ('resolved','voided') then raise exception 'This market has settled'; end if;
  if _status = 'closed' then raise exception 'Option submissions have closed'; end if;
  if now() < _opens then raise exception 'This market has not opened yet'; end if;
  -- Hard ceiling on closes_at, independent of options_lock_at. An option that
  -- appears after betting has shut can never be bet on, but it CAN still be
  -- named as the winner -- which would make every existing bet lose and force
  -- the market to refund-everyone. The lock is now kept in sync by
  -- update_market, so this should be unreachable; it is here so that
  -- correctness does not depend on one derived column staying correct.
  if now() > _closes then raise exception 'Betting has closed'; end if;
  if now() > _lock  then raise exception 'Option submissions have closed'; end if;

  if not public.is_circle_member(_circle_id) then raise exception 'Not a member'; end if;

  insert into public.market_options (market_id, label, sort_order, created_by)
  values (_market_id, trim(_label),
          coalesce((select max(sort_order) from public.market_options
                    where market_id = _market_id), 0) + 1,
          auth.uid())
  returning id into _id;

  return _id;
exception when unique_violation then
  raise exception 'That option already exists';
end;
$$;

-- ---------------------------------------------------------------------
-- 7.1 place_bet
--   The ONLY way a bet gets created. A balance check in JavaScript is not
--   a check.
--
--   v2 changes:
--     (a) `for share` on the market row. resolve_market/void_market take
--         `for update` on the same row, so a bet can no longer land in the
--         same instant a market is being settled. Previously that bet was
--         debited, inserted as 'pending', and then never settled by anyone:
--         the coins just vanished.
--     (b) eligibility is decided by opens_at/closes_at, NOT status. status
--         is only flipped by a cron job that runs every 5 minutes, so a
--         market scheduled for 8:00 PM was unbettable until 8:05.
-- ---------------------------------------------------------------------
create or replace function public.place_bet(
  _market_id bigint, _option_id bigint, _amount int
)
returns int language plpgsql security definer set search_path = '' as $$
declare
  _circle_id   bigint;
  _status      text;
  _opens       timestamptz;
  _closes      timestamptz;
  _subject     uuid;
  _review      timestamptz;
  _new_balance int;
  _bet_id      bigint;
begin
  if _amount <= 0 then raise exception 'Amount must be positive'; end if;

  select circle_id, status, opens_at, closes_at, subject_id, review_started_at
  into _circle_id, _status, _opens, _closes, _subject, _review
  from public.markets where id = _market_id
  for share;                               -- blocks against resolve/void

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _status in ('resolved','voided') then raise exception 'This market has already settled'; end if;
  if _status = 'closed' then raise exception 'Betting has closed'; end if;
  if now() < _opens  then raise exception 'Betting has not opened yet'; end if;
  if now() > _closes then raise exception 'Betting has closed'; end if;

  if not public.is_circle_member(_circle_id) then
    raise exception 'Not a member of this circle';
  end if;

  -- the subject controls the outcome, so they cannot bet on themselves
  if _subject = auth.uid() then
    raise exception 'You cannot bet on a market about yourself';
  end if;

  if not exists (select 1 from public.market_options
                 where id = _option_id and market_id = _market_id) then
    raise exception 'That option does not belong to this market';
  end if;

  -- balance check and deduction in ONE statement. Two fast taps cannot
  -- spend the same coins twice.
  update public.circle_members
  set balance = balance - _amount
  where circle_id = _circle_id
    and user_id   = auth.uid()
    and balance  >= _amount
  returning balance into _new_balance;

  if _new_balance is null then raise exception 'Not enough coins'; end if;

  insert into public.bets (market_id, option_id, user_id, amount, was_late)
  values (_market_id, _option_id, auth.uid(), _amount, _review is not null)
  returning id into _bet_id;

  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, bet_id, actor_id)
  values (_circle_id, auth.uid(), -_amount, 'bet', _market_id, _bet_id, auth.uid());

  return _new_balance;
end;
$$;


-- =====================================================================
-- 8. RESOLUTION
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8.1 propose_resolution
--
--   Anyone can propose. Three things stop this being a griefing tool:
--     (a) it costs a refundable bond
--     (b) it does NOT stop betting, it only timestamps the market
--     (c) you cannot propose before the event has actually ended
--
--   v2: the bond is read from circles.proposal_bond. It used to be a
--   caller-supplied argument with a default of 50, and this function is
--   exposed over RPC - so anyone could open devtools, call it with
--   { _bond: 0 }, and grief for free. The deterrent was opt-in.
--   The old 4-argument signature is dropped below, not just replaced.
-- ---------------------------------------------------------------------
drop function if exists public.propose_resolution(bigint, bigint, text, int);

create or replace function public.propose_resolution(
  _market_id bigint,
  _option_id bigint,
  _note      text default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  _circle_id bigint;
  _status    text;
  _known_at  timestamptz;
  _bond      int;
  _bal       int;
  _pid       bigint;
begin
  select m.circle_id, m.status, coalesce(m.event_end_at, m.closes_at), c.proposal_bond
  into _circle_id, _status, _known_at, _bond
  from public.markets m
  join public.circles c on c.id = m.circle_id
  where m.id = _market_id
  -- FOR UPDATE, not FOR SHARE: this function later UPDATEs this same markets
  -- row (review_started_at). Taking a shared lock and then upgrading it to
  -- exclusive is the classic lock-upgrade deadlock - two people proposing on
  -- the same market at once would both hold FOR SHARE and both wait forever.
  -- Lock order (markets -> circle_members) still matches every other function.
  for update of m;

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _status not in ('open','closed','scheduled') then
    raise exception 'This market is already settled';
  end if;
  if not public.is_circle_member(_circle_id) then raise exception 'Not a member'; end if;
  if now() < _known_at then
    raise exception 'The event has not finished yet';
  end if;
  if not exists (select 1 from public.market_options
                 where id = _option_id and market_id = _market_id) then
    raise exception 'That option does not belong to this market';
  end if;

  if _bond > 0 then
    update public.circle_members
    set balance = balance - _bond
    where circle_id = _circle_id and user_id = auth.uid() and balance >= _bond
    returning balance into _bal;
    if _bal is null then raise exception 'Not enough coins to post the bond'; end if;

    insert into public.coin_ledger
      (circle_id, user_id, amount, reason, market_id, actor_id, note)
    values (_circle_id, auth.uid(), -_bond, 'proposal_bond', _market_id, auth.uid(),
            'Bond posted on resolution proposal');
  end if;

  insert into public.resolution_proposals
    (market_id, proposer_id, proposed_option_id, note, bond)
  values (_market_id, auth.uid(), _option_id, _note, _bond)
  returning id into _pid;

  -- betting continues. This only marks the quarantine line.
  update public.markets
  set review_started_at = coalesce(review_started_at, now())
  where id = _market_id;

  return _pid;
end;
$$;

-- ---------------------------------------------------------------------
-- 8.2 review_proposal
--
--   _action:
--     'approve'       pay everyone out now, bond refunded
--     'reject_reopen' false alarm, betting continues, bond forfeited
--     'reject_close'  no more betting but still unresolved
--     'void_market'   refund every bet, nobody wins, bond refunded
-- ---------------------------------------------------------------------
create or replace function public.review_proposal(
  _proposal_id bigint,
  _action      text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  _market_id bigint;
  _circle_id bigint;
  _option_id bigint;
  _proposer  uuid;
  _bond      int;
  _closes    timestamptz;
begin
  if _action not in ('approve','reject_reopen','reject_close','void_market') then
    raise exception 'Unknown action';
  end if;

  -- LOCK ORDER: markets -> resolution_proposals -> circle_members, everywhere.
  -- The previous version did `select ... from proposals p join markets m ...
  -- for update`, which locks the PROPOSAL row first and the market second.
  -- Two admins reviewing two different pending proposals on the SAME market
  -- would each hold their own proposal row, then contend for the market, and
  -- the approve branch (which updates the OTHER admin's proposal row) closed
  -- the cycle: a genuine deadlock, aborted by Postgres mid-payout.
  -- Resolving the market id without a lock first is safe: market_id on a
  -- proposal is immutable.
  select p.market_id into _market_id
  from public.resolution_proposals p
  where p.id = _proposal_id and p.status = 'pending';
  if _market_id is null then raise exception 'Proposal not found or already reviewed'; end if;

  select m.circle_id, m.closes_at
  into _circle_id, _closes
  from public.markets m where m.id = _market_id
  for update;
  if _circle_id is null then raise exception 'Market not found'; end if;

  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can review proposals';
  end if;

  -- re-read the proposal under the market lock; another admin may have
  -- reviewed it while we were waiting for that lock
  select p.proposed_option_id, p.proposer_id, p.bond
  into _option_id, _proposer, _bond
  from public.resolution_proposals p
  where p.id = _proposal_id and p.status = 'pending'
  for update;
  if _option_id is null then raise exception 'Proposal not found or already reviewed'; end if;

  update public.resolution_proposals
  set status      = case when _action = 'approve' then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = _proposal_id;

  -- Bond back unless the proposal was rejected.
  -- The ledger row is driven by a RETURNING clause, not written blindly: if
  -- the proposer has since left the circle the UPDATE matches nothing, and an
  -- unconditional insert would have credited the ledger without crediting any
  -- balance -- permanent drift in circle_reconciliation.
  if _bond > 0 and _action in ('approve','void_market') then
    with credited as (
      update public.circle_members
      set balance = balance + _bond
      where circle_id = _circle_id and user_id = _proposer
      returning user_id
    )
    insert into public.coin_ledger
      (circle_id, user_id, amount, reason, market_id, actor_id, note)
    select _circle_id, c.user_id, _bond, 'bond_refund', _market_id, auth.uid(),
           'Resolution bond returned'
    from credited c;
  end if;

  if _action = 'approve' then
    -- competing proposals are settled inside resolve_market(), not here, so
    -- that an admin calling resolve_market() DIRECTLY also releases them.
    perform public.resolve_market(_market_id, _option_id);

  elsif _action = 'void_market' then
    perform public.void_market(_market_id, 'Voided by admin during review');

  elsif _action = 'reject_close' then
    -- situational, time-sensitive bet: stop betting, stay unresolved.
    -- Quarantine line is KEPT: any later bet is still snipe-suspect.
    update public.markets
    set status    = 'closed',
        closes_at = least(closes_at, now())
    where id = _market_id;

  elsif _action = 'reject_reopen' then
    -- v2: this branch used to be a literal no-op, so if the cron had already
    -- flipped the market to 'closed', "reject and reopen" left it closed
    -- forever - nothing ever moves a market from closed back to open.
    -- Now it genuinely reopens, but only if the close time is still ahead.
    if _closes > now() then
      update public.markets set status = 'open' where id = _market_id;
    end if;
    -- review_started_at is deliberately NOT cleared. The earliest proposal
    -- after the event ended is the PERMANENT quarantine line; clearing it
    -- would let bets from this window be re-classified as "early" when a
    -- later proposal drops a newer line, letting snipers steal the pot.
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8.3 resolve_market
--
--   Pool payout: winners get their stake back plus a proportional share
--   of the losing pool.
--     everyone on the winning side -> lose pool is 0 -> stakes returned
--     nobody on the winning side   -> refund everyone
--
--   LATE BET QUARANTINE. Bets placed after a resolution was proposed, on
--   the side that turned out correct, are voided and refunded. Late bets
--   on LOSING sides stay in the pot, so wrong snipers pay a tax.
-- ---------------------------------------------------------------------
create or replace function public.resolve_market(
  _market_id bigint, _winning_option_id bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  _circle_id bigint;
  _status    text;
  _review    timestamptz;
  _win       int;
  _lose      int;
begin
  select circle_id, status, review_started_at
  into _circle_id, _status, _review
  from public.markets where id = _market_id
  for update;                              -- serialize concurrent resolves

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _status in ('resolved','voided') then raise exception 'Market already settled'; end if;
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can resolve markets';
  end if;
  if not exists (select 1 from public.market_options
                 where id = _winning_option_id and market_id = _market_id) then
    raise exception 'That option does not belong to this market';
  end if;

  -- 1. quarantine late bets on the winning side, and refund them
  if _review is not null then
    with voided as (
      update public.bets b
      set voided_at   = now(),
          was_late    = true,
          status      = 'void',
          payout      = b.amount,
          void_reason = 'Placed after a resolution was proposed'
      where b.market_id  = _market_id
        and b.voided_at  is null
        and b.option_id  = _winning_option_id
        and b.created_at > _review
      returning b.user_id, b.amount
    ),
    agg as (
      select user_id, sum(amount)::int as total from voided group by user_id
    ),
    credited as (
      update public.circle_members cm
      set balance = cm.balance + agg.total
      from agg
      where cm.circle_id = _circle_id and cm.user_id = agg.user_id
      returning cm.user_id, agg.total
    )
    insert into public.coin_ledger
      (circle_id, user_id, amount, reason, market_id, actor_id, note)
    select _circle_id, c.user_id, c.total, 'late_void_refund', _market_id, auth.uid(),
           'Refunded: bet placed after a resolution was proposed'
    from credited c;
  end if;

  -- 2. pools, ignoring anything voided
  select
    coalesce(sum(amount) filter (where option_id =  _winning_option_id), 0),
    coalesce(sum(amount) filter (where option_id <> _winning_option_id), 0)
  into _win, _lose
  from public.bets
  where market_id = _market_id and voided_at is null;

  if _win = 0 then
    -- nobody was right: give everything back
    update public.bets
    set status = 'refunded', payout = amount
    where market_id = _market_id and voided_at is null;
  else
    -- winners: stake back + FLOORED share of the lose pool
    update public.bets b
    set status = 'won',
        payout = b.amount + floor(b.amount::numeric / _win * _lose)::int
    where b.market_id = _market_id
      and b.option_id = _winning_option_id
      and b.voided_at is null;

    update public.bets
    set status = 'lost', payout = 0
    where market_id  = _market_id
      and option_id <> _winning_option_id
      and voided_at  is null;

    -- rounding remainder to the largest winning stake so
    -- sum(winner payouts) == _win + _lose exactly (coins conserved)
    update public.bets
    set payout = payout + (
          (_win + _lose)
          - (select coalesce(sum(payout), 0) from public.bets
             where market_id = _market_id
               and option_id = _winning_option_id
               and voided_at is null)
        )
    where id = (
      select id from public.bets
      where market_id = _market_id
        and option_id = _winning_option_id
        and voided_at is null
      order by amount desc, id
      limit 1
    );
  end if;

  -- 3. pay out from bets.payout, never recomputed. One source of truth.
  with agg as (
    select user_id, sum(payout)::int as total
    from public.bets
    where market_id = _market_id and status in ('won','refunded')
    group by user_id
  ),
  credited as (
    update public.circle_members cm
    set balance = cm.balance + agg.total
    from agg
    where cm.circle_id = _circle_id and cm.user_id = agg.user_id
    returning cm.user_id, agg.total
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, actor_id)
  select _circle_id, c.user_id, c.total, 'payout', _market_id, auth.uid()
  from credited c
  where c.total > 0;

  -- 4. release every proposal still pending on this market.
  --    This MUST live here rather than in review_proposal(): resolve_market
  --    is granted to authenticated and an admin can call it directly, skipping
  --    the proposal flow entirely. When it did not sweep, every pending bond
  --    on the market stayed debited with its proposal frozen at 'pending'
  --    forever -- coins destroyed, and reset_season() permanently blocked by
  --    its own "review every pending proposal first" guard.
  --    Whoever named the winning option gets their bond back; everyone else
  --    forfeits, which is the griefing deterrent.
  with closed as (
    update public.resolution_proposals
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where market_id = _market_id and status = 'pending'
    returning proposer_id, proposed_option_id, bond
  ),
  refunds as (
    select proposer_id, sum(bond)::int as bond
    from closed
    where proposed_option_id = _winning_option_id and bond > 0
    group by proposer_id
  ),
  credited as (
    update public.circle_members cm
    set balance = cm.balance + r.bond
    from refunds r
    where cm.circle_id = _circle_id and cm.user_id = r.proposer_id
    returning cm.user_id, r.bond
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, actor_id, note)
  select _circle_id, c.user_id, c.bond, 'bond_refund', _market_id, auth.uid(),
         'Bond returned: proposal named the winning option'
  from credited c;

  -- v2: review_started_at is NO LONGER cleared here. It is the audit record
  -- of why late bets were voided; wiping it on resolve destroyed the reason
  -- behind a refund. The market is terminal now, so nothing reads it anyway.
  update public.markets
  set status            = 'resolved',
      winning_option_id = _winning_option_id,
      resolved_at       = now(),
      resolved_by       = auth.uid()
  where id = _market_id;

  -- notify everyone who had a stake. The voided_at filter is deliberately gone:
  -- the people whose late bets were just quarantined and refunded are exactly
  -- the ones who most need telling, and they were the only group excluded.
  insert into public.notifications (user_id, title, body, url)
  select distinct b.user_id,
         'Bet resolved',
         (select question from public.markets where id = _market_id),
         '/market/' || _market_id
  from public.bets b
  where b.market_id = _market_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8.4 void_market: refund everyone, nobody wins.
-- ---------------------------------------------------------------------
create or replace function public.void_market(_market_id bigint, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _status text;
begin
  select circle_id, status into _circle_id, _status
  from public.markets where id = _market_id
  for update;                              -- serialize with resolve/void/bet

  if _circle_id is null then raise exception 'Market not found'; end if;
  if _status in ('resolved','voided') then raise exception 'Market already settled'; end if;
  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can void a market';
  end if;

  with refunded as (
    update public.bets
    set status = 'refunded', payout = amount
    where market_id = _market_id and voided_at is null
    returning user_id, amount
  ),
  agg as (
    select user_id, sum(amount)::int as total from refunded group by user_id
  ),
  credited as (
    update public.circle_members cm
    set balance = cm.balance + agg.total
    from agg
    where cm.circle_id = _circle_id and cm.user_id = agg.user_id
    returning cm.user_id, agg.total
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, actor_id, note)
  select _circle_id, c.user_id, c.total, 'refund', _market_id, auth.uid(), _reason
  from credited c;

  -- release every pending proposal. Same reasoning as resolve_market: this is
  -- directly callable, and a stranded bond is a coin that no longer exists.
  -- A void means nothing was proven, so every bond comes back, forfeit or not.
  with closed as (
    update public.resolution_proposals
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where market_id = _market_id and status = 'pending'
    returning proposer_id, bond
  ),
  refunds as (
    select proposer_id, sum(bond)::int as bond
    from closed where bond > 0 group by proposer_id
  ),
  credited_bonds as (
    update public.circle_members cm
    set balance = cm.balance + r.bond
    from refunds r
    where cm.circle_id = _circle_id and cm.user_id = r.proposer_id
    returning cm.user_id, r.bond
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, actor_id, note)
  select _circle_id, c.user_id, c.bond, 'bond_refund', _market_id, auth.uid(),
         'Bond returned: market voided'
  from credited_bonds c;

  update public.markets
  set status      = 'voided',
      resolved_at = now(),
      resolved_by = auth.uid()
  where id = _market_id;

  -- v2: people had coins in this market. Tell them it was voided.
  insert into public.notifications (user_id, title, body, url)
  select distinct b.user_id,
         'Bet voided - stake refunded',
         (select question from public.markets where id = _market_id),
         '/market/' || _market_id
  from public.bets b
  where b.market_id = _market_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8.5 void_bet: admin cancels ONE bet.
--
--   v2: now takes `for update` on the market row first, then on the bet
--   row. Previously this was the only money-moving function with no lock,
--   so one admin voiding a bet while another resolved the market could
--   credit the same stake twice.
-- ---------------------------------------------------------------------
create or replace function public.void_bet(_bet_id bigint, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _uid uuid; _amt int; _mid bigint; _status text;
begin
  select market_id into _mid from public.bets where id = _bet_id;
  if _mid is null then raise exception 'Bet not found'; end if;

  select circle_id, status into _circle_id, _status
  from public.markets where id = _mid
  for update;

  if not public.is_circle_admin(_circle_id) then
    raise exception 'Only circle admins can void bets';
  end if;
  if _status in ('resolved','voided') then
    raise exception 'That market has already paid out';
  end if;

  -- re-read under the market lock so a concurrent void cannot double refund
  select user_id, amount into _uid, _amt
  from public.bets where id = _bet_id and voided_at is null
  for update;

  if _uid is null then raise exception 'Bet not found or already voided'; end if;

  update public.bets
  set voided_at   = now(),
      voided_by   = auth.uid(),
      void_reason = _reason,
      status      = 'void',
      payout      = amount
  where id = _bet_id;

  -- RETURNING-driven ledger row, same as everywhere else. The membership
  -- guards in leave_circle/remove_member should make a missing member
  -- impossible here, but the ledger invariant must not depend on a rule
  -- enforced in a different function.
  with credited as (
    update public.circle_members
    set balance = balance + _amt
    where circle_id = _circle_id and user_id = _uid
    returning user_id
  )
  insert into public.coin_ledger
    (circle_id, user_id, amount, reason, market_id, bet_id, actor_id, note)
  select _circle_id, c.user_id, _amt, 'void_refund', _mid, _bet_id, auth.uid(), _reason
  from credited c;
end;
$$;

-- ---------------------------------------------------------------------
-- 8.6 Proposal votes (advisory only - the admin still decides)
-- ---------------------------------------------------------------------
create or replace function public.vote_on_proposal(_proposal_id bigint, _vote text)
returns void language plpgsql security definer set search_path = '' as $$
declare _circle_id bigint; _status text;
begin
  if _vote not in ('approve','disapprove') then raise exception 'Invalid vote'; end if;

  select m.circle_id, p.status
  into _circle_id, _status
  from public.resolution_proposals p
  join public.markets m on m.id = p.market_id
  where p.id = _proposal_id;

  if _circle_id is null then raise exception 'Proposal not found'; end if;
  if not public.is_circle_member(_circle_id) then
    raise exception 'Not a member of this circle';
  end if;
  if _status <> 'pending' then
    raise exception 'This proposal has already been reviewed';
  end if;

  insert into public.proposal_votes (proposal_id, user_id, vote)
  values (_proposal_id, auth.uid(), _vote)
  on conflict (proposal_id, user_id)
  do update set vote = excluded.vote, updated_at = now();
end;
$$;

create or replace function public.clear_proposal_vote(_proposal_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.proposal_votes
  where proposal_id = _proposal_id and user_id = auth.uid();
end;
$$;


-- =====================================================================
-- 9. GRANTS
--   Only these functions are callable over RPC.
--
--   HARDENING: Postgres grants EXECUTE on every new function to PUBLIC by
--   default, and PostgREST exposes the public schema to the `anon` role. So
--   "not granting" a function does NOT make it private - every helper here
--   was reachable by an unauthenticated caller. The money functions all fail
--   safe (auth.uid() is null -> is_circle_member() false -> raise), but
--   market_circle(), proposal_circle() and market_is_settled() would happily
--   answer questions about circles the caller has nothing to do with.
--   Strip PUBLIC/anon from everything we own, then re-grant deliberately.
--   Extension-owned functions are excluded so pg_cron/pg_net keep working.
-- =====================================================================
do $$
declare _fn text;
begin
  for _fn in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'   -- skip extension members
      )
  loop
    execute format('revoke all on function %s from public', _fn);
    begin
      execute format('revoke all on function %s from anon', _fn);
    exception when undefined_object then null;   -- non-Supabase Postgres
    end;
  end loop;
end $$;

-- Helpers below are called from RLS policy expressions and from
-- security_invoker views, which evaluate as the CALLING user - so
-- `authenticated` genuinely needs EXECUTE on these three or every policy
-- that uses them throws "permission denied for function".
grant execute on function public.is_circle_member(bigint)   to authenticated;
grant execute on function public.is_circle_admin(bigint)    to authenticated;
grant execute on function public.market_circle(bigint)      to authenticated;
grant execute on function public.proposal_circle(bigint)    to authenticated;
grant execute on function public.market_is_settled(bigint)  to authenticated;
-- evidence_circle_id() / evidence_market_id() are created in section 10 and
-- granted there, since they cannot be granted before they exist.
-- default_display_name() is deliberately NOT granted: it is only ever called
-- from inside SECURITY DEFINER functions, where it runs as the definer.
grant execute on function public.create_circle(text)                            to authenticated;
grant execute on function public.join_circle(text)                              to authenticated;
grant execute on function public.rename_member(bigint, text)                    to authenticated;
grant execute on function public.set_circle_settings(bigint, int, int, text)    to authenticated;
grant execute on function public.mark_notification_read(bigint)                 to authenticated;
grant execute on function public.mark_all_notifications_read()                  to authenticated;
grant execute on function public.set_member_role(bigint, uuid, text)            to authenticated;
grant execute on function public.admin_adjust_coins(bigint, uuid, int, text)    to authenticated;
grant execute on function public.leave_circle(bigint)                           to authenticated;
grant execute on function public.remove_member(bigint, uuid)                    to authenticated;
grant execute on function public.reset_season(bigint, text)                     to authenticated;
grant execute on function public.create_market(bigint, text, text, timestamptz, text[], numeric, uuid, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.update_market(bigint, text, text, timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.cancel_market(bigint)                          to authenticated;
grant execute on function public.submit_option(bigint, text)                    to authenticated;
grant execute on function public.place_bet(bigint, bigint, int)                 to authenticated;
grant execute on function public.propose_resolution(bigint, bigint, text)       to authenticated;
grant execute on function public.review_proposal(bigint, text)                  to authenticated;
grant execute on function public.resolve_market(bigint, bigint)                 to authenticated;
grant execute on function public.void_market(bigint, text)                      to authenticated;
grant execute on function public.void_bet(bigint, text)                         to authenticated;
grant execute on function public.vote_on_proposal(bigint, text)                 to authenticated;
grant execute on function public.clear_proposal_vote(bigint)                    to authenticated;


-- =====================================================================
-- 10. STORAGE
--   Private bucket. Path convention: <circle_id>/<market_id>/<uuid>.<ext>
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

create or replace function public.evidence_circle_id(_name text)
returns bigint language sql immutable set search_path = '' as $$
  -- {1,18} is NOT cosmetic. '^\d+$' matches digit strings of ANY length, so a
  -- path like '99999999999999999999/1/x.jpg' (20 digits) passed the regex and
  -- then threw "value out of range for type bigint" INSIDE an RLS policy.
  -- A policy that raises does not deny -- it errors the whole query. One
  -- object with such a name would break evidence listing for every user in
  -- the project. bigint tops out at 19 digits, so 18 is always safe.
  select case
    when (storage.foldername(_name))[1] ~ '^\d{1,18}$'
      then ((storage.foldername(_name))[1])::bigint
    else null
  end;
$$;

-- v2: second path segment is the market id, so storage deletes can respect
-- market settlement the same way the market_evidence table policy does.
create or replace function public.evidence_market_id(_name text)
returns bigint language sql immutable set search_path = '' as $$
  -- same bigint-overflow guard as evidence_circle_id above
  select case
    when array_length(storage.foldername(_name), 1) >= 2
     and (storage.foldername(_name))[2] ~ '^\d{1,18}$'
      then ((storage.foldername(_name))[2])::bigint
    else null
  end;
$$;

grant execute on function public.evidence_circle_id(text) to authenticated;
grant execute on function public.evidence_market_id(text) to authenticated;

drop policy if exists evidence_read on storage.objects;
create policy evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and public.is_circle_member(public.evidence_circle_id(name))
  );

drop policy if exists evidence_upload on storage.objects;
create policy evidence_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and public.is_circle_member(public.evidence_circle_id(name))
    and not public.market_is_settled(public.evidence_market_id(name))
  );

drop policy if exists evidence_delete on storage.objects;
create policy evidence_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidence'
    and owner = auth.uid()
    and not public.market_is_settled(public.evidence_market_id(name))
  );


-- =====================================================================
-- 11. REALTIME
-- =====================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.bets;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.markets;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.proposal_votes;
  exception when duplicate_object then null; end;
end $$;


-- =====================================================================
-- 12. SCHEDULED JOBS
--   These are now cosmetic for betting (place_bet trusts timestamps), but
--   they keep status correct for list filters and badges.
--   Skipped automatically if pg_cron is not installed.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed - skipping section 12. Enable it and re-run this block.';
    return;
  end if;

  perform cron.schedule(
    'market-lifecycle',
    '*/5 * * * *',
    $job$
      update public.markets set status = 'open'
       where status = 'scheduled' and opens_at <= now();
      update public.markets set status = 'closed'
       where status = 'open' and closes_at <= now();
    $job$
  );

  perform cron.schedule(
    'closing-soon-alerts',
    '*/15 * * * *',
    $job$
      insert into public.notifications (user_id, title, body, url)
      select cm.user_id,
             'Betting closes soon',
             m.question,
             '/market/' || m.id
      from public.markets m
      join public.circle_members cm on cm.circle_id = m.circle_id
      where m.status = 'open'
        and m.closes_at between now() and now() + interval '1 hour'
        and not exists (
          select 1 from public.notifications n
          where n.user_id = cm.user_id
            and n.url = '/market/' || m.id
            and n.title = 'Betting closes soon'
        );
    $job$
  );

  perform cron.schedule(
    'prune-notifications',
    '0 4 * * *',
    $job$ delete from public.notifications where created_at < now() - interval '30 days'; $job$
  );

  if exists (select 1 from pg_extension where extname = 'pg_net') then
    -- push delivery. Store the secrets in Vault FIRST:
    --   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
    --   select vault.create_secret('sb_publishable_...',        'publishable_key');
    perform cron.schedule(
      'send-push',
      '* * * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'project_url') || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (select decrypted_secret from vault.decrypted_secrets
                       where name = 'publishable_key')
          ),
          body := '{}'::jsonb
        );
      $job$
    );
  end if;
end $$;

-- to remove a job:  select cron.unschedule('market-lifecycle');
-- to inspect runs:  select * from cron.job_run_details order by start_time desc limit 20;
-- to audit money:   select * from public.circle_reconciliation;   -- drift must be 0


-- =====================================================================
-- 13. IMMUTABILITY TRIGGERS
--
--   Until now, "settled means settled" was enforced by every individual
--   function remembering to check status. That held for three revisions but
--   it is a convention, not a guarantee: the next function either of us adds
--   has to remember, and cancel_market already proved that it can be missed.
--
--   These triggers make terminality a property of the TABLE. Any path that
--   tries to rewrite settled history fails, including a hand-written UPDATE
--   typed into the SQL editor at 2am.
--
--   ORDERING NOTE (why these do not break settlement):
--     resolve_market() and void_market() write the BETS first and flip the
--     MARKET to its terminal status last. So while the bet rows are being
--     stamped, the parent market is still open/closed and the guard passes.
--     Anything arriving after the market row flips is correctly rejected.
--
--   WHY SECURITY DEFINER ON THE GUARDS:
--     Three of these read public.markets to find the parent's status, and
--     public.markets has RLS enabled. A plain (INVOKER) trigger function
--     evaluates that read as the calling user, so an RLS-filtered row comes
--     back as zero rows -> _status is NULL -> the "parent already gone" early
--     return fires -> THE WRITE IS ALLOWED. A guard whose failure mode is
--     "permit" is not a guard. Running as the owner makes the status read
--     unconditional and correct, and closes that inversion permanently.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 13.1 Markets: no escape from a terminal status, and no deletion of one.
-- ---------------------------------------------------------------------
create or replace function public.markets_terminal_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    if old.status in ('resolved','voided') then
      raise exception
        'Market % has settled (%) and cannot be deleted. Settlement is permanent.',
        old.id, old.status
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  -- UPDATE: a terminal market is frozen entirely. Nothing legitimate updates
  -- one -- the lifecycle cron only touches 'scheduled'/'open', update_market()
  -- refuses settled markets, and resolve/void set the terminal status as their
  -- final write and never revisit it.
  if old.status in ('resolved','voided') then
    raise exception
      'Market % has settled (%) and cannot be modified. Settlement is permanent.',
      old.id, old.status
      using errcode = 'restrict_violation';
  end if;

  -- Block skipping straight to a terminal state without going through the
  -- resolve/void functions (which is how coins actually get paid out).
  if new.status = 'resolved' and new.winning_option_id is null then
    raise exception 'A resolved market must have a winning option'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists markets_terminal_guard on public.markets;
create trigger markets_terminal_guard
  before update or delete on public.markets
  for each row execute function public.markets_terminal_guard();

-- ---------------------------------------------------------------------
-- 13.2 Bets: once the parent market has settled, stakes and payouts are
--      frozen. This is what stops a leaderboard figure drifting after the
--      fact, and it closes the "edit payout, then nobody can tell" hole.
-- ---------------------------------------------------------------------
create or replace function public.bets_settled_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _status text; _mid bigint;
begin
  _mid := case when tg_op = 'DELETE' then old.market_id else new.market_id end;

  select status into _status from public.markets where id = _mid;

  -- Parent already gone (cascade from a delete that the markets guard above
  -- has already vetted) -- nothing to protect.
  if _status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if _status in ('resolved','voided') then
    raise exception
      'Market % has settled (%); its bets are frozen.', _mid, _status
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

drop trigger if exists bets_settled_guard on public.bets;
create trigger bets_settled_guard
  before insert or update or delete on public.bets
  for each row execute function public.bets_settled_guard();

-- ---------------------------------------------------------------------
-- 13.3 Resolution proposals: a reviewed proposal is history.
--      Without this, an approved proposal could be flipped back to
--      'pending' and re-reviewed, double-refunding its bond.
-- ---------------------------------------------------------------------
create or replace function public.proposals_reviewed_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    -- Parent market already gone: this is the ON DELETE CASCADE from
    -- cancel_market(), which rejects its pending proposals (refunding the
    -- bonds) and THEN deletes the market. Those rows arrive here as
    -- 'rejected', so a naive status check would abort the cancel entirely.
    -- The markets guard has already vetted that deletion, so allow it.
    if not exists (select 1 from public.markets where id = old.market_id) then
      return old;
    end if;
    if old.status <> 'pending' then
      raise exception 'Proposal % has been reviewed (%) and cannot be deleted.',
        old.id, old.status using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status <> 'pending' then
    raise exception 'Proposal % has been reviewed (%) and cannot be changed.',
      old.id, old.status using errcode = 'restrict_violation';
  end if;

  -- the bond is the deterrent; it must not be editable after posting
  if new.bond <> old.bond then
    raise exception 'The bond on a proposal cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists proposals_reviewed_guard on public.resolution_proposals;
create trigger proposals_reviewed_guard
  before update or delete on public.resolution_proposals
  for each row execute function public.proposals_reviewed_guard();

-- ---------------------------------------------------------------------
-- 13.4 Ledger: append-only. This is the audit trail that settles arguments,
--      and an audit trail you can edit is not one.
--
--      One narrow exception: market_id / bet_id are ON DELETE SET NULL, so
--      cancelling an unbetted market legitimately nulls those pointers while
--      preserving the row. Everything financial is frozen.
-- ---------------------------------------------------------------------
create or replace function public.ledger_append_only_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'coin_ledger is append-only; entry % cannot be deleted.', old.id
      using errcode = 'restrict_violation';
  end if;

  if new.id         is distinct from old.id
  or new.circle_id  is distinct from old.circle_id
  or new.user_id    is distinct from old.user_id
  or new.amount     is distinct from old.amount
  or new.reason     is distinct from old.reason
  or new.actor_id   is distinct from old.actor_id
  or new.note       is distinct from old.note
  or new.created_at is distinct from old.created_at then
    raise exception 'coin_ledger is append-only; entry % cannot be altered.', old.id
      using errcode = 'restrict_violation';
  end if;

  -- The ONLY permitted mutation is market_id / bet_id being nulled by the
  -- ON DELETE SET NULL foreign keys when an unbetted market is cancelled.
  -- note is frozen too: nothing in this schema ever rewrites one, and an
  -- editable description on an immutable amount is a misleading audit trail.
  if new.market_id is not null and new.market_id is distinct from old.market_id then
    raise exception 'coin_ledger is append-only; entry % cannot be re-pointed.', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.bet_id is not null and new.bet_id is distinct from old.bet_id then
    raise exception 'coin_ledger is append-only; entry % cannot be re-pointed.', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists ledger_append_only_guard on public.coin_ledger;
create trigger ledger_append_only_guard
  before update or delete on public.coin_ledger
  for each row execute function public.ledger_append_only_guard();

-- ---------------------------------------------------------------------
-- 13.5 Evidence rows follow their market, matching the RLS + storage rules.
-- ---------------------------------------------------------------------
create or replace function public.evidence_settled_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _status text; _mid bigint;
begin
  _mid := case when tg_op = 'DELETE' then old.market_id else new.market_id end;
  select status into _status from public.markets where id = _mid;

  if _status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if _status in ('resolved','voided') then
    raise exception
      'Market % has settled (%); its evidence is frozen.', _mid, _status
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

drop trigger if exists evidence_settled_guard on public.market_evidence;
create trigger evidence_settled_guard
  before insert or update or delete on public.market_evidence
  for each row execute function public.evidence_settled_guard();

-- ---------------------------------------------------------------------
-- 13.6 Break-glass.
--
--   These guards apply to the table owner and to SECURITY DEFINER functions
--   too, which is the point. If you ever genuinely must correct settled data
--   (a real corruption, not a change of heart), disable, fix, re-enable, and
--   then CHECK RECONCILIATION:
--
--     alter table public.markets disable trigger markets_terminal_guard;
--     -- ... your correction ...
--     alter table public.markets enable  trigger markets_terminal_guard;
--     select * from public.circle_reconciliation;   -- drift must be 0
--
--   DELETING A WHOLE CIRCLE cascades into markets AND coin_ledger, so it is
--   blocked by 13.1 (any settled market) and by 13.4 (every ledger row) --
--   not just the ledger. That is deliberate: dropping a circle destroys its
--   financial history. Both guards must come down together:
--
--     alter table public.markets     disable trigger markets_terminal_guard;
--     alter table public.coin_ledger disable trigger ledger_append_only_guard;
--     delete from public.circles where id = <id>;
--     alter table public.markets     enable  trigger markets_terminal_guard;
--     alter table public.coin_ledger enable  trigger ledger_append_only_guard;
--
--   Prefer admin_adjust_coins() for anything economic: it is reversible in
--   the open, ledgered, and stamped with actor_id.
--
--   DELETING AN AUTH USER: auth.users cascades into circle_members, bets and
--   coin_ledger. If that person ever bet on a market that has since settled,
--   13.2 and 13.4 will refuse and the user delete fails. That is the intended
--   trade-off -- their stake is part of a settled pot, and removing it would
--   silently rewrite other people's payouts. For a GDPR-style erasure, clear
--   the display_name and leave the financial rows in place; they are keyed by
--   uuid and carry no personal data. If you must hard-delete, disable
--   bets_settled_guard and ledger_append_only_guard, delete, re-enable, then
--   check circle_reconciliation -- expect drift, and correct it deliberately.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 13.7 STRUCTURAL INTEGRITY: cross-market references
--
--   place_bet() and propose_resolution() both verify that the option they
--   were handed actually belongs to the market they were handed. That is a
--   check in application code, and every check in application code is one
--   refactor away from not existing.
--
--   market_evidence is worse than a hypothetical: its INSERT policy is one of
--   only three client-writable surfaces in the whole schema, and it validates
--   market_id but NOT proposal_id. So a member could attach evidence to their
--   own market while pointing proposal_id at a proposal on a DIFFERENT market
--   -- their photo then renders under someone else's pending resolution, in a
--   circle they may not even belong to. Reachable today, from the browser.
--
--   Composite foreign keys make all three impossible at the storage layer.
--   MATCH SIMPLE semantics mean a NULL proposal_id still satisfies the
--   evidence constraint, so optional evidence keeps working.
-- =====================================================================
create unique index if not exists market_options_id_market
  on public.market_options (id, market_id);
create unique index if not exists proposals_id_market
  on public.resolution_proposals (id, market_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bets_option_matches_market') then
    alter table public.bets
      add constraint bets_option_matches_market
      foreign key (option_id, market_id)
      references public.market_options (id, market_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'proposals_option_matches_market') then
    alter table public.resolution_proposals
      add constraint proposals_option_matches_market
      foreign key (proposed_option_id, market_id)
      references public.market_options (id, market_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'evidence_proposal_matches_market') then
    alter table public.market_evidence
      add constraint evidence_proposal_matches_market
      foreign key (proposal_id, market_id)
      references public.resolution_proposals (id, market_id) on delete cascade;
  end if;
exception when foreign_key_violation then
  raise exception
    'Existing rows violate cross-market integrity. Find them with: '
    'select b.id from public.bets b join public.market_options o on o.id = b.option_id '
    'where o.market_id <> b.market_id;  (repeat for resolution_proposals and market_evidence)';
end $$;


-- =====================================================================
-- 14. FINAL PRIVILEGE SWEEP
--
--   Section 9 stripped default PUBLIC/anon EXECUTE from every function that
--   existed AT THAT POINT. Sections 10 and 13 then created seven more
--   (evidence_circle_id, evidence_market_id, and the five trigger guards),
--   and Postgres handed each of them EXECUTE to PUBLIC on creation. Running
--   the sweep again at the very end is what makes the guarantee actually
--   hold for the whole file, rather than for the first two thirds of it.
--
--   The trigger guards return type `trigger`, so PostgREST will not expose
--   them and a direct call fails with "can only be called as a trigger" --
--   but a privilege model that depends on that is a coincidence, not a
--   design. Revoke, then re-grant only what RLS policies genuinely need.
-- =====================================================================
do $$
declare _fn text;
begin
  for _fn in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public', _fn);
    begin
      execute format('revoke all on function %s from anon', _fn);
    exception when undefined_object then null;
    end;
  end loop;
end $$;

-- Re-grant the RPC surface. This list is the COMPLETE set of things a signed
-- in user may call; anything absent is unreachable from the client.
grant execute on function public.is_circle_member(bigint)                       to authenticated;
grant execute on function public.is_circle_admin(bigint)                        to authenticated;
grant execute on function public.market_circle(bigint)                          to authenticated;
grant execute on function public.proposal_circle(bigint)                        to authenticated;
grant execute on function public.market_is_settled(bigint)                      to authenticated;
grant execute on function public.evidence_circle_id(text)                       to authenticated;
grant execute on function public.evidence_market_id(text)                       to authenticated;
grant execute on function public.create_circle(text)                            to authenticated;
grant execute on function public.join_circle(text)                              to authenticated;
grant execute on function public.rename_member(bigint, text)                    to authenticated;
grant execute on function public.set_circle_settings(bigint, int, int, text)    to authenticated;
grant execute on function public.mark_notification_read(bigint)                 to authenticated;
grant execute on function public.mark_all_notifications_read()                  to authenticated;
grant execute on function public.set_member_role(bigint, uuid, text)            to authenticated;
grant execute on function public.admin_adjust_coins(bigint, uuid, int, text)    to authenticated;
grant execute on function public.leave_circle(bigint)                           to authenticated;
grant execute on function public.remove_member(bigint, uuid)                    to authenticated;
grant execute on function public.reset_season(bigint, text)                     to authenticated;
grant execute on function public.create_market(bigint, text, text, timestamptz, text[], numeric, uuid, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.update_market(bigint, text, text, timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.cancel_market(bigint)                          to authenticated;
grant execute on function public.submit_option(bigint, text)                    to authenticated;
grant execute on function public.place_bet(bigint, bigint, int)                 to authenticated;
grant execute on function public.propose_resolution(bigint, bigint, text)       to authenticated;
grant execute on function public.review_proposal(bigint, text)                  to authenticated;
grant execute on function public.resolve_market(bigint, bigint)                 to authenticated;
grant execute on function public.void_market(bigint, text)                      to authenticated;
grant execute on function public.void_bet(bigint, text)                         to authenticated;
grant execute on function public.vote_on_proposal(bigint, text)                 to authenticated;
grant execute on function public.clear_proposal_vote(bigint)                    to authenticated;
-- default_display_name() and the five *_guard() trigger functions are
-- deliberately absent: they only ever run inside SECURITY DEFINER functions
-- or as triggers, where they execute as the owner regardless.


-- =====================================================================
-- 15. SELF-TEST
--
--   Verifies the invariants that matter. Read-only: it makes assertions about
--   object state and reads circle_reconciliation, and writes nothing. It runs
--   automatically at the end of every install and RAISES on failure, so a bad
--   install fails loudly instead of looking successful.
--
--   Everything here asserts on OBJECT STATE (are the guards attached? is RLS
--   on? is anon locked out?), not on simulated gameplay, because seeding fake
--   auth.users rows to fake a full bet cycle would itself need the guards
--   disabled. Do the gameplay test by hand in the app.
-- =====================================================================
do $$
declare _n int; _missing text;
begin
  -- every table this schema owns has RLS on. Scoped to an explicit list so an
  -- unrelated table elsewhere in `public` cannot make this fail spuriously.
  select string_agg(c.relname, ', ') into _missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('circles','seasons','circle_members','markets',
                      'market_options','bets','resolution_proposals',
                      'market_evidence','coin_ledger','comments',
                      'push_subscriptions','notifications','proposal_votes')
    and not c.relrowsecurity;
  if _missing is not null then
    raise exception 'SELF-TEST FAIL: RLS is off on: %', _missing;
  end if;

  -- all five immutability triggers are attached and enabled
  select count(*) into _n
  from pg_trigger
  where not tgisinternal
    and tgenabled <> 'D'
    and tgname in ('markets_terminal_guard','bets_settled_guard',
                   'proposals_reviewed_guard','ledger_append_only_guard',
                   'evidence_settled_guard');
  if _n <> 5 then
    raise exception 'SELF-TEST FAIL: expected 5 enabled immutability triggers, found %', _n;
  end if;

  -- no public-schema function is callable by anon or by PUBLIC.
  -- A NULL proacl means "defaults still apply", and the default for a
  -- function is EXECUTE to PUBLIC -- so NULL is a failure, not a pass.
  -- An acl entry rendered as '=X/owner' (empty grantee) is the PUBLIC grant.
  select count(*) into _n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and (
      p.proacl is null
      or exists (select 1 from unnest(p.proacl) a where a::text like '=%')
      or (exists (select 1 from pg_roles where rolname = 'anon')
          and has_function_privilege('anon', p.oid, 'execute'))
    );
  if _n > 0 then
    raise exception 'SELF-TEST FAIL: % public function(s) still executable by anon/PUBLIC', _n;
  end if;

  -- every SECURITY DEFINER function pins search_path (Supabase lint 0011)
  select string_agg(p.proname, ', ') into _missing
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
      where cfg like 'search_path=%'
    );
  if _missing is not null then
    raise exception 'SELF-TEST FAIL: SECURITY DEFINER without search_path: %', _missing;
  end if;

  -- DATA API REACHABILITY.
  -- Added after a live failure: the schema installed cleanly, this self-test
  -- reported PASSED, and then every single client read returned
  -- "42501 permission denied for table" because the project had no default
  -- privileges (the post-2026-05-30 Supabase default). A self-test that
  -- passes while the app is completely unusable is worse than no self-test,
  -- so the GRANT half of the model is now asserted too.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    select string_agg(t, ', ') into _missing
    from unnest(array['circles','seasons','circle_members','markets',
                      'market_options','bets','resolution_proposals',
                      'market_evidence','coin_ledger','comments',
                      'notifications','proposal_votes','push_subscriptions']) t
    where not has_table_privilege('authenticated', 'public.'||quote_ident(t), 'select');
    if _missing is not null then
      raise exception
        'SELF-TEST FAIL: role authenticated cannot SELECT: %. The Data API will '
        'return 42501 for these. Section 2.5 did not apply.', _missing;
    end if;

    -- the three client-writable surfaces must actually be writable
    if not has_table_privilege('authenticated','public.comments','insert')
    or not has_table_privilege('authenticated','public.market_evidence','insert')
    or not has_table_privilege('authenticated','public.push_subscriptions','insert') then
      raise exception 'SELF-TEST FAIL: authenticated cannot INSERT comments/evidence/push';
    end if;

    -- and the money tables must NOT be directly writable
    select string_agg(t, ', ') into _missing
    from unnest(array['circles','circle_members','markets','bets',
                      'coin_ledger','resolution_proposals']) t
    where has_table_privilege('authenticated', 'public.'||quote_ident(t), 'insert')
       or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'update')
       or has_table_privilege('authenticated', 'public.'||quote_ident(t), 'delete');
    if _missing is not null then
      raise exception
        'SELF-TEST FAIL: authenticated has direct write access to: %. These must '
        'only be writable through SECURITY DEFINER functions.', _missing;
    end if;
  end if;

  -- anon must have no table access at all: every circle is private
  if exists (select 1 from pg_roles where rolname = 'anon') then
    select string_agg(t, ', ') into _missing
    from unnest(array['circles','seasons','circle_members','markets',
                      'market_options','bets','resolution_proposals',
                      'market_evidence','coin_ledger','comments',
                      'notifications','proposal_votes','push_subscriptions']) t
    where has_table_privilege('anon', 'public.'||quote_ident(t), 'select')
       or has_table_privilege('anon', 'public.'||quote_ident(t), 'insert')
       or has_table_privilege('anon', 'public.'||quote_ident(t), 'update')
       or has_table_privilege('anon', 'public.'||quote_ident(t), 'delete');
    if _missing is not null then
      raise exception 'SELF-TEST FAIL: role anon still has access to: %', _missing;
    end if;
  end if;

  -- no circle is out of balance
  select count(*) into _n from public.circle_reconciliation where drift <> 0;
  if _n > 0 then
    raise exception 'SELF-TEST FAIL: % circle(s) have ledger drift', _n;
  end if;

  raise notice 'SELF-TEST PASSED: RLS on all tables, 5 guards live, Data API grants correct (authenticated can read, anon locked out, money tables function-only), no anon-callable functions, all definers pinned, ledger balanced.';
end $$;