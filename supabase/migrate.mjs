// One-off (and re-runnable) import of data.json into the Supabase `places` table.
//
// Usage:
//   cd supabase
//   npm install
//   cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
//   npm run migrate
//
// Safe to re-run: it clears the table and reinserts, so it stays in sync with
// whatever is currently in ../data.json.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const dataPath = join(__dirname, "..", "data.json");
const { places } = JSON.parse(readFileSync(dataPath, "utf-8"));

const rows = places.map((p) => ({
  name: p.name,
  category: p.category,
  neighborhood: p.neighborhood ?? null,
  description: p.description ?? null,
  open_date: p.openDate ?? null,
  source: p.source ?? null,
  lat: p.lat ?? null,
  lng: p.lng ?? null,
  website: p.website ?? null,
  image: p.image ?? null,
}));

const { error: deleteError } = await supabase.from("places").delete().neq("id", 0);
if (deleteError) {
  console.error("Failed to clear existing rows:", deleteError.message);
  process.exit(1);
}

const { data, error: insertError } = await supabase.from("places").insert(rows).select();
if (insertError) {
  console.error("Failed to insert rows:", insertError.message);
  process.exit(1);
}

console.log(`Imported ${data.length} places into Supabase.`);
