# SF New Openings

A tiny static site that tracks newly opened restaurants, coffee shops, and bakeries in San Francisco — the notification Google Maps doesn't give you.

## How it works

- `data.json` holds the list of places (name, category, neighborhood, description, open date, source link).
- `index.html` / `style.css` / `app.js` render that data as a browsable, filterable, searchable grid. No build step, no dependencies.
- A weekly scheduled Claude task searches local SF food press (Eater SF, SF Standard, SF Chronicle, etc.) for new openings, updates `data.json`, and commits the change.

## Running locally

Just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publishing

To make this browsable from anywhere, push this repo to GitHub and enable GitHub Pages (Settings → Pages → deploy from `main` branch, root folder).

## Updating data manually

Edit `data.json` and add an object to the `places` array:

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
