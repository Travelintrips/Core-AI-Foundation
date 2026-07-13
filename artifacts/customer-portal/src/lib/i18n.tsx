/**
 * Lightweight i18n context for the customer portal.
 * Supports Indonesian (id) — default — and English (en).
 * Language preference is persisted in localStorage.
 *
 * Usage:
 *   const { t, lang, setLang } = useTranslation();
 *   t('nav.services')   → "Layanan" (id) | "Services" (en)
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { id as idLocale } from "@/locales/id";
import { en as enLocale } from "@/locales/en";

export type Lang = "id" | "en";
export type Translations = typeof idLocale;

const LOCALES: Record<Lang, Translations> = { id: idLocale, en: enLocale };
const LS_KEY = "cs_lang";

/** Resolve a dot-separated key against a nested object — returns raw value. */
function resolveRaw(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return key;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur ?? key;
}

/** Resolve a dot-separated key — returns string only. */
function resolve(obj: Record<string, unknown>, key: string): string {
  const raw = resolveRaw(obj, key);
  return typeof raw === "string" ? raw : key;
}

/* ── Context ── */

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Resolve a key that maps to a string array in the locale files. */
  tArr: (key: string) => string[];
};

const I18nContext = createContext<I18nCtx | null>(null);

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY) as Lang | null;
    if (stored === "id" || stored === "en") return stored;
  } catch { /* ignore */ }
  // Browser preference fallback
  if (navigator.language.startsWith("id")) return "id";
  return "id"; // default to Indonesian (primary market)
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const raw = resolve(LOCALES[lang] as unknown as Record<string, unknown>, key);
      if (!vars) return raw;
      return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? `{{${k}}}`));
    },
    [lang]
  );

  const tArr = useCallback(
    (key: string): string[] => {
      const raw = resolveRaw(LOCALES[lang] as unknown as Record<string, unknown>, key);
      return Array.isArray(raw) ? (raw as string[]) : [];
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tArr }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used inside LangProvider");
  return ctx;
}
