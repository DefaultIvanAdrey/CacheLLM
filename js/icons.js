/**
 * icons.js
 * Renders icons from the real Gravity UI icon pack (github.com/gravity-ui/icons,
 * MIT, the same set listed at svgicons.com/icon-set/gravity-ui-svg-icons).
 *
 * Icons are fetched once at runtime from a CDN mirror of @gravity-ui/icons,
 * normalized to a fixed size, then cached offline by the Service Worker —
 * same pattern as the WebLLM engine/model weights. If every network
 * candidate fails, a small local fallback glyph is used instead so the UI
 * never shows a broken/empty icon.
 *
 * Sizing is enforced TWICE (CSS class + inline style set in JS) so an icon
 * can never render oversized or undersized regardless of size value used.
 */

const PACK_VERSION = "2.20.0";
const CDN_BASES = [
  `https://cdn.jsdelivr.net/npm/@gravity-ui/icons@${PACK_VERSION}/svgs`,
  `https://unpkg.com/@gravity-ui/icons@${PACK_VERSION}/svgs`,
];

const ICON_CANDIDATES = {
  plus: ["plus"],
  trash: ["trash-bin", "trash"],
  close: ["xmark"],
  download: ["arrow-down-to-line", "arrow-down-to-square"],
  upload: ["arrow-up-from-line", "arrow-up-from-square"],
  send: ["paper-plane"],
  sun: ["sun"],
  moon: ["moon"],
  laptop: ["display"],
  drag: ["bars", "dots-6-vertical", "grip-dots-vertical"],
  more: ["ellipsis"],
  refresh: ["arrow-rotate-right"],
  archive: ["archive"],
  chip: ["cpu", "microchip", "aperture"],
  check: ["check"],
  circleCheck: ["circle-check"],
  alert: ["triangle-exclamation", "circle-exclamation"],
  zoomIn: ["magnifier-plus", "magnifier"],
  stop: ["stop", "square"],
  edit: ["pencil"],
  columnAdd: ["square-plus", "plus"],
  search: ["magnifier"],
  sort: ["arrow-up-arrow-down", "bars-descending"],
  filter: ["filter", "funnel"],
  sliders: ["sliders", "sliders-vertical"],
  info: ["circle-info"],
  thermometer: ["thermometer"],
  gauge: ["gauge"],
  columns: ["layout-columns-3", "layout-columns"],
  chat: ["message", "comment"],
  gear: ["gear"],
  house: ["house"],
  menu: ["bars", "list"],
  copy: ["copy"],
  externalLink: ["arrow-up-right-from-square"],
  clock: ["clock"],
  chevronDown: ["chevron-down", "arrow-chevron-down"],
  chevronUp: ["chevron-up", "arrow-chevron-up"],
  circleInfo: ["circle-info"],
  paperclip: ["paperclip"],
  image: ["picture", "image"],
  globe: ["globe"],
  brain: ["bulb", "lightbulb"],
  database: ["database"],
  key: ["key"],
  link: ["link"],
  code: ["code"],
  file: ["file", "file-text"],
  cloudArrow: ["cloud-arrow-up-in", "cloud"],
  handle: ["dots-6-vertical", "grip-dots-vertical", "bars"],
  bolt: ["bolt", "zap"],
  eye: ["eye"],
  eyeSlash: ["eye-slash"],
  robot: ["cpu"],
  wikipedia: ["book-open", "book"],
};

