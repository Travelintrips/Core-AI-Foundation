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
  // ── Seeded workflow copy ────────────────────────────────────────────────
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

  // ── Status badges (uppercase API values) ───────────────────────────────
  "ACTIVE": "AKTIF",
  "DRAFT": "DRAF",
  "PAUSED": "DIJEDA",
  "ARCHIVED": "DIARSIPKAN",

  // ── Tag / category labels ──────────────────────────────────────────────
  "creative": "kreatif",
  "brand": "brand",
  "marketing": "pemasaran",
  "documents": "dokumen",
  "summarization": "peringkasan",
  "sentiment": "sentimen",
  "analytics": "analitik",

  // ── Catalog admin ──────────────────────────────────────────────────────
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

  // ── Workforce page ─────────────────────────────────────────────────────
  "AI Workforce": "Tenaga Kerja AI",
  "Digital Employee Directory": "Direktori Karyawan Digital",
  "Seed Workforce": "Isi Data Tenaga Kerja",
  "Search employees...": "Cari karyawan...",
  "All Departments": "Semua Departemen",
  "All Status": "Semua Status",
  "Total Employees": "Total Karyawan",
  "Active Now": "Aktif Sekarang",
  "Departments": "Departemen",
  "Jobs Today": "Pekerjaan Hari Ini",
  "Loading workforce...": "Memuat tenaga kerja...",
  "No employees found": "Tidak ada karyawan ditemukan",
  "Seed the database to create Digital Workforce employees.":
    "Isi database untuk membuat karyawan Tenaga Kerja Digital.",
  // Table headers
  "Employee": "Karyawan",
  "Position": "Posisi",
  "Level": "Tingkat",
  // Detail panel section titles
  "Code": "Kode",
  "Cost Center": "Pusat Biaya",
  "Max Jobs": "Maks Pekerjaan",
  "Agent Slug": "Slug Agen",
  "AI Backend": "Backend AI",
  "Cost Simulation": "Simulasi Biaya",
  "Virtual Salary": "Gaji Virtual",
  "Hourly Rate": "Tarif Per Jam",
  "per month": "per bulan",
  "per hour": "per jam",
  "Workload": "Beban Kerja",
  "Skill Matrix": "Matriks Keahlian",
  "Tool Permissions": "Izin Alat",
  "Hierarchy": "Hierarki",
  "today": "hari ini",
  // Workload metrics
  "Running Jobs": "Pekerjaan Berjalan",
  "Queued Jobs": "Pekerjaan dalam Antrean",
  "Completed Today": "Selesai Hari Ini",
  "Failed Today": "Gagal Hari Ini",
  "Availability": "Ketersediaan",
  "Avg Latency": "Latensi Rata-rata",
  // Status labels used in StatusBadge
  "Active": "Aktif",
  "Busy": "Sibuk",
  "Offline": "Tidak Aktif",
  "Maintenance": "Pemeliharaan",
  "Idle": "Siaga",
  // Toast messages
  "Seed complete": "Pengisian data selesai",
  "Seed failed": "Pengisian data gagal",
  "Failed to load workforce data": "Gagal memuat data tenaga kerja",
  "Test data created": "Data uji berhasil dibuat",
  "Failed to create test data": "Gagal membuat data uji",
  "Network error": "Kesalahan jaringan",
  // Common field labels
  "Provider": "Penyedia",
  "Model": "Model",
  "Status": "Status",
  "Error": "Error",

  // ── Operations page ────────────────────────────────────────────────────
  "AI Operations Center": "Pusat Operasi AI",
  "Department": "Departemen",
  "Employees": "Karyawan",
  "Active Plans": "Rencana Aktif",
  "No departments seeded yet.": "Belum ada departemen yang diisi.",
  "Objective": "Tujuan",
  "Dept": "Dept",
  "Priority": "Prioritas",
  "No execution plans yet. They're created automatically when Creative AI projects run.":
    "Belum ada rencana eksekusi. Dibuat otomatis saat proyek Creative AI berjalan.",
  "Task": "Tugas",
  "No task assignments yet.": "Belum ada penugasan.",
  "No capacity data yet.": "Belum ada data kapasitas.",
  "Quality": "Kualitas",
  "XP": "XP",
  "No performance records yet.": "Belum ada catatan kinerja.",
  "No candidates flagged yet.": "Belum ada kandidat yang ditandai.",
  "No decisions logged yet.": "Belum ada keputusan tercatat.",
  "promotion candidate": "kandidat promosi",
  "training required": "pelatihan diperlukan",
  "Decision": "Keputusan",
  "Reason": "Alasan",

  // ── Production Pipeline page ───────────────────────────────────────────
  "Production Pipeline": "Pipeline Produksi",
  "Pipeline Detail": "Detail Pipeline",
  "Start Production Pipeline": "Mulai Pipeline Produksi",
  "Start Pipeline": "Mulai Pipeline",
  "Project ID (UUID or integer)": "ID Proyek (UUID atau integer)",
  "V4.4 · 7-stage AI production orchestrator": "V4.4 · Orkestrator produksi AI 7 tahap",
  "Stage Health": "Kesehatan Tahap",
  "Pipeline Flow": "Aliran Pipeline",
  "stages": "tahap",
  "No pipeline runs yet. Click Start Pipeline to begin.":
    "Belum ada proses pipeline. Klik Mulai Pipeline untuk memulai.",

  // ── Creative AI page ───────────────────────────────────────────────────
  "New Creative Brief": "Brief Kreatif Baru",
  "Specialist Agents": "Agen Spesialis",
  "Image Concepts": "Konsep Gambar",
  "Client Review": "Ulasan Klien",
  "Quotation": "Penawaran",
  "Generating…": "Membuat…",
  "Generate Creative Brief": "Buat Brief Kreatif",
  "Generate Image Concepts": "Buat Konsep Gambar",
  "Generate Images": "Buat Gambar",
  "Regenerate": "Buat Ulang",
  "Export MD": "Ekspor MD",
  // Brief form labels
  "Brand Name": "Nama Brand",
  "Business Type": "Jenis Bisnis",
  "Product / Service": "Produk / Layanan",
  "Campaign Goal": "Tujuan Kampanye",
  "Target Market": "Pasar Target",
  "Style Preference": "Preferensi Gaya",
  "Additional Notes": "Catatan Tambahan",
  // Asset stats
  "Generated": "Dibuat",
  "Approved": "Disetujui",
  "Avg QC": "Rata-rata QC",
  "Total Cost": "Total Biaya",
  // Feedback bar
  "No feedback yet": "Belum ada umpan balik",
  "Update": "Perbarui",
  "Review": "Ulasan",
  "Rating": "Rating",
  "Approve": "Setujui",
  // Asset card
  "Notes / Prompt": "Catatan / Prompt",
  "View Prompt": "Lihat Prompt",
  "Generation failed": "Pembuatan gagal",
  // Quotation/offer panel
  "Edit Draft": "Ubah Draf",
  "Create Offer": "Buat Penawaran",
  // Status/workflow states
  "Workflow queued — agents will start shortly…":
    "Alur kerja antri — agen akan segera mulai…",
  "Agents are generating your creative assets…":
    "Agen sedang membuat aset kreatif Anda…",
  "Workflow paused — per-workflow budget limit reached. Adjust guardrail settings to increase the limit.":
    "Alur kerja dijeda — batas anggaran per-alur kerja tercapai. Sesuaikan pengaturan guardrail untuk meningkatkan batas.",
  "budget capped": "anggaran terbatas",
  "Image Prompt Generator running… FLUX.1 image generation will start shortly.":
    "Image Prompt Generator berjalan… Pembuatan gambar FLUX.1 akan segera dimulai.",
  // Empty states
  "No projects yet": "Belum ada proyek",
  "No image concepts yet": "Belum ada konsep gambar",
  "No client review links yet": "Belum ada link ulasan klien",
  "Project not found": "Proyek tidak ditemukan",
  // Toast messages
  "Brief submitted": "Brief dikirim",
  "4-agent workflow has started.": "Alur kerja 4 agen telah dimulai.",
  "Review link created — copy it now!": "Link ulasan dibuat — salin sekarang!",
  "Review link revoked": "Link ulasan dicabut",
  "Quotation saved as draft": "Penawaran disimpan sebagai draf",
  "Quotation sent to client": "Penawaran dikirim ke klien",
  "Feedback recorded": "Umpan balik dicatat",
  "Markdown exported": "Markdown diekspor",
  "Export failed": "Ekspor gagal",
  "Failed to submit brief": "Gagal mengirim brief",
  "Failed to create review link": "Gagal membuat link ulasan",
  "Failed to revoke": "Gagal mencabut",
  "Generation already in progress": "Pembuatan sudah berjalan",
  "Failed to update asset": "Gagal memperbarui aset",
  "Failed to record feedback": "Gagal mencatat umpan balik",
  // Specialist agent labels
  "Fashion Design Specialist": "Spesialis Desain Fashion",
  "Interior Design Specialist": "Spesialis Desain Interior",
  "Fashion Specialist": "Spesialis Fashion",
  "Interior Specialist": "Spesialis Interior",
  // Design step names
  "Design Concept": "Konsep Desain",
  "Space Planning": "Perencanaan Ruang",
  "Material Specification": "Spesifikasi Material",
  "Interior Quality Control": "Kontrol Kualitas Interior",
  "Spatial Concept": "Konsep Spasial",
  "Material Spec": "Spek Material",
  "Client Proposal": "Proposal Klien",
  "Style Direction": "Arahan Gaya",

  // ── Observability page ─────────────────────────────────────────────────
  "AI Observability": "Observabilitas AI",
  "No execution data yet": "Belum ada data eksekusi",
  "No logs yet — logs appear once AI agents run.":
    "Belum ada log — log muncul saat agen AI berjalan.",
  "All statuses": "Semua status",
  "All providers": "Semua penyedia",
  "Timeout": "Waktu Habis",
  "Job / Order": "Pekerjaan / Pesanan",
  "When": "Waktu",
  "Workflow / Job": "Alur Kerja / Pekerjaan",
  "Order": "Pesanan",
  "Prompt Tokens": "Token Prompt",
  "Completion Tokens": "Token Penyelesaian",
  "Processing Time": "Waktu Pemrosesan",
  "Next →": "Berikutnya →",
  "Add Model Pricing": "Tambah Harga Model",
  "Edit Pricing": "Ubah Harga",
  "No workflow cost records yet.": "Belum ada catatan biaya alur kerja.",

  // ── Analytics / Dashboard ──────────────────────────────────────────────
  "Daily Activity": "Aktivitas Harian",
  "Requests": "Permintaan",
  "Tokens": "Token",
  "Cost (USD)": "Biaya (USD)",
  "Agent Performance": "Kinerja Agen",
  "Service Request Funnel": "Corong Permintaan Layanan",
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
