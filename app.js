/**
 * Departure board app.
 *
 * Button mode: departures are fetched once when the app opens and again when "Next departures" is pressed.
 * Between fetches, nothing is requested; the countdown and the clock are updated locally.
 * All API data is inserted with textContent, never as HTML.
 */
import { CONFIG } from "./config.js";

const CUSTOM = "__custom";
const STATE_KEY = "departures.state.v1";
const CACHE_KEY = "departures.cache.v1";
/** Extra departures fetched per station so the board stays full while the first ones leave. */
const SPARE_ROWS = 6;
/** A departure stays on the board this long after its expected time (milliseconds). */
const GRACE_MS = 30_000;
/** Reopening the app after this long in the background counts as "opening" and fetches again. */
const STALE_MS = 60_000;

/** Category codes from the API mapped to pictograms. Unknown codes get a neutral circle. */
const ICONS = {
  tram: ["T", "TRAM", "NFT"],
  bus: ["B", "BUS", "NFB", "KB", "EXB", "BN", "BP", "EV", "TX"],
  boat: ["BAT", "FAE", "BAV"],
  funicular: ["FUN", "CC"],
  cablecar: ["PB", "GB", "SL", "LB"],
  train: ["S", "SN", "IC", "IR", "IRE", "RE", "R", "EC", "EN", "ICE", "TGV", "RJX", "NJ", "PE", "M", "EXT"],
};

/** Train-like categories whose line label includes the category, e.g. "S12", "IR13". */
const PREFIXED = new Set(["S", "SN", "IC", "IR", "IRE", "RE", "R", "EC", "EN", "ICE", "TGV", "RJX", "NJ", "PE"]);

const $ = (id) => document.getElementById(id);
const el = {
  clock: $("clock"),
  subtitle: $("subtitle"),
  rows: $("rows"),
  message: $("message"),
  refresh: $("refresh"),
  status: $("status"),
  preset: $("preset"),
  chips: $("chips"),
  search: $("search"),
  suggestions: $("suggestions"),
};

let state = loadState();
/** Merged, sorted departures of all selected stations. */
let departures = [];
/** Time of the last successful fetch (ms since epoch), or null. */
let lastUpdated = null;
let loading = false;
/** Set when a forced refresh arrives during a running one. */
let rerun = false;
let cooldownUntil = 0;
let cooldownTimer = 0;

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read a JSON value from localStorage.
 * @param {string} key
 * @returns {any|null} The parsed value, or null if missing, unreadable or storage is blocked.
 */
function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Write a JSON value to localStorage. Failures (private mode, full storage) are ignored on purpose.
 * @param {string} key
 * @param {any} value
 */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The app works without storage; settings just won't be remembered. */
  }
}

/**
 * Load the saved station selection, falling back to the first preset.
 * @returns {{list: string, custom: {id: string, name: string}[]}} `list` is a preset name or CUSTOM.
 */
function loadState() {
  const saved = readStorage(STATE_KEY);
  const custom = Array.isArray(saved?.custom) ? saved.custom.filter((s) => s && s.id) : [];
  const known = saved?.list === CUSTOM || CONFIG.presets.some((p) => p.name === saved?.list);
  return { list: known ? saved.list : CONFIG.presets[0]?.name ?? CUSTOM, custom };
}

/** Persist the current station selection. */
function saveState() {
  writeStorage(STATE_KEY, state);
}

/**
 * The stations currently shown on the board.
 * @returns {{id: string, name: string}[]}
 */
function currentStations() {
  if (state.list === CUSTOM) return state.custom;
  return CONFIG.presets.find((p) => p.name === state.list)?.stations ?? [];
}

/** Cache key part identifying the station set, so a cached board is only reused for the same stations. */
function stationKey() {
  return currentStations().map((s) => s.id).join(",");
}

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */

/**
 * Fetch upcoming departures for one station from transport.opendata.ch.
 * Only the fields needed are requested, which keeps answers small (also useful for a microcontroller later).
 * @param {{id: string, name: string}} station
 * @returns {Promise<object[]>} Normalised departures, see normalise().
 */
