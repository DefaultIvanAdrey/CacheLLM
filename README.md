# Memory — On-Device AI Kanban (WebLLM PWA)

A mobile-native, installable, **offline-capable** Progressive Web App that runs an LLM
**entirely inside the browser** via [WebLLM](https://webllm.mlc.ai/) (WebGPU) — no server,
no API key, nothing ever leaves the device. It ships with a GitBook-styled UI, a Kanban
"memory" board whose cards support spreadsheet-style formulas and cross-references, and
a device-aware model recommender.

## Features

- **Chat** — pick a model, load it (cached after first download), stream responses.
- **Memory Board** — a Kanban board that *is* the model's context/system memory.
  - Add/rename/delete columns, drag cards between and within columns (works with touch, not just mouse).
  - Each card's text field can reference other cards and compute values, like a mini spreadsheet.
  - Any column can be toggled "Feed into assistant context" — its cards are compiled into the system prompt automatically.
  - **Import / Export** the whole board as a `.json` file at any time.
- **Device-aware model recommendation** — Settings detects WebGPU support, device RAM
  (where the browser reports it), CPU cores, and mobile-vs-desktop, then pulls WebLLM's
  live model registry and recommends the largest model that should comfortably fit.
- **Light / dark / system theme**, GitBook-inspired visual language (warm neutrals, flame-orange accent, pill buttons, hairline borders).
- **Installable PWA** — Add to Home Screen on iOS/Android, or install from the browser on desktop. Runs full-screen, no browser chrome.
- **Offline after first use** — the app shell, the WebLLM library, and downloaded model weights are all cached by a service worker / the browser's own storage, so subsequent launches work without a network connection.

## Running it

Because it uses ES modules, a Service Worker, and (optionally) WebGPU, it must be served
over **HTTP(S)** — opening `index.html` directly via `file://` will not work.

**Quickest (local testing):**
```bash
cd webllm-pwa
python3 -m http.server 8080
# open http://localhost:8080 in Chrome/Edge (Android/desktop) or Safari 26+ (iOS/macOS)
```

**Deploying for real mobile use** (any static host works — the app is 100% static files):
- GitHub Pages, Netlify, Vercel, Cloudflare Pages, or your own server with HTTPS.
- Just upload the whole folder as-is; no build step required.

**Installing on your phone:**
- **Android (Chrome):** open the site → menu → "Install app" / "Add to Home screen".
- **iOS (Safari 26+):** open the site → Share icon → "Add to Home Screen".
- Once installed, launch it like any other app — it opens full-screen and works offline after the first successful load.

## The formula engine (Kanban card references)

Every card's content field is plain text by default. Two ways to make it dynamic:

1. **Inline reference**, anywhere in the text:
   ```
   Hello {{Assistant Name}}, today is {{Today Card}}.
   ```
2. **Full formula** — start the field with `=`:
   ```
   =CONCAT("Hello, ", {{Name}}, "! You are ", {{Age}}, " years old.")
   =IF({{Age}} > 18, "adult", "minor")
   =SUM(CARDS_IN("Budget"))
   ```

References resolve by **card title** (case-insensitive) or by internal card id. Circular
references are detected and shown as `#REF!-CIRCULAR(...)` instead of crashing.

Supported functions: `CONCAT`, `JOIN(sep, ...)`, `UPPER`, `LOWER`, `TRIM`, `LEN`, `IF`,
`AND`, `OR`, `NOT`, `SUM`, `AVG`, `MIN`, `MAX`, `ROUND(n, decimals)`, `TODAY()`, `NOW()`,
`CARD(id)` / `REF(id)`, `CARDS_IN(column)`, `COUNT_IN(column)`. Operators: `+ - * /` (math),
`&` (string concat), `== != < > <= >=` (comparisons), parentheses for grouping.

The card editor shows a **live preview** of the evaluated result as you type.

## How model recommendation works (and its honest limits)

Browsers deliberately **do not** expose real GPU VRAM, for privacy/fingerprinting reasons.
The recommender combines the signals that *are* available:
- WebGPU adapter presence and its reported buffer limits (a rough proxy for GPU class),
- `navigator.deviceMemory` — only reported by Chrome/Android, in coarse GB buckets, and it's *RAM*, not VRAM,
- CPU core count,
- whether the device is mobile (mobile browsers impose much stricter per-tab GPU memory budgets than desktop, even on high-RAM phones).

From that it estimates a conservative "safe VRAM budget" and picks the largest model from
WebLLM's **live** `prebuiltAppConfig.model_list` that fits — e.g. a `Qwen2.5-0.5B`/`SmolLM2-360M`
class model on an older/low-RAM phone, up to `Llama-3.2-3B` or `Phi-3.5-mini` on a strong phone,
and `Llama-3.1-8B`-class models on a capable desktop GPU. This is a **heuristic, not a guarantee**
— you can always override it and pick any model manually from the Chat dropdown.

## Browser / device requirements

WebLLM requires **WebGPU** — there is no CPU fallback. As of 2026:
- **Desktop:** Chrome/Edge 113+, Firefox 141+ (Windows; macOS support newer), Safari 26+ (macOS Tahoe).
- **Mobile:** Chrome on Android (devices with Vulkan support, i.e. most phones since ~2018), Safari on iOS/iPadOS 26+.
- If `navigator.gpu` is unavailable, the app tells you plainly in Settings and Chat rather than failing silently.

## Offline behavior, in detail

- First visit **requires internet** to: fetch the app shell, fetch the WebLLM JS library
  from a CDN, and download your chosen model's weights (can be several hundred MB to a
  few GB depending on the model).
- After that, the service worker has cached the app shell + library, and the browser's
  Cache Storage holds the model weights — subsequent launches (including fully offline)
  reuse all of it.
- Settings → "Persistent storage" asks the browser not to evict this cache under storage
  pressure. "Clear cached model & app data" wipes it if you need space back.

## File structure

```
webllm-pwa/
├─ index.html            # App shell (topbar, sidebar, mobile tab bar, SPA router mount point)
├─ manifest.webmanifest   # PWA metadata + icons
├─ sw.js                  # Service worker: app-shell precache + runtime cache for CDN/model files
├─ offline.html           # Fallback shown if a page is requested offline before first cache
├─ css/styles.css         # GitBook-inspired design tokens + full component styles (light/dark)
├─ icons/                 # App icons (regular + maskable, multiple sizes)
└─ js/
   ├─ app.js              # Router, chat view, settings view, wiring
   ├─ theme.js            # Light/dark/system theme switching
   ├─ storage.js           # IndexedDB persistence + JSON import/export
   ├─ formula.js           # The Kanban card formula/reference engine
   ├─ kanban.js            # Kanban board rendering, card editor, touch drag & drop
   ├─ device.js            # WebGPU/device detection + model recommendation
   ├─ llm.js               # WebLLM engine wrapper (load/stream chat completions)
   └─ icons.js             # Inline SVG icon set (kept local so it works fully offline)
```

## Notes / possible next steps

- Multi-model comparison chat (load two models, compare answers side by side).
- Per-card "pin to top of context" ordering control.
- Export the Kanban board as Markdown in addition to JSON.
- Web Worker offloading for the LLM engine (keeps the UI thread perfectly smooth during generation on lower-end devices).
