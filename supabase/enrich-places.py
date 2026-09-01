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

PLACE_PHOTO_FIELD_MASK = "places.id,places.rating,places.userRatingCount,places.reviews,places.photos,places.websiteUri,places.googleMapsUri";


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
        'X-Goog-FieldMask': PLACE_PHOTO_FIELD_MASK
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

def extract_top_dishes(place_name: str,reviews: list) -> list:
    """
    Extract top dishes from Google Place reviews using Claude.

    Args:
        place_name (str): The name of the place.
        reviews (list): A list of review dictionaries from the Google Places API.

    Returns:
        list: A list of top dishes mentioned in the reviews.
    """
    if len(reviews) == 0:
        return []
    review_text =  "\n\n".join(f"Review {i+1} ({review.get('rating') or '?'}★): {review.get('text')}"
                               for i, review in enumerate(reviews)
    )
    prompt = f"Here are Google reviews for {place_name}, a San Francisco restaurant/cafe:\n\n{review_text}\n\nBased only on these reviews, list up to 5 specific dishes or menu items that are mentioned positively. Respond with ONLY a JSON array of short strings (e.g. [\"Pad See Ew\", \"Thai Iced Tea\"]) and nothing else. If no specific dishes are mentioned, respond with []."
    headers = {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    }
    data = {
        "model": "claude-sonnet-5",
        "max_tokens": 200,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }
    res = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=data, timeout = 30)
    if not res.ok:
        print(f"Top dishes extraction failed ({res.status_code}): {res.text}")
        return []
    result = res.json()
    content = result.get("content") or [{}]
    raw = content[0].get("text") or "[]"
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    try:
        dishes = json.loads(raw)
        return [d for d in dishes if isinstance(d, str)] if isinstance(dishes, list) else []
    except json.JSONDecodeError:
        print(f"  couldn't parse top-dish response: {raw}")
        return []

try:
    response = (supabase.table("places").select("id, name, neighborhood, image").is_("enriched_at", "null").execute())
       
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
        photos = upload_photos(place.get("id"), matched_place.get("photos"))
        top_dishes = extract_top_dishes(place["name"], reviews)
    

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
    # Only fill the list-card image if one wasn't already curated
    # (e.g. by hand in data.json) — don't clobber it on a re-enrich.
        if not place.get("image"):
            update_data["image"] = photos[0] if photos else None
        # Update the place in Supabase with the enriched data
        if got_usable_data:
            update_data["enriched_at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            print(f"  saved ({len(photos)} photos, {len(reviews)} reviews, {len(top_dishes)} dishes)")
        update_response = (supabase.table("places").update(update_data)
                       .eq("id", place["id"]).execute())
    except Exception as e:
            print(f"  Error enriching place {place['name']}: {e}")
            continue

print("Done.")