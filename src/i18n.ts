// src/plugin/i18n.ts
import en from "./lang/en.json";
import ja from "./lang/ja.json";

type LangCode = "en" | "ja";

// Map Obsidian codes to our internal codes.
// You can extend this table as needed.
function normalizeLang(code: string | null): LangCode {
  if (!code) return "en"; // Obsidian default is English when null

  if (code.startsWith("ja")) return "ja";
  // Add more mappings if you add more languages later.
  return "en";
}

const resources: Record<LangCode, Record<string, string>> = {
  en,
  ja,
};

let currentLang: LangCode = "en";

export function initI18nFromObsidian(): void {
  const raw = window.localStorage.getItem("language"); // e.g. 'en', 'ja'
  currentLang = normalizeLang(raw);
}

// Optional: allow overriding from plugin settings in the future
export function setLanguageOverride(lang: LangCode | "auto"): void {
  if (lang === "auto") {
    initI18nFromObsidian();
  } else {
    currentLang = lang;
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = resources[currentLang]?.[key] ?? resources.en[key] ?? key;

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      const pattern = new RegExp(`\\$\\{${name}\\}`, "g");
      text = text.replace(pattern, String(value));
    }
  }
  return text;
}
