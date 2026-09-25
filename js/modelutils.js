/**
 * modelutils.js — model family/quant/size parsing + search/sort/filter helpers.
 */
const FAMILY_KEYWORDS = [
  "TinyLlama", "Llama", "Qwen", "Phi", "Gemma", "Mistral", "Mixtral", "SmolLM",
  "RedPajama", "StableLM", "WizardMath", "Hermes", "DeepSeek", "Snowflake", "GPT",
];

export function extractFamily(modelId) {
  for (const kw of FAMILY_KEYWORDS) {
    if (modelId.toLowerCase().includes(kw.toLowerCase())) return kw;
  }
  return modelId.split("-")[0] || "Other";
}

const QUANT_RE = /q\d+f(?:16|32)(?:_\d+)?/i;
export function extractQuant(modelId) {
  const m = modelId.match(QUANT_RE);
  return m ? m[0].toLowerCase() : "unknown";
}

export function formatSizeMB(mb) {
  if (!mb && mb !== 0) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function extractParamSize(modelId) {
  const m = modelId.match(/(\d+(?:\.\d+)?)(x\d+)?[bB](?![a-zA-Z])/);
  if (!m) return null;
  return m[2] ? `${m[1]}${m[2]}B` : `${m[1]}B`;
}

export function searchModels(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const terms = q.split(/\s+/).filter(Boolean);
  return list.filter((m) => {
    const haystack = `${m.model_id} ${extractFamily(m.model_id)} ${extractQuant(m.model_id)} ${
      extractParamSize(m.model_id) || ""
    }`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export const SORT_MODES = {
  recommended: "Recommended first",
  nameAsc: "Name (A→Z)",
  nameDesc: "Name (Z→A)",
  sizeAsc: "Size: smallest first",
  sizeDesc: "Size: largest first",
};

export function sortModels(list, mode, recommendedIds) {
  const arr = [...list];
  switch (mode) {
    case "nameAsc":
      return arr.sort((a, b) => a.model_id.localeCompare(b.model_id));
    case "nameDesc":
      return arr.sort((a, b) => b.model_id.localeCompare(a.model_id));
    case "sizeAsc":
      return arr.sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0));
    case "sizeDesc":
      return arr.sort((a, b) => (b.vram_required_MB || 0) - (a.vram_required_MB || 0));
    case "recommended":
    default:
      return arr.sort((a, b) => {
        const ra = recommendedIds?.has(a.model_id) ? 0 : 1;
        const rb = recommendedIds?.has(b.model_id) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return (a.vram_required_MB || 0) - (b.vram_required_MB || 0);
      });
  }
}

export function filterModels(list, { families, quants, fitsOnly, budgetMB }) {
  return list.filter((m) => {
    if (families && families.size && !families.has(extractFamily(m.model_id))) return false;
    if (quants && quants.size && !quants.has(extractQuant(m.model_id))) return false;
    if (fitsOnly && budgetMB && (m.vram_required_MB || 0) > budgetMB) return false;
    return true;
  });
}
