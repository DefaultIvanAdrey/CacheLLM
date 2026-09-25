import { initTheme, cycleTheme, getStoredTheme, setStoredTheme, applyTheme } from "./theme.js";
import {
  loadBoard, saveBoard, loadSettings, saveSettings, defaultBoard,
  loadConversations, saveConversations, newConversation, deriveConversationTitle,
  GENERATION_PRESETS, MAX_TOKENS_PRESETS, genId,
} from "./storage.js";
import { KanbanBoard } from "./kanban.js";
import { LLMEngine, getModelList } from "./llm.js";
import { detectDevice, recommendModels, isLikelyVisionModel } from "./device.js";
import { evaluateCardContent } from "./formula.js";
import { icon, iconPlaceholder, mountIcons, preloadAllIcons } from "./icons.js";
import { openModelPicker } from "./modelpicker.js";
import { formatSizeMB, extractFamily } from "./modelutils.js";
import { renderChatMessage } from "./markdown.js";
import { processFile, attachmentToPromptText, formatFileSize } from "./attachments.js";
import { streamRemoteCompletion, OPENAI_COMPATIBLE_PRESETS, parseHuggingFaceModelInput } from "./providers.js";
import { lookup as webLookup } from "./webtool.js";
import { getCacheBreakdown, getStorageEstimate, clearBucket, clearAllCaches, BUCKET_LABELS } from "./storagemanager.js";

/* --------------------------------- State --------------------------------- */
const state = {
  route: "chat",
  board: null,
  settings: null,
  conv: { conversations: [], activeId: null },
  device: null,
  modelList: [],
  recommendation: null,
  engine: new LLMEngine(),
  modelStatus: "unloaded",
  generating: false,
  abortController: null,
  composerAttachments: [],
  hljsReady: false,
};

const els = {
  mainView: document.getElementById("mainView"),
  viewTitle: document.getElementById("viewTitle"),
  themeToggle: document.getElementById("themeToggle"),
  menuBtn: document.getElementById("menuBtn"),
  sidebar: document.getElementById("sidebar"),
  sidebarScrim: document.getElementById("sidebarScrim"),
  toastStack: document.getElementById("toastStack"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
};

preloadAllIcons();
mountIcons(document);

/* --------------------------------- Toasts --------------------------------- */
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.appendChild(icon(type === "error" ? "alert" : "circleCheck", { size: 15 }));
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  els.toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 3600);
}

/* --------------------------------- Theme --------------------------------- */
function refreshThemeButton() {
  const pref = getStoredTheme();
  const name = pref === "light" ? "sun" : pref === "dark" ? "moon" : "laptop";
  els.themeToggle.innerHTML = "";
  els.themeToggle.appendChild(icon(name, { size: 18 }));
}
els.themeToggle.addEventListener("click", () => {
  cycleTheme();
  refreshThemeButton();
});

/* --------------------------------- Routing --------------------------------- */
const ROUTE_TITLES = { chat: "Chat", board: "Memory Board", settings: "Settings" };
function setRoute(route) {
  state.route = route;
  els.viewTitle.textContent = ROUTE_TITLES[route];
  document.querySelectorAll(".nav-item, .tabbar-item").forEach((el) => el.classList.toggle("active", el.dataset.route === route));
  closeSidebar();
  renderRoute();
}
document.querySelectorAll(".nav-item, .tabbar-item").forEach((el) => el.addEventListener("click", () => setRoute(el.dataset.route)));
function openSidebar() { els.sidebar.classList.add("open"); els.sidebarScrim.style.display = "block"; }
function closeSidebar() { els.sidebar.classList.remove("open"); els.sidebarScrim.style.display = "none"; }
els.menuBtn.addEventListener("click", openSidebar);
els.sidebarScrim.addEventListener("click", closeSidebar);
function renderRoute() {
  els.mainView.innerHTML = "";
  if (state.route === "chat") renderChatView();
  else if (state.route === "board") renderBoardView();
  else if (state.route === "settings") renderSettingsView();
}

/* --------------------------------- Sidebar status --------------------------------- */
function updateSidebarStatus() {
  if (!state.device) { els.statusDot.className = "dot"; els.statusText.textContent = "Checking device…"; return; }
  if (state.settings.activeProvider !== "local") {
    els.statusDot.className = "dot info";
    els.statusText.textContent = `Remote provider active${navigator.onLine ? "" : " · offline"}`;
    return;
  }
  if (!state.device.gpu.supported) {
    els.statusDot.className = "dot err";
    els.statusText.textContent = "WebGPU unavailable";
  } else if (state.modelStatus === "ready") {
    els.statusDot.className = "dot ok";
    els.statusText.textContent = `Model ready${navigator.onLine ? "" : " · offline"}`;
  } else {
    els.statusDot.className = "dot warn";
    els.statusText.textContent = navigator.onLine ? "WebGPU ready · no model loaded" : "Offline · no model loaded";
  }
}
window.addEventListener("online", updateSidebarStatus);
window.addEventListener("offline", updateSidebarStatus);

/* ------------------------------ highlight.js (lazy) ------------------------------ */
let hljsPromise = null;
function loadHljs() {
  if (!hljsPromise) {
    hljsPromise = import("https://cdn.jsdelivr.net/npm/highlight.js@11/+esm")
      .then((mod) => (state.hljsReady = true) && mod)
      .catch(() => null);
  }
  return hljsPromise;
}
async function highlightCodeIn(container) {
  const blocks = container.querySelectorAll("pre code.hljs");
  if (!blocks.length) return;
  const mod = await loadHljs();
  const hljs = mod?.default || mod;
  if (!hljs) return;
  blocks.forEach((block) => {
    if (block.dataset.highlighted) return;
    try {
      hljs.highlightElement(block);
      block.dataset.highlighted = "yes";
    } catch {
      /* leave as plain text if a language isn't recognized */
    }
  });
}

/* ------------------------------ conversation helpers ------------------------------ */
function activeConversation() {
  return state.conv.conversations.find((c) => c.id === state.conv.activeId) || state.conv.conversations[0];
}
async function persistConversations() {
  await saveConversations(state.conv);
}
async function createNewConversation() {
  const conv = newConversation();
  state.conv.conversations.unshift(conv);
  state.conv.activeId = conv.id;
  await persistConversations();
  return conv;
}

/* ============================================================================
   CHAT VIEW
   ============================================================================ */
function buildBoardContextSections() {
  const board = state.board;
  const sections = [];
  for (const col of board.columns) {
    if (!col.injectIntoPrompt) continue;
    const cards = board.cards.filter((c) => c.columnId === col.id);
    if (!cards.length) continue;
    const lines = cards.map((c) => `- ${c.title}: ${evaluateCardContent(board, c)}`);
    sections.push(`## ${col.title}\n${lines.join("\n")}`);
  }
  return sections;
}

function findModelById(id) {
  return state.modelList.find((m) => m.model_id === id) || null;
}

function getActiveModelLabel() {
  if (state.settings.activeProvider === "gemini") return state.settings.remoteProviders.gemini.model || "Gemini";
  if (state.settings.activeProvider === "openai_compatible") return state.settings.remoteProviders.openai_compatible.model || "Remote model";
  return findModelById(state.settings.selectedModelId)?.model_id || state.recommendation?.primary?.model_id || null;
}

