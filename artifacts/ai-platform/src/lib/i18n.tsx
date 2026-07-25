/**
 * Lightweight i18n context for the AI Platform admin dashboard.
 * Supports Indonesian (id) and English (en).
 * Preference is persisted in localStorage.
 *
 * Usage:
 *   const { lang, setLang, t } = useLang();
 *   t('nav.sections.overview')  → "Ikhtisar" (id) | "Overview" (en)
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { id as idLocale } from "@/locales/id";
import { en as enLocale } from "@/locales/en";

export type Lang = "id" | "en";

const LOCALES = { id: idLocale, en: enLocale };
const LS_KEY = "ai_platform_lang";

function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return key;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : key;
}

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const LangContext = createContext<LangCtx | null>(null);

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY) as Lang | null;
    if (stored === "id" || stored === "en") return stored;
  } catch { /* ignore */ }
  return "id"; // default to Indonesian
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (key: string) => resolve(LOCALES[lang] as unknown as Record<string, unknown>, key),
    [lang],
  );

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangCtx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}