async function fetchStation(station) {
  const params = new URLSearchParams({ id: station.id, limit: String(CONFIG.rows + SPARE_ROWS) });
  const fields = [
    "station/name",
    "stationboard/category",
    "stationboard/number",
    "stationboard/to",
    "stationboard/stop/departure",
    "stationboard/stop/delay",
    "stationboard/stop/platform",
    "stationboard/stop/prognosis/departure",
  ];
  for (const f of fields) params.append("fields[]", f);

  const res = await fetch(`${CONFIG.apiBase}/stationboard?${params}`, { cache: "no-store", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const stationName = data?.station?.name || station.name;
  return (data?.stationboard ?? []).map((e) => normalise(e, station.id, stationName)).filter(Boolean);
}

/**
 * Turn one raw stationboard entry into the flat shape the board renders.
 * @param {object} entry Raw API entry.
 * @param {string} stationId
 * @param {string} stationName
 * @returns {object|null} null if the entry has no usable departure time.
 */
function normalise(entry, stationId, stationName) {
  const planned = Date.parse(entry?.stop?.departure);
  if (Number.isNaN(planned)) return null;
  // The prognosis is the real-time estimate; fall back to the timetable when there is none.
  const predicted = Date.parse(entry?.stop?.prognosis?.departure);
  const when = Number.isNaN(predicted) ? planned : predicted;
  const delay = Number.isFinite(entry?.stop?.delay) ? entry.stop.delay : Math.round((when - planned) / 60_000);
  const category = String(entry.category ?? "").toUpperCase();

  return {
    stationId,
    stationName,
    category,
    label: lineLabel(category, entry.number),
    to: stripPrefix(String(entry.to ?? "")),
    platform: entry?.stop?.platform ?? "",
    planned,
    when,
    delay,
  };
}

/**
 * Build the line label shown in the badge.
 * Trams and buses show just their number ("4"); trains show category and number ("S12", "IR13").
 * Long numbers are train run numbers (e.g. "002390"), not line numbers, so only the category is shown.
 * @param {string} category
 * @param {string|null} number
 * @returns {string}
 */
function lineLabel(category, number) {
  const n = String(number ?? "").trim();
  if (!n || n.length > 3) return category || "?";
  return PREFIXED.has(category) ? `${category}${n}` : n;
}

/**
 * Remove a configured locality prefix, e.g. "Zürich, Hirzenbach" -> "Hirzenbach".
 * @param {string} name
 * @returns {string}
 */
function stripPrefix(name) {
  const prefix = CONFIG.stripPrefixes.find((p) => name.startsWith(p) && name.length > p.length);
  return prefix ? name.slice(prefix.length) : name;
}

/**
 * Search stations by name for the "Add a stop" field.
 * @param {string} query
 * @param {AbortSignal} signal Lets a newer keystroke cancel an older request.
 * @returns {Promise<{id: string, name: string}[]>}
 */
async function searchStations(query, signal) {
  const params = new URLSearchParams({ query, type: "station" });
  const res = await fetch(`${CONFIG.apiBase}/locations?${params}`, { signal, referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data?.stations ?? []).filter((s) => s.id && s.name).slice(0, 8).map((s) => ({ id: String(s.id), name: s.name }));
}

/* ------------------------------------------------------------------ */
/* Refresh (the "Next departures" button)                             */
/* ------------------------------------------------------------------ */

/**
 * Fetch all selected stations in parallel and merge them into one board.
 * Respects the cooldown unless `force` is set (used when the station list itself changes).
 * @param {{force?: boolean}} [options]
 */
async function refresh({ force = false } = {}) {
  if (loading) {
    // The station list changed mid-request: fetch again as soon as the current request is done.
    if (force) rerun = true;
    return;
  }
  if (!force && Date.now() < cooldownUntil) return;
  const stations = currentStations();
  if (stations.length === 0) {
    departures = [];
    render();
    setStatus("No stations selected. Add one under Stations.");
    return;
  }

  loading = true;
  startCooldown();
  setStatus("Loading…");
  const key = stationKey();
  const results = await Promise.allSettled(stations.map(fetchStation));
  loading = false;

  if (rerun) {
    rerun = false;
    refresh({ force: true });
    return;
  }
  // The selection may have changed while we were waiting (e.g. a station removed); then this result is outdated.
  if (key !== stationKey()) {
    render();
    setStatus(lastUpdated ? `Updated ${formatTime(lastUpdated, true)}` : "");
    return;
  }

  const ok = results.filter((r) => r.status === "fulfilled");
  if (ok.length === 0) {
    const since = lastUpdated ? ` Showing data from ${formatTime(lastUpdated, true)}.` : "";
    setStatus(`Could not reach the timetable service.${since}`, true);
    render();
    return;
  }

  departures = ok.flatMap((r) => r.value).sort((a, b) => a.when - b.when || a.planned - b.planned);
  lastUpdated = Date.now();
  writeStorage(CACHE_KEY, { key, lastUpdated, departures });

  const failed = results.length - ok.length;
  setStatus(`Updated ${formatTime(lastUpdated, true)}` + (failed ? ` · ${failed} station(s) failed` : ""), failed > 0);
  render();
}

/** Disable the button for the configured cooldown, so the free API isn't hammered. */
function startCooldown() {
  cooldownUntil = Date.now() + CONFIG.cooldownSeconds * 1000;
  el.refresh.disabled = true;
  clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    el.refresh.disabled = false;
  }, CONFIG.cooldownSeconds * 1000);
}

/**
 * Show a line of status text under the button.
 * @param {string} text
 * @param {boolean} [isError]
 */
function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

/**
 * Format a timestamp as local HH:MM (or HH:MM:SS).
 * @param {number} ms
 * @param {boolean} [seconds]
 * @returns {string}
 */
function formatTime(ms, seconds = false) {
  const opts = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (seconds) opts.second = "2-digit";
  return new Date(ms).toLocaleTimeString("de-CH", opts);
}

/**
 * Pick black or white text for a coloured badge, using the relative luminance of the background (WCAG formula).
 * @param {string} hex Colour like "#18286B".
 * @returns {string}
 */
function contrastText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Create an <svg><use></svg> pictogram for a vehicle category.
 * @param {string} category
 * @returns {SVGSVGElement}
 */
function iconFor(category) {
  const name = Object.keys(ICONS).find((k) => ICONS[k].includes(category)) ?? "other";
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", name);
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * Create an element with a class and text content.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build one board row.
 * @param {object} d Normalised departure.
 * @param {number} now
 * @param {boolean} showStation Whether to show which station it leaves from (only useful with several stations).
 * @returns {HTMLLIElement}
 */
function renderRow(d, now, showStation) {
  const li = make("li", "row");

  const badge = make("span", "badge", d.label);
  const color = CONFIG.lineColors[d.label];
  if (color) {
    const bg = typeof color === "string" ? color : color.bg;
    const fg = typeof color === "string" ? contrastText(color) : color.fg ?? contrastText(color.bg);
    badge.classList.add("colored");
    // Setting style through the DOM is allowed by the page's Content Security Policy.
    badge.style.setProperty("--line-bg", bg);
    badge.style.setProperty("--line-fg", fg);
  }

  const dest = make("span", "dest");
  dest.append(make("div", "dest-name", d.to));
  const from = [showStation ? stripPrefix(d.stationName) : "", d.platform ? `Pl. ${d.platform}` : ""].filter(Boolean).join(" · ");
  if (from) dest.append(make("div", "dest-from", from));

  const time = make("span", "time", formatTime(d.planned));
  if (d.delay > 0) time.append(make("span", "delay", `+${d.delay}'`));

  const minutes = Math.max(0, Math.floor((d.when - now) / 60_000));
  const inCell = make("span", minutes === 0 ? "in now" : "in", `${minutes}'`);

  li.append(iconFor(d.category), badge, dest, time, inCell);
  return li;
}

/** Redraw the board from the departures in memory, dropping those that have left. */
function render() {
  const now = Date.now();
  const stations = currentStations();
  const visible = departures.filter((d) => d.when > now - GRACE_MS).slice(0, CONFIG.rows);

  el.rows.replaceChildren(...visible.map((d) => renderRow(d, now, stations.length > 1)));

  let message = "";
  if (stations.length === 0) message = "No stations selected.";
  else if (visible.length === 0 && lastUpdated) message = "No departures in memory. Press the button for new ones.";
  else if (visible.length === 0) message = "Press the button to load departures.";
  el.message.textContent = message;
  el.message.hidden = !message;
}

/** Update the clock and the countdown. Runs every few seconds; makes no network requests. */
function tick() {
  el.clock.textContent = formatTime(Date.now());
  render();
}

/* ------------------------------------------------------------------ */
/* Station settings                                                   */
/* ------------------------------------------------------------------ */

/** Redraw the list selector, the station chips and the subtitle. */
function renderSettings() {
  const options = CONFIG.presets.map((p) => new Option(p.name, p.name));
  options.push(new Option("My stations", CUSTOM));
  el.preset.replaceChildren(...options);
  el.preset.value = state.list;

  const stations = currentStations();
  el.chips.replaceChildren(
    ...stations.map((s) => {
      const li = make("li", "chip", s.name);
      const remove = make("button", "", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${s.name}`);
      remove.addEventListener("click", () => removeStation(s.id));
      li.append(remove);
      return li;
    }),
  );
  el.subtitle.textContent = stations.map((s) => stripPrefix(s.name)).join(" · ");
}

/**
 * Editing a preset turns it into "My stations", so presets in config.js always stay as written.
 */
function switchToCustom() {
  if (state.list !== CUSTOM) {
    state.custom = currentStations().map((s) => ({ ...s }));
    state.list = CUSTOM;
  }
}

/**
 * Add a station to the board and fetch immediately.
 * @param {{id: string, name: string}} station
 */
function addStation(station) {
  if (currentStations().some((s) => s.id === station.id)) return;
  switchToCustom();
  state.custom.push(station);
  saveState();
  renderSettings();
  refresh({ force: true });
}

/**
 * Remove a station. Its departures are dropped locally, no new request is needed.
 * @param {string} id
 */
function removeStation(id) {
  switchToCustom();
  state.custom = state.custom.filter((s) => s.id !== id);
  departures = departures.filter((d) => d.stationId !== id);
  saveState();
  renderSettings();
  render();
}

/** Switch to another preset (or to "My stations") and fetch it. */
function onPresetChange() {
  state.list = el.preset.value;
  saveState();
  departures = [];
  lastUpdated = null;
  renderSettings();
  render();
  refresh({ force: true });
}

/* ------------------------------------------------------------------ */
/* Stop search with suggestions                                       */
/* ------------------------------------------------------------------ */

let searchTimer = 0;
let searchAbort = null;
let suggestions = [];
let activeIndex = -1;

/** Debounce typing so the API is only asked once the user pauses. */
function onSearchInput() {
  clearTimeout(searchTimer);
  const query = el.search.value.trim();
  if (query.length < 2) {
    showSuggestions([]);
    return;
  }
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      showSuggestions(await searchStations(query, searchAbort.signal));
    } catch (err) {
      if (err.name !== "AbortError") showSuggestions([]);
    }
  }, 300);
}

/**
 * Show the suggestion list under the search field.
 * @param {{id: string, name: string}[]} list
 */
function showSuggestions(list) {
  suggestions = list;
  activeIndex = -1;
  el.suggestions.replaceChildren(
    ...list.map((s, i) => {
      const li = make("li", "", s.name);
      li.setAttribute("role", "option");
      li.id = `suggestion-${i}`;
      // mousedown fires before the input loses focus, so the click is not lost.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggestion(i);
      });
      return li;
    }),
  );
  el.suggestions.hidden = list.length === 0;
}

/**
 * Add the chosen suggestion and reset the search field.
 * @param {number} index
 */
function pickSuggestion(index) {
  const station = suggestions[index];
  if (!station) return;
  el.search.value = "";
  showSuggestions([]);
  addStation(station);
}

/**
 * Keyboard navigation in the suggestion list: arrows move, Enter picks, Escape closes.
 * @param {KeyboardEvent} e
 */
function onSearchKey(e) {
  if (el.suggestions.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    activeIndex = (activeIndex + step + suggestions.length) % suggestions.length;
    [...el.suggestions.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === activeIndex)));
  } else if (e.key === "Enter") {
    e.preventDefault();
    pickSuggestion(activeIndex >= 0 ? activeIndex : 0);
  } else if (e.key === "Escape") {
    showSuggestions([]);
  }
}

/* ------------------------------------------------------------------ */
/* Start-up                                                           */
/* ------------------------------------------------------------------ */

/** Wire up events, show cached data instantly, then fetch fresh departures once. */
function init() {
  el.refresh.addEventListener("click", () => refresh());
  el.preset.addEventListener("change", onPresetChange);
  el.search.addEventListener("input", onSearchInput);
  el.search.addEventListener("keydown", onSearchKey);
  el.search.addEventListener("blur", () => showSuggestions([]));

  // Reopening the app from the background counts as "opening it" if the data is old.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!lastUpdated || Date.now() - lastUpdated > STALE_MS)) refresh();
  });

  // Show the last board immediately (also works offline), as long as it is for the same stations.
  const cache = readStorage(CACHE_KEY);
  if (cache?.key === stationKey() && Array.isArray(cache.departures)) {
    departures = cache.departures;
    lastUpdated = cache.lastUpdated;
    setStatus(`Last updated ${formatTime(lastUpdated, true)}`);
  }

  renderSettings();
  tick();
  setInterval(tick, 5_000);
  refresh({ force: true });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* Without the service worker the app still works, just not offline. */
    });
  }
}

init();
