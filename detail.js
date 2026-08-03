const content = document.getElementById("content");

const CATEGORY_LABELS = {
  restaurant: "Restaurant",
  coffee: "Coffee Shop",
  bakery: "Bakery",
};

const CATEGORY_COLORS = {
  restaurant: "#c1440e",
  coffee: "#6f4e37",
  bakery: "#b8860b",
};

function websiteLabel(url) {
  return url.includes("instagram.com") ? "Instagram" : "Website";
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rowToDetail(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    neighborhood: row.neighborhood,
    description: row.description,
    openDate: row.open_date,
    source: row.source,
    website: row.website,
    image: row.image,
    lat: row.lat,
    lng: row.lng,
    rating: row.rating,
    userRatingCount: row.user_rating_count,
    reviews: row.reviews || [],
    photos: row.photos || [],
    topDishes: row.top_dishes || [],
    googleMapsUri: row.google_maps_uri,
  };
}

function showMessage(text) {
  content.innerHTML = `<p class="empty">${text}</p>`;
}

let galleryPhotos = [];

function renderGallery(p) {
  const photos = p.photos.length > 0 ? p.photos : p.image ? [p.image] : [];
  galleryPhotos = photos;
  if (photos.length === 0) {
    return `<div class="detail-gallery"><div class="card-image-placeholder ${p.category}"></div></div>`;
  }
  return `
    <div class="detail-gallery">
      ${photos
        .map(
          (src, i) =>
            `<img src="${src}" alt="${p.name}" loading="lazy" onclick="openLightbox(${i})">`
        )
        .join("")}
    </div>
  `;
}

let lightboxIndex = 0;

function renderLightbox() {
  let el = document.getElementById("lightbox");
  if (!el) {
    el = document.createElement("div");
    el.id = "lightbox";
    el.className = "lightbox";
    el.addEventListener("click", (e) => {
      if (e.target === el) closeLightbox();
    });
    document.body.appendChild(el);
  }
  const multiple = galleryPhotos.length > 1;
  el.innerHTML = `
    <button class="lightbox-close" aria-label="Close">&times;</button>
    ${multiple ? `<button class="lightbox-prev" aria-label="Previous photo">&#8249;</button>` : ""}
    <img src="${galleryPhotos[lightboxIndex]}" alt="">
    ${multiple ? `<button class="lightbox-next" aria-label="Next photo">&#8250;</button>` : ""}
  `;
  el.querySelector(".lightbox-close").onclick = closeLightbox;
  if (multiple) {
    el.querySelector(".lightbox-prev").onclick = () => showLightboxPhoto(-1);
    el.querySelector(".lightbox-next").onclick = () => showLightboxPhoto(1);
  }
}

function showLightboxPhoto(delta) {
  lightboxIndex = (lightboxIndex + delta + galleryPhotos.length) % galleryPhotos.length;
  renderLightbox();
}

function handleLightboxKey(e) {
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") showLightboxPhoto(-1);
  else if (e.key === "ArrowRight") showLightboxPhoto(1);
}

function openLightbox(index) {
  lightboxIndex = index;
  renderLightbox();
  document.addEventListener("keydown", handleLightboxKey);
}
window.openLightbox = openLightbox;

function closeLightbox() {
  const el = document.getElementById("lightbox");
  if (el) el.remove();
  document.removeEventListener("keydown", handleLightboxKey);
}

function renderTopDishes(p) {
  if (p.topDishes.length === 0) return "";
  return `
    <section class="detail-section">
      <h2>Top Dishes</h2>
      <div class="dish-chips">
        ${p.topDishes.map((d) => `<span class="dish-chip">${d}</span>`).join("")}
      </div>
    </section>
  `;
}

function renderMenu(p) {
  let link = "";
  if (p.website) {
    link = `<a href="${p.website}" target="_blank" rel="noopener">${websiteLabel(p.website)} →</a>`;
  } else if (p.googleMapsUri) {
    link = `<a href="${p.googleMapsUri}" target="_blank" rel="noopener">View on Google Maps →</a>`;
  }
  return `
    <section class="detail-section">
      <h2>Menu</h2>
      ${link ? `<p>${link}</p>` : `<p class="muted">No menu link available yet.</p>`}
    </section>
  `;
}

function renderMap(p) {
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return "";
  return `
    <section class="detail-section">
      <h2>Location</h2>
      <div id="detailMap" class="detail-map"></div>
    </section>
  `;
}

function initDetailMap(p) {
  const mapEl = document.getElementById("detailMap");
  if (!mapEl) return;

  const map = L.map(mapEl, { scrollWheelZoom: false }).setView([p.lat, p.lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  const color = CATEGORY_COLORS[p.category] || "#333";
  const icon = L.divIcon({
    className: "map-pin",
    html: `<span style="background:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);

  // Clicking the pin or the map itself opens this exact spot on Google Maps
  // (googleMapsUri, from the Places enrichment, is more precise than a
  // plain lat/lng search when it's available).
  const gmapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const openGoogleMaps = () => window.open(gmapsUrl, "_blank", "noopener");
  marker.on("click", openGoogleMaps);
  map.on("click", openGoogleMaps);
}

function renderReviews(p) {
  const summary =
    p.rating != null
      ? `<p class="review-summary">★ ${p.rating.toFixed(1)}${p.userRatingCount ? ` · ${p.userRatingCount} reviews` : ""}</p>`
      : "";

  if (p.reviews.length === 0) {
    return `
      <section class="detail-section">
        <h2>Reviews</h2>
        ${summary}
        <p class="muted">No reviews yet.</p>
      </section>
    `;
  }

  return `
    <section class="detail-section">
      <h2>Reviews</h2>
      ${summary}
      <div class="review-list">
        ${p.reviews
          .map(
            (r) => `
          <div class="review-card">
            <div class="review-meta"><strong>${r.author}</strong>${r.rating != null ? ` · ★ ${r.rating}` : ""}${r.relative_time ? ` · ${r.relative_time}` : ""}</div>
            <p>${r.text}</p>
          </div>
        `
          )
          .join("")}
      </div>
    </section>
  `;
}

function render(p) {
  document.title = `${p.name} — SF New Openings`;
  content.innerHTML = `
    ${renderGallery(p)}
    <div class="detail-header">
      <h1>${p.name}</h1>
      <span class="tag ${p.category}">${CATEGORY_LABELS[p.category] || p.category}</span>
    </div>
    <div class="neighborhood">${p.neighborhood || ""}</div>
    <p class="updated">${formatDate(p.openDate)}</p>
    <p class="description">${p.description || ""}</p>
    ${renderTopDishes(p)}
    ${renderMenu(p)}
    ${renderMap(p)}
    ${renderReviews(p)}
    ${p.source ? `<p class="source-link"><a href="${p.source}" target="_blank" rel="noopener">Source →</a></p>` : ""}
  `;
  initDetailMap(p);
}

const id = new URLSearchParams(location.search).get("id");

if (!id) {
  showMessage("No place specified.");
} else {
  const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  db.from("places")
    .select("*")
    .eq("id", id)
    .single()
    .then(({ data, error }) => {
      if (error || !data) {
        showMessage("Couldn't find that place.");
        if (error) console.error(error);
        return;
      }
      render(rowToDetail(data));
    })
    .catch((err) => {
      showMessage("Couldn't load this place from the database.");
      console.error(err);
    });
}
