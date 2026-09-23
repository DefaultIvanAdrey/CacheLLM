/**
 * storage.js
 * Local persistence for the Kanban "memory" board, chat history, and app
 * settings. Uses IndexedDB (works fully offline, larger quota than
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
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

const BOARD_KEY = "memory-board";
const SETTINGS_KEY = "app-settings";
const CHAT_KEY = "chat-history";

export function defaultBoard() {
  const now = Date.now();
  const col = (id, title, inject = true) => ({ id, title, injectIntoPrompt: inject });
  const card = (id, columnId, title, content) => ({
    id,
    columnId,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  });
  return {
    version: 1,
    boardName: "Assistant Memory",
    columns: [
      col("col-identity", "Identity"),
      col("col-context", "Context"),
      col("col-instructions", "Instructions"),
      col("col-archive", "Archive", false),
    ],
    cards: [
      card("card-name", "col-identity", "Assistant Name", "Kai"),
      card(
        "card-persona",
        "col-identity",
        "Persona",
        '=CONCAT("You are ", {{Assistant Name}}, ", a concise and friendly on-device assistant.")'
      ),
      card("card-user", "col-context", "User Preference", "Keep answers short unless asked to elaborate."),
      card(
        "card-system",
        "col-instructions",
        "System Prompt",
        "={{Persona}} & \" \" & {{User Preference}}"
      ),
    ],
  };
}

export function defaultSettings() {
  return {
    theme: "system", // 'light' | 'dark' | 'system'
    selectedModelId: null,
    autoRecommend: true,
    temperature: 0.8,
    maxTokens: 512,
  };
}

export async function loadBoard() {
  const stored = await idbGet(BOARD_KEY);
  return stored || defaultBoard();
}

export async function saveBoard(board) {
  await idbSet(BOARD_KEY, board);
}

export async function loadSettings() {
  const stored = await idbGet(SETTINGS_KEY);
  return { ...defaultSettings(), ...(stored || {}) };
}

export async function saveSettings(settings) {
  await idbSet(SETTINGS_KEY, settings);
}

export async function loadChatHistory() {
  const stored = await idbGet(CHAT_KEY);
  return stored || [];
}

export async function saveChatHistory(messages) {
  await idbSet(CHAT_KEY, messages);
}

/* -------------------------- Import / Export -------------------------- */

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
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function genId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}
