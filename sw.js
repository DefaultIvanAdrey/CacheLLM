/**
 * sw.js — service worker
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons/manifest): precached on install, served
 *    cache-first so the UI opens instantly and fully offline after first
 *    visit.
 *  - Everything else (the WebLLM library fetched from esm.run, and model
 *    weight/wasm files fetched from Hugging Face CDNs by WebLLM itself):
 *    runtime-cached with a "cache, falling back to network, then cache the
 *    response" strategy. This is what makes the *model* usable offline
 *    after the first successful download — WebLLM's own IndexedDB/Cache
 *    bookkeeping still applies on top of this.
 *
 * Model weights are large; the browser's own storage-eviction rules apply.
 * The app requests `navigator.storage.persist()` on first launch to reduce
 * the chance of eviction, and Settings exposes a manual "clear cache"
 * action.
 */

const VERSION = "v1";
const SHELL_CACHE = `memory-shell-${VERSION}`;
const RUNTIME_CACHE = `memory-runtime-${VERSION}`;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/theme.js",
  "./js/storage.js",
  "./js/formula.js",
  "./js/kanban.js",
  "./js/device.js",
  "./js/llm.js",
  "./js/icons.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
  "./offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // let POST/etc pass through untouched

  const url = new URL(req.url);

  // Navigations: network-first so updates are picked up when online, with
  // offline fallback to the cached shell (SPA => always index.html).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./offline.html")))
    );
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isShellAsset = isSameOrigin && SHELL_URLS.some((u) => url.pathname.endsWith(u.replace("./", "/")));

  if (isShellAsset) {
    // Cache-first for the app shell.
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // Everything else (WebLLM library chunks, model shards, wasm, tokenizer
  // files, etc. — same-origin or cross-origin): cache-first, then network,
  // caching the result for next time (and for offline use).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Only cache successful (or opaque cross-origin) responses.
          if (res && (res.ok || res.type === "opaque")) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // No cache, no network — nothing we can do for this sub-resource.
          return new Response("", { status: 504, statusText: "Offline and not cached" });
        });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
