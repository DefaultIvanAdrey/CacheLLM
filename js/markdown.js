/**
 * markdown.js
 * A small, dependency-free Markdown renderer purpose-built for LLM chat
 * output, plus a "thinking" tag extractor for reasoning models that emit
 * <think>...</think> / <thinking>...</thinking> / <reasoning>...</reasoning>
 * blocks (e.g. DeepSeek-R1 distills, QwQ, Qwen3-thinking).
 *
 * All plain text is HTML-escaped before any tag is introduced, so model
 * output can never inject markup into the page.
 */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const THINK_TAGS = ["think", "thinking", "reasoning", "reflection"];

/**
 * Pulls out reasoning/"thinking" blocks from raw model output.
 * Returns { thinking: string|null, remainder: string, stillThinking: boolean }.
 */
export function extractThinking(rawText) {
  const text = String(rawText ?? "");
  const tagAlt = THINK_TAGS.join("|");
  const pairedRe = new RegExp(`<\\s*(${tagAlt})\\s*>([\\s\\S]*?)<\\s*/\\s*\\1\\s*>`, "gi");
  const thinkingParts = [];
  let remainder = text.replace(pairedRe, (_match, _tag, inner) => {
    if (inner.trim()) thinkingParts.push(inner.trim());
    return "";
  });

  const unclosedRe = new RegExp(`<\\s*(${tagAlt})\\s*>([\\s\\S]*)$`, "i");
  const unclosedMatch = remainder.match(unclosedRe);
  let stillThinking = false;
  if (unclosedMatch) {
    stillThinking = true;
    if (unclosedMatch[2].trim()) thinkingParts.push(unclosedMatch[2].trim());
    remainder = remainder.slice(0, unclosedMatch.index);
  }

  return {
    thinking: thinkingParts.length ? thinkingParts.join("\n\n") : null,
    remainder: remainder.trim(),
    stillThinking,
  };
}

