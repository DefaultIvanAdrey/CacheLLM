# Memory — On-Device AI Kanban (WebLLM PWA)

A mobile-native, installable, **offline-capable** Progressive Web App that runs an LLM
**entirely inside the browser** via [WebLLM](https://webllm.mlc.ai/) (WebGPU) by default —
no server, no API key, nothing leaves the device unless you explicitly opt into a remote
provider. Includes a Kanban "memory" board with formula-capable cards and file attachments,
multi-conversation chat with full Markdown/code rendering, a searchable model catalog, and
optional remote model support (Gemini / DeepSeek / any OpenAI-compatible endpoint).

## Highlights

- **🌙 Dark mode, verified.** Every color in the stylesheet is a theme variable — audited
  programmatically to guarantee zero hardcoded colors outside the light/dark token blocks,
  plus computed contrast-ratio checks across visible text in dark mode.
- **📎 Attachments** in both Chat and Kanban cards. Text files read directly; PDFs/`.docx`
  extracted client-side (pdf.js / mammoth, loaded on demand); images resized and sent to
  vision-capable models, or kept as a labeled reference otherwise.
- **💬 Multiple conversations** — History drawer to create/switch/delete conversations,
  plus **Delete** and **Copy** on every individual message so you can "perfect" a
  conversation in place.
- **📊 Real storage management** — byte-accurate breakdown of everything cached
  (models, WebLLM library, icons, document tools, app shell), per-category and
  "clear everything" actions.
- **🌐 Web lookup toggle** + **🧠 Deep-thinking toggle**, both next to Send.
- **Markdown + code rendering fixed** — bold/italic/lists/tables/links render properly,
  `<think>...</think>` blocks collapse into a "Thinking…" disclosure instead of leaking
  into the visible answer, fenced code renders in a labeled, copyable, syntax-highlighted
  container.
- **⏱ Estimated generation progress bar** with tokens/sec and ETA.
- **☁️ Remote models (optional, clearly disclaimed)** — Gemini or DeepSeek/OpenAI-
  compatible/Hugging Face API key. Off by default.
- **✋ Kanban cards have a dedicated drag handle** — tapping/opening a card on mobile
  never accidentally starts a drag.

## Dark mode, in detail

Every single color value in `css/styles.css` is a `var(--token)` reference; the two
`[data-theme="light"|"dark"]` blocks are the *only* places literal colors are allowed to
appear. I verified this by parsing the stylesheet and confirming zero stray hex/rgb/named
colors outside those blocks, and confirming every variable used anywhere is defined in
*both* themes with matching names. `color-scheme: light|dark` is set per theme so native
form controls render correctly too. Code blocks use custom theme-aware syntax-highlighting
colors instead of a third-party (often single-theme) `highlight.js` stylesheet, so code
text stays readable in both modes.

## Being honest about "internet search"

A fully offline, 100% local LLM has no built-in way to browse the web — there's no server
here to proxy that for it. The **Web** toggle: when on and you're online, the app looks
your question up on **Wikipedia** (one of the only public knowledge APIs that allows
anonymous cross-origin requests from a browser) and feeds the retrieved summary to the
model as context. This is a genuinely useful quick-facts lookup, but it is **not** a
general web search engine — it can't browse arbitrary sites, click links, or fetch live
data like stock prices or scores.

## About the progress bar

True completion time can't be known in advance. The bar shows **tokens generated ÷ your
max-length setting**, plus a live tokens/second rate and a rough ETA from that rate —
labeled "(estimated)" and it resets once the reply actually finishes.

## Capability badges

The Chat header shows live badges: **Runs locally & private** vs **Remote**, whether the
current model **can see images** (best-effort — detected heuristically by model name,
e.g. `Phi-3.5-vision`/`*-VL-*`, since there's no runtime capability query), **reads
attached documents** (always true — documents are extracted to plain text as context, so
any text model can use them), and whether **web lookup** is on.

## Remote models: Gemini / DeepSeek / Hugging Face

Settings → **Remote models** is off by default and shows a disclaimer: enabling it means
your messages and attachments go directly from your browser to that provider's own
servers — not private, not local. Your key is stored only in this browser.

- **Google Gemini** — paste your [AI Studio](https://aistudio.google.com/apikey) key and a
  model name (e.g. `gemini-2.5-flash`). Real streaming via `streamGenerateContent` SSE;
  supports image attachments natively; native `thinkingConfig.thinkingBudget` wired to the
  Deep-thinking toggle.
- **OpenAI-compatible** — one field shape covers **DeepSeek**, **Hugging Face's Inference
  Providers router**, OpenAI itself, or your own server, with quick-fill presets. Paste a
  full Hugging Face model page URL into the model field and it's auto-parsed into the
  `org/model` id. DeepSeek's native `thinking.reasoning_effort` is wired to the
  Deep-thinking toggle.

**On "attaching a Hugging Face model link" directly:** WebLLM can only run models
specifically compiled to WebGPU/MLC format (the ones in the searchable model picker,
published under the `mlc-ai` org) — it can't compile an arbitrary Hugging Face repo on the
fly in a browser tab. What's built instead: the Hugging Face **Inference Providers** route
above, which lets you point at almost any Hugging Face-hosted model by name/URL — it just
runs on Hugging Face's cloud (with your token), not your device, which is why it lives
under "Remote models" rather than being presented as private.

## Features (full list)

- **Chat** — searchable/sortable/filterable model picker, streamed responses with Stop,
  full Markdown + labeled/syntax-highlighted code blocks, collapsible "Thinking…" blocks,
  Copy + Delete on every message, image/document attachments, Web-lookup and
  Deep-thinking toggles, estimated progress bar.
- **Conversations** — New chat, History drawer (switch/delete), per-message delete.
- **Memory Board** — Kanban columns/cards with a dedicated drag **handle**, card and
  column drag-and-drop, spreadsheet-style formulas/cross-references, file/image
  attachments per card, per-column "feed into assistant context" toggle, JSON
  import/export.
- **Device-aware model recommendation** — searchable catalog with family/size/quant
  filters, "fits my device" filter, honest heuristic budget estimate.
- **Generation controls** — Beginner mode (3 style presets + length picker) and Advanced
  mode (temperature/top-p/penalties/max tokens sliders with explainers), Deep-thinking
  toggle.
- **Storage management** — real byte-accurate breakdown, per-category and full clear
  actions, browser quota usage, persistent-storage request.
- **Remote models (optional)** — Gemini and OpenAI-compatible providers, clearly
  disclaimed, off by default.
- **Light/dark/system theme**, GitBook-inspired visual language, Gravity UI icon pack
  (fetched at runtime, cached offline, guaranteed-consistent sizing, graceful fallback).
- **Installable PWA**, runs full-screen, fully offline after first use.

## Running it

Must be served over **HTTP(S)** (ES modules + Service Worker + WebGPU don't work over
`file://`).

```bash
cd webllm-pwa
python3 -m http.server 8080
# open http://localhost:8080 in Chrome/Edge (Android/desktop) or Safari 26+ (iOS/macOS)
```

Deploy anywhere static (GitHub Pages, Netlify, Vercel, Cloudflare Pages, your own HTTPS
server) — it's 100% static files, no build step. Install via the browser's "Add to Home
Screen" / "Install app" prompt.

## Formula engine (Kanban cards)

`{{Card Title}}` interpolates another card's value anywhere in text; start a card with `=`
for a full formula: `=CONCAT("Hello, ", {{Name}}, "!")`, `=IF({{Age}}>18,"adult","minor")`,
`=SUM(CARDS_IN("Budget"))`. Functions: `CONCAT`, `JOIN`, `UPPER`, `LOWER`, `TRIM`, `LEN`,
`IF`, `AND`, `OR`, `NOT`, `SUM`, `AVG`, `MIN`, `MAX`, `ROUND`, `TODAY`, `NOW`, `CARD`/`REF`,
`CARDS_IN`, `COUNT_IN`. Circular references resolve to `#REF!-CIRCULAR(...)` instead of
crashing. The card editor shows a live preview as you type.

## Browser / device requirements

Local inference requires **WebGPU** (no CPU fallback): Chrome/Edge 113+, Firefox 141+,
Safari 26+ on desktop; Chrome on Android, Safari on iOS/iPadOS 26+ on mobile. Remote
providers work in any modern browser regardless of WebGPU.

## File structure

```
webllm-pwa/
├─ index.html / manifest.webmanifest / sw.js / offline.html
├─ css/styles.css        # Theme tokens (dark-mode-audited) + all component styles
├─ icons/                 # App's own logo (regular + maskable, multiple sizes)
└─ js/
   ├─ app.js              # Router, chat/board/settings views, conversation + generation logic
   ├─ markdown.js          # Markdown renderer + <think> tag extraction
   ├─ providers.js          # Remote provider adapters: OpenAI-compatible + Gemini (real SSE)
   ├─ attachments.js        # File/image processing: text extraction, PDF/DOCX, image resize
   ├─ webtool.js            # Wikipedia-based "web lookup" tool
   ├─ storagemanager.js      # Real cache-storage byte accounting + clearing
   ├─ storage.js            # IndexedDB: board, settings, multi-conversation persistence
   ├─ kanban.js             # Kanban board: cards (with drag handle), columns, attachments
   ├─ formula.js            # Formula/reference engine
   ├─ device.js             # WebGPU detection + model recommendation + vision heuristic
   ├─ modelutils.js / modelpicker.js  # Model catalog search/sort/filter + picker UI
   ├─ llm.js                # Local WebLLM engine wrapper
   ├─ icons.js              # Gravity UI icon loader (CDN fetch, offline cache, fixed sizing)
   └─ theme.js              # Light/dark/system theme switching
```
