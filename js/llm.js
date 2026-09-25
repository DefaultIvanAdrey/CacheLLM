/**
 * llm.js
 * Thin wrapper around @mlc-ai/web-llm for the LOCAL, on-device engine. See
 * providers.js for the separate (explicitly non-local) remote provider
 * adapters used when the user configures their own API key.
 */

let webllmModulePromise = null;

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
      `Could not load the WebLLM library from any CDN (tried ${CDN_CANDIDATES.length}). Check your internet connection for first-time setup. Last error: ${lastErr?.message}`
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
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        /* ignore */
      }
    }
    this.engine = new this.webllm.MLCEngine({ initProgressCallback: (p) => onProgress && onProgress(p) });
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
   * `deepThinking=false` appends a lightweight system instruction requesting
   * a direct, concise answer (best-effort prompt-level control — local
   * WebLLM models don't expose a structured "no-think" API the way some
   * remote providers, e.g. DeepSeek/Gemini, do).
   */
  async chatStream(messages, { temperature = 0.8, topP = 0.95, frequencyPenalty = 0, presencePenalty = 0, maxTokens = 512, deepThinking = true, onToken } = {}) {
    if (!this.engine) throw new Error("No model loaded yet.");

    let finalMessages = messages;
    if (!deepThinking) {
      const fastInstruction = "\n\nRespond directly and concisely. Skip step-by-step reasoning or <think> blocks — just give the final answer.";
      finalMessages = messages.map((m, i) =>
        m.role === "system" && i === 0 ? { ...m, content: m.content + fastInstruction } : m
      );
      if (!finalMessages.some((m) => m.role === "system")) {
        finalMessages = [{ role: "system", content: fastInstruction.trim() }, ...finalMessages];
      }
    }

    const chunks = await this.engine.chat.completions.create({
      messages: finalMessages,
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