function getCapabilities() {
  const provider = state.settings.activeProvider;
  if (provider === "gemini") return { vision: "yes", local: false, provider: "Google Gemini (remote)" };
  if (provider === "openai_compatible") return { vision: "maybe", local: false, provider: "Remote API (OpenAI-compatible)" };
  const modelId = getActiveModelLabel();
  return { vision: modelId && isLikelyVisionModel(modelId) ? "yes" : "no", local: true, provider: "Local (on-device)" };
}

function renderChatView() {
  const view = document.createElement("div");
  view.className = "chat-view";
  view.innerHTML = `
    <div class="chat-model-bar">
      <button class="btn icon ghost" id="historyBtn" title="Conversations"></button>
      <button class="model-select-btn" id="modelSelectBtn" type="button">
        <span class="icon-box icon-18" data-icon="chip"></span>
        <span class="msb-text">
          <div class="msb-name" id="msbName">Loading model list…</div>
          <div class="msb-meta" id="msbMeta"></div>
        </span>
        <span class="icon-box icon-16" data-icon="chevronDown"></span>
      </button>
      <button class="btn sm accent" id="loadModelBtn">Load model</button>
      <span class="badge" id="modelStatusBadge"></span>
      <span class="spacer"></span>
      <button class="btn icon ghost" id="newChatBtn" title="New chat"></button>
    </div>
    <div class="capability-row" id="capabilityRow"></div>
    <div class="progress-wrap hidden" id="progressWrap">
      <div class="progress-track"><div class="progress-bar" id="progressBar"></div></div>
      <div class="progress-label" id="progressLabel"></div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="chat-input-bar">
      <div class="composer-attachments" id="composerAttachments"></div>
      <div class="chat-input-row">
        <textarea id="chatInput" rows="1" placeholder="Ask your assistant… (Shift+Enter for newline)"></textarea>
        <button class="btn primary icon" id="sendBtn"></button>
        <button class="btn icon hidden" id="stopBtn" title="Stop generating"></button>
      </div>
      <div class="composer-tools-row">
        <input type="file" id="composerFileInput" class="hidden" multiple accept="image/*,.pdf,.docx,.txt,.md,.csv,.json" />
        <button class="btn icon ghost" id="attachBtn" title="Attach image or file"></button>
        <button class="toggle-pill" id="internetToggle" type="button" title="Let the assistant look things up on Wikipedia when online"></button>
        <button class="toggle-pill" id="thinkingToggle" type="button" title="Deep thinking = more thorough but slower"></button>
        <span class="spacer"></span>
      </div>
    </div>
  `;
  els.mainView.appendChild(view);
  mountIcons(view);
  view.querySelector("#sendBtn").appendChild(icon("send", { size: 16 }));
  view.querySelector("#stopBtn").appendChild(icon("stop", { size: 16 }));
  view.querySelector("#historyBtn").appendChild(icon("clock", { size: 17 }));
  view.querySelector("#newChatBtn").appendChild(icon("plus", { size: 17 }));
  view.querySelector("#attachBtn").appendChild(icon("paperclip", { size: 16 }));

  const modelBtn = view.querySelector("#modelSelectBtn");
  const msbName = view.querySelector("#msbName");
  const msbMeta = view.querySelector("#msbMeta");
  const loadBtn = view.querySelector("#loadModelBtn");
  const statusBadge = view.querySelector("#modelStatusBadge");
  const progressWrap = view.querySelector("#progressWrap");
  const progressBar = view.querySelector("#progressBar");
  const progressLabel = view.querySelector("#progressLabel");
  const messagesEl = view.querySelector("#messages");
  const chatInput = view.querySelector("#chatInput");
  const sendBtn = view.querySelector("#sendBtn");
  const stopBtn = view.querySelector("#stopBtn");
  const internetToggle = view.querySelector("#internetToggle");
  const thinkingToggle = view.querySelector("#thinkingToggle");
  const attachBtn = view.querySelector("#attachBtn");
  const composerFileInput = view.querySelector("#composerFileInput");
  const composerAttachmentsEl = view.querySelector("#composerAttachments");

  const isLocalProvider = state.settings.activeProvider === "local";
  modelBtn.style.display = isLocalProvider ? "" : "none";
  loadBtn.style.display = isLocalProvider ? "" : "none";
  statusBadge.style.display = isLocalProvider ? "" : "none";
  if (!isLocalProvider) {
    const remoteBadge = document.createElement("span");
    remoteBadge.className = "badge info";
    remoteBadge.textContent = getActiveModelLabel() || "Remote model";
    view.querySelector(".chat-model-bar").insertBefore(remoteBadge, view.querySelector(".spacer"));
  }

  function refreshModelButton() {
    const selected = findModelById(state.settings.selectedModelId) || state.recommendation?.primary;
    if (!selected) {
      msbName.textContent = state.modelList.length ? "Choose a model…" : "Loading model list…";
      msbMeta.textContent = "";
      return;
    }
    const isRec = state.recommendation?.primary?.model_id === selected.model_id;
    msbName.textContent = selected.model_id;
    msbMeta.textContent = `${formatSizeMB(selected.vram_required_MB)} · ${extractFamily(selected.model_id)}${isRec ? " · ★ recommended" : ""}`;
    if (!state.settings.selectedModelId) state.settings.selectedModelId = selected.model_id;
  }
  refreshModelButton();
  updateModelStatusBadge(statusBadge);
  renderCapabilityRow(view.querySelector("#capabilityRow"));

  modelBtn.addEventListener("click", () => {
    if (!state.modelList.length) { toast("Still fetching the model catalog — try again in a moment.", "error"); return; }
    openModelPicker({
      modelList: state.modelList, device: state.device, recommendation: state.recommendation,
      currentSelection: state.settings.selectedModelId,
      onSelect: async (model) => {
        state.settings.selectedModelId = model.model_id;
        await saveSettings(state.settings);
        refreshModelButton();
        renderCapabilityRow(view.querySelector("#capabilityRow"));
      },
    });
  });

  view.querySelector("#historyBtn").addEventListener("click", () => openConversationDrawer());
  view.querySelector("#newChatBtn").addEventListener("click", async () => {
    await createNewConversation();
    renderChatView();
  });

  renderMessages(messagesEl);

  loadBtn.addEventListener("click", () => {
    const modelId = state.settings.selectedModelId || state.recommendation?.primary?.model_id;
    if (!modelId) { toast("Pick a model first.", "error"); return; }
    loadSelectedModel(modelId, { progressWrap, progressBar, progressLabel, statusBadge, loadBtn });
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
  });
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(chatInput, messagesEl, sendBtn, stopBtn); }
  });
  sendBtn.addEventListener("click", () => handleSend(chatInput, messagesEl, sendBtn, stopBtn));
  stopBtn.addEventListener("click", async () => {
    if (state.abortController) state.abortController.abort();
    await state.engine.interrupt();
  });

  function refreshToggle(btn, iconName, on, label) {
    btn.innerHTML = "";
    btn.appendChild(icon(iconName, { size: 14 }));
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    btn.classList.toggle("on", on);
  }
  refreshToggle(internetToggle, "globe", state.settings.internetSearch, "Web");
  refreshToggle(thinkingToggle, "brain", state.settings.deepThinking, state.settings.deepThinking ? "Deep think" : "Fast");
  internetToggle.addEventListener("click", async () => {
    state.settings.internetSearch = !state.settings.internetSearch;
    await saveSettings(state.settings);
    refreshToggle(internetToggle, "globe", state.settings.internetSearch, "Web");
    toast(state.settings.internetSearch ? "Web lookup enabled (Wikipedia, when online)." : "Web lookup disabled.");
  });
  thinkingToggle.addEventListener("click", async () => {
    state.settings.deepThinking = !state.settings.deepThinking;
    await saveSettings(state.settings);
    refreshToggle(thinkingToggle, "brain", state.settings.deepThinking, state.settings.deepThinking ? "Deep think" : "Fast");
    toast(state.settings.deepThinking ? "Deep thinking on — more thorough, may be slower." : "Fast mode on — quicker, more direct answers.");
  });

  attachBtn.addEventListener("click", () => composerFileInput.click());
  composerFileInput.addEventListener("change", async () => {
    const files = [...composerFileInput.files];
    composerFileInput.value = "";
    for (const file of files) {
      const processed = await processFile(file);
      state.composerAttachments.push(processed);
      renderComposerAttachments(composerAttachmentsEl);
      if (processed.error) toast(`"${file.name}": ${processed.error}`, "error");
    }
  });
  renderComposerAttachments(composerAttachmentsEl);
}

