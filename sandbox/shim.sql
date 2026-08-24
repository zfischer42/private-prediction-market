-- Minimal stand-in for the parts of Supabase the schema leans on.
-- Only auth.uid(), auth.users, the three roles, a storage stub, and the
-- realtime publication. Nothing here changes the schema's own logic.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- so the harness can `set role authenticated` and back
grant anon to postgres;
grant authenticated to postgres;
grant service_role to postgres;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Real Supabase reads the sub claim out of the request JWT. The harness
-- sets that GUC directly to impersonate a signed-in user.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---- storage stub -------------------------------------------------
create schema if not exists storage;

create table storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null,
  owner     uuid
);
alter table storage.objects enable row level security;

-- Supabase's version returns the directory parts, dropping the filename:
--   storage.foldername('12/34/x.png') -> {12,34}
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---- realtime stub ------------------------------------------------
-- Section 11 only traps duplicate_object, so the publication must exist
-- or the whole script aborts there.
create publication supabase_realtime;

-- public schema access, matching a stock Supabase project
grant usage on schema public to anon, authenticated, service_role;