function renderInline(text) {
  let out = escapeHtml(text);

  const codeSpans = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  const linkSpans = [];
  const stashLink = (html) => {
    linkSpans.push(html);
    return `\u0000LINK${linkSpans.length - 1}\u0000`;
  };
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) =>
    stashLink(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
  );
  out = out.replace(/(^|[\s(])((https?:\/\/)[^\s<>")]+)/g, (_m, pre, url) =>
    pre + stashLink(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
  );

  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  out = out.replace(/\u0000LINK(\d+)\u0000/g, (_m, i) => linkSpans[Number(i)]);
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${escapeHtml(codeSpans[Number(i)])}</code>`);

  return out;
}

function isTableSeparatorRow(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}
function splitTableRow(line) {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}
function renderTable(lines) {
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
  html += header.map((h) => `<th>${renderInline(h)}</th>`).join("");
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>" + row.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
  }
  html += "</tbody></table></div>";
  return html;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  let html = `<${tag}>`;
  for (const item of items) {
    html += `<li>${renderInline(item.text)}`;
    if (item.children && item.children.length) html += renderList(item.children, item.childOrdered);
    html += "</li>";
  }
  html += `</${tag}>`;
  return html;
}

function parseListBlock(lines) {
  const items = [];
  let current = null;
  let ordered = null;
  for (const raw of lines) {
    const topMatch = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!topMatch) continue;
    const indent = topMatch[1].length;
    const marker = topMatch[2];
    const text = topMatch[3];
    const isOrdered = /\d+\./.test(marker);
    if (indent === 0) {
      if (ordered === null) ordered = isOrdered;
      current = { text, children: [], childOrdered: null };
      items.push(current);
    } else if (current) {
      if (current.childOrdered === null) current.childOrdered = isOrdered;
      current.children.push({ text, children: [] });
    }
  }
  return { html: renderList(items, ordered), ordered };
}

function renderCodeBlock(lang, code) {
  const safeLang = (lang || "").trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  const displayLang = safeLang || "text";
  const escaped = escapeHtml(code.replace(/\n$/, ""));
  const langClass = safeLang ? ` language-${safeLang}` : "";
  return (
    `<div class="code-block" data-lang="${displayLang}">` +
    `<div class="code-block-header"><span class="code-lang-label">${escapeHtml(displayLang)}</span>` +
    `<button type="button" class="code-copy-btn" data-copy-target="code">Copy</button></div>` +
    `<pre><code class="hljs${langClass}">${escaped}</code></pre>` +
    `</div>`
  );
}

function lineType(line) {
  if (/^\s*([-*+]|\d+\.)\s+/.test(line)) return "list";
  if (/^\s*>/.test(line)) return "quote";
  if (/^#{1,6}\s+/.test(line)) return "header";
  return "para";
}

/** Splits a blank-line-delimited chunk into sub-blocks at every line-type
 *  boundary, so e.g. "Intro text:\n- item one\n- item two" becomes a
 *  paragraph block followed by a proper list block. */
function splitByLineType(chunk) {
  const lines = chunk.split("\n").filter((l, i, arr) => !(l.trim() === "" && i === arr.length - 1));
  if (!lines.length) return [];
  const groups = [];
  let current = [lines[0]];
  let currentType = lineType(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const t = lineType(lines[i]);
    if (t === "header" || currentType === "header" || t !== currentType) {
      groups.push(current.join("\n"));
      current = [lines[i]];
      currentType = t;
    } else {
      current.push(lines[i]);
    }
  }
  groups.push(current.join("\n"));
  return groups;
}

export function renderMarkdown(rawText) {
  const text = String(rawText ?? "").replace(/\r\n/g, "\n");

  const codeBlocks = [];
  let working = text.replace(/```([a-zA-Z0-9+#.-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    codeBlocks.push({ lang, code });
    return `\u0000BLOCK${codeBlocks.length - 1}\u0000`;
  });
  const trailingFence = working.match(/```([a-zA-Z0-9+#.-]*)\n([\s\S]*)$/);
  if (trailingFence) {
    codeBlocks.push({ lang: trailingFence[1], code: trailingFence[2] });
    working = working.slice(0, trailingFence.index) + `\u0000BLOCK${codeBlocks.length - 1}\u0000`;
  }

  const rawChunks = working.split(/\n{2,}/);
  const rawBlocks = [];
  for (const chunk of rawChunks) {
    if (!chunk.trim()) continue;
    if (/^\u0000BLOCK\d+\u0000$/.test(chunk.trim())) {
      rawBlocks.push(chunk.trim());
      continue;
    }
    rawBlocks.push(...splitByLineType(chunk));
  }
  const htmlParts = [];

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const placeholderMatch = trimmed.match(/^\u0000BLOCK(\d+)\u0000$/);
    if (placeholderMatch) {
      const { lang, code } = codeBlocks[Number(placeholderMatch[1])];
      htmlParts.push(renderCodeBlock(lang, code));
      continue;
    }

    const lines = trimmed.split("\n");

    if (lines.length === 1 && /^(-{3,}|\*{3,}|_{3,})$/.test(lines[0].trim())) {
      htmlParts.push("<hr/>");
      continue;
    }

    const headerMatch = lines.length === 1 && lines[0].match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      htmlParts.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      continue;
    }

    if (lines.every((l) => /^\s*>/.test(l))) {
      const inner = lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n");
      htmlParts.push(`<blockquote>${renderMarkdown(inner)}</blockquote>`);
      continue;
    }

    if (lines.length >= 2 && lines[0].includes("|") && isTableSeparatorRow(lines[1])) {
      htmlParts.push(renderTable(lines));
      continue;
    }

    if (lines.every((l) => /^\s*([-*+]|\d+\.)\s+/.test(l))) {
      htmlParts.push(parseListBlock(lines).html);
      continue;
    }

    htmlParts.push(`<p>${lines.map(renderInline).join("<br/>")}</p>`);
  }

  return htmlParts.join("\n");
}

/**
 * High-level helper for chat bubbles: strips thinking blocks, returns both
 * the rendered thinking HTML (if any) and the rendered answer HTML, plus
 * whether the model is still "mid-thought" (for a live spinner state).
 */
export function renderChatMessage(rawText) {
  const { thinking, remainder, stillThinking } = extractThinking(rawText);
  return {
    thinkingHtml: thinking ? renderMarkdown(thinking) : null,
    stillThinking,
    answerHtml: renderMarkdown(remainder),
    hasAnswer: remainder.trim().length > 0,
  };
}
