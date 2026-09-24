# Memory — On-Device AI Kanban (WebLLM PWA)

A mobile-native, installable, **offline-capable** Progressive Web App that runs an LLM
**entirely inside the browser** via [WebLLM](https://webllm.mlc.ai/) (WebGPU) — no server,
no API key, nothing ever leaves the device. It uses the **Gravity UI** icon pack, a
GitBook-styled UI, a Kanban "memory" board with formula-capable cards, a searchable/
sortable model catalog, and a device-aware model recommender.

## What's new in this revision

- **Gravity UI icons everywhere** — every icon in the app (nav, buttons, badges, modals)
  now comes from the real [Gravity UI icon pack](https://github.com/gravity-ui/icons)
  (MIT, by Yandex; the same set listed on svgicons.com), not custom hand-drawn icons.
- **Searchable, sortable, filterable model picker** replaces the old plain dropdown —
  free-text search, sort by name/size/recommended, filter by model family or "fits my
  device", live result count.
- **Richer, friendlier Generation settings** — a Beginner/Advanced mode toggle, three
  one-click style presets (Precise / Balanced / Creative) with plain-language
  descriptions, per-control "ⓘ" explanations, a beginner-friendly response-length
  picker, and a 30-second guide for anyone new to temperature/top-p/penalties.
- **Draggable columns** in the Memory Board — reorder whole columns with a dedicated
  grip handle, in addition to the existing card drag-and-drop.
- **Guaranteed icon sizing** — icons are rendered into a fixed pixel box enforced both
  by CSS *and* an inline-style safety net, so nothing can render oversized or
  undersized regardless of the source SVG's native dimensions.

## How the Gravity UI icons actually load (and stay offline-safe)

Because this is a strictly offline-first PWA, the ~800-icon Gravity UI pack is **not**
bundled as one huge local file. Instead, exactly like the WebLLM engine library and
model weights, each icon's real SVG is fetched **once** from a public CDN mirror of the
`@gravity-ui/icons` npm package (jsDelivr, with an unpkg fallback), normalized to a
consistent size, and then the Service Worker's runtime cache keeps it available forever
— including fully offline.

Robustness built in:
- Each icon slot tries a couple of plausible real file names (e.g. `trash-bin` then
  `trash`) in case of a naming mismatch.
- Two CDNs are tried per candidate.
- If every attempt fails (e.g. completely offline on a brand-new install before
  anything has been cached), a small hand-drawn fallback glyph is shown instead so the
  UI never breaks or shows an empty box — it's simply upgraded to the real Gravity UI
  icon the instant a connection is available.
- Every icon renders inside a fixed-size box (`.icon-box.icon-<px>` + an inline
  `width`/`height` style set directly in JS), so sizing is 100% consistent no matter
  the source icon's native viewBox — verified in automated testing across every icon
  in the app.

## Features

- **Chat** — a searchable model picker (see below), streamed responses, stop button.
- **Memory Board** — a Kanban board that *is* the model's context/system memory.
  - Add/rename/delete/**reorder** columns (drag the grip handle in the column header),
    and drag cards between/within columns — both work with touch, not just mouse.
  - Each card's text field can reference other cards and compute values, like a mini
    spreadsheet (see Formula engine below).
  - Any column can be toggled "Feed into assistant context" — its cards are compiled
    into the system prompt automatically.
  - **Import/export** the whole board as a `.json` file at any time.
- **Model picker** — search by name/family/size, sort (recommended / name / size),
  filter by family chip or "fits my device", with per-row size/family/quant badges and
  a fit/tight-fit indicator.
- **Device-aware model recommendation** — detects WebGPU support, device RAM (where
  reported), CPU cores, and mobile-vs-desktop, then reads WebLLM's live model registry
  and recommends the largest model that should comfortably fit.
- **Generation controls for every skill level**:
  - *Beginner mode*: three style presets (Precise/Balanced/Creative) + a plain-English
    response-length picker (Short/Medium/Long/Very long).
  - *Advanced mode*: raw sliders for temperature, top-p, frequency penalty, presence
    penalty, and max tokens — each with an "ⓘ" toggle explaining what it does and when
    to change it.
  - A collapsible "New to these settings?" guide.
- **Light/dark/system theme**, GitBook-inspired visual language (warm neutrals, ink
  text, flame-orange accent, pill buttons, hairline borders).
- **Installable PWA**, runs full-screen, offline after first use.

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
GitHub Pages, Netlify, Vercel, Cloudflare Pages, or your own HTTPS server. Just upload
the whole folder as-is; no build step required.

**Installing on your phone:**
- **Android (Chrome):** open the site → menu → "Install app" / "Add to Home screen".
- **iOS (Safari 26+):** open the site → Share icon → "Add to Home Screen".
- Once installed, it launches full-screen and works offline after the first successful load.

## The formula engine (Kanban card references)

Two ways to make a card's content dynamic:

1. **Inline reference**, anywhere in the text: `Hello {{Assistant Name}}, today is {{Today Card}}.`
2. **Full formula** — start the field with `=`:
   ```
   =CONCAT("Hello, ", {{Name}}, "! You are ", {{Age}}, " years old.")
   =IF({{Age}} > 18, "adult", "minor")
   =SUM(CARDS_IN("Budget"))
   ```

References resolve by **card title** (case-insensitive) or internal id. Circular
references are detected and shown as `#REF!-CIRCULAR(...)` instead of crashing.

Supported functions: `CONCAT`, `JOIN(sep, ...)`, `UPPER`, `LOWER`, `TRIM`, `LEN`, `IF`,
`AND`, `OR`, `NOT`, `SUM`, `AVG`, `MIN`, `MAX`, `ROUND(n, decimals)`, `TODAY()`, `NOW()`,
`CARD(id)` / `REF(id)`, `CARDS_IN(column)`, `COUNT_IN(column)`. Operators: `+ - * /`
(math), `&` (string concat), `== != < > <= >=` (comparisons), parentheses for grouping.
The card editor shows a **live preview** of the evaluated result as you type.

## Model catalog: search, sort & filter

Click the model button in Chat to open the picker:
- **Search** matches model name, family (Llama/Qwen/Phi/Gemma/Mistral/SmolLM/…),
  quantization (q4f16_1, etc.), and parameter size (e.g. searching "3b" finds every
  ~3-billion-parameter model across families).
- **Sort**: Recommended first, Name A→Z/Z→A, Size smallest/largest first.
- **Filter chips**: "Fits my device" (based on the estimated budget in Settings) and
  one chip per model family detected in the catalog.
- Each row shows a ★ recommended badge, family/parameter/quantization tags, a
  fits/tight-fit badge, and the download size.

## Generation settings, explained

Open **Settings → Generation**:
- **Beginner mode** (default): pick a style card — *Precise* (focused/consistent),
  *Balanced* (sensible default), or *Creative* (varied/surprising) — and a plain-English
  response length. That's it.
- **Advanced mode**: raw control over Temperature, Top-p, Frequency penalty, Presence
  penalty, and Max tokens, each with an "ⓘ" button that expands a short explanation of
  what the slider does and when you'd want to change it. A "Reset to Balanced defaults"
  button is always available.

## How model recommendation works (and its honest limits)

Browsers deliberately **do not** expose real GPU VRAM, for privacy/fingerprinting
reasons. The recommender combines the signals that *are* available: WebGPU adapter
presence/buffer limits, `navigator.deviceMemory` (Chrome/Android only, coarse RAM
buckets — not VRAM), CPU core count, and mobile-vs-desktop (mobile browsers impose much
stricter per-tab GPU memory budgets than desktop, even on high-RAM phones). From that it
estimates a conservative "safe VRAM budget" and picks the largest model from WebLLM's
**live** model list that fits. This is a **heuristic, not a guarantee** — override it
any time via the searchable model picker.

## Browser / device requirements

WebLLM requires **WebGPU** — there is no CPU fallback. As of 2026: Chrome/Edge 113+,
Firefox 141+ (Windows; newer for macOS), Safari 26+ (macOS Tahoe) on desktop; Chrome on
Android (Vulkan-capable devices, i.e. most phones since ~2018) and Safari on iOS/iPadOS
26+ on mobile. If `navigator.gpu` is unavailable, the app says so plainly in Settings
and Chat rather than failing silently.

## Offline behavior, in detail

First visit **requires internet** to fetch: the app shell, the WebLLM JS library, the
Gravity UI icon SVGs, and your chosen model's weights. After that, the service worker
has cached the app shell + library + icons, and the browser's Cache Storage holds the
model weights — subsequent launches (including fully offline) reuse all of it. Settings
→ "Persistent storage" asks the browser not to evict this cache under storage pressure;
"Clear cached model & app data" wipes it if you need space back.

## File structure

```
webllm-pwa/
├─ index.html            # App shell (topbar, sidebar, mobile tab bar, SPA router mount point)
├─ manifest.webmanifest   # PWA metadata + icons
├─ sw.js                  # Service worker: app-shell precache + runtime cache (WebLLM + icons + models)
├─ offline.html           # Fallback shown if a page is requested offline before first cache
├─ css/styles.css         # GitBook-inspired design tokens + full component styles (light/dark)
├─ icons/                 # App icons (regular + maskable, multiple sizes) — the app's own logo
└─ js/
   ├─ app.js              # Router, chat view, settings view (incl. Generation UI), wiring
   ├─ theme.js            # Light/dark/system theme switching
   ├─ storage.js           # IndexedDB persistence, JSON import/export, generation presets
   ├─ formula.js           # The Kanban card formula/reference engine
   ├─ kanban.js            # Kanban board rendering, card editor, card + column drag & drop
   ├─ device.js            # WebGPU/device detection + model recommendation
   ├─ modelutils.js         # Model family/quant/size parsing, search/sort/filter helpers
   ├─ modelpicker.js         # Searchable/sortable/filterable model picker modal
   ├─ llm.js               # WebLLM engine wrapper (load/stream chat completions)
   └─ icons.js             # Gravity UI icon loader: CDN fetch, caching, sizing, fallback
```

## Notes / possible next steps

- Multi-model comparison chat (load two models, compare answers side by side).
- Per-card "pin to top of context" ordering control.
- Export the Kanban board as Markdown in addition to JSON.
- Web Worker offloading for the LLM engine (keeps the UI thread smooth during
  generation on lower-end devices).
