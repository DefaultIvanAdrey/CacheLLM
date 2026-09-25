/**
 * device.js
 * Detects the current device/browser's realistic capability to run WebLLM
 * models, then recommends the best-fitting prebuilt model(s) from WebLLM's
 * live model registry. See README for the honest limitations of this
 * heuristic (browsers do not expose real VRAM).
 */

export async function detectDevice() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const isMobile = isMobileUA || (coarsePointer && (isIOS || isAndroid));

  const deviceMemoryGB = "deviceMemory" in navigator ? navigator.deviceMemory : null;
  const cores = navigator.hardwareConcurrency || null;

  const gpu = await detectWebGPU();
  const budgetMB = estimateBudgetMB({ isMobile, deviceMemoryGB, cores, gpu });

  return {
    ua,
    platform: isIOS ? "iOS" : isAndroid ? "Android" : "Desktop",
    isMobile,
    deviceMemoryGB,
    cores,
    gpu,
    budgetMB,
  };
}

async function detectWebGPU() {
  if (!("gpu" in navigator)) {
    return { supported: false, reason: "navigator.gpu is not available in this browser." };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { supported: false, reason: "No WebGPU adapter could be obtained." };
    let info = {};
    try {
      if (typeof adapter.requestAdapterInfo === "function") info = await adapter.requestAdapterInfo();
      else if (adapter.info) info = adapter.info;
    } catch {
      /* ignore */
    }
    const limits = adapter.limits || {};
    const features = adapter.features ? [...adapter.features] : [];
    return {
      supported: true,
      vendor: info.vendor || info.description || "unknown",
      architecture: info.architecture || "",
      maxBufferSize: limits.maxBufferSize || 0,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize || 0,
      features,
    };
  } catch (err) {
    return { supported: false, reason: (err && err.message) || "WebGPU request failed." };
  }
}

function estimateBudgetMB({ isMobile, deviceMemoryGB, cores, gpu }) {
  if (!gpu.supported) return 0;
  let ramGB = deviceMemoryGB || (isMobile ? 4 : 8);
  const bufMB = gpu.maxBufferSize ? gpu.maxBufferSize / (1024 * 1024) : 0;

  let budget;
  if (isMobile) {
    budget = 900 + Math.min(Math.max(ramGB - 3, 0), 5) * 300;
    budget = Math.min(budget, 2600);
  } else {
    budget = ramGB * 1024 * 0.45;
    budget = Math.max(budget, 1500);
  }
  if (bufMB && bufMB < 1024) budget = Math.min(budget, 1400);
  if (cores && cores <= 4) budget = Math.min(budget, isMobile ? 1400 : 3000);
  return Math.round(budget);
}

export function recommendModels(modelList, device, opts = {}) {
  const max = opts.max || 3;
  if (!device.gpu.supported) return { primary: null, alternatives: [], budgetMB: 0 };

  const supportedFeatureSet = new Set(device.gpu.features || []);
  const eligible = modelList.filter((m) => {
    if (m.model_type === 1 || /embedding/i.test(m.model_id)) return false;
    if (m.required_features && m.required_features.length) {
      const ok = m.required_features.every((f) => supportedFeatureSet.has(f));
      if (!ok) return false;
    }
    return typeof m.vram_required_MB === "number";
  });

  const fitting = eligible.filter((m) => m.vram_required_MB <= device.budgetMB).sort((a, b) => b.vram_required_MB - a.vram_required_MB);
  const smallest = [...eligible].sort((a, b) => a.vram_required_MB - b.vram_required_MB)[0] || null;

  let primary = fitting[0] || smallest;
  const alternatives = [];
  for (const m of fitting.slice(1)) {
    if (alternatives.length >= max - 1) break;
    if (m.model_id !== primary?.model_id) alternatives.push(m);
  }
  if (!fitting.length && smallest) {
    for (const m of [...eligible].sort((a, b) => a.vram_required_MB - b.vram_required_MB).slice(1, max)) {
      alternatives.push(m);
    }
  }
  return { primary, alternatives, budgetMB: device.budgetMB, fits: fitting.length > 0 };
}

/**
 * Best-effort heuristic: does this model likely accept image input?
 * WebLLM's vision support is limited to specific model families; we can't
 * verify at runtime without trying, so this is used only to set user
 * expectations (a capability badge), never to silently drop attachments.
 */
export function isLikelyVisionModel(modelId) {
  return /vision|-vl-|\bvl\b|llava|moondream|vlm/i.test(modelId);
}
