/**
 * kanban.js
 * Renders and manages the "memory" Kanban board: columns, cards, formula
 * previews, card editor modal, and touch-friendly drag & drop for BOTH
 * cards (within/between columns) and whole columns (reordering), built on
 * the Pointer Events API rather than HTML5 DnD, since HTML5 drag-and-drop
 * does not work reliably on mobile touchscreens.
 */
import { evaluateCardContent, extractReferences } from "./formula.js";
import { genId, exportBoardToFile, importBoardFromFile } from "./storage.js";
import { iconPlaceholder, icon, mountIcons } from "./icons.js";

const COLUMN_PALETTE = [
  "var(--col-identity)",
  "var(--col-context)",
  "var(--col-instructions)",
  "var(--col-archive)",
  "#d946ef",
  "#f59e0b",
  "#14b8a6",
];

export class KanbanBoard {
  /**
   * @param {HTMLElement} root
   * @param {object} opts { getBoard, setBoard, onToast }
   */
  constructor(root, opts) {
    this.root = root;
    this.getBoard = opts.getBoard;
    this.setBoard = opts.setBoard;
    this.onToast = opts.onToast || (() => {});
    this.filter = "";
    this.drag = null; // active card-drag state
    this.colDrag = null; // active column-drag state
    this._bindGlobalPointerHandlers();
  }

  board() {
    return this.getBoard();
  }

  async persist() {
    await this.setBoard(this.board());
  }