const FALLBACK = {
  plus: { viewBox: "0 0 24 24", body: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  trash: { viewBox: "0 0 24 24", body: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  close: { viewBox: "0 0 24 24", body: '<path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  download: { viewBox: "0 0 24 24", body: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  upload: { viewBox: "0 0 24 24", body: '<path d="M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  send: { viewBox: "0 0 24 24", body: '<path d="m22 2-7 20-4-9-9-4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  sun: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  moon: { viewBox: "0 0 24 24", body: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  laptop: { viewBox: "0 0 24 24", body: '<rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M2 20h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  drag: { viewBox: "0 0 24 24", body: '<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>' },
  more: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>' },
  refresh: { viewBox: "0 0 24 24", body: '<path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  archive: { viewBox: "0 0 24 24", body: '<rect x="2" y="4" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  chip: { viewBox: "0 0 24 24", body: '<rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  check: { viewBox: "0 0 24 24", body: '<path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  circleCheck: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  alert: { viewBox: "0 0 24 24", body: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  zoomIn: { viewBox: "0 0 24 24", body: '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  stop: { viewBox: "0 0 24 24", body: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>' },
  edit: { viewBox: "0 0 24 24", body: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  columnAdd: { viewBox: "0 0 24 24", body: '<path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>' },
  search: { viewBox: "0 0 24 24", body: '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="m21 21-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  sort: { viewBox: "0 0 24 24", body: '<path d="M7 3v14M7 17l-3-3M7 17l3-3M17 21V7M17 7l-3 3M17 7l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  filter: { viewBox: "0 0 24 24", body: '<path d="M4 4h16l-6.5 8v6l-3 2v-8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  sliders: { viewBox: "0 0 24 24", body: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h13M21 18h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="6" r="2" fill="currentColor"/><circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/>' },
  info: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  circleInfo: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  thermometer: { viewBox: "0 0 24 24", body: '<path d="M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  gauge: { viewBox: "0 0 24 24", body: '<path d="M12 15v-3m8 3a8 8 0 1 0-16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  columns: { viewBox: "0 0 24 24", body: '<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 3v18M15 3v18" stroke="currentColor" stroke-width="2"/>' },
  chat: { viewBox: "0 0 24 24", body: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  gear: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.6" fill="none"/>' },
  house: { viewBox: "0 0 24 24", body: '<path d="m3 11 9-8 9 8M5 10v10h14V10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  menu: { viewBox: "0 0 24 24", body: '<path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  copy: { viewBox: "0 0 24 24", body: '<rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="2" fill="none"/>' },
  externalLink: { viewBox: "0 0 24 24", body: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  clock: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  chevronDown: { viewBox: "0 0 24 24", body: '<path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  chevronUp: { viewBox: "0 0 24 24", body: '<path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  paperclip: { viewBox: "0 0 24 24", body: '<path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 1 1 5 5L10.5 19a2 2 0 1 1-2.8-2.8L15.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  image: { viewBox: "0 0 24 24", body: '<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m21 15-5-5L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  globe: { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" stroke="currentColor" stroke-width="2" fill="none"/>' },
  brain: { viewBox: "0 0 24 24", body: '<path d="M9 2a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 8v1a3 3 0 0 0 0 6v1a3 3 0 0 0 2 2.8V19a3 3 0 0 0 3 3 2 2 0 0 0 2-2V5a3 3 0 0 0-3-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M15 2a3 3 0 0 1 3 3v.2A3 3 0 0 1 20 8v1a3 3 0 0 1 0 6v1a3 3 0 0 1-2 2.8V19a3 3 0 0 1-3 3 2 2 0 0 1-2-2V5a3 3 0 0 1 3-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>' },
  database: { viewBox: "0 0 24 24", body: '<ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="currentColor" stroke-width="2" fill="none"/>' },
  key: { viewBox: "0 0 24 24", body: '<circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="m10.8 12.2 8.7-8.7M16 6l2.5 2.5M19 3l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  link: { viewBox: "0 0 24 24", body: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' },
  code: { viewBox: "0 0 24 24", body: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  file: { viewBox: "0 0 24 24", body: '<path d="M6 2h9l5 5v15H6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M15 2v5h5" stroke="currentColor" stroke-width="2" fill="none"/>' },
  cloudArrow: { viewBox: "0 0 24 24", body: '<path d="M7 18a4 4 0 1 1 1-7.9A5.5 5.5 0 0 1 18.5 12 3.5 3.5 0 0 1 18 19H7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  handle: { viewBox: "0 0 24 24", body: '<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>' },
  bolt: { viewBox: "0 0 24 24", body: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>' },
  eye: { viewBox: "0 0 24 24", body: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>' },
  eyeSlash: { viewBox: "0 0 24 24", body: '<path d="M3 3l18 18M10.6 5.2A11 11 0 0 1 12 5c7 0 11 7 11 7a13.6 13.6 0 0 1-3.2 3.9M6.5 6.6A13.7 13.7 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 4.2-.9M9.9 10a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  robot: { viewBox: "0 0 24 24", body: '<rect x="4" y="8" width="16" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8V4m-3 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="14" r="1.3" fill="currentColor"/><circle cx="15" cy="14" r="1.3" fill="currentColor"/>' },
  wikipedia: { viewBox: "0 0 24 24", body: '<path d="M4 4h6v2H8l4 12 3-9-1-3h-1V4h6v2h-1l-5 14h-2L7 8 5 6H4Z" stroke="currentColor" stroke-width="0.6" fill="currentColor"/>' },
};

const resolvedCache = new Map();
const pendingNodes = new Map();

function parseSvgText(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") return null;
  const viewBox = svg.getAttribute("viewBox") || "0 0 24 24";
  return { viewBox, body: svg.innerHTML };
}

async function fetchCandidate(fileName) {
  for (const base of CDN_BASES) {
    try {
      const res = await fetch(`${base}/${fileName}.svg`, { mode: "cors" });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseSvgText(text);
      if (parsed) return parsed;
    } catch {
      /* try next base */
    }
  }
  return null;
}

async function resolveIcon(name) {
  if (resolvedCache.has(name)) return resolvedCache.get(name);
  const promise = (async () => {
    const candidates = ICON_CANDIDATES[name] || [];
    for (const fileName of candidates) {
      const result = await fetchCandidate(fileName);
      if (result) return result;
    }
    return FALLBACK[name] || FALLBACK.circleInfo;
  })();
  resolvedCache.set(name, promise);
  const result = await promise;
  hydrateWaiters(name, result);
  return result;
}

function buildSvgMarkup({ viewBox, body }) {
  return `<svg viewBox="${viewBox}" width="100%" height="100%" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function hydrateWaiters(name, result) {
  const nodes = pendingNodes.get(name);
  if (!nodes) return;
  for (const node of nodes) {
    if (node.isConnected) node.innerHTML = buildSvgMarkup(result);
  }
  pendingNodes.delete(name);
}

function enforceSize(el, size) {
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

export function icon(name, opts = {}) {
  const size = opts.size || 18;
  const span = document.createElement("span");
  span.className = `icon-box icon-${size}${opts.className ? " " + opts.className : ""}`;
  enforceSize(span, size);
  span.setAttribute("aria-hidden", "true");
  span.dataset.iconName = name;

  if (resolvedCache.has(name)) {
    resolvedCache.get(name).then((result) => {
      span.innerHTML = buildSvgMarkup(result);
    });
  } else {
    span.innerHTML = buildSvgMarkup(FALLBACK[name] || FALLBACK.circleInfo);
    if (!pendingNodes.has(name)) pendingNodes.set(name, []);
    pendingNodes.get(name).push(span);
    resolveIcon(name);
  }
  return span;
}

export function iconPlaceholder(name, opts = {}) {
  const size = opts.size || 18;
  return `<span class="icon-box icon-${size}${opts.className ? " " + opts.className : ""}" style="width:${size}px;height:${size}px" data-icon="${name}" aria-hidden="true"></span>`;
}

export function mountIcons(root = document) {
  const nodes = root.querySelectorAll("[data-icon]");
  nodes.forEach((node) => {
    const name = node.dataset.icon;
    node.dataset.iconName = name;
    delete node.dataset.icon;
    if (!node.style.width) {
      const sizeClass = [...node.classList].find((c) => /^icon-\d+$/.test(c));
      const px = sizeClass ? sizeClass.split("-")[1] : "18";
      enforceSize(node, px);
    }
    if (resolvedCache.has(name)) {
      resolvedCache.get(name).then((result) => {
        node.innerHTML = buildSvgMarkup(result);
      });
    } else {
      node.innerHTML = buildSvgMarkup(FALLBACK[name] || FALLBACK.circleInfo);
      if (!pendingNodes.has(name)) pendingNodes.set(name, []);
      pendingNodes.get(name).push(node);
      resolveIcon(name);
    }
  });
}

export function preloadAllIcons() {
  Object.keys(ICON_CANDIDATES).forEach((name) => resolveIcon(name));
}
