/* =========================================================
   SHIV SAKTI — SALES DESK
   All data lives in localStorage. No server, no login.
   The Sales Desk screen (formerly "Order Calculator") is the heart
   of the app: product selection -> auto price -> manual packing ->
   live negotiation -> live totals. Packing is entered per-order and
   is never stored on the product record.
   ========================================================= */

const STORAGE_KEY = "ddp_state_v1";
let state = null;          // the whole app's data, persisted every change
let navStack = ["screen-home"];

/* ---------------------------------------------------------
   BOOTSTRAP
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  state = loadState();
  if (!state) {
    state = await buildDefaultState();
    saveState();
  }
  applyTheme(state.theme);
  registerServiceWorker();
  wireNavigation();
  wireThemeToggle();
  wirePriceFinder();
  wireOrderCalculator();
  wireProfitCalculator();
  wireSettings();
  wireSheets();
  populateAllDropdowns();
  renderSettingsScreen();
  runPriceFinder();
  runOrderCalculator();
  renderHomeStats();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast("Could not save — storage may be full");
  }
}

async function buildDefaultState() {
  let seed;
  try {
    const res = await fetch("products.json");
    seed = await res.json();
  } catch (e) {
    // Fallback minimal seed if products.json can't be reached (should be cached by the SW)
    seed = {
      categories: ["Dona Silver", "Plate Silver", "Bowl", "Compartment Plate"],
      sizes: ['5"', '6"', '7"', '8"', '9"', '10"', "4 CP"],
      gsm: [120, 140, 180],
      customerCategories: ["Wholesale", "Retail", "User"],
      customerCategoryMinOrders: { Wholesale: 50, Retail: 10, User: 1 },
      defaultPacketsPerKatta: 100,
      defaultPiecesPerPacket: 18,
      priceList: []
    };
  }
  return {
    theme: "light",
    categories: seed.categories,
    sizes: seed.sizes,
    gsm: seed.gsm,
    customerCategories: seed.customerCategories,
    customerCategoryMinOrders: seed.customerCategoryMinOrders || {},
    defaultPacketsPerKatta: seed.defaultPacketsPerKatta,
    defaultPiecesPerPacket: seed.defaultPiecesPerPacket,
    priceList: seed.priceList,
    favorites: [],
    recentOrders: []
  };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

/* ---------------------------------------------------------
   NAVIGATION
   --------------------------------------------------------- */
function wireNavigation() {
  document.querySelectorAll(".nav-card").forEach((btn) => {
    btn.addEventListener("click", () => goToScreen(btn.dataset.target));
  });
  document.getElementById("backBtn").addEventListener("click", goBack);
}

function goToScreen(id) {
  if (navStack[navStack.length - 1] !== id) navStack.push(id);
  showScreen(id);
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    showScreen(navStack[navStack.length - 1]);
  }
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(id);
  target.classList.add("active");
  document.getElementById("screenTitle").textContent = target.dataset.title.replace("&amp;", "&");
  document.getElementById("backBtn").hidden = id === "screen-home";
  if (id === "screen-home") renderHomeStats();
}
showScreen("screen-home");

/* ---------------------------------------------------------
   THEME
   --------------------------------------------------------- */
function wireThemeToggle() {
  document.getElementById("themeToggle").addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
  });
  document.querySelectorAll("#themeSegmented .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme));
  });
}

function setTheme(theme) {
  state.theme = theme;
  saveState();
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll("#themeSegmented .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1614" : "#eef0e9");
}

/* ---------------------------------------------------------
   SHARED HELPERS
   --------------------------------------------------------- */
function fillSelect(select, items, selected) {
  const prev = selected !== undefined ? selected : select.value;
  select.innerHTML = "";
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  });
  if (items.includes(prev)) select.value = prev;
}

function populateAllDropdowns() {
  const gsmStrings = state.gsm.map(String);
  [["pfCategory", state.categories], ["pfSize", state.sizes], ["pfGsm", gsmStrings], ["pfCustomer", state.customerCategories],
   ["ocCategory", state.categories], ["ocSize", state.sizes], ["ocGsm", gsmStrings], ["ocCustomer", state.customerCategories]]
    .forEach(([id, list]) => fillSelect(document.getElementById(id), list));

  document.getElementById("setDefaultPackets").value = state.defaultPacketsPerKatta;
  document.getElementById("setDefaultPieces").value = state.defaultPiecesPerPacket;
  document.getElementById("ocPacketsPerKatta").value = state.defaultPacketsPerKatta;
  document.getElementById("ocPiecesPerPacket").value = state.defaultPiecesPerPacket;
}