function renderComposerAttachments(container) {
  container.innerHTML = "";
  if (!state.composerAttachments.length) return;
  const row = document.createElement("div");
  row.className = "attachment-row";
  state.composerAttachments.forEach((att, idx) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip" + (att.error ? " warn" : "");
    const thumbOrIcon = att.kind === "image" ? `<img class="thumb" src="${att.dataUrl}" alt=""/>` : `<span class="file-icon">${iconPlaceholder("file", { size: 13 })}</span>`;
    chip.innerHTML = `${thumbOrIcon}<span class="name" title="${att.name}">${att.name}</span><button type="button" class="remove-btn" data-idx="${idx}">${iconPlaceholder("close", { size: 12 })}</button>`;
    row.appendChild(chip);
  });
  container.appendChild(row);
  mountIcons(row);
  row.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.composerAttachments.splice(Number(btn.dataset.idx), 1);
      renderComposerAttachments(container);
    });
  });
}

function renderCapabilityRow(container) {
  const caps = getCapabilities();
  container.innerHTML = "";
  const items = [
    { label: caps.local ? "Runs locally & private" : "Remote (not private)", ok: caps.local, always: true },
    { label: caps.vision === "yes" ? "Can see images" : caps.vision === "maybe" ? "May support images (varies)" : "Can't see images (text only)", ok: caps.vision === "yes" },
    { label: "Reads attached documents", ok: true },
    { label: state.settings.internetSearch ? "Web lookup: on" : "Web lookup: off", ok: state.settings.internetSearch },
  ];
  items.forEach((it) => {
    const span = document.createElement("span");
    span.className = `cap-badge ${it.always ? (it.ok ? "yes" : "remote") : it.ok ? "yes" : "no"}`;
    span.textContent = it.label;
    container.appendChild(span);
  });
}

function updateModelStatusBadge(badge) {
  const map = { unloaded: ["", "Not loaded"], loading: ["accent", "Loading…"], ready: ["success", "Ready"], error: ["danger", "Error"] };
  const [cls, label] = map[state.modelStatus] || map.unloaded;
  badge.className = `badge ${cls}`;
  badge.textContent = label;
}

async function loadSelectedModel(modelId, ui) {
  if (!modelId) return;
  if (!state.device?.gpu?.supported) { toast("WebGPU isn't available in this browser, so WebLLM can't run here.", "error"); return; }
  state.modelStatus = "loading";
  updateModelStatusBadge(ui.statusBadge);
  ui.loadBtn.disabled = true;
  ui.progressWrap.classList.remove("hidden");
  updateSidebarStatus();
  try {
    await state.engine.loadModel(modelId, (p) => {
      const pct = Math.round((p.progress || 0) * 100);
      ui.progressBar.style.width = `${pct}%`;
      ui.progressLabel.textContent = p.text || `${pct}%`;
    });
    state.modelStatus = "ready";
    state.settings.selectedModelId = modelId;
    await saveSettings(state.settings);
    toast(`${modelId} is ready.`);
  } catch (err) {
    state.modelStatus = "error";
    toast(`Failed to load model: ${err.message}`, "error");
  }
  ui.loadBtn.disabled = false;
  updateModelStatusBadge(ui.statusBadge);
  updateSidebarStatus();
}

/* ------------------------------ message rendering ------------------------------ */

function renderMessages(container) {
  container.innerHTML = "";
  const conv = activeConversation();
  if (!conv || !conv.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="icon">💬</div><p><strong>No messages yet.</strong></p><p>Pick a model above, load it, and start chatting — entirely on this device, offline once cached.</p>`;
    container.appendChild(empty);
    return;
  }
  for (const m of conv.messages) container.appendChild(renderMessageBubble(m, container));
  highlightCodeIn(container);
  container.scrollTop = container.scrollHeight;
}

function renderMessageBubble(m, messagesContainer) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${m.role}`;
  wrap.dataset.msgId = m.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = m.role === "user" ? "You" : "AI";
  wrap.appendChild(avatar);

  const body = document.createElement("div");
  body.className = "msg-body";

  if (m.attachments && m.attachments.length) {
    const attRow = document.createElement("div");
    attRow.className = "attachment-row";
    attRow.style.marginBottom = "6px";
    m.attachments.forEach((att) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      const thumbOrIcon = att.kind === "image" ? `<img class="thumb" src="${att.dataUrl}" alt=""/>` : `<span class="file-icon">${iconPlaceholder("file", { size: 13 })}</span>`;
      chip.innerHTML = `${thumbOrIcon}<span class="name" title="${att.name}">${att.name}</span>`;
      attRow.appendChild(chip);
    });
    body.appendChild(attRow);
    mountIcons(attRow);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  body.appendChild(bubble);
  renderBubbleContent(bubble, m, body);

  if (m.searchSources && m.searchSources.length) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `🔎 Looked up: ${m.searchSources.map((s) => s.title).join(", ")}`;
    body.appendChild(meta);
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-action-btn";
  copyBtn.appendChild(icon("copy", { size: 12 }));
  const copyLabel = document.createElement("span");
  copyLabel.textContent = "Copy";
  copyBtn.appendChild(copyLabel);
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(typeof m.content === "string" ? m.content : "");
      copyLabel.textContent = "Copied!";
      setTimeout(() => (copyLabel.textContent = "Copy"), 1400);
    } catch {
      toast("Couldn't copy — clipboard access was blocked.", "error");
    }
  });
  actions.appendChild(copyBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "msg-action-btn danger-hover";
  delBtn.appendChild(icon("trash", { size: 12 }));
  const delLabel = document.createElement("span");
  delLabel.textContent = "Delete";
  delBtn.appendChild(delLabel);
  delBtn.addEventListener("click", async () => {
    if (!confirm("Remove this message from the conversation? This can't be undone.")) return;
    const conv = activeConversation();
    conv.messages = conv.messages.filter((msg) => msg.id !== m.id);
    conv.updatedAt = Date.now();
    await persistConversations();
    renderMessages(messagesContainer);
  });
  actions.appendChild(delBtn);
  body.appendChild(actions);

  wrap.appendChild(body);
  return wrap;
}

