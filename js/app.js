import { initTheme, cycleTheme, getStoredTheme } from "./theme.js";
import {
  loadBoard,
  saveBoard,
  loadSettings,
  saveSettings,
  loadChatHistory,
  saveChatHistory,
  GENERATION_PRESETS,
  MAX_TOKENS_PRESETS,
} from "./storage.js";
import { KanbanBoard } from "./kanban.js";
import { LLMEngine, getModelList } from "./llm.js";
import { detectDevice, recommendModels } from "./device.js";
import { evaluateCardContent } from "./formula.js";
import { icon, iconPlaceholder, mountIcons, preloadAllIcons } from "./icons.js";
import { openModelPicker } from "./modelpicker.js";
import { formatSizeMB, extractFamily } from "./modelutils.js";

/* --------------------------------- State --------------------------------- */
const state = {
  route: "chat",
  board: null,
  settings: null,
  chatHistory: [],
  device: null,
  modelList: [],
  recommendation: null,
  engine: new LLMEngine(),
  modelStatus: "unloaded", // unloaded | loading | ready | error
  generating: false,
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
  }, 3400);
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
  document.querySelectorAll(".nav-item, .tabbar-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
  closeSidebar();
  renderRoute();
}

document.querySelectorAll(".nav-item, .tabbar-item").forEach((el) => {
  el.addEventListener("click", () => setRoute(el.dataset.route));
});

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarScrim.style.display = "block";
}
function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarScrim.style.display = "none";
}
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
  if (!state.device) {
    els.statusDot.className = "dot";
    els.statusText.textContent = "Checking device…";
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

/* ============================================================================
   CHAT VIEW
   ============================================================================ */
function buildSystemPrompt() {
  const board = state.board;
  const sections = [];
  for (const col of board.columns) {
    if (!col.injectIntoPrompt) continue;
    const cards = board.cards.filter((c) => c.columnId === col.id);
    if (!cards.length) continue;
    const lines = cards.map((c) => `- ${c.title}: ${evaluateCardContent(board, c)}`);
    sections.push(`## ${col.title}\n${lines.join("\n")}`);
  }
  if (!sections.length) return "You are a helpful, concise on-device assistant.";
  return `You are a helpful on-device assistant. Use the following memory (kept in a Kanban board by the user) as authoritative context about the user and how to behave:\n\n${sections.join(
    "\n\n"
  )}`;
}

function findModelById(id) {
  return state.modelList.find((m) => m.model_id === id) || null;
}

function renderChatView() {
  const view = document.createElement("div");
  view.className = "chat-view";
  view.innerHTML = `
    <div class="chat-model-bar">
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
    </div>
    <div class="progress-wrap hidden" id="progressWrap">
      <div class="progress-track"><div class="progress-bar" id="progressBar"></div></div>
      <div class="progress-label" id="progressLabel"></div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="chat-input-bar">
      <div class="chat-input-row">
        <textarea id="chatInput" rows="1" placeholder="Ask your on-device assistant… (Shift+Enter for newline)"></textarea>
        <button class="btn primary icon" id="sendBtn"></button>
        <button class="btn icon hidden" id="stopBtn" title="Stop generating"></button>
      </div>
    </div>
  `;
  els.mainView.appendChild(view);
  mountIcons(view);
  view.querySelector("#sendBtn").appendChild(icon("send", { size: 16 }));
  view.querySelector("#stopBtn").appendChild(icon("stop", { size: 16 }));

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

  function refreshModelButton() {
    const selected = findModelById(state.settings.selectedModelId) || state.recommendation?.primary;
    if (!selected) {
      msbName.textContent = state.modelList.length ? "Choose a model…" : "Loading model list…";
      msbMeta.textContent = "";
      return;
    }
    const isRec = state.recommendation?.primary?.model_id === selected.model_id;
    msbName.textContent = selected.model_id;
    msbMeta.textContent = `${formatSizeMB(selected.vram_required_MB)} · ${extractFamily(selected.model_id)}${isRec ? " · ★ recommended for your device" : ""}`;
    if (!state.settings.selectedModelId) state.settings.selectedModelId = selected.model_id;
  }
  refreshModelButton();
  updateModelStatusBadge(statusBadge);

  modelBtn.addEventListener("click", () => {
    if (!state.modelList.length) {
      toast("Still fetching the model catalog — try again in a moment.", "error");
      return;
    }
    openModelPicker({
      modelList: state.modelList,
      device: state.device,
      recommendation: state.recommendation,
      currentSelection: state.settings.selectedModelId,
      onSelect: async (model) => {
        state.settings.selectedModelId = model.model_id;
        await saveSettings(state.settings);
        refreshModelButton();
      },
    });
  });

  renderMessages(messagesEl);

  loadBtn.addEventListener("click", () => {
    const modelId = state.settings.selectedModelId || state.recommendation?.primary?.model_id;
    if (!modelId) {
      toast("Pick a model first.", "error");
      return;
    }
    loadSelectedModel(modelId, { progressWrap, progressBar, progressLabel, statusBadge, loadBtn });
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
  });
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(chatInput, messagesEl, sendBtn, stopBtn);
    }
  });
  sendBtn.addEventListener("click", () => handleSend(chatInput, messagesEl, sendBtn, stopBtn));
  stopBtn.addEventListener("click", async () => {
    await state.engine.interrupt();
  });
}

