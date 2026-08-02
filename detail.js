const content = document.getElementById("content");

const CATEGORY_LABELS = {
  restaurant: "Restaurant",
  coffee: "Coffee Shop",
  bakery: "Bakery",
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

function renderGallery(p) {
  const photos = p.photos.length > 0 ? p.photos : p.image ? [p.image] : [];
  if (photos.length === 0) {
    return `<div class="detail-gallery"><div class="card-image-placeholder ${p.category}"></div></div>`;
  }
  return `
    <div class="detail-gallery">
      ${photos.map((src) => `<img src="${src}" alt="${p.name}" loading="lazy">`).join("")}
    </div>
  `;
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
    ${renderReviews(p)}
    ${p.source ? `<p class="source-link"><a href="${p.source}" target="_blank" rel="noopener">Source →</a></p>` : ""}
  `;
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
