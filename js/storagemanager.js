/**
 * storagemanager.js
 * Real (not guessed) storage usage accounting for the "Storage management"
 * settings panel:
 *  - Overall usage/quota via the Storage API (navigator.storage.estimate()).
 *  - A byte-accurate breakdown of everything sitting in Cache Storage
 *    (the WebLLM engine library, downloaded model weights/tokenizer files,
 *    Gravity UI icon SVGs, and the app shell itself), computed by actually
 *    reading each cached response's blob size.
 *  - Targeted clear actions per bucket, plus a full-nuke option.
 */

function bucketFor(url) {
  if (/mlc-ai\/web-llm|esm\.run\/@mlc-ai|jsdelivr\.net\/npm\/@mlc-ai|unpkg\.com\/@mlc-ai/.test(url)) return "webllmLibrary";
  if (/huggingface\.co|mlc-ai\/.*\.(bin|wasm|json)|resolve\/main|\.wasm$|tokenizer/.test(url)) return "modelWeights";
  if (/@gravity-ui\/icons/.test(url)) return "icons";
  if (/pdfjs-dist|mammoth|highlight\.js|cdnjs.*highlight/.test(url)) return "documentTools";
  if (/\/(index\.html|manifest\.webmanifest|css\/|js\/|icons\/icon|offline\.html)/.test(url) || url.endsWith("/")) return "appShell";
  return "other";
}

export const BUCKET_LABELS = {
  modelWeights: "Downloaded AI models",
  webllmLibrary: "WebLLM engine library",
  icons: "Gravity UI icons",
  documentTools: "Document tools (PDF/Word readers)",
  appShell: "App shell (HTML/CSS/JS)",
  other: "Other cached files",
};

export async function getCacheBreakdown() {
  const buckets = Object.fromEntries(Object.keys(BUCKET_LABELS).map((k) => [k, { bytes: 0, count: 0, entries: [] }]));
  if (!("caches" in window)) return buckets;

  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const req of requests) {
      try {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.clone().blob();
        const bucket = bucketFor(req.url);
        buckets[bucket].bytes += blob.size;
        buckets[bucket].count += 1;
        buckets[bucket].entries.push({ url: req.url, bytes: blob.size, cacheName });
      } catch {
        /* unreadable entry, skip */
      }
    }
  }
  return buckets;
}

export async function getStorageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return { usage: null, quota: null };
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota };
}

export async function clearBucket(bucketKey) {
  const cacheNames = await caches.keys();
  let deleted = 0;
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const req of requests) {
      if (bucketFor(req.url) === bucketKey) {
        await cache.delete(req);
        deleted++;
      }
    }
  }
  return deleted;
}

export async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}