function renderBubbleContent(bubble, m, body) {
  bubble.innerHTML = "";
  const rawText = typeof m.content === "string" ? m.content : "";
  const { thinkingHtml, stillThinking, answerHtml } = renderChatMessage(rawText);

  if (thinkingHtml) {
    const block = document.createElement("div");
    block.className = "thinking-block";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "thinking-toggle";
    const spinnerIcon = stillThinking ? "brain" : "brain";
    toggle.innerHTML = `<span class="${stillThinking ? "spin" : ""}">${iconPlaceholder(spinnerIcon, { size: 13 })}</span><span>${stillThinking ? "Thinking…" : "Show reasoning"}</span>`;
    const contentEl = document.createElement("div");
    contentEl.className = "thinking-body hidden";
    contentEl.innerHTML = thinkingHtml;
    toggle.addEventListener("click", () => contentEl.classList.toggle("hidden"));
    block.appendChild(toggle);
    block.appendChild(contentEl);
    bubble.appendChild(block);
    mountIcons(block);
    if (stillThinking) contentEl.classList.remove("hidden");
  }

  const answerEl = document.createElement("div");
  answerEl.innerHTML = answerHtml;
  bubble.appendChild(answerEl);

  answerEl.querySelectorAll(".code-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.closest(".code-block").querySelector("code").textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      });
    });
  });
}

/* ------------------------------ sending / generation ------------------------------ */

function startGenProgress(body, maxTokens) {
  const wrap = document.createElement("div");
  wrap.className = "gen-progress";
  wrap.innerHTML = `<div class="gen-progress-track" style="flex:1;"><div class="gen-progress-bar" style="width:0%"></div></div><span class="gen-progress-label">Starting…</span>`;
  body.insertBefore(wrap, body.firstChild);
  const bar = wrap.querySelector(".gen-progress-bar");
  const label = wrap.querySelector(".gen-progress-label");
  const start = performance.now();
  let tokenCount = 0;

  return {
    tick() {
      tokenCount++;
      const elapsedS = (performance.now() - start) / 1000;
      const pct = Math.min(99, Math.round((tokenCount / maxTokens) * 100));
      bar.style.width = `${pct}%`;
      if (elapsedS < 0.6 || tokenCount < 4) {
        label.textContent = "Starting…";
        return;
      }
      const rate = tokenCount / elapsedS;
      const remainingTokens = Math.max(maxTokens - tokenCount, 0);
      const etaS = rate > 0 ? remainingTokens / rate : null;
      label.textContent = `~${pct}% · ${rate.toFixed(1)} tok/s${etaS !== null ? ` · ~${Math.ceil(etaS)}s left (est.)` : ""}`;
    },
    finish(reachedNaturalEnd) {
      const elapsedS = ((performance.now() - start) / 1000).toFixed(1);
      bar.style.width = "100%";
      label.textContent = reachedNaturalEnd ? `Done in ${elapsedS}s` : `Stopped after ${elapsedS}s`;
      setTimeout(() => wrap.remove(), 2200);
    },
  };
}

