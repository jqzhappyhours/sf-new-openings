-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- to create the places table and lock it down to public read-only access.

create table if not exists places (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  neighborhood text,
  description text,
  open_date date,
  source text,
  lat double precision,
  lng double precision,
  website text,
  image text,
  created_at timestamptz not null default now()
);

alter table places enable row level security;

create policy "Public read access"
  on places for select
  to anon
  using (true);

-- No insert/update/delete policy for the anon role on purpose: the app only
-- ever reads. Writes (the weekly data refresh) go through the service role
-- key from supabase/migrate.mjs, which bypasses RLS.
