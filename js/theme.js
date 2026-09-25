/**
 * theme.js
 * Light / dark / system theme switching. Persists choice in localStorage and
 * updates <meta name="theme-color"> for correct PWA chrome coloring.
 */

const KEY = "webllm-kanban-theme";
const THEME_COLORS = { light: "#fafaf9", dark: "#141210" };

export function getStoredTheme() {
  return localStorage.getItem(KEY) || "system";
}
export function setStoredTheme(value) {
  localStorage.setItem(KEY, value);
}
function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
export function resolveEffectiveTheme(pref) {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}
export function applyTheme(pref) {
  const effective = resolveEffectiveTheme(pref);
  document.documentElement.setAttribute("data-theme", effective);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[effective]);
  return effective;
}
export function initTheme(onChange) {
  const pref = getStoredTheme();
  applyTheme(pref);
  if (window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener?.("change", () => {
      if (getStoredTheme() === "system") {
        const eff = applyTheme("system");
        onChange && onChange(eff);
      }
    });
  }
  return resolveEffectiveTheme(pref);
}
export function cycleTheme() {
  const order = ["light", "dark", "system"];
  const current = getStoredTheme();
  const next = order[(order.indexOf(current) + 1) % order.length];
  setStoredTheme(next);
  applyTheme(next);
  return next;
}
