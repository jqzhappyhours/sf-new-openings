// Fetches reviews, rating, and photos for each place from the Google Places
// API (New), asks Claude to pull out commonly-mentioned dishes from those
// reviews, and writes it all into the `places` table for detail.html to
// read. Never called from the browser — the API keys below must stay
// server-side (Yelp explicitly forbids client-side calls, and Google's key
// would be exposed too).
//
// Usage:
//   cd supabase
//   npm install
//   cp .env.example .env   # fill in all four vars
//   npm run enrich
//
// Safe to re-run: only places with enriched_at still null (never
// successfully enriched) are processed. Delete enriched_at on a row (or run
// the SQL: update places set enriched_at = null) to force a refresh.

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !serviceRoleKey || !googleApiKey || !anthropicApiKey) {
  console.error(
    "Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY. Copy .env.example to .env and fill it in."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const PLACE_PHOTO_FIELD_MASK =
  "places.id,places.rating,places.userRatingCount,places.reviews,places.photos,places.websiteUri,places.googleMapsUri";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchGooglePlace(place) {
  const textQuery = [place.name, place.neighborhood, "San Francisco, CA"].filter(Boolean).join(", ");

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleApiKey,
      "X-Goog-FieldMask": PLACE_PHOTO_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, maxResultCount: 1 }),
  });

  if (!res.ok) {
    throw new Error(`Places API search failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.places?.[0] ?? null;
}

async function uploadPhotos(placeId, photos) {
  const urls = [];

  for (const [i, photo] of (photos ?? []).slice(0, 6).entries()) {
    // Ask for the CDN URL as JSON instead of a 302 redirect (skipHttpRedirect)
    // and fetch that URL directly — some sandboxed environments don't follow
    // the redirect from the media endpoint.
    const lookupRes = await fetch(
      `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1200&key=${googleApiKey}&skipHttpRedirect=true`
    );
    if (!lookupRes.ok) {
      console.warn(`  photo ${i} lookup failed (${lookupRes.status}), skipping`);
      continue;
    }
    const { photoUri } = await lookupRes.json();

    const mediaRes = await fetch(photoUri);
    if (!mediaRes.ok) {
      console.warn(`  photo ${i} fetch failed (${mediaRes.status}), skipping`);
      continue;
    }

    const contentType = mediaRes.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await mediaRes.arrayBuffer());
    const path = `${placeId}/${i}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("place-photos")
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadError) {
      console.warn(`  photo ${i} upload failed: ${uploadError.message}`);
      continue;
    }

    const { data } = supabase.storage.from("place-photos").getPublicUrl(path);
    urls.push(data.publicUrl);
  }

  return urls;
}

function mapReviews(reviews) {
  return (reviews ?? []).slice(0, 5).map((r) => ({
    author: r.authorAttribution?.displayName ?? "Anonymous",
    rating: r.rating ?? null,
    text: r.text?.text ?? r.originalText?.text ?? "",
    relative_time: r.relativePublishTimeDescription ?? "",
  }));
}

async function extractTopDishes(placeName, reviews) {
  if (reviews.length === 0) return [];

  const reviewText = reviews.map((r, i) => `Review ${i + 1} (${r.rating ?? "?"}★): ${r.text}`).join("\n\n");
  const prompt = `Here are Google reviews for "${placeName}", a San Francisco restaurant/cafe:\n\n${reviewText}\n\nBased only on these reviews, list up to 5 specific dishes or menu items that are mentioned positively. Respond with ONLY a JSON array of short strings (e.g. ["Pad See Ew", "Thai Iced Tea"]) and nothing else. If no specific dishes are mentioned, respond with [].`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.warn(`  top-dish extraction failed (${res.status}): ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? "[]").replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const dishes = JSON.parse(raw);
    return Array.isArray(dishes) ? dishes.filter((d) => typeof d === "string") : [];
  } catch {
    console.warn(`  couldn't parse top-dish response: ${raw}`);
    return [];
  }
}

const { data: places, error: fetchError } = await supabase
  .from("places")
  .select("id, name, neighborhood")
  .is("enriched_at", null);

if (fetchError) {
  console.error("Failed to load places:", fetchError.message);
  process.exit(1);
}

if (!places || places.length === 0) {
  console.log("Nothing to enrich — every place already has enriched_at set.");
  process.exit(0);
}

console.log(`Enriching ${places.length} place(s)...`);

for (const place of places) {
  console.log(`- ${place.name}`);
  try {
    const match = await searchGooglePlace(place);
    if (!match) {
      console.warn("  no Google Places match found, marking as enriched with no data");
      await supabase.from("places").update({ enriched_at: new Date().toISOString() }).eq("id", place.id);
      continue;
    }

    const reviews = mapReviews(match.reviews);
    const [photos, topDishes] = await Promise.all([
      uploadPhotos(place.id, match.photos),
      extractTopDishes(place.name, reviews),
    ]);

    const { error: updateError } = await supabase
      .from("places")
      .update({
        google_place_id: match.id ?? null,
        google_maps_uri: match.googleMapsUri ?? null,
        rating: match.rating ?? null,
        user_rating_count: match.userRatingCount ?? null,
        reviews,
        photos,
        top_dishes: topDishes,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", place.id);

    if (updateError) {
      console.error(`  failed to save: ${updateError.message}`);
    } else {
      console.log(`  saved (${photos.length} photos, ${reviews.length} reviews, ${topDishes.length} dishes)`);
    }
  } catch (err) {
    console.error(`  error: ${err.message}`);
  }

  await sleep(300);
}

console.log("Done.");
