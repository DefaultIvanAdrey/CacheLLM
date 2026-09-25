/**
 * providers.js
 * Remote (non-local, non-private) AI provider adapters. These are entirely
 * optional and OFF by default — the app is local-first. When a user
 * explicitly configures one in Settings → Remote models, their prompts and
 * any attached files/images are sent directly from the browser to that
 * provider's own servers (never through any server of ours; we don't have
 * one). API keys are stored only in this browser's IndexedDB.
 */

function toOpenAIContent(text, attachments) {
  const imgs = (attachments || []).filter((a) => a.kind === "image" && a.dataUrl);
  if (!imgs.length) return text;
  const parts = [{ type: "text", text }];
  for (const img of imgs) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  return parts;
}

function toGeminiParts(text, attachments) {
  const parts = [{ text }];
  for (const img of (attachments || []).filter((a) => a.kind === "image" && a.dataUrl)) {
    const m = img.dataUrl.match(/^data:(.+);base64,(.*)$/);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return parts;
}

async function* readSSELines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      yield line;
    }
  }
  if (buffer) yield buffer;
}

export const OPENAI_COMPATIBLE_PRESETS = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", modelPlaceholder: "deepseek-chat" },
  huggingface: { label: "Hugging Face Router", baseUrl: "https://router.huggingface.co/v1", modelPlaceholder: "deepseek-ai/DeepSeek-R1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelPlaceholder: "gpt-4o-mini" },
  custom: { label: "Custom / self-hosted server", baseUrl: "", modelPlaceholder: "your-model-name" },
};

async function* streamOpenAICompatible({ baseUrl, apiKey, model, messages, temperature, topP, maxTokens, deepThinking, signal }) {
  const body = { model, messages, temperature, top_p: topP, max_tokens: maxTokens, stream: true };
  if (/deepseek/i.test(baseUrl)) {
    body.thinking = { reasoning_effort: deepThinking ? "high" : "none" };
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${errText ? " — " + errText.slice(0, 300) : ""}`);
  }
  for await (const line of readSSELines(res)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    if (!payload) continue;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    } catch {
      /* ignore malformed keep-alive lines */
    }
  }
}

function geminiRoleFor(role) {
  return role === "assistant" ? "model" : "user";
}

async function* streamGemini({ apiKey, model, messages, temperature, topP, maxTokens, deepThinking, signal }) {
  const systemMsg = messages.find((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");
  const contents = turns.map((m) => ({
    role: geminiRoleFor(m.role),
    parts: Array.isArray(m.content) ? m.content : toGeminiParts(m.content, m.attachments),
  }));
  const body = {
    contents,
    generationConfig: {
      temperature,
      topP,
      maxOutputTokens: maxTokens,
      thinkingConfig: deepThinking ? undefined : { thinkingBudget: 0 },
    },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${errText ? " — " + errText.slice(0, 300) : ""}`);
  }
  for await (const line of readSSELines(res)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (text) yield text;
    } catch {
      /* ignore malformed keep-alive lines */
    }
  }
}

export async function streamRemoteCompletion(providerConfig, messages, opts) {
  const { onToken, temperature, topP, maxTokens, deepThinking, signal } = opts;
  let iterator;
  if (providerConfig.type === "gemini") {
    iterator = streamGemini({ apiKey: providerConfig.apiKey, model: providerConfig.model, messages, temperature, topP, maxTokens, deepThinking, signal });
  } else {
    const openAIMessages = messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content : toOpenAIContent(m.content, m.attachments) }));
    iterator = streamOpenAICompatible({ baseUrl: providerConfig.baseUrl, apiKey: providerConfig.apiKey, model: providerConfig.model, messages: openAIMessages, temperature, topP, maxTokens, deepThinking, signal });
  }
  let full = "";
  for await (const delta of iterator) {
    full += delta;
    onToken && onToken(delta, full);
  }
  return full;
}

/** Extracts a plausible "org/model" slug from a pasted Hugging Face URL, or
 *  passes through a plain model id / provider-suffixed id unchanged. */
export function parseHuggingFaceModelInput(input) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/huggingface\.co\/([^/?#\s]+\/[^/?#\s]+)/i);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}