  render() {
    const board = this.board();
    this.root.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "board-toolbar";
    toolbar.innerHTML = `
      <div class="left">
        <div class="search-field">
          ${iconPlaceholder("search", { size: 14 })}
          <input type="search" placeholder="Filter cards…" id="boardFilter" style="width:170px" />
        </div>
        <span class="badge">${board.cards.length} card${board.cards.length === 1 ? "" : "s"}</span>
      </div>
      <div class="right">
        <button class="btn sm" id="exportBoardBtn">${iconPlaceholder("download", { size: 14 })}<span>Export JSON</span></button>
        <button class="btn sm" id="importBoardBtn">${iconPlaceholder("upload", { size: 14 })}<span>Import JSON</span></button>
        <input type="file" id="importBoardFile" accept="application/json" class="hidden" />
      </div>
    `;
    this.root.appendChild(toolbar);
    mountIcons(toolbar);
    toolbar.querySelector("#boardFilter").value = this.filter;
    toolbar.querySelector("#boardFilter").addEventListener("input", (e) => {
      this.filter = e.target.value;
      this.renderColumns();
    });
    toolbar.querySelector("#exportBoardBtn").addEventListener("click", () => {
      exportBoardToFile(this.board());
      this.onToast("Memory board exported.");
    });
    const fileInput = toolbar.querySelector("#importBoardFile");
    toolbar.querySelector("#importBoardBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const parsed = await importBoardFromFile(file);
        await this.setBoard(parsed);
        this.render();
        this.onToast("Memory board imported.");
      } catch (err) {
        this.onToast(`Import failed: ${err.message}`, "error");
      }
      fileInput.value = "";
    });

    this.columnsEl = document.createElement("div");
    this.columnsEl.className = "board-columns";
    this.root.appendChild(this.columnsEl);
    this.renderColumns();
  }

  renderColumns() {
    const board = this.board();
    const q = this.filter.trim().toLowerCase();
    this.columnsEl.innerHTML = "";

    board.columns.forEach((col, i) => {
      const colEl = document.createElement("div");
      colEl.className = "column";
      colEl.dataset.columnId = col.id;

      const cards = board.cards.filter((c) => c.columnId === col.id);
      const visibleCards = q
        ? cards.filter((c) => {
            const evaluated = evaluateCardContent(board, c).toLowerCase();
            return c.title.toLowerCase().includes(q) || evaluated.includes(q) || c.content.toLowerCase().includes(q);
          })
        : cards;

      const header = document.createElement("div");
      header.className = "column-header";
      header.innerHTML = `
        <span class="column-drag-handle" title="Drag to reorder columns">${iconPlaceholder("drag", { size: 16 })}</span>
        <span class="column-dot" style="background:${COLUMN_PALETTE[i % COLUMN_PALETTE.length]}"></span>
        <input class="column-title-input" value="${escapeAttr(col.title)}" />
        <span class="column-count">${cards.length}</span>
        <button class="btn icon ghost sm column-menu-btn" title="Delete column">${iconPlaceholder("trash", { size: 14 })}</button>
      `;
      mountIcons(header);
      header.querySelector(".column-drag-handle").addEventListener("pointerdown", (e) => this._onColumnPointerDown(e, colEl, col));

      const titleInput = header.querySelector(".column-title-input");
      titleInput.addEventListener("change", async () => {
        col.title = titleInput.value.trim() || col.title;
        await this.persist();
      });
      header.querySelector(".column-menu-btn").addEventListener("click", async () => {
        if (cards.length && !confirm(`Delete column "${col.title}" and its ${cards.length} card(s)?`)) return;
        const board2 = this.board();
        board2.cards = board2.cards.filter((c) => c.columnId !== col.id);
        board2.columns = board2.columns.filter((c) => c.id !== col.id);
        await this.persist();
        this.renderColumns();
      });
      colEl.appendChild(header);

      const body = document.createElement("div");
      body.className = "column-body";
      body.dataset.columnId = col.id;
      visibleCards.forEach((card) => body.appendChild(this.renderCard(card)));
      colEl.appendChild(body);

      const footer = document.createElement("div");
      footer.className = "column-footer";
      footer.innerHTML = `<button class="add-card-btn">${iconPlaceholder("plus", { size: 14 })}<span>Add card</span></button>`;
      mountIcons(footer);
      footer.querySelector("button").addEventListener("click", () => this.openCardEditor(null, col.id));
      colEl.appendChild(footer);

      const injectRow = document.createElement("label");
      injectRow.className = "column-inject-toggle";
      injectRow.innerHTML = `
        <span class="switch" style="width:30px;height:18px;">
          <input type="checkbox" ${col.injectIntoPrompt ? "checked" : ""}/>
          <span class="track" style="border-radius:999px;"><span class="thumb" style="width:12px;height:12px;top:2px;left:2px;"></span></span>
        </span>
        <span>Feed into assistant context</span>
      `;
      injectRow.querySelector("input").addEventListener("change", async (e) => {
        col.injectIntoPrompt = e.target.checked;
        await this.persist();
      });
      colEl.appendChild(injectRow);

      this.columnsEl.appendChild(colEl);
    });

    const addColBtn = document.createElement("button");
    addColBtn.className = "add-column-btn";
    addColBtn.appendChild(icon("columnAdd", { size: 16 }));
    const addColLabel = document.createElement("span");
    addColLabel.textContent = "Add column";
    addColBtn.appendChild(addColLabel);
    addColBtn.addEventListener("click", async () => {
      const title = prompt("Column name?", "New column");
      if (!title) return;
      const board2 = this.board();
      board2.columns.push({ id: genId("col"), title: title.trim(), injectIntoPrompt: true });
      await this.persist();
      this.renderColumns();
    });
    this.columnsEl.appendChild(addColBtn);
  }

  renderCard(card) {
    const board = this.board();
    const el = document.createElement("div");
    el.className = "kcard";
    el.dataset.cardId = card.id;

    const isFormula = card.content.trim().startsWith("=");
    const evaluated = evaluateCardContent(board, card);
    const isError = /^#(REF|ERROR)!/.test(evaluated);
    const refs = extractReferences(card.content);

    el.innerHTML = `
      <div class="kcard-title-row">
        <div class="kcard-title">${escapeHtml(card.title || "Untitled")}</div>
        <div class="kcard-badges">${isFormula ? `<span class="badge accent">fx</span>` : ""}</div>
      </div>
      <div class="kcard-content ${isError ? "formula-error" : ""}">${escapeHtml(evaluated) || "<em>(empty)</em>"}</div>
      ${refs.length ? `<div class="kcard-footer"><span class="kcard-refs">↳ refs: ${refs.map(escapeHtml).join(", ")}</span></div>` : ""}
    `;

    el.addEventListener("click", () => {
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }
      this.openCardEditor(card.id, card.columnId);
    });

    el.addEventListener("pointerdown", (e) => this._onCardPointerDown(e, el, card));

    return el;
  }

  /* ------------------------------- Drag & Drop (Pointer Events) ------------------------------- */

  _bindGlobalPointerHandlers() {
    window.addEventListener("pointermove", (e) => {
      this._onPointerMove(e);
      this._onColumnPointerMove(e);
    });
    window.addEventListener("pointerup", (e) => {
      this._onPointerUp(e);
      this._onColumnPointerUp(e);
    });
    window.addEventListener("pointercancel", (e) => {
      this._onPointerUp(e);
      this._onColumnPointerUp(e);
    });
  }

  /* ---- Card drag ---- */

  _onCardPointerDown(e, el, card) {
    if (e.button !== undefined && e.button !== 0) return;
    this.drag = {
      pointerId: e.pointerId,
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      sourceEl: el,
      placeholder: null,
      clone: null,
    };
  }

  _onPointerMove(e) {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;

    if (!d.moved) {
      d.moved = true;
      this._suppressClick = true;
      const rect = d.sourceEl.getBoundingClientRect();
      d.width = rect.width;
      d.height = rect.height;

      d.placeholder = document.createElement("div");
      d.placeholder.className = "kcard";
      d.placeholder.style.cssText = `border:1.5px dashed var(--border-strong); background:var(--surface-alt); box-shadow:none; height:${rect.height}px;`;
      d.sourceEl.parentNode.insertBefore(d.placeholder, d.sourceEl);

      d.clone = d.sourceEl.cloneNode(true);
      d.clone.classList.add("dragging");
      d.clone.style.cssText = `position:fixed; left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; z-index:150; pointer-events:none; box-shadow:var(--shadow-md); transform: rotate(1.5deg);`;
      document.body.appendChild(d.clone);
      d.sourceEl.remove();
    }

    d.clone.style.left = `${e.clientX - d.width / 2}px`;
    d.clone.style.top = `${e.clientY - d.height / 2}px`;

    d.clone.style.display = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    d.clone.style.display = "";
    if (!under) return;
    const body = under.closest(".column-body");
    if (!body) return;

    const overCard = under.closest(".kcard");
    if (overCard && overCard !== d.placeholder) {
      const rect = overCard.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      body.insertBefore(d.placeholder, before ? overCard : overCard.nextSibling);
    } else if (!overCard) {
      body.appendChild(d.placeholder);
    }
  }

  async _onPointerUp(e) {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    this.drag = null;

    if (!d.moved) return; // was a simple tap; click handler already handles edit

    const targetBody = d.placeholder.parentElement;
    const targetColumnId = targetBody ? targetBody.dataset.columnId : null;

    const board = this.board();
    const card = board.cards.find((c) => c.id === d.cardId);
    if (!card || !targetColumnId) {
      d.clone && d.clone.remove();
      this.renderColumns();
      return;
    }

    const siblingIds = [...targetBody.children]
      .filter((n) => n.classList.contains("kcard") || n === d.placeholder)
      .map((n) => (n === d.placeholder ? "__PLACEHOLDER__" : n.dataset.cardId));

    card.columnId = targetColumnId;

    const withoutCard = board.cards.filter((c) => c.id !== card.id);
    const idx = siblingIds.indexOf("__PLACEHOLDER__");
    const targetColumnCardIdsInOrder = siblingIds.filter((id) => id !== "__PLACEHOLDER__");
    const beforeId = targetColumnCardIdsInOrder[idx];

    let insertAt = withoutCard.length;
    if (beforeId) {
      insertAt = withoutCard.findIndex((c) => c.id === beforeId);
      if (insertAt === -1) insertAt = withoutCard.length;
    } else if (idx > 0) {
      const afterId = targetColumnCardIdsInOrder[idx - 1];
      const afterIdx = withoutCard.findIndex((c) => c.id === afterId);
      insertAt = afterIdx === -1 ? withoutCard.length : afterIdx + 1;
    }
    withoutCard.splice(insertAt, 0, card);
    board.cards = withoutCard;
    card.updatedAt = Date.now();

    d.clone && d.clone.remove();
    d.placeholder && d.placeholder.remove();

    await this.persist();
    this.renderColumns();
  }

  /* ---- Column drag (reordering whole columns) ---- */

  _onColumnPointerDown(e, colEl, col) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = colEl.getBoundingClientRect();
    this.colDrag = {
      pointerId: e.pointerId,
      columnId: col.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      sourceEl: colEl,
      placeholder: null,
      clone: null,
      width: rect.width,
      height: rect.height,
    };
  }

  _onColumnPointerMove(e) {
    const d = this.colDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;

    if (!d.moved) {
      d.moved = true;
      const rect = d.sourceEl.getBoundingClientRect();

      d.placeholder = document.createElement("div");
      d.placeholder.className = "column-ghost";
      d.placeholder.style.width = `${rect.width}px`;
      d.sourceEl.parentNode.insertBefore(d.placeholder, d.sourceEl);

      d.clone = d.sourceEl.cloneNode(true);
      d.clone.classList.add("column-dragging");
      d.clone.style.cssText = `position:fixed; left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px; z-index:150; pointer-events:none; box-shadow:var(--shadow-md); opacity:0.92; transform: rotate(1deg);`;
      document.body.appendChild(d.clone);
      d.sourceEl.style.visibility = "hidden";
      d.sourceEl.style.pointerEvents = "none";
    }

    d.clone.style.left = `${e.clientX - d.width / 2}px`;
    d.clone.style.top = `${e.clientY - d.height / 2}px`;

    const containerRect = this.columnsEl.getBoundingClientRect();
    const clampedX = Math.min(Math.max(e.clientX, containerRect.left + 10), containerRect.right - 10);

    d.clone.style.display = "none";
    const under = document.elementFromPoint(clampedX, e.clientY);
    d.clone.style.display = "";
    if (!under) return;

    const overColumn = under.closest(".column");
    if (overColumn && overColumn !== d.sourceEl && overColumn !== d.placeholder) {
      const rect = overColumn.getBoundingClientRect();
      const before = clampedX < rect.left + rect.width / 2;
      this.columnsEl.insertBefore(d.placeholder, before ? overColumn : overColumn.nextSibling);
    }
  }

  async _onColumnPointerUp(e) {
    const d = this.colDrag;
    if (!d || d.pointerId !== e.pointerId) return;
    this.colDrag = null;

    if (!d.moved) return;

    d.placeholder.replaceWith(d.sourceEl);
    d.sourceEl.style.visibility = "";
    d.sourceEl.style.pointerEvents = "";
    d.clone && d.clone.remove();

    const orderedIds = [...this.columnsEl.children]
      .filter((n) => n.classList.contains("column"))
      .map((n) => n.dataset.columnId);

    const board = this.board();
    const byId = new Map(board.columns.map((c) => [c.id, c]));
    board.columns = orderedIds.map((id) => byId.get(id)).filter(Boolean);

    await this.persist();
    this.renderColumns();
  }

  /* ------------------------------------- Card editor modal ------------------------------------- */

  openCardEditor(cardId, defaultColumnId) {
    const board = this.board();
    const isNew = !cardId;
    const card = isNew
      ? { id: genId("card"), columnId: defaultColumnId, title: "", content: "", createdAt: Date.now(), updatedAt: Date.now() }
      : board.cards.find((c) => c.id === cardId);
    if (!card) return;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <strong>${isNew ? "New card" : "Edit card"}</strong>
          <button class="btn icon ghost" id="closeModalBtn">${iconPlaceholder("close", { size: 16 })}</button>
        </div>
        <div class="modal-body">
          <div>
            <label>Title</label>
            <input id="cardTitleInput" placeholder="e.g. Assistant Name" value="${escapeAttr(card.title)}" />
          </div>
          <div>
            <label>Content (supports formulas)</label>
            <textarea id="cardContentInput" rows="6" placeholder='Plain text, or {{Other Card}} references, or =CONCAT("Hi ", {{Name}})'>${escapeHtml(card.content)}</textarea>
          </div>
          <div>
            <label>Live preview</label>
            <div class="formula-preview" id="cardPreview"></div>
          </div>
          <div>
            <label>Column</label>
            <select id="cardColumnSelect">
              ${board.columns.map((c) => `<option value="${c.id}" ${c.id === card.columnId ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
            </select>
          </div>
          <div class="hint">
            Reference another card anywhere with <code>{{Card Title}}</code>. Start with <code>=</code> for a full formula,
            e.g. <code>=IF({{Age}}&gt;18,"adult","minor")</code>. Functions: CONCAT, JOIN, UPPER, LOWER, TRIM, LEN, IF, SUM, AVG,
            MIN, MAX, ROUND, TODAY, NOW, CARD(id), CARDS_IN(column), COUNT_IN(column).
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn danger" id="deleteCardBtn" ${isNew ? "style='visibility:hidden'" : ""}>${iconPlaceholder("trash", { size: 14 })}<span>Delete</span></button>
          <div style="display:flex; gap:8px;">
            <button class="btn" id="cancelCardBtn">Cancel</button>
            <button class="btn primary" id="saveCardBtn">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    mountIcons(overlay);

    const titleInput = overlay.querySelector("#cardTitleInput");
    const contentInput = overlay.querySelector("#cardContentInput");
    const preview = overlay.querySelector("#cardPreview");
    const columnSelect = overlay.querySelector("#cardColumnSelect");

    const updatePreview = () => {
      const tempBoard = {
        columns: board.columns,
        cards: board.cards.map((c) => (c.id === card.id ? { ...c, title: titleInput.value, content: contentInput.value } : c)),
      };
      if (isNew) tempBoard.cards.push({ ...card, title: titleInput.value, content: contentInput.value });
      const tempCard = tempBoard.cards.find((c) => c.id === card.id);
      const result = evaluateCardContent(tempBoard, tempCard);
      preview.textContent = result || "(empty)";
      preview.classList.toggle("error", /^#(REF|ERROR)!/.test(result));
    };
    titleInput.addEventListener("input", updatePreview);
    contentInput.addEventListener("input", updatePreview);
    updatePreview();
    setTimeout(() => titleInput.focus(), 30);

    const close = () => overlay.remove();
    overlay.querySelector("#closeModalBtn").addEventListener("click", close);
    overlay.querySelector("#cancelCardBtn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector("#saveCardBtn").addEventListener("click", async () => {
      card.title = titleInput.value.trim() || "Untitled";
      card.content = contentInput.value;
      card.columnId = columnSelect.value;
      card.updatedAt = Date.now();
      const b = this.board();
      if (isNew) {
        b.cards.push(card);
      } else {
        const i = b.cards.findIndex((c) => c.id === card.id);
        if (i !== -1) b.cards[i] = card;
      }
      await this.persist();
      close();
      this.renderColumns();
    });

    if (!isNew) {
      overlay.querySelector("#deleteCardBtn").addEventListener("click", async () => {
        if (!confirm(`Delete card "${card.title}"?`)) return;
        const b = this.board();
        b.cards = b.cards.filter((c) => c.id !== card.id);
        await this.persist();
        close();
        this.renderColumns();
      });
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str ?? "").replace(/"/g, "&quot;");
}