async function handleSend(input, messagesEl, sendBtn, stopBtn) {
  const text = input.value.trim();
  if ((!text && !state.composerAttachments.length) || state.generating) return;

  const provider = state.settings.activeProvider;
  if (provider === "local" && state.modelStatus !== "ready") { toast("Load a model first.", "error"); return; }
  if (provider === "gemini" && !state.settings.remoteProviders.gemini.apiKey) { toast("Add a Gemini API key in Settings → Remote models first.", "error"); return; }
  if (provider === "openai_compatible" && (!state.settings.remoteProviders.openai_compatible.baseUrl || !state.settings.remoteProviders.openai_compatible.model)) {
    toast("Configure the remote endpoint in Settings → Remote models first.", "error");
    return;
  }

  const conv = activeConversation();
  const attachments = state.composerAttachments;
  input.value = "";
  input.style.height = "auto";
  state.composerAttachments = [];
  renderComposerAttachments(document.getElementById("composerAttachments"));

  let searchResult = null;
  if (state.settings.internetSearch && text) {
    searchResult = await webLookup(text);
    if (!searchResult.ok && searchResult.reason === "offline") toast("Web lookup skipped — you're offline.", "error");
  }

  const userMsg = { id: genId("msg"), role: "user", content: text, attachments, at: Date.now(), searchSources: searchResult?.ok ? searchResult.sources : undefined };
  conv.messages.push(userMsg);
  if (conv.messages.filter((m) => m.role === "user").length === 1) conv.title = deriveConversationTitle(conv);
  conv.updatedAt = Date.now();
  renderMessages(messagesEl);
  await persistConversations();

  const assistantMsg = { id: genId("msg"), role: "assistant", content: "", attachments: [], at: Date.now() };
  conv.messages.push(assistantMsg);
  renderMessages(messagesEl);
  const bubbleWrap = messagesEl.lastElementChild;
  const bubble = bubbleWrap.querySelector(".msg-bubble");
  const body = bubbleWrap.querySelector(".msg-body");

  state.generating = true;
  sendBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");
  state.abortController = new AbortController();

  const sections = buildBoardContextSections();
  if (searchResult?.ok) sections.push(`## Web lookup results (Wikipedia)\n${searchResult.contextBlock}`);
  const attachmentTexts = attachments.filter((a) => a.kind !== "image").map(attachmentToPromptText);
  if (attachmentTexts.length) sections.push(`## Attached files\n${attachmentTexts.join("\n\n")}`);

  const systemPrompt = sections.length
    ? `You are a helpful assistant. Use the following context as authoritative background:\n\n${sections.join("\n\n")}`
    : "You are a helpful, concise assistant.";

  const historyMessages = conv.messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
    attachments: m.attachments,
  }));
  const messages = [{ role: "system", content: systemPrompt }, ...historyMessages];

  const progress = startGenProgress(body, state.settings.maxTokens);
  let reachedNaturalEnd = true;

  try {
    if (provider === "local") {
      await state.engine.chatStream(messages, {
        temperature: state.settings.temperature,
        topP: state.settings.topP,
        frequencyPenalty: state.settings.frequencyPenalty,
        presencePenalty: state.settings.presencePenalty,
        maxTokens: state.settings.maxTokens,
        deepThinking: state.settings.deepThinking,
        onToken: (_delta, full) => {
          assistantMsg.content = full;
          renderBubbleContent(bubble, assistantMsg, body);
          progress.tick();
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      });
    } else {
      const providerConfig =
        provider === "gemini"
          ? { type: "gemini", apiKey: state.settings.remoteProviders.gemini.apiKey, model: state.settings.remoteProviders.gemini.model }
          : {
              type: "openai_compatible",
              baseUrl: state.settings.remoteProviders.openai_compatible.baseUrl,
              apiKey: state.settings.remoteProviders.openai_compatible.apiKey,
              model: state.settings.remoteProviders.openai_compatible.model,
            };
      await streamRemoteCompletion(providerConfig, messages, {
        temperature: state.settings.temperature,
        topP: state.settings.topP,
        maxTokens: state.settings.maxTokens,
        deepThinking: state.settings.deepThinking,
        signal: state.abortController.signal,
        onToken: (_delta, full) => {
          assistantMsg.content = full;
          renderBubbleContent(bubble, assistantMsg, body);
          progress.tick();
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      });
    }
  } catch (err) {
    reachedNaturalEnd = false;
    if (err.name === "AbortError") {
      assistantMsg.content += "\n\n_(stopped by user)_";
    } else {
      assistantMsg.content = assistantMsg.content || `⚠️ ${err.message}`;
      toast(`Generation error: ${err.message}`, "error");
    }
    renderBubbleContent(bubble, assistantMsg, body);
  }

  progress.finish(reachedNaturalEnd);
  state.generating = false;
  state.abortController = null;
  sendBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  conv.updatedAt = Date.now();
  await persistConversations();
  highlightCodeIn(bubbleWrap);
}

/* ============================================================================
   CONVERSATION DRAWER
   ============================================================================ */
function openConversationDrawer() {
  const overlay = document.createElement("div");
  overlay.className = "conv-drawer-overlay";
  overlay.innerHTML = `
    <div class="conv-drawer">
      <div class="conv-drawer-header">
        <strong>Conversations</strong>
        <button class="btn icon ghost" id="convDrawerClose"></button>
      </div>
      <div class="conv-drawer-list" id="convDrawerList"></div>
      <div class="conv-drawer-footer">
        <button class="btn primary" id="convDrawerNew" style="width:100%;">${iconPlaceholder("plus", { size: 14 })}<span>New chat</span></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#convDrawerClose").appendChild(icon("close", { size: 16 }));
  mountIcons(overlay);

  const listEl = overlay.querySelector("#convDrawerList");
  function renderList() {
    listEl.innerHTML = "";
    const sorted = [...state.conv.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const c of sorted) {
      const item = document.createElement("div");
      item.className = "conv-item" + (c.id === state.conv.activeId ? " active" : "");
      item.innerHTML = `
        <div class="ci-main">
          <div class="ci-title">${escapeHtml(c.title || "New chat")}</div>
          <div class="ci-meta">${c.messages.length} message${c.messages.length === 1 ? "" : "s"} · ${new Date(c.updatedAt).toLocaleString()}</div>
        </div>
        <button class="ci-delete">${iconPlaceholder("trash", { size: 14 })}</button>
      `;
      item.addEventListener("click", (e) => {
        if (e.target.closest(".ci-delete")) return;
        state.conv.activeId = c.id;
        persistConversations();
        overlay.remove();
        renderChatView();
      });
      item.querySelector(".ci-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete conversation "${c.title}"? This can't be undone.`)) return;
        state.conv.conversations = state.conv.conversations.filter((x) => x.id !== c.id);
        if (!state.conv.conversations.length) state.conv.conversations.push(newConversation());
        if (state.conv.activeId === c.id) state.conv.activeId = state.conv.conversations[0].id;
        await persistConversations();
        renderList();
        renderChatView();
      });
      listEl.appendChild(item);
      mountIcons(item);
    }
  }
  renderList();

  overlay.querySelector("#convDrawerNew").addEventListener("click", async () => {
    await createNewConversation();
    overlay.remove();
    renderChatView();
  });
  overlay.querySelector("#convDrawerClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/* ============================================================================
   BOARD VIEW
   ============================================================================ */
function renderBoardView() {
  const view = document.createElement("div");
  view.className = "board-view";
  els.mainView.appendChild(view);
  const kanban = new KanbanBoard(view, {
    getBoard: () => state.board,
    setBoard: async (b) => { state.board = b; await saveBoard(state.board); },
    onToast: (msg, type) => toast(msg, type),
  });
  kanban.render();
}

/* ============================================================================
   SETTINGS VIEW
   ============================================================================ */
function matchesPreset(temperature, topP) {
  for (const [key, p] of Object.entries(GENERATION_PRESETS)) {
    if (Math.abs(p.temperature - temperature) < 0.001 && Math.abs(p.topP - topP) < 0.001) return key;
  }
  return null;
}

function renderSettingsView() {
  const view = document.createElement("div");
  view.className = "settings-view";
  const d = state.device;
  const rec = state.recommendation;
  const s = state.settings;

  view.innerHTML = `
    <div class="card-surface settings-section">
      <h3>${iconPlaceholder("chip", { size: 16 })}Device &amp; WebGPU</h3>
      <div class="device-grid">
        <div class="device-stat"><div class="v">${d ? d.platform : "…"}</div><div class="k">Platform</div></div>
        <div class="device-stat"><div class="v">${d ? (d.isMobile ? "Mobile" : "Desktop") : "…"}</div><div class="k">Form factor</div></div>
        <div class="device-stat"><div class="v">${d?.deviceMemoryGB ? d.deviceMemoryGB + " GB" : "Not reported"}</div><div class="k">Device RAM</div></div>
        <div class="device-stat"><div class="v">${d?.cores || "Not reported"}</div><div class="k">CPU cores</div></div>
        <div class="device-stat"><div class="v">${d?.gpu?.supported ? "Supported" : "Unavailable"}</div><div class="k">WebGPU</div></div>
        <div class="device-stat"><div class="v">${d ? formatSizeMB(d.budgetMB) : "…"}</div><div class="k">Estimated model budget</div></div>
      </div>
      <p class="hint" style="margin-top:10px;">Browsers don't expose real VRAM for privacy reasons, so this budget is a conservative estimate. You can always pick a different model manually via the searchable picker in Chat.</p>
      ${
        rec?.primary
          ? `<div class="model-rec-card"><div><div class="name">${rec.primary.model_id}</div><div class="meta">${formatSizeMB(rec.primary.vram_required_MB)} VRAM · ${rec.fits ? "fits comfortably" : "closest available fit"}</div></div><button class="btn sm accent" id="useRecommendedBtn">Use this model</button></div>`
          : d && !d.gpu.supported
          ? `<div class="model-rec-card" style="background:var(--surface-alt); border-color:var(--border);"><div class="meta">No WebGPU-capable adapter found — try the latest Chrome/Edge, or Safari 26+ on iOS/macOS.</div></div>`
          : ""
      }
    </div>

    <div class="card-surface settings-section">
      <h3>${iconPlaceholder("laptop", { size: 16 })}Appearance</h3>
      <div class="settings-row">
        <div class="label-block"><div class="t">Theme</div><div class="d">Light, dark, or follow system</div></div>
        <div style="display:flex; gap:6px;">
          <button class="btn sm" data-theme-choice="light">Light</button>
          <button class="btn sm" data-theme-choice="dark">Dark</button>
          <button class="btn sm" data-theme-choice="system">System</button>
        </div>
      </div>
    </div>

    <div class="card-surface settings-section" id="generationSection">
      <h3>${iconPlaceholder("gauge", { size: 16 })}Generation</h3>
      <div class="mode-toggle" id="genModeToggle"><button data-mode="beginner">Beginner</button><button data-mode="advanced">Advanced</button></div>
      <div id="beginnerControls" style="margin-top:14px;">
        <label>Response style</label>
        <div class="preset-grid" id="presetGrid"></div>
        <div class="control-block">
          <div class="control-head"><span class="label-main">Response length</span></div>
          <select id="maxTokensPresetSelect">${MAX_TOKENS_PRESETS.map((p) => `<option value="${p.value}">${p.label} — ${p.description}</option>`).join("")}</select>
        </div>
      </div>
      <div id="advancedControls" class="hidden" style="margin-top:8px;">
        <div class="control-block">
          <div class="control-head"><span class="label-main">Temperature <button class="info-btn" data-info="tempDesc">${iconPlaceholder("info", { size: 14 })}</button></span><span class="value-pill" id="tempValuePill">${s.temperature.toFixed(2)}</span></div>
          <input type="range" id="tempRange" min="0" max="1.5" step="0.05" value="${s.temperature}" />
          <div class="control-desc hidden" id="tempDesc">Controls randomness. <strong>Lower</strong> (0–0.4) = focused, predictable. <strong>Higher</strong> (0.9–1.5) = varied, more creative but can wander.</div>
        </div>
        <div class="control-block">
          <div class="control-head"><span class="label-main">Top-p <button class="info-btn" data-info="topPDesc">${iconPlaceholder("info", { size: 14 })}</button></span><span class="value-pill" id="topPValuePill">${s.topP.toFixed(2)}</span></div>
          <input type="range" id="topPRange" min="0.1" max="1" step="0.01" value="${s.topP}" />
          <div class="control-desc hidden" id="topPDesc">Limits word choices to the smallest set covering this probability mass. Usually 0.9–0.95; lower only if answers feel erratic.</div>
        </div>
        <div class="control-block">
          <div class="control-head"><span class="label-main">Frequency penalty <button class="info-btn" data-info="freqDesc">${iconPlaceholder("info", { size: 14 })}</button></span><span class="value-pill" id="freqValuePill">${s.frequencyPenalty.toFixed(2)}</span></div>
          <input type="range" id="freqRange" min="-2" max="2" step="0.1" value="${s.frequencyPenalty}" />
          <div class="control-desc hidden" id="freqDesc">Discourages repeating the same words too often. Raise if the model starts looping; keep at 0 normally.</div>
        </div>
        <div class="control-block">
          <div class="control-head"><span class="label-main">Presence penalty <button class="info-btn" data-info="presDesc">${iconPlaceholder("info", { size: 14 })}</button></span><span class="value-pill" id="presValuePill">${s.presencePenalty.toFixed(2)}</span></div>
          <input type="range" id="presRange" min="-2" max="2" step="0.1" value="${s.presencePenalty}" />
          <div class="control-desc hidden" id="presDesc">Encourages new topics/words rather than sticking to one theme. Keep at 0 normally.</div>
        </div>
        <div class="control-block">
          <div class="control-head"><span class="label-main">Max response tokens <button class="info-btn" data-info="maxTokDesc">${iconPlaceholder("info", { size: 14 })}</button></span></div>
          <input type="number" id="maxTokensInput" min="32" max="4096" step="32" value="${s.maxTokens}" />
          <div class="control-desc hidden" id="maxTokDesc">A hard cap on reply length (~¾ word per token). This also drives the estimated progress bar during generation.</div>
        </div>
        <button class="btn sm" id="resetGenDefaultsBtn">${iconPlaceholder("refresh", { size: 13 })}<span>Reset to Balanced defaults</span></button>
      </div>
      <details class="guide">
        <summary>${iconPlaceholder("circleInfo", { size: 15 })}<span>New to these settings? Read a 30-second guide</span><span class="icon-box icon-16 chev" data-icon="chevronDown"></span></summary>
        <div class="guide-body"><dl>
          <dt>Deep thinking vs. Fast (near the chat composer)</dt><dd>Deep thinking lets the model reason more thoroughly (slower); Fast asks for a direct answer with no extended reasoning shown.</dd>
          <dt>Web lookup (near the chat composer)</dt><dd>When on and you're online, the assistant checks Wikipedia for relevant background before answering — it's a quick lookup, not a full web browser.</dd>
          <dt>Temperature &amp; Top-p</dt><dd>Both control randomness. Start with the presets above — Balanced works for most chatting.</dd>
          <dt>Max response tokens</dt><dd>A length limit. If replies get cut off, raise it.</dd>
        </dl></div>
      </details>
    </div>

    <div class="card-surface settings-section" id="remoteSection">
      <h3>${iconPlaceholder("cloudArrow", { size: 16 })}Remote models (optional)</h3>
      <div class="disclaimer-box">
        ${iconPlaceholder("alert", { size: 18 })}
        <div class="text"><strong>Not local, not private.</strong> If you enable a remote provider below, your messages (and any attached files/images) are sent directly from this browser to that provider's own servers — never through anything of ours, since this app has no backend. Your API key is stored only in this browser. Everything else in this app defaults to fully on-device, offline-capable inference.</div>
      </div>
      <div class="provider-tabs" id="providerTabs"></div>
      <div id="providerFieldsHost"></div>
    </div>

    <div class="card-surface settings-section" id="storageSection">
      <h3>${iconPlaceholder("database", { size: 16 })}Storage management</h3>
      <div id="storageHost">Calculating…</div>
    </div>
  `;
  els.mainView.appendChild(view);
  mountIcons(view);

  view.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setStoredTheme(btn.dataset.themeChoice);
      applyTheme(btn.dataset.themeChoice);
      refreshThemeButton();
    });
  });

  const recBtn = view.querySelector("#useRecommendedBtn");
  if (recBtn) {
    recBtn.addEventListener("click", async () => {
      state.settings.selectedModelId = rec.primary.model_id;
      state.settings.activeProvider = "local";
      await saveSettings(state.settings);
      toast(`Selected ${rec.primary.model_id}. Go to Chat and press "Load model".`);
      setRoute("chat");
    });
  }

  wireGenerationControls(view, s);
  wireRemoteProviderControls(view, s);
  wireStorageManagement(view);
}

