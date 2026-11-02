// Spanish and English. Copy stays inline at each call site, next to its markup:
// tr("English", "Español"). Numbers are not localized: amounts are formatted en-US and some
// code parses them back by stripping commas, and Peru writes them the same way.
export type Lang = "es" | "en";

const LANG_KEY = "honorarios.lang";
const GEO_TIMEOUT_MS = 1200;
// Countries where Spanish is the main language.
const SPANISH = new Set(["AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GQ", "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "ES", "UY", "VE"]);

let lang: Lang = "en";
let onChange: (() => void) | null = null;
// [English, Spanish]. The English title is the one in the HTML; the Spanish one sits in
// <title data-es>. Read lazily: stellar.ts imports this module and the tests run without a DOM.
let titles: [string, string] | null = null;

export const tr = (en: string, es: string): string => (lang === "es" ? es : en);

export const getLang = (): Lang => lang;

/** Locale for dates only. */
export const dateLocale = (): string => (lang === "es" ? "es-PE" : "en-US");

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "es" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

/** Visitor country from the Vercel function. "" when it is not there (vite dev) or slow. */
async function country(): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch("/api/geo", { signal: ctl.signal });
    if (!res.ok) return "";
    const body = (await res.json()) as { country?: unknown };
    return typeof body.country === "string" ? body.country.toUpperCase() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function applyDocument() {
  const el = document.querySelector("title");
  titles ??= [el?.textContent ?? "", el?.dataset.es ?? el?.textContent ?? ""];
  document.documentElement.lang = lang;
  document.title = lang === "es" ? titles[1] : titles[0];
}

/** An explicit choice wins; then the country of the IP; then the browser language. */
export async function initLang(): Promise<Lang> {
  const saved = stored();
  if (saved) {
    lang = saved;
  } else {
    const c = await country();
    lang = c ? (SPANISH.has(c) ? "es" : "en") : navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
  }
  applyDocument();
  return lang;
}

export function setLang(l: Lang) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* no storage */ }
  if (l === lang) return;
  lang = l;
  applyDocument();
  renderSwitch();
  onChange?.();
}

/** ES / EN buttons in the top bar. `rerender` repaints the page in the new language. */
export function mountLangSwitch(rerender: () => void) {
  onChange = rerender;
  renderSwitch();
}

function renderSwitch() {
  const box = document.getElementById("lang");
  if (!box) return;
  box.setAttribute("aria-label", tr("Language", "Idioma"));
  // Built once and then only updated, so the button that was clicked keeps keyboard focus.
  if (!box.childElementCount) {
    box.innerHTML = (["es", "en"] as const).map((l) =>
      `<button type="button" lang="${l}" title="${l === "es" ? "Español" : "English"}">${l.toUpperCase()}</button>`).join("");
    box.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
      b.addEventListener("click", () => setLang(b.lang as Lang)));
  }
  box.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.lang === lang)));
}
