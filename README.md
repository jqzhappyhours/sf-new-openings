# SF New Openings

A tiny static site that tracks newly opened restaurants, coffee shops, and bakeries in San Francisco — the notification Google Maps doesn't give you.

## How it works

- Listing data lives in a Supabase (hosted Postgres) `places` table instead of a flat file, so it can be updated without a commit-and-deploy cycle. `data.json` is kept as the seed/backup copy and is no longer read by the app.
- `index.html` / `style.css` / `app.js` render that data as a browsable, filterable, searchable grid. Still no build step for the site itself — `app.js` talks to Supabase directly from the browser using the `supabase-js` client and a public anon key (see `config.js`).
- `supabase/` holds the database schema and a migration script for loading/refreshing data from `data.json` into the table.
- A weekly scheduled Claude task searches local SF food press (Eater SF, SF Standard, SF Chronicle, etc.) for new openings and writes them to the database (see "Updating data" below).

## One-time Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard, go to SQL Editor → New query, paste the contents of `supabase/schema.sql`, and run it. This creates the `places` table with row-level security limited to public read access.
3. In Project Settings → API, copy the **Project URL** and **anon/public key** into `config.js` (replacing the placeholder values). This key is safe to commit — RLS restricts it to read-only.
4. In Project Settings → API, copy the **service role key** (keep this secret, never commit it) for use by the migration script below.

## Importing/refreshing data from data.json

```
cd supabase
npm install
cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run migrate
```

This clears and reloads the `places` table from `../data.json`. Re-run it any time `data.json` changes and you want the database to match.

## Running locally

Just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Requires `config.js` to have real Supabase credentials (see setup above).

## Publishing

To make this browsable from anywhere, push this repo to GitHub and enable GitHub Pages (Settings → Pages → deploy from `main` branch, root folder). Since `config.js`'s anon key is read-only, it's fine to publish as-is.

## Updating data

Preferred: add a row via the Supabase Table Editor (dashboard → Table Editor → `places` → Insert row), or add it to `data.json` and re-run the migration script above.

`data.json` format for reference:

```json
{
  "name": "Place Name",
  "category": "restaurant | coffee | bakery",
  "neighborhood": "Neighborhood or address",
  "description": "One sentence on what it is.",
  "openDate": "YYYY-MM-DD",
  "source": "https://source-link.com"
}
```
