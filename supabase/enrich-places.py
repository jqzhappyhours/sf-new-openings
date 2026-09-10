import os
from supabase import create_client, Client
import requests
import re
import json
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# Set up Supabase client using environment variables for URL and API key
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
googleApiKey: str = os.environ.get("GOOGLE_PLACES_API_KEY")
anthropicApiKey: str = os.environ.get("ANTHROPIC_API_KEY")


# Create Supabase client and handle potential exceptions
try:
    supabase: Client = create_client(url, key)
except Exception as e:
    raise Exception(f"Failed to create Supabase client: {e}")

PLACE_FIELD_MASK = (
    "places.id,places.rating,places.userRatingCount,places.reviews,places.photos,"
    "places.websiteUri,places.googleMapsUri,places.primaryType,"
    "places.primaryTypeDisplayName,places.types,places.editorialSummary"
)

# Google Places (New) type strings that actually name a cuisine, mapped to a
# display label. Generic types (`restaurant`, `cafe`, `bar`, `bakery`,
# `fine_dining_restaurant`, ...) are deliberately absent — they're a format,
# not a cuisine, so those fall through to Claude.
GOOGLE_CUISINE_LABELS = {
    "afghani_restaurant": "Afghan", "african_restaurant": "African",
    "american_restaurant": "American", "asian_restaurant": "Asian",
    "barbecue_restaurant": "Barbecue", "brazilian_restaurant": "Brazilian",
    "chinese_restaurant": "Chinese", "french_restaurant": "French",
    "greek_restaurant": "Greek", "hamburger_restaurant": "Burgers",
    "indian_restaurant": "Indian", "indonesian_restaurant": "Indonesian",
    "italian_restaurant": "Italian", "japanese_restaurant": "Japanese",
    "korean_restaurant": "Korean", "lebanese_restaurant": "Lebanese",
    "mediterranean_restaurant": "Mediterranean", "mexican_restaurant": "Mexican",
    "middle_eastern_restaurant": "Middle Eastern", "pizza_restaurant": "Pizza",
    "ramen_restaurant": "Ramen", "seafood_restaurant": "Seafood",
    "spanish_restaurant": "Spanish", "steak_house": "Steakhouse",
    "sushi_restaurant": "Sushi", "thai_restaurant": "Thai",
    "turkish_restaurant": "Turkish", "vegan_restaurant": "Vegan",
    "vegetarian_restaurant": "Vegetarian", "vietnamese_restaurant": "Vietnamese",
}


def cuisine_from_google(match: dict):
    """Return a cuisine label from Google's structured place type, or None."""
    if match.get("primaryType") in GOOGLE_CUISINE_LABELS:
        return GOOGLE_CUISINE_LABELS[match["primaryType"]]
    for t in match.get("types", []):
        if t in GOOGLE_CUISINE_LABELS:
            return GOOGLE_CUISINE_LABELS[t]
    return None


def search_google_places(place: dict):
    """
    Search for a place using the Google Places API.

    Args:
        place (dict): A dictionary containing the name and neighborhood

    Returns:
        dict | None: The first matching Google Place, or None
        if no place is found.
    """
    text_query = ", ".join(
        filter(None, [place.get("name"), place.get("neighborhood"), "San Francisco, CA"])
    )


    # Define the API endpoint
    url = 'https://places.googleapis.com/v1/places:searchText'
    # Define the headers
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,  # Replace 'API_KEY' with your actual Google Places API key
        'X-Goog-FieldMask': PLACE_FIELD_MASK
    }
    
    # Define the data payload for the POST request
    data = {
        "textQuery": text_query,
        "maxResultCount": 1
    }
    # Execute the HTTP POST request
    response = requests.post(url, json=data, headers=headers, timeout = 10)
    # Check if the request was successful
    if not response.ok:
       raise Exception(f"Place API search failed ({response.status_code}): {response.text}")

    places = response.json().get("places", []) 
    return places[0] if places else None  # Return the JSON response from the Google Places API
   
def upload_photos(placeId: str, photos: list):
    """
    Call Google Place API to downloand up to 6 photos of a place, 
    upload photos to Supabase storage, and return public URLs for the uploaded photos.

    Args:
        place_id (str): The ID of the place.
        photos (list): A list of photo dictionaries containing 'photoReference' and 'description'.
    """

    urls = []
    photos = photos or []
    # fetch up to 6 photos
    for i, photo in enumerate(photos[:6]):
        lookupRes = requests.get(f"https://places.googleapis.com/v1/{photo['name']}/media?maxWidthPx=1200&key={googleApiKey}&skipHttpRedirect=true",
                                 timeout = 10,)

        if not lookupRes.ok:
            print(f"Photo {i} lookup failed ({lookupRes.status_code}): {lookupRes.text}")
            continue
        photoUri = lookupRes.json()["photoUri"]
        mediaRes = requests.get(photoUri, timeout = 10,)
        if not mediaRes.ok:
            print(f"Photo {i} download failed ({mediaRes.status_code}), skipping")
            continue
        contentType = mediaRes.headers.get('Content-Type', 'image/jpeg')
        image_bytes = mediaRes.content
        path = f"{placeId}/{i}.jpg"
        try:
            supabase.storage.from_("place-photos").upload(
                path,
                image_bytes,
                {"contentType": contentType, "upsert": "true"})
        except Exception as e:
            print(f"Photo {i} upload failed: {e}")
            continue
        # Get public URL
        data = supabase.storage.from_("place-photos").get_public_url(path)
        urls.append(data)

    return urls

