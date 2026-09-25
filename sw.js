/**
 * sw.js — service worker
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons/manifest): precached on install, served
 *    cache-first so the UI opens instantly and fully offline after first
 *    visit.
 *  - Everything else — WebLLM engine library, downloaded model weights,
 *    Gravity UI icon SVGs, and on-demand document tools (pdf.js, mammoth,
 *    highlight.js) — is runtime-cached cache-first-then-network, so it all
 *    keeps working offline after first successful use.
 *  - Remote AI provider calls (Gemini/OpenAI-compatible endpoints) are
 *    intentionally NOT cached — they're live conversations, not static
 *    assets, and go straight to the network like any POST request already
 *    does (the fetch handler below only touches GET requests).
 */

const VERSION = "v3";
const SHELL_CACHE = `memory-shell-${VERSION}`;
const RUNTIME_CACHE = `memory-runtime-${VERSION}`;

const SHELL_URLS = [
  "./", "./index.html", "./manifest.webmanifest", "./css/styles.css",
  "./js/app.js", "./js/theme.js", "./js/storage.js", "./js/formula.js",
  "./js/kanban.js", "./js/device.js", "./js/llm.js", "./js/icons.js",
  "./js/modelpicker.js", "./js/modelutils.js", "./js/markdown.js",
  "./js/providers.js", "./js/attachments.js", "./js/webtool.js",
  "./js/storagemanager.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-192.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/favicon-16.png",
  "./offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // remote AI provider POSTs pass straight through, uncached

  const url = new URL(req.url);

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
    event.respondWith(
      caches.match(req).then(
        (cached) => cached || fetch(req).then((res) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // Everything else (WebLLM library/model files, Gravity UI icons, pdf.js/
  // mammoth/highlight.js) — cache-first, then network, caching the result.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => new Response("", { status: 504, statusText: "Offline and not cached" }));
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
