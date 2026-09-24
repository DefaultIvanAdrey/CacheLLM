/**
 * llm.js
 * Thin wrapper around @mlc-ai/web-llm: loads the library from CDN (cached by
 * the service worker after first successful load so it keeps working
 * offline), exposes model list access, engine creation with progress
 * reporting, and streaming chat completions.
 */

let webllmModulePromise = null;

// Try a few CDNs in order in case one is down, blocked, or mis-configured
// for CORS in a given network. The service worker runtime-caches whichever
// one succeeds, so subsequent (and offline) loads reuse that same source.
const CDN_CANDIDATES = [
  "https://esm.run/@mlc-ai/web-llm",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm",
  "https://unpkg.com/@mlc-ai/web-llm?module",
];

async function loadWebLLM() {
  if (webllmModulePromise) return webllmModulePromise;
  webllmModulePromise = (async () => {
    let lastErr;
    for (const url of CDN_CANDIDATES) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        if (mod && mod.MLCEngine) return mod;
        lastErr = new Error(`Module at ${url} did not export MLCEngine`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `Could not load the WebLLM library from any CDN (tried ${CDN_CANDIDATES.length}). ` +
        `Check your internet connection for first-time setup. Last error: ${lastErr?.message}`
    );
  })();
  return webllmModulePromise;
}

export async function getModelList() {
  const webllm = await loadWebLLM();
  return webllm.prebuiltAppConfig.model_list;
}

export class LLMEngine {
  constructor() {
    this.engine = null;
    this.currentModelId = null;
    this.webllm = null;
  }

  async init() {
    this.webllm = await loadWebLLM();
    return this.webllm;
  }

  async loadModel(modelId, onProgress) {
    if (!this.webllm) await this.init();
    if (this.engine && this.currentModelId === modelId) return this.engine;

    // Recreate the engine per load: this guarantees the init progress
    // callback (which differs per call site/UI instance) is always fresh,
    // without depending on a mutator method that may not exist across
    // WebLLM versions. Unload any previously loaded model first to free
    // GPU memory.
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        /* ignore */
      }
    }
    this.engine = new this.webllm.MLCEngine({
      initProgressCallback: (p) => onProgress && onProgress(p),
    });
    await this.engine.reload(modelId);
    this.currentModelId = modelId;
    return this.engine;
  }

  async unload() {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        /* ignore */
      }
    }
    this.currentModelId = null;
  }

  /**
   * Streaming chat completion. `onToken` receives incremental text deltas.
   * Returns the full final message text.
   */
  async chatStream(
    messages,
    { temperature = 0.8, topP = 0.95, frequencyPenalty = 0, presencePenalty = 0, maxTokens = 512, onToken } = {}
  ) {
    if (!this.engine) throw new Error("No model loaded yet.");
    const chunks = await this.engine.chat.completions.create({
      messages,
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      max_tokens: maxTokens,
      stream: true,
    });
    let full = "";
    for await (const chunk of chunks) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        onToken && onToken(delta, full);
      }
    }
    return full;
  }

  async interrupt() {
    if (this.engine) {
      try {
        await this.engine.interruptGenerate();
      } catch {
        /* ignore */
      }
    }
  }
}