def map_reviews(reviews: dict) -> dict:
    """
    Map Google Place reviews to a simplified format.

    Args:
        reviews (dict): A list of review dictionaries from the Google Places API.

    Returns:
        list: A list of simplified review dictionaries.
    """
    mapped_reviews = []
    reviews = reviews or []
    for review in reviews[:5]:
        text_obj = review.get("text") or review.get("originalText") or {}
        mapped_reviews.append({
            "author": (review.get("authorAttribution") or {}).get("displayName", "Anonymous"),
            "rating": review.get("rating"),
            "text": text_obj.get("text", ""),
            "relative_time": review.get("relativePublishTimeDescription", "")
        })
    return mapped_reviews

def extract_dishes_and_cuisine(place_name: str, description: str, editorial_summary: str, reviews: list) -> dict:
    """
    Ask Claude for top dishes (from reviews) and a cuisine label (from Google's editorial summary + reviews).

    Returns:
        dict: {"dishes": list[str], "cuisine": str | None}
    """
    review_text = "\n\n".join(
        f"Review {i+1} ({review.get('rating') or '?'}★): {review.get('text')}"
        for i, review in enumerate(reviews)
    )
    context = "\n\n".join(
        part
        for part in [
            f"Editorial description: {description}" if description else "",
            f"Google's summary: {editorial_summary}" if editorial_summary else "",
            f"Google reviews:\n\n{review_text}" if review_text else "",
        ]
        if part
    )
    if not context:
        return {"dishes": [], "cuisine": None}

    prompt = (
        f'Here is information about "{place_name}", a San Francisco restaurant/cafe:\n\n{context}\n\n'
        'Respond with ONLY a JSON object, nothing else, shaped exactly like:\n'
        '{"dishes": ["Pad See Ew", "Thai Iced Tea"], "cuisine": "Thai"}\n'
        '- "dishes": up to 5 specific dishes or menu items mentioned positively in the reviews. Use [] if none are named.\n'
        '- "cuisine": the single best short cuisine label (e.g. "Thai", "Italian", "New American", "Filipino", "Cafe", "Bakery"). Use null if genuinely unclear.'
    )
    headers = {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    }
    data = {
        "model": "claude-sonnet-5",
        "max_tokens": 250,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }
    res = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=data, timeout = 30)
    if not res.ok:
        print(f"Dish/cuisine extraction failed ({res.status_code}): {res.text}")
        return {"dishes": [], "cuisine": None}
    result = res.json()
    content = result.get("content") or [{}]
    raw = content[0].get("text") or "{}"
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return {"dishes": [], "cuisine": None}
        dishes = [d for d in parsed.get("dishes", []) if isinstance(d, str)]
        cuisine_val = parsed.get("cuisine")
        cuisine = cuisine_val.strip() if isinstance(cuisine_val, str) and cuisine_val.strip() else None
        return {"dishes": dishes, "cuisine": cuisine}
    except json.JSONDecodeError:
        print(f"  couldn't parse dish/cuisine response: {raw}")
        return {"dishes": [], "cuisine": None}

try:
    response = (supabase.table("places").select("id, name, neighborhood, description, image, cuisine").is_("enriched_at", "null").execute())
       
except Exception as e:
    print(f"Failed to load places: {e}")
    sys.exit(0)

places = response.data

if not places:
    print("No places to enrich.")
    sys.exit(0)

# Enrich each place in the places list
print(f"Enriching {len(places)} places...")

for place in places:
    print(f"- {place['name']}")
    try:
        matched_place = search_google_places(place)
        if not matched_place:
        # Leave enriched_at null — a brand-new place may not be indexed by
        # Google yet, so let the next scan try again instead of skipping it
        # forever.
            print(f"No Google Place found, will retry next run.")
            continue
        if not matched_place.get("photos") or not matched_place.get("reviews"):
            print("  matched but missing photos/reviews, will retry next run")
            continue
        reviews = map_reviews(matched_place.get("reviews"))
        editorial_summary = (matched_place.get("editorialSummary") or {}).get("text")
        photos = upload_photos(place.get("id"), matched_place.get("photos"))
        extracted = extract_dishes_and_cuisine(
            place["name"], place.get("description"), editorial_summary, reviews
        )
        top_dishes = extracted["dishes"]
        # Prefer Google's structured cuisine type; fall back to Claude's read of
        # the description/summary/reviews for the many places Google only tags
        # `restaurant`. Left None if neither is confident.
        cuisine = cuisine_from_google(matched_place) or extracted["cuisine"]

        # a flag indicating whether we got usable data
        got_usable_data = len(photos) > 0 and len(reviews) > 0

        # create json data object for the updated data
        update_data = {
        "google_place_id": matched_place.get("id"),
        "google_maps_uri": matched_place.get("googleMapsUri"),
        "rating" : matched_place.get("rating"),
        "user_rating_count" : matched_place.get("userRatingCount"),
        "reviews" : reviews,
         "photos" : photos,
        "top_dishes" : top_dishes,
        }
    # Only fill the list-card image / cuisine if one wasn't already curated
    # (e.g. by hand in data.json or corrected in the DB) — don't clobber on a re-enrich.
        if not place.get("image"):
            update_data["image"] = photos[0] if photos else None
        if not place.get("cuisine"):
            update_data["cuisine"] = cuisine
        # Update the place in Supabase with the enriched data
        if got_usable_data:
            update_data["enriched_at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            print(f"  saved ({len(photos)} photos, {len(reviews)} reviews, {len(top_dishes)} dishes, cuisine: {cuisine or '—'})")
        update_response = (supabase.table("places").update(update_data)
                       .eq("id", place["id"]).execute())
    except Exception as e:
            print(f"  Error enriching place {place['name']}: {e}")
            continue

print("Done.")