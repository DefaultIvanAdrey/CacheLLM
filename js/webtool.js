/**
 * webtool.js
 * "Internet search" toggle backing logic.
 *
 * A fully offline, 100% local LLM has no native ability to browse the web,
 * and there is no way to grant it real autonomous browsing from inside a
 * static PWA with no backend. What we CAN responsibly do: when the toggle
 * is on and the browser is online, look the user's question up on
 * Wikipedia (one of the few public knowledge APIs that allows anonymous
 * cross-origin requests from a browser) and splice the retrieved summary
 * into the model's context before it answers. It is NOT a general web
 * search engine and cannot click links, browse arbitrary sites, or fetch
 * real-time data — the UI is worded accordingly.
 */

const OPENSEARCH_URL = "https://en.wikipedia.org/w/api.php";
const SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary";

function toSearchPhrase(question) {
  let q = question.replace(/[?!.]+$/g, "").trim();
  const leadWord = /^(who|what|when|where|why|how|is|are|was|were|does|do|did|can|could|tell me about|explain|search for|look up)\s+/i;
  let prev;
  do {
    prev = q;
    q = q.replace(leadWord, "");
  } while (q !== prev);
  return (q || question).trim().slice(0, 120);
}

async function opensearch(query) {
  const url = `${OPENSEARCH_URL}?action=opensearch&format=json&formatversion=2&limit=3&origin=*&search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia search failed (${res.status})`);
  const [, titles] = await res.json();
  return titles || [];
}

async function fetchSummary(title) {
  const res = await fetch(`${SUMMARY_URL}/${encodeURIComponent(title)}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.extract) return null;
  return { title: json.title, extract: json.extract, url: json.content_urls?.desktop?.page };
}

/**
 * Looks up the user's question and returns a context block to prepend to
 * the model's context, plus the list of sources used. Returns { ok: false }
 * if nothing useful was found or the device is offline.
 */
export async function lookup(question) {
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  try {
    const phrase = toSearchPhrase(question) || question;
    const titles = await opensearch(phrase);
    if (!titles.length) return { ok: false, reason: "no_results" };

    const summaries = [];
    for (const title of titles.slice(0, 2)) {
      const summary = await fetchSummary(title);
      if (summary) summaries.push(summary);
    }
    if (!summaries.length) return { ok: false, reason: "no_results" };

    const contextBlock = summaries.map((s) => `### ${s.title} (Wikipedia)\n${s.extract}`).join("\n\n");
    return { ok: true, contextBlock, sources: summaries.map((s) => ({ title: s.title, url: s.url })) };
  } catch (err) {
    return { ok: false, reason: "error", error: err.message };
  }
}
