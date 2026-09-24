/**
 * modelpicker.js
 * A searchable, sortable, filterable modal for choosing a WebLLM model —
 * replaces a plain <select>, which doesn't scale to WebLLM's 100+ model
 * catalog. Supports:
 *   - free-text search (name, family, quantization, parameter size)
 *   - sort: recommended-first, name A-Z/Z-A, size smallest/largest
 *   - filter chips: family, "fits my device only"
 */
import { icon } from "./icons.js";
import { extractFamily, extractQuant, extractParamSize, formatSizeMB, searchModels, sortModels, filterModels, SORT_MODES } from "./modelutils.js";

export function openModelPicker({ modelList, device, recommendation, currentSelection, onSelect }) {
  const recIds = new Set(
    [recommendation?.primary?.model_id, ...(recommendation?.alternatives || []).map((m) => m.model_id)].filter(Boolean)
  );

  const state = {
    query: "",
    sort: "recommended",
    families: new Set(),
    fitsOnly: false,
  };

  const families = [...new Set(modelList.map((m) => extractFamily(m.model_id)))].sort();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal mp-modal">
      <div class="modal-header">
        <strong>Choose a model</strong>
        <button class="btn icon ghost" id="mpClose"></button>
      </div>
      <div class="mp-search-row">
        <div class="search-field">
          <span id="mpSearchIcon"></span>
          <input type="text" id="mpSearchInput" placeholder="Search by name, family, size (e.g. \"qwen 3b\")…" />
        </div>
        <select id="mpSortSelect">
          ${Object.entries(SORT_MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
      </div>
      <div class="mp-filters" id="mpFilters"></div>
      <div class="mp-results-meta" id="mpResultsMeta"></div>
      <div class="mp-list" id="mpList"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#mpClose").appendChild(icon("close", { size: 18 }));
  overlay.querySelector("#mpSearchIcon").replaceWith(icon("search", { size: 16 }));

  const searchInput = overlay.querySelector("#mpSearchInput");
  const sortSelect = overlay.querySelector("#mpSortSelect");
  const filtersEl = overlay.querySelector("#mpFilters");
  const listEl = overlay.querySelector("#mpList");
  const metaEl = overlay.querySelector("#mpResultsMeta");

  sortSelect.value = state.sort;

  // Filter chips: "Fits my device" + top families (cap to avoid overflow; rest still searchable)
  const fitsChip = document.createElement("button");
  fitsChip.type = "button";
  fitsChip.className = "chip";
  fitsChip.textContent = `Fits my device (${formatSizeMB(device.budgetMB)} budget)`;
  fitsChip.addEventListener("click", () => {
    state.fitsOnly = !state.fitsOnly;
    fitsChip.classList.toggle("active", state.fitsOnly);
    render();
  });
  filtersEl.appendChild(fitsChip);

  families.forEach((fam) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = fam;
    chip.addEventListener("click", () => {
      if (state.families.has(fam)) state.families.delete(fam);
      else state.families.add(fam);
      chip.classList.toggle("active", state.families.has(fam));
      render();
    });
    filtersEl.appendChild(chip);
  });

  function computeList() {
    let list = modelList.filter((m) => typeof m.vram_required_MB === "number");
    list = searchModels(list, state.query);
    list = filterModels(list, { families: state.families, fitsOnly: state.fitsOnly, budgetMB: device.budgetMB });
    list = sortModels(list, state.sort, recIds);
    return list;
  }

  function render() {
    const list = computeList();
    metaEl.textContent = `${list.length} of ${modelList.length} models`;
    listEl.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "mp-empty";
      empty.textContent = "No models match your search/filters. Try clearing a filter.";
      listEl.appendChild(empty);
      return;
    }
    for (const m of list) {
      const row = document.createElement("div");
      row.className = "mp-row" + (m.model_id === currentSelection ? " selected" : "");
      const fam = extractFamily(m.model_id);
      const quant = extractQuant(m.model_id);
      const paramSize = extractParamSize(m.model_id);
      const fits = (m.vram_required_MB || 0) <= device.budgetMB;
      const isRec = recIds.has(m.model_id);

      row.innerHTML = `
        <div class="mp-main">
          <div class="mp-name">${escapeHtml(m.model_id)}</div>
          <div class="mp-tags">
            ${isRec ? `<span class="badge accent">★ recommended</span>` : ""}
            <span class="badge">${escapeHtml(fam)}</span>
            ${paramSize ? `<span class="badge">${paramSize}</span>` : ""}
            <span class="badge">${escapeHtml(quant)}</span>
            ${fits ? `<span class="badge success">fits</span>` : `<span class="badge danger">tight fit</span>`}
          </div>
        </div>
        <div class="mp-size">${formatSizeMB(m.vram_required_MB)}</div>
      `;
      row.addEventListener("click", () => {
        onSelect(m);
        overlay.remove();
      });
      listEl.appendChild(row);
    }
  }

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    render();
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    render();
  });

  overlay.querySelector("#mpClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", escHandler);
    }
  });

  render();
  setTimeout(() => searchInput.focus(), 30);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
