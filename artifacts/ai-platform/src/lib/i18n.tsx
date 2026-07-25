/**
 * Lightweight i18n context for the AI Platform admin dashboard.
 * Supports Indonesian (id) and English (en).
 * Preference is persisted in localStorage.
 *
 * Usage:
 *   const { lang, setLang, t } = useLang();
 *   t('nav.sections.overview')  → "Ikhtisar" (id) | "Overview" (en)
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

function flattenLocale(
  value: unknown,
  prefix = "",
  output: Record<string, string> = {},
): Record<string, string> {
  if (typeof value === "string") {
    output[prefix] = value;
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    flattenLocale(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

/**
 * A few screens predate the translation context and still render literal UI
 * strings. The locale files cover the shared product vocabulary; these
 * additions cover seeded workflow copy and common labels used by those legacy
 * screens. They are intentionally exact-match translations so user-entered
 * descriptions and names are not rewritten.
 */
const LEGACY_ID_TRANSLATIONS: Record<string, string> = {
  "Creative Brief Workflow": "Alur Kerja Brief Kreatif",
  "Full 4-step creative pipeline: Brand Strategy → Creative Direction → Copy Production → Quality Control":
    "Pipeline kreatif 4 langkah lengkap: Strategi Brand → Arahan Kreatif → Produksi Copy → Kontrol Kualitas",
  "Document Summary Pipeline": "Pipeline Ringkasan Dokumen",
  "Extract, chunk, and summarize long documents using AI":
    "Ekstrak, pecah, dan ringkas dokumen panjang menggunakan AI",
  "Sentiment Analysis Pipeline": "Pipeline Analisis Sentimen",
  "Classify and analyze sentiment across batches of text":
    "Klasifikasikan dan analisis sentimen dari kumpulan teks",
  "Brand Strategy": "Strategi Brand",
  "Creative Direction": "Arahan Kreatif",
  "Copy Production": "Produksi Copy",
  "Quality Control": "Kontrol Kualitas",
  "Extract Text": "Ekstrak Teks",
  "Chunk Document": "Pecah Dokumen",
  "Summarize Chunks": "Ringkas Bagian",
  "Merge Summary": "Gabungkan Ringkasan",
  "Preprocess Text": "Pra-proses Teks",
  "Classify Sentiment": "Klasifikasikan Sentimen",
  "Aggregate Results": "Gabungkan Hasil",
  "ACTIVE": "AKTIF",
  "DRAFT": "DRAF",
  "PAUSED": "DIJEDA",
  "ARCHIVED": "DIARSIPKAN",
  "creative": "kreatif",
  "brand": "brand",
  "marketing": "pemasaran",
  "documents": "dokumen",
  "summarization": "peringkasan",
  "sentiment": "sentimen",
  "analytics": "analitik",
  "Search employees...": "Cari karyawan...",
  "All Departments": "Semua Departemen",
  "Digital Employee Directory": "Direktori Karyawan Digital",
  "Total Employees": "Total Karyawan",
  "Active Now": "Aktif Sekarang",
  "Departments": "Departemen",
  "Jobs Today": "Pekerjaan Hari Ini",
  "Running Jobs": "Pekerjaan Berjalan",
  "Queued Jobs": "Pekerjaan dalam Antrean",
  "Completed Today": "Selesai Hari Ini",
  "Failed Today": "Gagal Hari Ini",
  "Availability": "Ketersediaan",
  "Avg Latency": "Latensi Rata-rata",
  "Provider": "Penyedia",
  "Model": "Model",
  "Status": "Status",
  "Error": "Error",
  "Seed complete": "Pengisian data selesai",
  "Seed failed": "Pengisian data gagal",
  "Failed to load workforce data": "Gagal memuat data tenaga kerja",
  "Test data created": "Data uji berhasil dibuat",
  "Failed to create test data": "Gagal membuat data uji",
  "Network error": "Kesalahan jaringan",
  "Daily Activity": "Aktivitas Harian",
  "Requests": "Permintaan",
  "Tokens": "Token",
  "Cost (USD)": "Biaya (USD)",
  "Agent Performance": "Kinerja Agen",
  "Service Request Funnel": "Corong Permintaan Layanan",
  "Public": "Publik",
  "Internal": "Internal",
  "Actions": "Tindakan",
  "Archive via status": "Arsipkan melalui status",
  "Edit category": "Ubah kategori",
  "Add category": "Tambah kategori",
  "Add Category": "Tambah Kategori",
  "Code (e.g. creative)": "Kode (mis. kreatif)",
  "Public discovery": "Penemuan publik",
  "Commercial ready": "Siap komersial",
  "Internal only": "Khusus internal",
  "Featured category": "Kategori unggulan",
  "Save": "Simpan",
};

function getLocaleTextMap(lang: Lang): Record<string, string> {
  const source = flattenLocale(LOCALES[lang === "id" ? "en" : "id"]);
  const target = flattenLocale(LOCALES[lang]);
  const map: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    const translated = target[key];
    if (translated && translated !== value) map[value] = translated;
  }

  if (lang === "id") {
    Object.assign(map, LEGACY_ID_TRANSLATIONS);
  } else {
    for (const [english, indonesian] of Object.entries(LEGACY_ID_TRANSLATIONS)) {
      map[indonesian] = english;
    }
  }
  return map;
}

const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"];
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

function translateDom(root: HTMLElement, map: Record<string, string>) {
  const translateValue = (value: string) => {
    const leading = value.match(/^\s*/)?.[0] ?? "";
    const trailing = value.match(/\s*$/)?.[0] ?? "";
    const trimmed = value.trim();
    const translated = map[trimmed];
    return translated == null ? value : `${leading}${translated}${trailing}`;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (parent && !SKIPPED_TAGS.has(parent.tagName) && current.nodeValue?.trim()) {
      textNodes.push(current as Text);
    }
  }
  for (const node of textNodes) {
    const next = translateValue(node.nodeValue ?? "");
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    if (SKIPPED_TAGS.has(element.tagName)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const next = translateValue(value);
      if (next !== value) element.setAttribute(attribute, next);
    }
  });
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
  const domTextMap = useMemo(() => getLocaleTextMap(lang), [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (key: string) => resolve(LOCALES[lang] as unknown as Record<string, unknown>, key),
    [lang],
  );

  // Some of the platform's older feature pages still contain literal UI copy
  // instead of a locale key. Localize those nodes at the shell boundary so
  // changing ID/EN applies consistently to nested screens too. React-owned
  // components remain safe because the observer only changes exact UI strings.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.body;
    let frame = 0;
    const apply = () => {
      frame = 0;
      translateDom(root, domTextMap);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [domTextMap]);

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
