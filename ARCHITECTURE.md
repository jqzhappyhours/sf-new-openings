# Architecture

File-by-file reference for this repo. For setup/usage instructions, see [README.md](README.md).

This file is expected to be kept in sync with the codebase — a Claude Code hook (`.claude/settings.json`) reminds Claude to update it whenever a project file is edited or written.

## Frontend (static site, no build step)

- **`index.html`** — Page shell. Loads Leaflet (map library) and the Supabase JS client from CDNs, then `config.js` and `app.js`. Contains the empty containers (`#map`, `#grid`) that `app.js` populates, plus the search input and category filter buttons.
- **`style.css`** — All styling for both pages: layout/grid for the place cards, category tag colors, map container sizing, the custom Leaflet marker pin look, and the detail page (photo gallery, review cards, dish chips).
- **`config.js`** — Public Supabase project URL and anon (read-only) API key, assigned to `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY`. Safe to commit — row-level security restricts this key to read access (see `supabase/schema.sql`).
- **`app.js`** — All client-side logic for the list page:
  - Creates a Supabase client with `config.js` credentials and fetches all rows from the `places` table on load.
  - Maps DB rows (snake_case, e.g. `open_date`) to the app's place objects (camelCase, e.g. `openDate`) via `rowToPlace`, including the row `id` used to link to the detail page.
  - Renders the filterable/searchable card grid (`renderList`) and a Leaflet map with one pin per place that has coordinates (`renderMap`/`initMap`). Each card's photo links to `detail.html?id=<place id>`.
  - Handles category filter buttons and the search box, re-rendering both the grid and map on change.
  - Falls back to a placeholder colored by category if a place has no image or its image fails to load.
- **`detail.html`** — Page shell for a single place's detail view. Loads the Supabase JS client, `config.js`, then `detail.js`. Contains a static back link and an empty `#content` container that `detail.js` populates.
- **`detail.js`** — Client-side logic for the detail page: reads the `id` query param, fetches that one row from the `places` table, maps it via `rowToDetail` (same DB-row shape as `app.js` plus the enrichment columns below), and renders a photo gallery, description, top dishes, a menu link-out (to the place's website, falling back to its Google Maps listing), and a review list with average rating. Shows a "not found" message if the id is missing or the row doesn't exist.

## Data

- **`data.json`** — Seed/backup copy of the place listings (name, category, neighborhood, description, openDate, source, lat/lng, website, image). No longer read directly by the app at runtime; it's the source that `supabase/migrate.mjs` upserts into the database. Edit this file and re-run the migration to bulk-update listings. Not kept in sync automatically with rows added by the weekly food-press scan routine — periodically re-pull from the DB if it needs to reflect the live table.
- **`images/`** — Local place photos referenced by `data.json`/the `places` table (e.g. `images/saam.jpg`, `images/stray-dog.jpg`). Some places instead link directly to externally-hosted images.

## Database (Supabase)

- **`supabase/schema.sql`** — One-time SQL run in the Supabase SQL Editor. Creates the `places` table and locks it down: row-level security enabled with a public read-only policy for the `anon` role (no insert/update/delete policy for `anon` on purpose — writes only happen via the service-role key, which bypasses RLS). Also creates a unique index on `name` (lets `migrate.mjs` upsert instead of wiping the table), an `alter table` block adding the detail-page columns (`google_place_id`, `google_maps_uri`, `rating`, `user_rating_count`, `reviews`, `photos`, `top_dishes`, `enriched_at`), and a statement creating the public `place-photos` Storage bucket that `enrich-places.mjs` uploads photos into.
- **`supabase/migrate.mjs`** — Node script (ESM) that upserts rows from `../data.json` into the `places` table by name (insert if new, update if the name already exists), using the Supabase service-role key from `supabase/.env`. Non-destructive: rows added by other means (e.g. the weekly food-press scan routine) and not present in `data.json` are left alone. Safe to re-run any time `data.json` changes; run via `npm run migrate` inside `supabase/`. Does not touch the enrichment columns.
- **`supabase/enrich-places.mjs`** — Node script (ESM) that fills in the detail-page columns: for every place with `enriched_at is null`, it searches the Google Places API (New) for a match, uploads its photos to the `place-photos` Storage bucket, asks Claude to extract commonly-mentioned dishes from the reviews, and writes it all back to that place's row. Also backfills the list-card `image` column from the first uploaded photo, but only if `image` isn't already set (so a hand-curated `data.json` image is never overwritten on a re-enrich). `enriched_at` is only stamped once a place actually comes away with photos or reviews — a place with no Google Places match yet (e.g. a very new opening not indexed by Google) or that matched but got nothing usable stays `enriched_at is null`, so the next run retries it instead of leaving it permanently missing photos/reviews. Run via `npm run enrich` inside `supabase/`; safe to re-run since already-enriched rows are skipped.
- **`supabase/package.json`** — Declares the `migrate` and `enrich` npm scripts and the two dependencies they need: `@supabase/supabase-js` (DB client) and `dotenv` (loads `.env`). `enrich-places.mjs` calls the Google Places and Anthropic HTTP APIs directly via `fetch`, no extra dependency needed.
- **`supabase/.env.example`** — Template for `supabase/.env`, listing the four required env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`.
- **`supabase/.env`** *(gitignored)* — Actual Supabase URL + service-role key + Google/Anthropic API keys used by `migrate.mjs`/`enrich-places.mjs`. Never commit this — the service-role key bypasses row-level security.

## Project meta

- **`README.md`** — User-facing setup and usage docs: one-time Supabase setup, running locally, publishing via GitHub Pages, and how to add/update listings.
- **`.gitignore`** — Ignores `.DS_Store`, `node_modules/`, and `.env`.
- **`.claude/`** — Claude Code project config (not app code). `settings.json` holds the hook that keeps this file up to date.
- **Weekly food press scan** — Not a file in this repo; a cloud routine ("sf-new-openings weekly food press scan", Mondays 8am Pacific) that searches SF food press for new openings and inserts them into the `places` table via the Supabase REST API. Configured directly in Claude's routine scheduler, not stored in the repo — manage it at [claude.ai/code/routines](https://claude.ai/code/routines).
