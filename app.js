let allPlaces = [];
let activeCategory = "all";
let searchTerm = "";
let map = null;
let markers = [];

const grid = document.getElementById("grid");
const mapEl = document.getElementById("map");
const emptyMsg = document.getElementById("empty");
const searchInput = document.getElementById("search");
const filterButtons = document.querySelectorAll(".filter-btn");
const lastUpdatedEl = document.getElementById("lastUpdated");

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

function getFiltered() {
  const term = searchTerm.trim().toLowerCase();

  const filtered = allPlaces.filter((p) => {
    const matchesCategory = activeCategory === "all" || p.category === activeCategory;
    const matchesSearch =
      !term ||
      p.name.toLowerCase().includes(term) ||
      (p.neighborhood || "").toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });

  filtered.sort((a, b) => (b.openDate || "").localeCompare(a.openDate || ""));
  return filtered;
}

function handleImageError(img) {
  const placeholder = document.createElement("div");
  placeholder.className = `card-image-placeholder ${img.dataset.category}`;
  img.replaceWith(placeholder);
}
window.handleImageError = handleImageError;

function renderList(filtered) {
  grid.innerHTML = "";

  for (const p of filtered) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-image">
        ${
          p.image
            ? `<img src="${p.image}" alt="${p.name}" data-category="${p.category}" loading="lazy" onerror="handleImageError(this)">`
            : `<div class="card-image-placeholder ${p.category}"></div>`
        }
      </div>
      <div class="card-top">
        <h3>${p.name}</h3>
        <span class="tag ${p.category}">${CATEGORY_LABELS[p.category] || p.category}</span>
      </div>
      <div class="neighborhood">${p.neighborhood || ""}</div>
      <div class="description">${p.description || ""}</div>
      <div class="card-bottom">
        <span>${formatDate(p.openDate)}</span>
        <div class="card-links">
          ${p.website ? `<a href="${p.website}" target="_blank" rel="noopener">${websiteLabel(p.website)} →</a>` : ""}
          ${p.source ? `<a href="${p.source}" target="_blank" rel="noopener">Source →</a>` : ""}
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
}

function initMap() {
  if (map) return;
  map = L.map(mapEl).setView([37.7699, -122.4269], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

function renderMap(filtered) {
  initMap();

  markers.forEach((m) => map.removeLayer(m));
  markers = [];

  const withCoords = filtered.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

  for (const p of withCoords) {
    const color = CATEGORY_COLORS[p.category] || "#333";
    const icon = L.divIcon({
      className: "map-pin",
      html: `<span style="background:${color}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
    marker.bindPopup(`
      <strong>${p.name}</strong><br>
      <span>${CATEGORY_LABELS[p.category] || p.category} · ${p.neighborhood || ""}</span>
      <p>${p.description || ""}</p>
      ${p.website ? `<a href="${p.website}" target="_blank" rel="noopener">${websiteLabel(p.website)} →</a> ` : ""}
      ${p.source ? `<a href="${p.source}" target="_blank" rel="noopener">Source →</a>` : ""}
    `);
    markers.push(marker);
  }

  if (withCoords.length > 0) {
    const bounds = L.latLngBounds(withCoords.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

}

function render() {
  const filtered = getFiltered();
  emptyMsg.hidden = filtered.length > 0;
  renderMap(filtered);
  renderList(filtered);
}

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.category;
    render();
  });
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value;
  render();
});

fetch("data.json")
  .then((res) => res.json())
  .then((data) => {
    allPlaces = data.places || [];
    if (data.lastUpdated) {
      lastUpdatedEl.textContent = `Last updated ${formatDate(data.lastUpdated)}`;
    }
    render();
  })
  .catch((err) => {
    emptyMsg.hidden = false;
    emptyMsg.textContent = "Couldn't load data.json.";
    console.error(err);
  });
