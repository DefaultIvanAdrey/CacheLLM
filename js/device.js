/**
 * device.js
 * Detects the current device/browser's realistic capability to run WebLLM
 * models, then recommends the best-fitting prebuilt model(s) from WebLLM's
 * live model registry.
 *
 * Notes on the heuristic (communicated to the user in the UI too):
 *  - Browsers deliberately do NOT expose real VRAM for privacy reasons.
 *  - navigator.deviceMemory (Chrome/Android only) reports *RAM* in coarse
 *    buckets (0.25 - 8, capped at 8 even if more), not VRAM.
 *  - Safari/iOS and Firefox do not implement deviceMemory at all.
 *  - Mobile browsers additionally impose much stricter per-tab GPU buffer
 *    budgets than desktop, even on high-RAM phones.
 *  - We combine: WebGPU availability, adapter limits (maxBufferSize /
 *    maxStorageBufferBindingSize as a rough proxy for GPU class),
 *    deviceMemory (if present), logical core count, and mobile-vs-desktop
 *    to produce a conservative "safe VRAM budget" in MB, then pick the
 *    largest prebuilt model(s) that fit under it.
 */

export async function detectDevice() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const isMobile = isMobileUA || (coarsePointer && (isIOS || isAndroid));

  const deviceMemoryGB = "deviceMemory" in navigator ? navigator.deviceMemory : null; // Chrome/Android only
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
    if (!adapter) {
      return { supported: false, reason: "No WebGPU adapter could be obtained." };
    }
    let info = {};
    try {
      // requestAdapterInfo is deprecated/unavailable in some browsers; guard it.
      if (typeof adapter.requestAdapterInfo === "function") {
        info = await adapter.requestAdapterInfo();
      } else if (adapter.info) {
        info = adapter.info;
      }
    } catch {
      /* ignore, not all browsers expose this */
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

  // Base guess from RAM if the browser reports it, otherwise assume a
  // reasonably modern mid-range default.
  let ramGB = deviceMemoryGB || (isMobile ? 4 : 8);

  // GPU buffer-limit signal: desktops/discrete GPUs typically report much
  // larger maxBufferSize than mobile integrated GPUs.
  const bufMB = gpu.maxBufferSize ? gpu.maxBufferSize / (1024 * 1024) : 0;

  let budget;
  if (isMobile) {
    // Mobile browsers cap per-tab GPU memory hard, regardless of total RAM.
    // Be conservative: scale gently with RAM, cap low.
    budget = 900 + Math.min(Math.max(ramGB - 3, 0), 5) * 300; // 900MB..2400MB range
    budget = Math.min(budget, 2600);
  } else {
    // Desktop: assume a fraction of RAM is usable as GPU-accessible memory.
    budget = ramGB * 1024 * 0.45;
    budget = Math.max(budget, 1500);
  }

  // If the adapter reports an unusually small buffer limit, clamp down
  // regardless of RAM (integrated/older GPU signal).
  if (bufMB && bufMB < 1024) {
    budget = Math.min(budget, 1400);
  }

  // cores as a mild extra signal for very low-power devices
  if (cores && cores <= 4) {
    budget = Math.min(budget, isMobile ? 1400 : 3000);
  }

  return Math.round(budget);
}

/**
 * Given the WebLLM prebuiltAppConfig.model_list and a detected device,
 * return a ranked recommendation set.
 */
export function recommendModels(modelList, device, opts = {}) {
  const max = opts.max || 3;
  if (!device.gpu.supported) return { primary: null, alternatives: [], budgetMB: 0 };

  const supportedFeatureSet = new Set(device.gpu.features || []);
  const eligible = modelList.filter((m) => {
    if (m.model_type === 1 /* embedding */ || /embedding/i.test(m.model_id)) return false;
    if (m.required_features && m.required_features.length) {
      const ok = m.required_features.every((f) => supportedFeatureSet.has(f));
      if (!ok) return false;
    }
    return typeof m.vram_required_MB === "number";
  });

  const fitting = eligible
    .filter((m) => m.vram_required_MB <= device.budgetMB)
    .sort((a, b) => b.vram_required_MB - a.vram_required_MB);

  // Always keep a guaranteed ultra-light fallback available too.
  const smallest = [...eligible].sort((a, b) => a.vram_required_MB - b.vram_required_MB)[0] || null;

  let primary = fitting[0] || smallest;
  const alternatives = [];
  for (const m of fitting.slice(1)) {
    if (alternatives.length >= max - 1) break;
    if (m.model_id !== primary?.model_id) alternatives.push(m);
  }
  if (!fitting.length && smallest) {
    // nothing truly "fits" the conservative budget - still offer the next
    // couple of smallest models as alternatives so the user has options.
    for (const m of [...eligible].sort((a, b) => a.vram_required_MB - b.vram_required_MB).slice(1, max)) {
      alternatives.push(m);
    }
  }

  return { primary, alternatives, budgetMB: device.budgetMB, fits: fitting.length > 0 };
}
