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

-- Run this next: adds the columns the detail page (detail.html/detail.js)
-- needs. Written as an ALTER so it's safe to run against the table created
-- above, whether that happened just now or a while ago. Populated by
-- supabase/enrich-places.mjs, not by migrate.mjs.
alter table places add column if not exists google_place_id text;
alter table places add column if not exists google_maps_uri text;
alter table places add column if not exists rating numeric;
alter table places add column if not exists user_rating_count int;
alter table places add column if not exists reviews jsonb;
alter table places add column if not exists photos text[];
alter table places add column if not exists top_dishes text[];
alter table places add column if not exists enriched_at timestamptz;

-- Run this once too: creates the public Storage bucket that
-- enrich-places.mjs uploads Google Places photos into. Public buckets serve
-- objects at /storage/v1/object/public/... without needing a storage.objects
-- RLS policy; the enrich script writes to it with the service-role key,
-- which bypasses RLS anyway.
insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', true)
on conflict (id) do nothing;