function findPriceEntry(category, size, gsm, customerCategory) {
  return state.priceList.find(
    (p) => p.category === category && p.size === size && String(p.gsm) === String(gsm) && p.customerCategory === customerCategory
  );
}

function money(n) {
  if (isNaN(n)) n = 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
function moneyWhole(n) {
  if (isNaN(n)) n = 0;
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function money4(n) {
  if (isNaN(n)) n = 0;
  return "₹" + n.toFixed(4);
}

/* ---------------------------------------------------------
   HOME SCREEN — today's snapshot
   Derived from recentOrders that were saved today via the
   Sales Desk. No fake data — starts at zero until an order
   is actually saved on the current calendar day.
   --------------------------------------------------------- */
function renderHomeStats() {
  const todayStr = new Date().toDateString();
  const todays = (state.recentOrders || []).filter(
    (o) => new Date(o.timestamp).toDateString() === todayStr
  );
  const orderCount = todays.length;
  const revenue = todays.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
  const pieces = todays.reduce((sum, o) => sum + (Number(o.totalPieces) || 0), 0);

  document.getElementById("homeOrdersToday").textContent = orderCount.toLocaleString("en-IN");
  document.getElementById("homeRevenueToday").textContent = moneyWhole(revenue);
  document.getElementById("homePiecesToday").textContent = pieces.toLocaleString("en-IN");
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------------------------------------------------------
   PRICE FINDER
   --------------------------------------------------------- */
function wirePriceFinder() {
  ["pfCategory", "pfSize", "pfGsm", "pfCustomer"].forEach((id) => {
    document.getElementById(id).addEventListener("change", runPriceFinder);
  });
  document.getElementById("pfFavBtn").addEventListener("click", togglePfFavorite);
  document.getElementById("pfSendToOrder").addEventListener("click", () => {
    document.getElementById("ocCategory").value = document.getElementById("pfCategory").value;
    document.getElementById("ocSize").value = document.getElementById("pfSize").value;
    document.getElementById("ocGsm").value = document.getElementById("pfGsm").value;
    document.getElementById("ocCustomer").value = document.getElementById("pfCustomer").value;
    runOrderCalculator(true);
    goToScreen("screen-sales-desk");
  });

  const search = document.getElementById("pfSearch");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    if (!q) {
      document.getElementById("pfSearchResults").hidden = true;
      document.getElementById("pfResult").hidden = false;
      return;
    }
    document.getElementById("pfResult").hidden = true;
    const terms = q.split(/\s+/);
    const matches = state.priceList.filter((p) => {
      const hay = `${p.category} ${p.size} ${p.gsm} ${p.customerCategory}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    }).slice(0, 40);
    renderSearchResults(matches);
  });
}

function renderSearchResults(matches) {
  const wrap = document.getElementById("pfSearchResults");
  const list = document.getElementById("pfSearchList");
  wrap.hidden = false;
  list.innerHTML = "";
  if (!matches.length) {
    list.innerHTML = '<div class="result-empty">No matches. Try different words.</div>';
    return;
  }
  matches.forEach((p) => {
    const el = document.createElement("div");
    el.className = "price-list-item";
    el.innerHTML = `
      <div class="pli-info">
        <span class="pli-title">${p.category} · ${p.size}</span>
        <span class="pli-sub">${p.gsm} GSM · ${p.customerCategory}</span>
      </div>
      <span class="pli-price">${money(p.price)}</span>`;
    el.addEventListener("click", () => {
      document.getElementById("pfCategory").value = p.category;
      document.getElementById("pfSize").value = p.size;
      document.getElementById("pfGsm").value = String(p.gsm);
      document.getElementById("pfCustomer").value = p.customerCategory;
      document.getElementById("pfSearch").value = "";
      document.getElementById("pfSearchResults").hidden = true;
      document.getElementById("pfResult").hidden = false;
      runPriceFinder();
    });
    list.appendChild(el);
  });
}

function runPriceFinder() {
  const category = document.getElementById("pfCategory").value;
  const size = document.getElementById("pfSize").value;
  const gsm = document.getElementById("pfGsm").value;
  const customerCategory = document.getElementById("pfCustomer").value;
  const entry = findPriceEntry(category, size, gsm, customerCategory);

  const empty = document.getElementById("pfEmpty");
  const body = document.getElementById("pfBody");

  if (!entry) {
    empty.hidden = false;
    empty.textContent = "No price saved for this combination yet. Add it in Settings → Price List.";
    body.hidden = true;
    return;
  }
  empty.hidden = true;
  body.hidden = false;

  const piecesPerPacket = Number(state.defaultPiecesPerPacket) || 1;
  const packetsPerKatta = Number(state.defaultPacketsPerKatta) || 1;
  const perPiece = entry.price;
  const perPacket = perPiece * piecesPerPacket;
  const perKatta = perPacket * packetsPerKatta;

  document.getElementById("pfPiecePrice").textContent = money(perPiece);
  document.getElementById("pfPacketPrice").textContent = moneyWhole(perPacket);
  document.getElementById("pfKattaPrice").textContent = moneyWhole(perKatta);
  document.getElementById("pfMinOrder").textContent =
    `Minimum order: ${entry.minOrder} Katta (${customerCategory})`;

  const isFav = state.favorites.includes(entry.id);
  const favIcon = document.getElementById("pfFavIcon");
  favIcon.setAttribute("fill", isFav ? "currentColor" : "none");
  const favBtn = document.getElementById("pfFavBtn");
  favBtn.lastChild.textContent = isFav ? " Saved to Favorites" : " Save to Favorites";
  favBtn.dataset.entryId = entry.id;
}

function togglePfFavorite() {
  const id = document.getElementById("pfFavBtn").dataset.entryId;
  if (!id) return;
  const idx = state.favorites.indexOf(id);
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
    showToast("Removed from Favorites");
  } else {
    state.favorites.push(id);
    showToast("Saved to Favorites");
  }
  saveState();
  runPriceFinder();
}

/* ---------------------------------------------------------
   SALES DESK — product pricing + packing + negotiation
   Business rule: packing (pieces/packet, packets/katta, katta
   count) belongs to the ORDER, never to the product. The product
   record only ever supplies category/size/gsm/customerCategory/
   minOrder/price. Packing is always a manual, per-order input.
   --------------------------------------------------------- */
let negotiation = { original: 0, current: 0 };
// Snapshot of the last computed totals, kept for "Save to Recent Orders"
// and the Home screen's Today's stats — avoids re-parsing rendered text.
let lastCalc = { totalPieces: 0, grandTotal: 0 };

function wireOrderCalculator() {
  ["ocCategory", "ocSize", "ocGsm", "ocCustomer"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => runOrderCalculator(true));
  });
  ["ocKatta", "ocPacketsPerKatta", "ocPiecesPerPacket"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => runOrderCalculator(false));
  });

  document.querySelectorAll(".paisa-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paisa = Number(btn.dataset.paisa);
      negotiation.current = Math.max(0, negotiation.current + paisa / 100);
      updateOrderMath();
    });
  });
  document.getElementById("ocResetNeg").addEventListener("click", () => {
    negotiation.current = negotiation.original;
    updateOrderMath();
  });

  document.getElementById("ocCopySummary").addEventListener("click", copyOrderSummary);
  document.getElementById("ocShareWhatsapp").addEventListener("click", shareOrderWhatsapp);
  document.getElementById("ocSaveRecent").addEventListener("click", saveRecentOrder);
}

// resetPrice = true when category/size/gsm/customer changed (pulls a fresh auto price).
// Looks up products.json/state.priceList ONLY — never invents a price. If the
// combination isn't in the price list, the Sales Desk shows "Price Not Available"
// and hides packing/negotiation/results instead of calculating on a fake number.
function runOrderCalculator(resetPrice) {
  const category = document.getElementById("ocCategory").value;
  const size = document.getElementById("ocSize").value;
  const gsm = document.getElementById("ocGsm").value;
  const customerCategory = document.getElementById("ocCustomer").value;
  const entry = findPriceEntry(category, size, gsm, customerCategory);

  const priceEmpty = document.getElementById("sdPriceEmpty");
  const priceBody = document.getElementById("sdPriceBody");
  const packingCard = document.getElementById("sdPackingCard");
  const negCard = document.getElementById("sdNegCard");
  const resultsCard = document.getElementById("sdResultsCard");

  if (!entry) {
    priceEmpty.hidden = false;
    priceBody.hidden = true;
    packingCard.hidden = true;
    negCard.hidden = true;
    resultsCard.hidden = true;
    return; // do NOT crash, do NOT fabricate a price — just stop here.
  }

  priceEmpty.hidden = true;
  priceBody.hidden = false;
  packingCard.hidden = false;
  negCard.hidden = false;
  resultsCard.hidden = false;

  document.getElementById("sdPiecePrice").textContent = money(entry.price);
  document.getElementById("sdMinOrder").textContent =
    `Minimum order: ${entry.minOrder} Katta (${customerCategory})`;

  if (resetPrice) {
    negotiation.original = entry.price;
    negotiation.current = entry.price;
  }
  updateOrderMath();
}

// Recalculates everything live — no Calculate button. Runs on every
// keystroke in packing fields and every negotiation button press.
function updateOrderMath() {
  const katta = Number(document.getElementById("ocKatta").value) || 0;
  const packetsPerKatta = Number(document.getElementById("ocPacketsPerKatta").value) || 0;
  const piecesPerPacket = Number(document.getElementById("ocPiecesPerPacket").value) || 0;

  const piecesPerKatta = packetsPerKatta * piecesPerPacket;
  const totalPackets = katta * packetsPerKatta;
  const totalPieces = totalPackets * piecesPerPacket;

  const price = negotiation.current;
  const pricePerPacket = price * piecesPerPacket;
  const pricePerKatta = pricePerPacket * packetsPerKatta;
  const grandTotal = price * totalPieces;

  lastCalc.totalPieces = totalPieces;
  lastCalc.grandTotal = grandTotal;

  document.getElementById("ocPricePiece").textContent = money(price);
  document.getElementById("ocPricePacket").textContent = moneyWhole(pricePerPacket);
  document.getElementById("ocPriceKatta").textContent = moneyWhole(pricePerKatta);
  document.getElementById("ocPiecesPerKatta").textContent = piecesPerKatta.toLocaleString("en-IN");
  document.getElementById("ocTotalPackets").textContent = totalPackets.toLocaleString("en-IN");
  document.getElementById("ocTotalPieces").textContent = totalPieces.toLocaleString("en-IN");
  document.getElementById("ocGrandTotal").textContent = moneyWhole(grandTotal);

  // negotiation panel
  document.getElementById("ocNegPrice").textContent = money4(negotiation.current);
  document.getElementById("ocOrigPrice").textContent = money4(negotiation.original);
  document.getElementById("ocCurrPrice").textContent = money4(negotiation.current);
  const diff = negotiation.current - negotiation.original;
  document.getElementById("ocDiff").textContent = (diff >= 0 ? "+" : "") + money4(diff);

  const profitImpact = diff * totalPieces;
  const profitLabel = document.getElementById("ocProfitLabel");
  const profitValue = document.getElementById("ocProfitValue");
  profitLabel.textContent = profitImpact >= 0 ? "Extra Profit" : "Reduced Profit";
  profitValue.textContent = moneyWhole(Math.abs(profitImpact));
  profitValue.classList.toggle("positive", profitImpact >= 0);
  profitValue.classList.toggle("negative", profitImpact < 0);
}

function buildOrderSummaryText() {
  const category = document.getElementById("ocCategory").value;
  const size = document.getElementById("ocSize").value;
  const gsm = document.getElementById("ocGsm").value;
  const customerCategory = document.getElementById("ocCustomer").value;
  const katta = document.getElementById("ocKatta").value || 0;
  return [
    `*Shiv Sakti — Order Summary*`,
    `Item: ${category}, ${size}, ${gsm} GSM`,
    `Customer Type: ${customerCategory}`,
    `Katta Ordered: ${katta}`,
    `Pieces / Katta: ${document.getElementById("ocPiecesPerKatta").textContent}`,
    `Total Packets: ${document.getElementById("ocTotalPackets").textContent}`,
    `Total Pieces: ${document.getElementById("ocTotalPieces").textContent}`,
    `Price / Piece: ${document.getElementById("ocPricePiece").textContent}`,
    `Price / Packet: ${document.getElementById("ocPricePacket").textContent}`,
    `Price / Katta: ${document.getElementById("ocPriceKatta").textContent}`,
    `*Grand Total: ${document.getElementById("ocGrandTotal").textContent}*`
  ].join("\n");
}

function copyOrderSummary() {
  const text = buildOrderSummaryText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("Order summary copied")).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
}
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); showToast("Order summary copied"); }
  catch (e) { showToast("Could not copy"); }
  document.body.removeChild(ta);
}

function shareOrderWhatsapp() {
  const text = buildOrderSummaryText();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function saveRecentOrder() {
  const order = {
    id: "O" + Date.now(),
    timestamp: Date.now(),
    category: document.getElementById("ocCategory").value,
    size: document.getElementById("ocSize").value,
    gsm: document.getElementById("ocGsm").value,
    customerCategory: document.getElementById("ocCustomer").value,
    katta: document.getElementById("ocKatta").value,
    packetsPerKatta: document.getElementById("ocPacketsPerKatta").value,
    piecesPerPacket: document.getElementById("ocPiecesPerPacket").value,
    pricePerPiece: negotiation.current,
    grandTotalText: document.getElementById("ocGrandTotal").textContent,
    // numeric fields power the Home screen's Today's Orders/Revenue/Pieces
    grandTotal: lastCalc.grandTotal,
    totalPieces: lastCalc.totalPieces
  };
  state.recentOrders.unshift(order);
  state.recentOrders = state.recentOrders.slice(0, 200);
  saveState();
  renderHomeStats();
  showToast("Saved to Recent Orders");
}

/* ---------------------------------------------------------
   PROFIT CALCULATOR
   --------------------------------------------------------- */
function wireProfitCalculator() {
  ["pcCost", "pcSelling", "pcQty"].forEach((id) => {
    document.getElementById(id).addEventListener("input", runProfitCalculator);
  });
}

function runProfitCalculator() {
  const cost = parseFloat(document.getElementById("pcCost").value) || 0;
  const selling = parseFloat(document.getElementById("pcSelling").value) || 0;
  const qty = parseFloat(document.getElementById("pcQty").value) || 0;

  const profitPerPiece = selling - cost;
  const totalProfit = profitPerPiece * qty;
  const profitPercent = cost > 0 ? (profitPerPiece / cost) * 100 : 0;

  document.getElementById("pcProfitPiece").textContent = money(profitPerPiece);
  document.getElementById("pcTotalProfit").textContent = moneyWhole(totalProfit);
  document.getElementById("pcProfitPercent").textContent = profitPercent.toFixed(1) + "%";
}

/* ---------------------------------------------------------
   SETTINGS — tag lists (categories / sizes / gsm / customer)
   --------------------------------------------------------- */
const TAG_CONFIG = {
  categories: { containerId: "tagCategories", inputId: "addCategoryInput", stateKey: "categories", isNumber: false },
  sizes: { containerId: "tagSizes", inputId: "addSizeInput", stateKey: "sizes", isNumber: false },
  gsm: { containerId: "tagGsm", inputId: "addGsmInput", stateKey: "gsm", isNumber: true },
  customer: { containerId: "tagCustomer", inputId: "addCustomerInput", stateKey: "customerCategories", isNumber: false }
};

function wireSettings() {
  document.querySelectorAll(".btn-add").forEach((btn) => {
    btn.addEventListener("click", () => addTag(btn.dataset.list));
  });
  document.getElementById("setDefaultPackets").addEventListener("input", (e) => {
    state.defaultPacketsPerKatta = Number(e.target.value) || 0;
    saveState();
  });
  document.getElementById("setDefaultPieces").addEventListener("input", (e) => {
    state.defaultPiecesPerPacket = Number(e.target.value) || 0;
    saveState();
  });
  document.getElementById("addPriceRow").addEventListener("click", addPriceRow);
  document.getElementById("exportPriceList").addEventListener("click", exportPriceList);
  document.getElementById("backupAll").addEventListener("click", backupEverything);
  document.getElementById("restoreAll").addEventListener("click", () => document.getElementById("restoreFile").click());
  document.getElementById("restoreFile").addEventListener("change", restoreEverything);
  document.getElementById("resetApp").addEventListener("click", resetAppData);
  document.getElementById("openProfitCalc").addEventListener("click", () => goToScreen("screen-profit-calculator"));
}

function addTag(listKey) {
  const cfg = TAG_CONFIG[listKey];
  const input = document.getElementById(cfg.inputId);
  let value = input.value.trim();
  if (!value) return;
  if (cfg.isNumber) value = Number(value);
  const list = state[cfg.stateKey];
  if (list.map(String).includes(String(value))) {
    showToast("Already in the list");
    return;
  }
  list.push(value);
  input.value = "";
  saveState();
  renderTagList(listKey);
  populateAllDropdowns();
}

function removeTag(listKey, value) {
  const cfg = TAG_CONFIG[listKey];
  state[cfg.stateKey] = state[cfg.stateKey].filter((v) => String(v) !== String(value));
  saveState();
  renderTagList(listKey);
  populateAllDropdowns();
}

function renderTagList(listKey) {
  const cfg = TAG_CONFIG[listKey];
  const container = document.getElementById(cfg.containerId);
  container.innerHTML = "";
  state[cfg.stateKey].forEach((value) => {
    const chip = document.createElement("div");
    chip.className = "tag-chip";
    chip.innerHTML = `<span>${value}</span>`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.addEventListener("click", () => removeTag(listKey, value));
    chip.appendChild(del);
    container.appendChild(chip);
  });
}

/* ---------------------------------------------------------
   SETTINGS — price list editor
   --------------------------------------------------------- */
function renderPriceListEditor() {
  const container = document.getElementById("priceListEditor");
  container.innerHTML = "";
  document.getElementById("priceListCount").textContent = state.priceList.length;

  state.priceList.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "pl-row";
    row.dataset.id = entry.id;

    const catSel = makeSelect(state.categories, entry.category, "category");
    const sizeSel = makeSelect(state.sizes, entry.size, "size");
    const gsmSel = makeSelect(state.gsm.map(String), String(entry.gsm), "gsm");
    const custSel = makeSelect(state.customerCategories, entry.customerCategory, "customerCategory");

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.step = "0.01";
    priceInput.value = entry.price;
    priceInput.placeholder = "Price / piece";
    priceInput.dataset.field = "price";

    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.value = entry.minOrder;
    minInput.placeholder = "Min order (Katta)";
    minInput.dataset.field = "minOrder";

    const grid = document.createElement("div");
    grid.className = "pl-row-grid";
    grid.append(catSel, sizeSel, gsmSel, custSel, priceInput, minInput);

    const footer = document.createElement("div");
    footer.className = "pl-row-footer";
    const idLabel = document.createElement("span");
    idLabel.style.fontSize = "11px";
    idLabel.style.color = "var(--text-3)";
    idLabel.textContent = entry.id;
    const delBtn = document.createElement("button");
    delBtn.className = "pl-delete";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deletePriceRow(entry.id));
    footer.append(idLabel, delBtn);

    row.append(grid, footer);
    container.appendChild(row);

    grid.querySelectorAll("select, input").forEach((el) => {
      el.addEventListener("change", () => updatePriceRow(entry.id, el.dataset.field, el.value));
      el.addEventListener("input", () => updatePriceRow(entry.id, el.dataset.field, el.value));
    });
  });
}

function makeSelect(options, selected, field) {
  const sel = document.createElement("select");
  sel.dataset.field = field;
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (String(opt) === String(selected)) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function updatePriceRow(id, field, value) {
  const entry = state.priceList.find((p) => p.id === id);
  if (!entry) return;
  if (field === "price" || field === "minOrder") {
    entry[field] = Number(value) || 0;
  } else if (field === "gsm") {
    entry.gsm = Number(value);
  } else {
    entry[field] = value;
  }
  saveState();
  runPriceFinder();
}

function deletePriceRow(id) {
  state.priceList = state.priceList.filter((p) => p.id !== id);
  saveState();
  renderPriceListEditor();
  showToast("Price row deleted");
}

function addPriceRow() {
  const newId = "P" + Date.now();
  state.priceList.unshift({
    id: newId,
    category: state.categories[0] || "",
    size: state.sizes[0] || "",
    gsm: state.gsm[0] || 0,
    customerCategory: state.customerCategories[0] || "",
    price: 0,
    minOrder: 1
  });
  saveState();
  renderPriceListEditor();
}

/* ---------------------------------------------------------
   SETTINGS — data: export / backup / restore / reset
   --------------------------------------------------------- */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPriceList() {
  downloadJSON(state.priceList, "shiv-sakti-price-list.json");
  showToast("Price list exported");
}

function backupEverything() {
  downloadJSON(state, `shiv-sakti-backup-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("Backup downloaded");
}

function restoreEverything(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.priceList)) throw new Error("bad file");
      state = Object.assign({}, state, data);
      saveState();
      populateAllDropdowns();
      renderSettingsScreen();
      runPriceFinder();
      runOrderCalculator(true);
      showToast("Backup restored");
    } catch (err) {
      showToast("That file could not be read");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

async function resetAppData() {
  if (!confirm("This will erase all custom prices, favorites and recent orders on this device. Continue?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = await buildDefaultState();
  saveState();
  populateAllDropdowns();
  renderSettingsScreen();
  runPriceFinder();
  runOrderCalculator(true);
  showToast("App data reset");
}

function renderSettingsScreen() {
  renderTagList("categories");
  renderTagList("sizes");
  renderTagList("gsm");
  renderTagList("customer");
  renderPriceListEditor();
}

/* ---------------------------------------------------------
   RECENT ORDERS + FAVORITES SHEETS
   --------------------------------------------------------- */
function wireSheets() {
  document.getElementById("openRecent").addEventListener("click", () => {
    renderRecentSheet();
    document.getElementById("recentOverlay").hidden = false;
  });
  document.getElementById("closeRecent").addEventListener("click", () => {
    document.getElementById("recentOverlay").hidden = true;
  });
  document.getElementById("recentOverlay").addEventListener("click", (e) => {
    if (e.target.id === "recentOverlay") e.target.hidden = true;
  });

  document.getElementById("openFavorites").addEventListener("click", () => {
    renderFavoritesSheet();
    document.getElementById("favoritesOverlay").hidden = false;
  });
  document.getElementById("closeFavorites").addEventListener("click", () => {
    document.getElementById("favoritesOverlay").hidden = true;
  });
  document.getElementById("favoritesOverlay").addEventListener("click", (e) => {
    if (e.target.id === "favoritesOverlay") e.target.hidden = true;
  });
}

function renderRecentSheet() {
  const list = document.getElementById("recentList");
  list.innerHTML = "";
  if (!state.recentOrders.length) {
    list.innerHTML = '<div class="sheet-empty">No saved orders yet. Save one from the Order Calculator.</div>';
    return;
  }
  state.recentOrders.forEach((o) => {
    const el = document.createElement("div");
    el.className = "recent-item";
    const date = new Date(o.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `
      <div class="recent-item-top"><span>${o.category} · ${o.size}</span><span class="recent-item-total">${o.grandTotalText}</span></div>
      <div class="recent-item-sub">${o.gsm} GSM · ${o.customerCategory} · ${o.katta} Katta · ${date}</div>`;
    el.addEventListener("click", () => {
      document.getElementById("ocCategory").value = o.category;
      document.getElementById("ocSize").value = o.size;
      document.getElementById("ocGsm").value = o.gsm;
      document.getElementById("ocCustomer").value = o.customerCategory;
      document.getElementById("ocKatta").value = o.katta;
      document.getElementById("ocPacketsPerKatta").value = o.packetsPerKatta;
      document.getElementById("ocPiecesPerPacket").value = o.piecesPerPacket;
      // Refresh price availability for the selected combo first (without
      // resetting negotiation), then restore the exact negotiated price.
      runOrderCalculator(false);
      negotiation.original = Number(o.pricePerPiece);
      negotiation.current = Number(o.pricePerPiece);
      updateOrderMath();
      document.getElementById("recentOverlay").hidden = true;
      goToScreen("screen-sales-desk");
    });
    list.appendChild(el);
  });
}

function renderFavoritesSheet() {
  const list = document.getElementById("favoritesList");
  list.innerHTML = "";
  const favs = state.priceList.filter((p) => state.favorites.includes(p.id));
  if (!favs.length) {
    list.innerHTML = '<div class="sheet-empty">No favorites yet. Star a price in Price Finder.</div>';
    return;
  }
  favs.forEach((p) => {
    const el = document.createElement("div");
    el.className = "price-list-item";
    el.innerHTML = `
      <div class="pli-info">
        <span class="pli-title">${p.category} · ${p.size}</span>
        <span class="pli-sub">${p.gsm} GSM · ${p.customerCategory}</span>
      </div>
      <span class="pli-price">${money(p.price)}</span>`;
    el.addEventListener("click", () => {
      document.getElementById("pfCategory").value = p.category;
      document.getElementById("pfSize").value = p.size;
      document.getElementById("pfGsm").value = String(p.gsm);
      document.getElementById("pfCustomer").value = p.customerCategory;
      runPriceFinder();
      document.getElementById("favoritesOverlay").hidden = true;
      goToScreen("screen-price-book");
    });
    list.appendChild(el);
  });
}
