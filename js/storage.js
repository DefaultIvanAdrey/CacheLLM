/**
 * storage.js
 * Local persistence for conversations, the Kanban "memory" board, and app
 * settings. Uses IndexedDB (offline-capable, larger quota than
 * localStorage) with a small promise wrapper. Also provides JSON
 * import/export of the whole memory board.
 */

const DB_NAME = "webllm-kanban-db";
const DB_VERSION = 1;
const STORE = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

const BOARD_KEY = "memory-board";
const SETTINGS_KEY = "app-settings";
const CONVERSATIONS_KEY = "conversations-v2";
const LEGACY_CHAT_KEY = "chat-history";

export function defaultBoard() {
  const now = Date.now();
  const col = (id, title, inject = true) => ({ id, title, injectIntoPrompt: inject });
  const card = (id, columnId, title, content) => ({
    id, columnId, title, content, createdAt: now, updatedAt: now, attachments: [],
  });
  return {
    version: 2,
    boardName: "Assistant Memory",
    columns: [
      col("col-identity", "Identity"),
      col("col-context", "Context"),
      col("col-instructions", "Instructions"),
      col("col-archive", "Archive", false),
    ],
    cards: [
      card("card-name", "col-identity", "Assistant Name", "Kai"),
      card("card-persona", "col-identity", "Persona", '=CONCAT("You are ", {{Assistant Name}}, ", a concise and friendly on-device assistant.")'),
      card("card-user", "col-context", "User Preference", "Keep answers short unless asked to elaborate."),
      card("card-system", "col-instructions", "System Prompt", '={{Persona}} & " " & {{User Preference}}'),
    ],
  };
}

export async function loadBoard() {
  const stored = await idbGet(BOARD_KEY);
  const board = stored || defaultBoard();
  board.cards.forEach((c) => {
    if (!c.attachments) c.attachments = [];
  });
  return board;
}
export async function saveBoard(board) {
  await idbSet(BOARD_KEY, board);
}

export const GENERATION_PRESETS = {
  precise: { label: "Precise", temperature: 0.3, topP: 0.85, description: "Focused, consistent, sticks closely to facts. Good for Q&A, coding, summarizing." },
  balanced: { label: "Balanced", temperature: 0.8, topP: 0.95, description: "A sensible default — some variety without going off the rails." },
  creative: { label: "Creative", temperature: 1.15, topP: 0.98, description: "More surprising, varied wording. Good for brainstorming or creative writing." },
};

export const MAX_TOKENS_PRESETS = [
  { value: 150, label: "Short", description: "~1 paragraph" },
  { value: 512, label: "Medium", description: "A few paragraphs" },
  { value: 1024, label: "Long", description: "Several paragraphs" },
  { value: 2048, label: "Very long", description: "Long-form / multi-section answers" },
];

export function defaultSettings() {
  return {
    theme: "system",
    selectedModelId: null,
    autoRecommend: true,
    generationMode: "beginner",
    activePreset: "balanced",
    temperature: 0.8,
    topP: 0.95,
    frequencyPenalty: 0,
    presencePenalty: 0,
    maxTokens: 512,
    deepThinking: true,
    internetSearch: false,
    activeProvider: "local",
    remoteProviders: {
      openai_compatible: { baseUrl: "", apiKey: "", model: "", presetKey: "custom" },
      gemini: { apiKey: "", model: "gemini-2.5-flash" },
    },
  };
}

export async function loadSettings() {
  const stored = await idbGet(SETTINGS_KEY);
  const merged = { ...defaultSettings(), ...(stored || {}) };
  merged.remoteProviders = { ...defaultSettings().remoteProviders, ...(stored?.remoteProviders || {}) };
  return merged;
}
export async function saveSettings(settings) {
  await idbSet(SETTINGS_KEY, settings);
}

function genId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function newConversation(title) {
  const now = Date.now();
  return { id: genId("conv"), title: title || "New chat", messages: [], createdAt: now, updatedAt: now };
}

export function deriveConversationTitle(conversation) {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const text = (typeof firstUser.content === "string" ? firstUser.content : "").trim();
  if (!text) return "New chat";
  return text.length > 42 ? text.slice(0, 42) + "…" : text;
}

async function migrateLegacyChatHistory() {
  const legacy = await idbGet(LEGACY_CHAT_KEY);
  if (!legacy || !Array.isArray(legacy) || !legacy.length) return null;
  const conv = newConversation();
  conv.messages = legacy.map((m) => ({ id: genId("msg"), role: m.role, content: m.content, attachments: [], at: m.at || Date.now() }));
  conv.title = deriveConversationTitle(conv);
  conv.updatedAt = Date.now();
  return conv;
}

export async function loadConversations() {
  let stored = await idbGet(CONVERSATIONS_KEY);
  if (!stored) {
    const migrated = await migrateLegacyChatHistory();
    const initial = migrated ? [migrated] : [newConversation()];
    stored = { conversations: initial, activeId: initial[0].id };
    await idbSet(CONVERSATIONS_KEY, stored);
    await idbDelete(LEGACY_CHAT_KEY);
  }
  stored.conversations.forEach((c) => {
    c.messages.forEach((m) => {
      if (!m.attachments) m.attachments = [];
      if (!m.id) m.id = genId("msg");
    });
  });
  return stored;
}

export async function saveConversations(state) {
  await idbSet(CONVERSATIONS_KEY, state);
}

export function exportBoardToFile(board) {
  const blob = new Blob([JSON.stringify(board, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `${(board.boardName || "memory-board").replace(/\s+/g, "-").toLowerCase()}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importBoardFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.cards)) {
          throw new Error("File does not look like a valid memory board export (missing columns/cards).");
        }
        parsed.cards.forEach((c) => {
          if (!c.attachments) c.attachments = [];
        });
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export { genId };