function updateModelStatusBadge(badge) {
  const map = {
    unloaded: ["", "Not loaded"],
    loading: ["accent", "Loading…"],
    ready: ["success", "Ready"],
    error: ["danger", "Error"],
  };
  const [cls, label] = map[state.modelStatus] || map.unloaded;
  badge.className = `badge ${cls}`;
  badge.textContent = label;
}

async function loadSelectedModel(modelId, ui) {
  if (!modelId) return;
  if (!state.device?.gpu?.supported) {
    toast("WebGPU isn't available in this browser, so WebLLM can't run here.", "error");
    return;
  }
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

function renderMessages(container) {
  container.innerHTML = "";
  if (!state.chatHistory.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="icon">💬</div><p><strong>No messages yet.</strong></p><p>Pick a model above, load it, and start chatting — entirely on this device, offline once cached.</p>`;
    container.appendChild(empty);
    return;
  }
  for (const m of state.chatHistory) container.appendChild(renderMessageBubble(m));
  container.scrollTop = container.scrollHeight;
}

function renderMessageBubble(m) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${m.role}`;
  wrap.innerHTML = `
    <div class="avatar">${m.role === "user" ? "You" : "AI"}</div>
    <div class="msg-body">
      <div class="msg-bubble"></div>
    </div>
  `;
  wrap.querySelector(".msg-bubble").textContent = m.content;
  return wrap;
}

async function handleSend(input, messagesEl, sendBtn, stopBtn) {
  const text = input.value.trim();
  if (!text || state.generating) return;
  if (state.modelStatus !== "ready") {
    toast("Load a model first.", "error");
    return;
  }
  input.value = "";
  input.style.height = "auto";
  state.chatHistory.push({ role: "user", content: text, at: Date.now() });
  renderMessages(messagesEl);
  await saveChatHistory(state.chatHistory);

  const assistantMsg = { role: "assistant", content: "", at: Date.now() };
  state.chatHistory.push(assistantMsg);
  renderMessages(messagesEl);
  const bubble = messagesEl.lastElementChild.querySelector(".msg-bubble");

  state.generating = true;
  sendBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");

  const systemPrompt = buildSystemPrompt();
  const messages = [
    { role: "system", content: systemPrompt },
    ...state.chatHistory.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    await state.engine.chatStream(messages, {
      temperature: state.settings.temperature,
      topP: state.settings.topP,
      frequencyPenalty: state.settings.frequencyPenalty,
      presencePenalty: state.settings.presencePenalty,
      maxTokens: state.settings.maxTokens,
      onToken: (_delta, full) => {
        assistantMsg.content = full;
        bubble.textContent = full;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      },
    });
  } catch (err) {
    assistantMsg.content = `⚠️ ${err.message}`;
    bubble.textContent = assistantMsg.content;
  }

  state.generating = false;
  sendBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  await saveChatHistory(state.chatHistory);
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
    setBoard: async (b) => {
      state.board = b;
      await saveBoard(state.board);
    },
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
      <p class="hint" style="margin-top:10px;">
        Browsers don't expose real VRAM for privacy reasons, so this budget is a conservative estimate combining
        WebGPU availability, reported RAM (when available), CPU cores, and platform. You can always pick a
        different model manually from the searchable list in Chat.
      </p>
      ${
        rec?.primary
          ? `<div class="model-rec-card">
              <div>
                <div class="name">${rec.primary.model_id}</div>
                <div class="meta">${formatSizeMB(rec.primary.vram_required_MB)} VRAM · ${rec.fits ? "fits comfortably" : "closest available fit"}</div>
              </div>
              <button class="btn sm accent" id="useRecommendedBtn">Use this model</button>
            </div>`
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
      <div class="mode-toggle" id="genModeToggle">
        <button data-mode="beginner">Beginner</button>
        <button data-mode="advanced">Advanced</button>
      </div>

      <div id="beginnerControls" style="margin-top:14px;">
        <label>Response style</label>
        <div class="preset-grid" id="presetGrid"></div>

        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Response length</span>
          </div>
          <select id="maxTokensPresetSelect">
            ${MAX_TOKENS_PRESETS.map((p) => `<option value="${p.value}">${p.label} — ${p.description}</option>`).join("")}
          </select>
        </div>
      </div>

      <div id="advancedControls" class="hidden" style="margin-top:8px;">
        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Temperature <button class="info-btn" data-info="tempDesc">${iconPlaceholder("info", { size: 14 })}</button></span>
            <span class="value-pill" id="tempValuePill">${s.temperature.toFixed(2)}</span>
          </div>
          <input type="range" id="tempRange" min="0" max="1.5" step="0.05" value="${s.temperature}" />
          <div class="control-desc hidden" id="tempDesc">
            Controls how "random" each next word is. <strong>Lower</strong> (0–0.4) = focused, predictable, best for facts/code.
            <strong>Higher</strong> (0.9–1.5) = more varied and surprising, good for brainstorming — but can wander off-topic
            or get less coherent at the extreme end.
          </div>
        </div>
        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Top-p (nucleus sampling) <button class="info-btn" data-info="topPDesc">${iconPlaceholder("info", { size: 14 })}</button></span>
            <span class="value-pill" id="topPValuePill">${s.topP.toFixed(2)}</span>
          </div>
          <input type="range" id="topPRange" min="0.1" max="1" step="0.01" value="${s.topP}" />
          <div class="control-desc hidden" id="topPDesc">
            Limits word choices to the smallest set whose combined probability reaches this value.
            <strong>Lower</strong> = safer, more predictable word choices. <strong>Higher</strong> (close to 1) = considers
            more unusual words. Usually left around 0.9–0.95; only lower it if answers feel too erratic.
          </div>
        </div>
        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Frequency penalty <button class="info-btn" data-info="freqDesc">${iconPlaceholder("info", { size: 14 })}</button></span>
            <span class="value-pill" id="freqValuePill">${s.frequencyPenalty.toFixed(2)}</span>
          </div>
          <input type="range" id="freqRange" min="-2" max="2" step="0.1" value="${s.frequencyPenalty}" />
          <div class="control-desc hidden" id="freqDesc">
            Discourages repeating the exact same words/phrases too often. Raise it if the model starts looping or
            repeating itself; keep at 0 for normal use.
          </div>
        </div>
        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Presence penalty <button class="info-btn" data-info="presDesc">${iconPlaceholder("info", { size: 14 })}</button></span>
            <span class="value-pill" id="presValuePill">${s.presencePenalty.toFixed(2)}</span>
          </div>
          <input type="range" id="presRange" min="-2" max="2" step="0.1" value="${s.presencePenalty}" />
          <div class="control-desc hidden" id="presDesc">
            Encourages the model to bring up new topics/words it hasn't used yet in this reply, rather than sticking
            to a narrow theme. Raise for more variety; keep at 0 for normal use.
          </div>
        </div>
        <div class="control-block">
          <div class="control-head">
            <span class="label-main">Max response tokens <button class="info-btn" data-info="maxTokDesc">${iconPlaceholder("info", { size: 14 })}</button></span>
          </div>
          <input type="number" id="maxTokensInput" min="32" max="4096" step="32" value="${s.maxTokens}" />
          <div class="control-desc hidden" id="maxTokDesc">
            A hard cap on how long a single reply can be, measured in "tokens" (roughly ¾ of a word each). Higher
            allows longer answers but takes more time and memory; very low values may cut answers off mid-sentence.
          </div>
        </div>
        <button class="btn sm" id="resetGenDefaultsBtn">${iconPlaceholder("refresh", { size: 13 })}<span>Reset to Balanced defaults</span></button>
      </div>

      <details class="guide">
        <summary>${iconPlaceholder("circleInfo", { size: 15 })}<span>New to these settings? Read a 30-second guide</span><span class="icon-box icon-16 chev" style="margin-left:auto;" data-icon="chevronDown"></span></summary>
        <div class="guide-body">
          <dl>
            <dt>System prompt</dt>
            <dd>The instructions the model always sees, built automatically from your Memory Board columns marked "Feed into assistant context".</dd>
            <dt>Temperature &amp; Top-p</dt>
            <dd>Both control randomness. Start with the presets above — Balanced works well for most chatting. Only go to Advanced mode if you want to fine-tune further.</dd>
            <dt>Frequency &amp; presence penalty</dt>
            <dd>Advanced knobs for reducing repetition or encouraging topic variety. Safe to leave at 0.</dd>
            <dt>Max response tokens</dt>
            <dd>Think of this as a length limit. If replies get cut off, raise it (Long/Very long, or a higher number in Advanced mode).</dd>
          </dl>
        </div>
      </details>
    </div>

    <div class="card-surface settings-section">
      <h3>${iconPlaceholder("archive", { size: 16 })}Storage &amp; offline</h3>
      <div class="settings-row">
        <div class="label-block"><div class="t">Persistent storage</div><div class="d">Prevents the browser from evicting cached model weights</div></div>
        <button class="btn sm" id="persistBtn">Request</button>
      </div>
      <div class="settings-row">
        <div class="label-block"><div class="t">Clear cached model &amp; app data</div><div class="d">Frees space; you'll need to be online to reload models</div></div>
        <button class="btn sm danger" id="clearCacheBtn">Clear</button>
      </div>
      <div class="settings-row">
        <div class="label-block"><div class="t">Reset memory board</div><div class="d">Restores the default columns &amp; example cards</div></div>
        <button class="btn sm danger" id="resetBoardBtn">Reset</button>
      </div>
    </div>
  `;
  els.mainView.appendChild(view);
  mountIcons(view);

  view.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      import("./theme.js").then(({ setStoredTheme, applyTheme }) => {
        setStoredTheme(btn.dataset.themeChoice);
        applyTheme(btn.dataset.themeChoice);
        refreshThemeButton();
      });
    });
  });

  const recBtn = view.querySelector("#useRecommendedBtn");
  if (recBtn) {
    recBtn.addEventListener("click", async () => {
      state.settings.selectedModelId = rec.primary.model_id;
      await saveSettings(state.settings);
      toast(`Selected ${rec.primary.model_id}. Go to Chat and press "Load model".`);
      setRoute("chat");
    });
  }

  /* ---- Generation: mode toggle ---- */
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

  /* ---- Generation: presets (beginner) ---- */
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

  /* ---- Generation: max tokens preset select (beginner) ---- */
  const maxTokensSelect = view.querySelector("#maxTokensPresetSelect");
  const closestPresetValue = MAX_TOKENS_PRESETS.reduce((best, p) => (Math.abs(p.value - s.maxTokens) < Math.abs(best - s.maxTokens) ? p.value : best), MAX_TOKENS_PRESETS[1].value);
  maxTokensSelect.value = String(closestPresetValue);
  maxTokensSelect.addEventListener("change", async () => {
    s.maxTokens = parseInt(maxTokensSelect.value, 10);
    await saveSettings(s);
    const rawInput = view.querySelector("#maxTokensInput");
    if (rawInput) rawInput.value = s.maxTokens;
  });

  /* ---- Generation: advanced sliders ---- */
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
    tempRange.value = s.temperature;
    tempPill.textContent = s.temperature.toFixed(2);
    topPRange.value = s.topP;
    topPPill.textContent = s.topP.toFixed(2);
    freqRange.value = s.frequencyPenalty;
    freqPill.textContent = s.frequencyPenalty.toFixed(2);
    presRange.value = s.presencePenalty;
    presPill.textContent = s.presencePenalty.toFixed(2);
    maxTokensInput.value = s.maxTokens;
  }

  tempRange.addEventListener("input", async () => {
    s.temperature = parseFloat(tempRange.value);
    tempPill.textContent = s.temperature.toFixed(2);
    await saveSettings(s);
    renderPresets();
  });
  topPRange.addEventListener("input", async () => {
    s.topP = parseFloat(topPRange.value);
    topPPill.textContent = s.topP.toFixed(2);
    await saveSettings(s);
    renderPresets();
  });
  freqRange.addEventListener("input", async () => {
    s.frequencyPenalty = parseFloat(freqRange.value);
    freqPill.textContent = s.frequencyPenalty.toFixed(2);
    await saveSettings(s);
  });
  presRange.addEventListener("input", async () => {
    s.presencePenalty = parseFloat(presRange.value);
    presPill.textContent = s.presencePenalty.toFixed(2);
    await saveSettings(s);
  });
  maxTokensInput.addEventListener("change", async () => {
    s.maxTokens = parseInt(maxTokensInput.value, 10) || 512;
    await saveSettings(s);
    const closest = MAX_TOKENS_PRESETS.reduce((best, p) => (Math.abs(p.value - s.maxTokens) < Math.abs(best - s.maxTokens) ? p.value : best), MAX_TOKENS_PRESETS[1].value);
    maxTokensSelect.value = String(closest);
  });

  view.querySelector("#resetGenDefaultsBtn").addEventListener("click", async () => {
    const balanced = GENERATION_PRESETS.balanced;
    s.temperature = balanced.temperature;
    s.topP = balanced.topP;
    s.frequencyPenalty = 0;
    s.presencePenalty = 0;
    s.maxTokens = 512;
    await saveSettings(s);
    syncAdvancedInputsFromSettings();
    renderPresets();
    maxTokensSelect.value = "512";
    toast("Generation settings reset to Balanced defaults.");
  });

  /* ---- info disclosure buttons ---- */
  view.querySelectorAll(".info-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = view.querySelector(`#${btn.dataset.info}`);
      if (target) target.classList.toggle("hidden");
    });
  });

  view.querySelector("#persistBtn").addEventListener("click", async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      toast(granted ? "Persistent storage granted." : "Browser declined persistent storage.");
    } else {
      toast("This browser doesn't support the storage persistence API.", "error");
    }
  });
  view.querySelector("#clearCacheBtn").addEventListener("click", async () => {
    if (!confirm("This clears all cached files and models. Continue?")) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    toast("Cache cleared. Reloading…");
    setTimeout(() => location.reload(), 800);
  });
  view.querySelector("#resetBoardBtn").addEventListener("click", async () => {
    if (!confirm("Reset the memory board to defaults? This can't be undone.")) return;
    const { defaultBoard } = await import("./storage.js");
    state.board = defaultBoard();
    await saveBoard(state.board);
    toast("Memory board reset.");
  });
}

/* ============================================================================
   INIT
   ============================================================================ */
async function init() {
  initTheme();
  refreshThemeButton();

  state.board = await loadBoard();
  state.settings = await loadSettings();
  state.chatHistory = await loadChatHistory();

  renderRoute(); // render chat view immediately (empty state) while device/model info loads

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
    navigator.storage.persisted().then((already) => {
      if (!already) navigator.storage.persist();
    });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
