import { initTheme, cycleTheme, getStoredTheme } from "./theme.js";
import { loadBoard, saveBoard, loadSettings, saveSettings, loadChatHistory, saveChatHistory } from "./storage.js";
import { KanbanBoard } from "./kanban.js";
import { LLMEngine, getModelList } from "./llm.js";
import { detectDevice, recommendModels } from "./device.js";
import { evaluateCardContent } from "./formula.js";
import { Icon } from "./icons.js";

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

/* --------------------------------- Toasts --------------------------------- */
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = msg;
  els.toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* --------------------------------- Theme --------------------------------- */
function themeIconFor(pref) {
  if (pref === "light") return Icon.sun;
  if (pref === "dark") return Icon.moon;
  return Icon.laptop;
}
function refreshThemeButton() {
  els.themeToggle.innerHTML = themeIconFor(getStoredTheme());
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

function renderChatView() {
  const view = document.createElement("div");
  view.className = "chat-view";
  view.innerHTML = `
    <div class="chat-model-bar">
      <select id="modelSelect"></select>
      <button class="btn sm accent" id="loadModelBtn">Load model</button>
      <span class="recommend-pill" id="recommendPill"></span>
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
        <button class="btn primary icon" id="sendBtn">${Icon.send}</button>
        <button class="btn icon hidden" id="stopBtn" title="Stop generating">${Icon.stop}</button>
      </div>
    </div>
  `;
  els.mainView.appendChild(view);

  const modelSelect = view.querySelector("#modelSelect");
  const loadBtn = view.querySelector("#loadModelBtn");
  const recommendPill = view.querySelector("#recommendPill");
  const statusBadge = view.querySelector("#modelStatusBadge");
  const progressWrap = view.querySelector("#progressWrap");
  const progressBar = view.querySelector("#progressBar");
  const progressLabel = view.querySelector("#progressLabel");
  const messagesEl = view.querySelector("#messages");
  const chatInput = view.querySelector("#chatInput");
  const sendBtn = view.querySelector("#sendBtn");
  const stopBtn = view.querySelector("#stopBtn");

  populateModelSelect(modelSelect);
  updateModelStatusBadge(statusBadge);
  if (state.recommendation?.primary) {
    recommendPill.innerHTML = `${Icon.chip}<span>Recommended: ${state.recommendation.primary.model_id}</span>`;
  }

  renderMessages(messagesEl);

  loadBtn.addEventListener("click", () => loadSelectedModel(modelSelect.value, { progressWrap, progressBar, progressLabel, statusBadge, loadBtn }));

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

function populateModelSelect(select) {
  select.innerHTML = "";
  if (!state.modelList.length) {
    select.innerHTML = `<option>Loading model list…</option>`;
    return;
  }
  const rec = state.recommendation;
  const recIds = new Set([rec?.primary?.model_id, ...(rec?.alternatives || []).map((m) => m.model_id)].filter(Boolean));

  const makeOpt = (m) => {
    const opt = document.createElement("option");
    opt.value = m.model_id;
    const size = m.vram_required_MB ? `${(m.vram_required_MB / 1024).toFixed(1)}GB` : "";
    opt.textContent = `${recIds.has(m.model_id) ? "★ " : ""}${m.model_id} ${size ? `(${size})` : ""}`;
    return opt;
  };

  if (rec?.primary) select.appendChild(makeOpt(rec.primary));
  for (const alt of rec?.alternatives || []) select.appendChild(makeOpt(alt));

  const divider = document.createElement("option");
  divider.disabled = true;
  divider.textContent = "──────── All models ────────";
  select.appendChild(divider);

  const rest = state.modelList
    .filter((m) => typeof m.vram_required_MB === "number" && !recIds.has(m.model_id))
    .sort((a, b) => a.vram_required_MB - b.vram_required_MB);
  for (const m of rest) select.appendChild(makeOpt(m));

  if (state.settings.selectedModelId) select.value = state.settings.selectedModelId;
}

function updateModelStatusBadge(badge) {
  const map = {
    unloaded: ["", "Not loaded"],
    loading: ["accent", "Loading…"],
    ready: ["success", "Ready"],
    error: ["", "Error"],
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
function fmtMB(mb) {
  if (!mb) return "0 MB";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function renderSettingsView() {
  const view = document.createElement("div");
  view.className = "settings-view";
  const d = state.device;
  const rec = state.recommendation;

  view.innerHTML = `
    <div class="card-surface settings-section">
      <h3>Device &amp; WebGPU</h3>
      <div class="device-grid">
        <div class="device-stat"><div class="v">${d ? d.platform : "…"}</div><div class="k">Platform</div></div>
        <div class="device-stat"><div class="v">${d ? (d.isMobile ? "Mobile" : "Desktop") : "…"}</div><div class="k">Form factor</div></div>
        <div class="device-stat"><div class="v">${d?.deviceMemoryGB ? d.deviceMemoryGB + " GB" : "Not reported"}</div><div class="k">Device RAM</div></div>
        <div class="device-stat"><div class="v">${d?.cores || "Not reported"}</div><div class="k">CPU cores</div></div>
        <div class="device-stat"><div class="v">${d?.gpu?.supported ? "Supported" : "Unavailable"}</div><div class="k">WebGPU</div></div>
        <div class="device-stat"><div class="v">${d ? fmtMB(d.budgetMB) : "…"}</div><div class="k">Estimated model budget</div></div>
      </div>
      <p class="hint" style="margin-top:10px;">
        Browsers don't expose real VRAM for privacy reasons, so this budget is a conservative estimate combining
        WebGPU availability, reported RAM (when available), CPU cores, and platform. You can always pick a
        different model manually in Chat.
      </p>
      ${
        rec?.primary
          ? `<div class="model-rec-card">
              <div>
                <div class="name">${rec.primary.model_id}</div>
                <div class="meta">${fmtMB(rec.primary.vram_required_MB)} VRAM · ${rec.fits ? "fits comfortably" : "closest available fit"}</div>
              </div>
              <button class="btn sm accent" id="useRecommendedBtn">Use this model</button>
            </div>`
          : d && !d.gpu.supported
          ? `<div class="model-rec-card" style="background:var(--surface-alt); border-color:var(--border);"><div class="meta">No WebGPU-capable adapter found — try the latest Chrome/Edge, or Safari 26+ on iOS/macOS.</div></div>`
          : ""
      }
    </div>

    <div class="card-surface settings-section">
      <h3>Appearance</h3>
      <div class="settings-row">
        <div class="label-block"><div class="t">Theme</div><div class="d">Light, dark, or follow system</div></div>
        <div style="display:flex; gap:6px;">
          <button class="btn sm" data-theme-choice="light">Light</button>
          <button class="btn sm" data-theme-choice="dark">Dark</button>
          <button class="btn sm" data-theme-choice="system">System</button>
        </div>
      </div>
    </div>

    <div class="card-surface settings-section">
      <h3>Generation</h3>
      <div class="settings-row">
        <div class="label-block"><div class="t">Temperature</div><div class="d">Higher = more creative, lower = more focused</div></div>
        <input type="range" min="0" max="1.5" step="0.05" id="tempRange" style="width:140px" value="${state.settings.temperature}" />
        <span id="tempVal" class="badge">${state.settings.temperature}</span>
      </div>
      <div class="settings-row">
        <div class="label-block"><div class="t">Max response tokens</div></div>
        <input type="number" id="maxTokensInput" style="width:90px" min="32" max="4096" step="32" value="${state.settings.maxTokens}" />
      </div>
    </div>

    <div class="card-surface settings-section">
      <h3>Storage &amp; offline</h3>
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

  const tempRange = view.querySelector("#tempRange");
  const tempVal = view.querySelector("#tempVal");
  tempRange.addEventListener("input", async () => {
    state.settings.temperature = parseFloat(tempRange.value);
    tempVal.textContent = state.settings.temperature;
    await saveSettings(state.settings);
  });
  view.querySelector("#maxTokensInput").addEventListener("change", async (e) => {
    state.settings.maxTokens = parseInt(e.target.value, 10) || 512;
    await saveSettings(state.settings);
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

  if (state.route === "chat") renderRoute();
  if (state.route === "settings") renderRoute();

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