function wireGenerationControls(view, s) {
  const modeToggle = view.querySelector("#genModeToggle");
  const beginnerControls = view.querySelector("#beginnerControls");
  const advancedControls = view.querySelector("#advancedControls");
  function refreshModeUI() {
    modeToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === s.generationMode));
    beginnerControls.classList.toggle("hidden", s.generationMode !== "beginner");
    advancedControls.classList.toggle("hidden", s.generationMode !== "advanced");
  }
  refreshModeUI();
  modeToggle.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      s.generationMode = btn.dataset.mode;
      await saveSettings(s);
      refreshModeUI();
    });
  });

  const presetGrid = view.querySelector("#presetGrid");
  function renderPresets() {
    presetGrid.innerHTML = "";
    const active = matchesPreset(s.temperature, s.topP);
    for (const [key, p] of Object.entries(GENERATION_PRESETS)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "preset-card" + (active === key ? " active" : "");
      card.innerHTML = `<div class="pc-title">${p.label}</div><div class="pc-desc">${p.description}</div>`;
      card.addEventListener("click", async () => {
        s.temperature = p.temperature;
        s.topP = p.topP;
        s.activePreset = key;
        await saveSettings(s);
        renderPresets();
        syncAdvancedInputsFromSettings();
      });
      presetGrid.appendChild(card);
    }
  }
  renderPresets();

  const maxTokensSelect = view.querySelector("#maxTokensPresetSelect");
  const closestPresetValue = MAX_TOKENS_PRESETS.reduce((best, p) => (Math.abs(p.value - s.maxTokens) < Math.abs(best - s.maxTokens) ? p.value : best), MAX_TOKENS_PRESETS[1].value);
  maxTokensSelect.value = String(closestPresetValue);
  maxTokensSelect.addEventListener("change", async () => {
    s.maxTokens = parseInt(maxTokensSelect.value, 10);
    await saveSettings(s);
    const rawInput = view.querySelector("#maxTokensInput");
    if (rawInput) rawInput.value = s.maxTokens;
  });

  const tempRange = view.querySelector("#tempRange");
  const tempPill = view.querySelector("#tempValuePill");
  const topPRange = view.querySelector("#topPRange");
  const topPPill = view.querySelector("#topPValuePill");
  const freqRange = view.querySelector("#freqRange");
  const freqPill = view.querySelector("#freqValuePill");
  const presRange = view.querySelector("#presRange");
  const presPill = view.querySelector("#presValuePill");
  const maxTokensInput = view.querySelector("#maxTokensInput");

  function syncAdvancedInputsFromSettings() {
    tempRange.value = s.temperature; tempPill.textContent = s.temperature.toFixed(2);
    topPRange.value = s.topP; topPPill.textContent = s.topP.toFixed(2);
    freqRange.value = s.frequencyPenalty; freqPill.textContent = s.frequencyPenalty.toFixed(2);
    presRange.value = s.presencePenalty; presPill.textContent = s.presencePenalty.toFixed(2);
    maxTokensInput.value = s.maxTokens;
  }
  tempRange.addEventListener("input", async () => { s.temperature = parseFloat(tempRange.value); tempPill.textContent = s.temperature.toFixed(2); await saveSettings(s); renderPresets(); });
  topPRange.addEventListener("input", async () => { s.topP = parseFloat(topPRange.value); topPPill.textContent = s.topP.toFixed(2); await saveSettings(s); renderPresets(); });
  freqRange.addEventListener("input", async () => { s.frequencyPenalty = parseFloat(freqRange.value); freqPill.textContent = s.frequencyPenalty.toFixed(2); await saveSettings(s); });
  presRange.addEventListener("input", async () => { s.presencePenalty = parseFloat(presRange.value); presPill.textContent = s.presencePenalty.toFixed(2); await saveSettings(s); });
  maxTokensInput.addEventListener("change", async () => {
    s.maxTokens = parseInt(maxTokensInput.value, 10) || 512;
    await saveSettings(s);
    const closest = MAX_TOKENS_PRESETS.reduce((best, p) => (Math.abs(p.value - s.maxTokens) < Math.abs(best - s.maxTokens) ? p.value : best), MAX_TOKENS_PRESETS[1].value);
    maxTokensSelect.value = String(closest);
  });
  view.querySelector("#resetGenDefaultsBtn").addEventListener("click", async () => {
    const balanced = GENERATION_PRESETS.balanced;
    s.temperature = balanced.temperature; s.topP = balanced.topP; s.frequencyPenalty = 0; s.presencePenalty = 0; s.maxTokens = 512;
    await saveSettings(s);
    syncAdvancedInputsFromSettings();
    renderPresets();
    maxTokensSelect.value = "512";
    toast("Generation settings reset to Balanced defaults.");
  });
  view.querySelectorAll(".info-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = view.querySelector(`#${btn.dataset.info}`);
      if (target) target.classList.toggle("hidden");
    });
  });
}

