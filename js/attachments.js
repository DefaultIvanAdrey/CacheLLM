/**
 * attachments.js
 * Handles files/images attached in Chat or on Kanban cards:
 *  - Images: resized client-side and encoded as a data URL.
 *  - Plain-text-ish files (.txt/.md/.csv/.json/.js/.py/... ) read directly.
 *  - PDFs and .docx: best-effort text extraction using pdf.js / mammoth,
 *    loaded on demand from a CDN. Falls back to filename-only reference if
 *    extraction fails.
 *  - Anything else: attached as a filename-only reference.
 */

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "cs", "go", "rs", "rb",
  "php", "sql", "sh", "bash", "log", "ini", "toml", "svg",
]);

const MAX_IMAGE_DIMENSION = 1280;
const MAX_TEXT_CHARS = 20000;

function extOf(filename) {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function resizeImage(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs");
      mod.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
      return mod;
    })();
  }
  return pdfjsPromise;
}

let mammothPromise = null;
async function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import("https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js").then(() => window.mammoth);
  }
  return mammothPromise;
}

async function extractPdfText(arrayBuffer) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  const pageCount = Math.min(doc.numPages, 30);
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n\n";
    if (text.length > MAX_TEXT_CHARS) break;
  }
  const truncated = doc.numPages > pageCount || text.length > MAX_TEXT_CHARS;
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated, pageCount: doc.numPages };
}

async function extractDocxText(arrayBuffer) {
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const truncated = result.value.length > MAX_TEXT_CHARS;
  return { text: result.value.slice(0, MAX_TEXT_CHARS), truncated };
}

/**
 * Processes a single File into a normalized attachment record:
 * { id, name, size, kind: 'image'|'text'|'unsupported', dataUrl?, text?, truncated?, error? }
 */
export async function processFile(file) {
  const id = `att-${Math.random().toString(36).slice(2, 10)}`;
  const base = { id, name: file.name, size: file.size, mime: file.type };

  if (file.type.startsWith("image/")) {
    try {
      const raw = await fileToDataUrl(file);
      const resized = await resizeImage(raw, MAX_IMAGE_DIMENSION);
      return { ...base, kind: "image", dataUrl: resized };
    } catch (err) {
      return { ...base, kind: "unsupported", error: err.message };
    }
  }

  const ext = extOf(file.name);

  if (ext === "pdf" || file.type === "application/pdf") {
    try {
      const buf = await file.arrayBuffer();
      const { text, truncated, pageCount } = await extractPdfText(buf);
      return { ...base, kind: "text", text, truncated, meta: `${pageCount} page(s)` };
    } catch (err) {
      return { ...base, kind: "unsupported", error: `Couldn't extract PDF text (${err.message}). The file name is still attached for reference.` };
    }
  }

  if (ext === "docx") {
    try {
      const buf = await file.arrayBuffer();
      const { text, truncated } = await extractDocxText(buf);
      return { ...base, kind: "text", text, truncated };
    } catch (err) {
      return { ...base, kind: "unsupported", error: `Couldn't extract .docx text (${err.message}). The file name is still attached for reference.` };
    }
  }

  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) {
    try {
      const text = await fileToText(file);
      const truncated = text.length > MAX_TEXT_CHARS;
      return { ...base, kind: "text", text: text.slice(0, MAX_TEXT_CHARS), truncated };
    } catch (err) {
      return { ...base, kind: "unsupported", error: err.message };
    }
  }

  return { ...base, kind: "unsupported", error: "File type not supported for content extraction — only the file name is attached." };
}

export function attachmentToPromptText(att) {
  if (att.kind === "text") {
    return `--- Attached file: ${att.name}${att.meta ? ` (${att.meta})` : ""} ---\n${att.text}${att.truncated ? "\n[...truncated...]" : ""}\n--- end of ${att.name} ---`;
  }
  if (att.kind === "image") return `[Attached image: ${att.name}]`;
  return `[Attached file: ${att.name} — content could not be read${att.error ? ": " + att.error : ""}]`;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
