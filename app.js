let allPlaces = [];
let activeCategory = "all";
let searchTerm = "";

const grid = document.getElementById("grid");
const emptyMsg = document.getElementById("empty");
const searchInput = document.getElementById("search");
const filterButtons = document.querySelectorAll(".filter-btn");
const lastUpdatedEl = document.getElementById("lastUpdated");

const CATEGORY_LABELS = {
  restaurant: "Restaurant",
  coffee: "Coffee Shop",
  bakery: "Bakery",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function render() {
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

  grid.innerHTML = "";
  emptyMsg.hidden = filtered.length > 0;

  for (const p of filtered) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <h3>${p.name}</h3>
        <span class="tag ${p.category}">${CATEGORY_LABELS[p.category] || p.category}</span>
      </div>
      <div class="neighborhood">${p.neighborhood || ""}</div>
      <div class="description">${p.description || ""}</div>
      <div class="card-bottom">
        <span>${formatDate(p.openDate)}</span>
        ${p.source ? `<a href="${p.source}" target="_blank" rel="noopener">Source →</a>` : ""}
      </div>
    `;
    grid.appendChild(card);
  }
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