function wireRemoteProviderControls(view, s) {
  const tabsEl = view.querySelector("#providerTabs");
  const fieldsHost = view.querySelector("#providerFieldsHost");
  const PROVIDERS = [
    { key: "local", label: "Local (this device)" },
    { key: "openai_compatible", label: "OpenAI-compatible" },
    { key: "gemini", label: "Google Gemini" },
  ];

  function renderTabs() {
    tabsEl.innerHTML = "";
    PROVIDERS.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "chip" + (s.activeProvider === p.key ? " active" : "");
      btn.textContent = p.label;
      btn.addEventListener("click", async () => {
        s.activeProvider = p.key;
        await saveSettings(s);
        renderTabs();
        renderFields();
        toast(`Active provider: ${p.label}`);
      });
      tabsEl.appendChild(btn);
    });
  }

  function renderFields() {
    fieldsHost.innerHTML = "";
    if (s.activeProvider === "local") {
      fieldsHost.innerHTML = `<p class="hint">Using the on-device model selected in Chat. No API key needed, works fully offline once downloaded.</p>`;
      return;
    }
    if (s.activeProvider === "openai_compatible") {
      const cfg = s.remoteProviders.openai_compatible;
      fieldsHost.innerHTML = `
        <div class="preset-btn-row" id="oaPresetRow"></div>
        <div class="provider-fields">
          <div><label>Base URL</label><input id="oaBaseUrl" placeholder="https://api.deepseek.com/v1" value="${escapeAttr(cfg.baseUrl)}"/></div>
          <div><label>Model name (or paste a Hugging Face model URL)</label><input id="oaModel" placeholder="deepseek-chat" value="${escapeAttr(cfg.model)}"/></div>
          <div class="field-with-toggle"><label>API key</label><input id="oaKey" type="password" placeholder="sk-…" value="${escapeAttr(cfg.apiKey)}"/><button type="button" class="reveal-key-btn" id="oaKeyToggle">${iconPlaceholder("eye", { size: 15 })}</button></div>
          <button class="btn primary sm" id="oaSave" style="align-self:flex-start;">Save</button>
        </div>
        <p class="hint" style="margin-top:10px;">Works with any OpenAI-compatible endpoint: DeepSeek, Hugging Face's Inference Providers router, OpenAI itself, Together, Groq, or your own local server. Pasting a Hugging Face model page URL into the model field auto-extracts the "org/model" id.</p>
      `;
      mountIcons(fieldsHost);
      const presetRow = fieldsHost.querySelector("#oaPresetRow");
      Object.entries(OPENAI_COMPATIBLE_PRESETS).forEach(([key, preset]) => {
        const btn = document.createElement("button");
        btn.className = "chip";
        btn.textContent = preset.label;
        btn.addEventListener("click", () => {
          fieldsHost.querySelector("#oaBaseUrl").value = preset.baseUrl;
          fieldsHost.querySelector("#oaModel").placeholder = preset.modelPlaceholder;
        });
        presetRow.appendChild(btn);
      });
      const keyInput = fieldsHost.querySelector("#oaKey");
      fieldsHost.querySelector("#oaKeyToggle").addEventListener("click", () => {
        keyInput.type = keyInput.type === "password" ? "text" : "password";
      });
      const modelInput = fieldsHost.querySelector("#oaModel");
      modelInput.addEventListener("blur", () => {
        if (modelInput.value.includes("huggingface.co")) modelInput.value = parseHuggingFaceModelInput(modelInput.value);
      });
      fieldsHost.querySelector("#oaSave").addEventListener("click", async () => {
        cfg.baseUrl = fieldsHost.querySelector("#oaBaseUrl").value.trim();
        cfg.model = modelInput.value.trim();
        cfg.apiKey = keyInput.value.trim();
        await saveSettings(s);
        toast("Remote endpoint saved.");
      });
      return;
    }
    if (s.activeProvider === "gemini") {
      const cfg = s.remoteProviders.gemini;
      fieldsHost.innerHTML = `
        <div class="provider-fields">
          <div><label>Model</label><input id="gModel" placeholder="gemini-2.5-flash" value="${escapeAttr(cfg.model)}"/></div>
          <div class="field-with-toggle"><label>API key</label><input id="gKey" type="password" placeholder="AIza…" value="${escapeAttr(cfg.apiKey)}"/><button type="button" class="reveal-key-btn" id="gKeyToggle">${iconPlaceholder("eye", { size: 15 })}</button></div>
          <button class="btn primary sm" id="gSave" style="align-self:flex-start;">Save</button>
        </div>
        <p class="hint" style="margin-top:10px;">Get a free API key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a>. Supports image attachments natively.</p>
      `;
      mountIcons(fieldsHost);
      const keyInput = fieldsHost.querySelector("#gKey");
      fieldsHost.querySelector("#gKeyToggle").addEventListener("click", () => { keyInput.type = keyInput.type === "password" ? "text" : "password"; });
      fieldsHost.querySelector("#gSave").addEventListener("click", async () => {
        cfg.model = fieldsHost.querySelector("#gModel").value.trim();
        cfg.apiKey = keyInput.value.trim();
        await saveSettings(s);
        toast("Gemini settings saved.");
      });
    }
  }

  renderTabs();
  renderFields();
}

async function wireStorageManagement(view) {
  const host = view.querySelector("#storageHost");
  const [{ usage, quota }, breakdown] = await Promise.all([getStorageEstimate(), getCacheBreakdown()]);
  const totalCached = Object.values(breakdown).reduce((sum, b) => sum + b.bytes, 0);
  const colors = ["#fe551b", "#0ea5e9", "#16a34a", "#a855f7", "#79716b", "#f59e0b"];
  const keys = Object.keys(BUCKET_LABELS);

  host.innerHTML = `
    <div class="storage-total">
      <span class="big">${formatSizeMB(totalCached / (1024 * 1024))}</span>
      <span class="of">cached${quota ? ` · ${formatSizeMB(usage / (1024 * 1024))} / ${formatSizeMB(quota / (1024 * 1024))} browser quota used` : ""}</span>
    </div>
    <div class="storage-bar-track">${keys.map((k, i) => (breakdown[k].bytes ? `<div class="storage-bar-seg" style="width:${(breakdown[k].bytes / (totalCached || 1)) * 100}%; background:${colors[i % colors.length]}"></div>` : "")).join("")}</div>
    <div id="storageRows"></div>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="btn sm" id="storageRefresh">${iconPlaceholder("refresh", { size: 13 })}<span>Refresh</span></button>
      <button class="btn sm danger" id="storageClearAll">${iconPlaceholder("trash", { size: 13 })}<span>Clear everything</span></button>
    </div>
    <div class="settings-row" style="margin-top:6px;">
      <div class="label-block"><div class="t">Persistent storage</div><div class="d">Ask the browser not to evict cached model weights under storage pressure</div></div>
      <button class="btn sm" id="persistBtn">Request</button>
    </div>
    <div class="settings-row">
      <div class="label-block"><div class="t">Reset memory board</div><div class="d">Restores the default columns &amp; example cards</div></div>
      <button class="btn sm danger" id="resetBoardBtn">Reset</button>
    </div>
  `;
  mountIcons(host);

  const rowsEl = host.querySelector("#storageRows");
  keys.forEach((k, i) => {
    if (!breakdown[k].count) return;
    const row = document.createElement("div");
    row.className = "storage-breakdown-row";
    row.innerHTML = `
      <span class="storage-color-dot" style="background:${colors[i % colors.length]}"></span>
      <div class="sb-label">${BUCKET_LABELS[k]}<div class="sb-meta">${breakdown[k].count} file${breakdown[k].count === 1 ? "" : "s"}</div></div>
      <span class="sb-size">${formatSizeMB(breakdown[k].bytes / (1024 * 1024))}</span>
      <button class="btn icon ghost sm" data-bucket="${k}" title="Clear ${BUCKET_LABELS[k]}">${iconPlaceholder("trash", { size: 13 })}</button>
    `;
    rowsEl.appendChild(row);
  });
  mountIcons(rowsEl);
  rowsEl.querySelectorAll("[data-bucket]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.bucket;
      if (!confirm(`Clear "${BUCKET_LABELS[key]}"? You may need to re-download it next time you use that feature.`)) return;
      await clearBucket(key);
      toast(`Cleared ${BUCKET_LABELS[key]}.`);
      wireStorageManagement(view);
    });
  });

  host.querySelector("#storageRefresh").addEventListener("click", () => wireStorageManagement(view));
  host.querySelector("#storageClearAll").addEventListener("click", async () => {
    if (!confirm("This clears ALL cached files and models. Continue?")) return;
    await clearAllCaches();
    toast("Cache cleared. Reloading…");
    setTimeout(() => location.reload(), 800);
  });
  host.querySelector("#persistBtn").addEventListener("click", async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      toast(granted ? "Persistent storage granted." : "Browser declined persistent storage.");
    } else toast("This browser doesn't support the storage persistence API.", "error");
  });
  host.querySelector("#resetBoardBtn").addEventListener("click", async () => {
    if (!confirm("Reset the memory board to defaults? This can't be undone.")) return;
    state.board = defaultBoard();
    await saveBoard(state.board);
    toast("Memory board reset.");
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str ?? "").replace(/"/g, "&quot;");
}

/* ============================================================================
   INIT
   ============================================================================ */
async function init() {
  initTheme();
  refreshThemeButton();

  state.board = await loadBoard();
  state.settings = await loadSettings();
  state.conv = await loadConversations();

  renderRoute();

  state.device = await detectDevice();
  updateSidebarStatus();

  try {
    state.modelList = await getModelList();
    state.recommendation = recommendModels(state.modelList, state.device);
  } catch (err) {
    toast("Couldn't reach the model registry — check your connection for first-time setup.", "error");
  }

  renderRoute();

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((already) => { if (!already) navigator.storage.persist(); });
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
