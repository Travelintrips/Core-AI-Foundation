/**
 * Pencarian Tarif BTKI & HS Code — Customer Portal
 *
 * Halaman publik (tanpa login) untuk mencari kode HS, tarif bea masuk,
 * pajak impor, LARTAS, dan dokumen perizinan dari database BTKI (6.990 kode).
 *
 * API:
 *   GET /api/customs/hs-search?q=...&limit=20
 *   GET /api/customs/hs/:code
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
import { SEOMeta } from "@/components/SEOMeta";
  Search,
  AlertTriangle,
  CheckCircle2,
  Package,
  ChevronRight,
  ArrowLeft,
  Globe,
  FileText,
  Percent,
  X,
  Info,
  ShieldAlert,
  Loader2,
  Calculator,
} from "lucide-react";

// ── API ────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TariffRow {
  id: number;
  hs_code: string;
  hs_code_6: string;
  hs_code_4: string;
  hs_code_2: string;
  description_id: string;
  description_en: string | null;
  unit: string | null;
  category: string | null;
  bm_mfn: string | null;
  bm_acfta: string | null;
  bm_afta: string | null;
  bm_aifta: string | null;
  bm_aanzfta: string | null;
  bm_ahkfta: string | null;
  bm_asfta: string | null;
  bm_akfta: string | null;
  bm_indonesia_australia: string | null;
  ppn_rate: string | null;
  ppnbm_rate: string | null;
  pph22_rate: string | null;
  pph22_non_api: string | null;
  lartas_import: boolean;
  lartas_export: boolean;
  lartas_desc: string | null;
  regulator_import: string | null;
  regulator_export: string | null;
  perizinan_import: { docs?: string[]; note?: string } | null;
  perizinan_export: { docs?: string[]; note?: string } | null;
  notes: string | null;
  updated_at: string;
}

interface SearchResult {
  results: TariffRow[];
  total: number;
  page: number;
  limit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(val: string | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `${n}%`;
}

/**
 * Heading rows have a 4 or 6-digit hs_code with no dots (e.g. "6105", "610510").
 * These are chapter/subchapter headings — all FTA/tariff fields are null.
 * Only 10-digit dotted codes (e.g. "6109.10.00") carry real tariff data.
 */
function isHeadingRow(hs_code: string): boolean {
  return !/\./.test(hs_code);
}

function RateChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null | undefined;
  accent?: "blue" | "purple" | "green";
}) {
  const display = pct(value);
  const isZero = display === "0%";
  const isEmpty = display === "—";

  const accentCls =
    accent === "blue"
      ? "border-blue-500/30 bg-blue-950/30"
      : accent === "purple"
      ? "border-purple-500/30 bg-purple-950/30"
      : "border-white/10 bg-white/5";

  const valueCls = isEmpty
    ? "text-white/20"
    : isZero
    ? "text-green-400"
    : "text-amber-400";

  return (
    <div
      className={`flex flex-col items-center justify-center px-2 py-2 rounded-lg border text-center ${accentCls}`}
    >
      <span className="text-[9px] font-medium uppercase tracking-wider mb-1"
        style={{ color: "#64748B" }}>
        {label}
      </span>
      <span className={`text-sm font-bold ${valueCls}`}>{display}</span>
    </div>
  );
}

// ── Result Card ───────────────────────────────────────────────────────────────

function TariffCard({
  row,
  onSelect,
}: {
  row: TariffRow;
  onSelect: (row: TariffRow) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="w-full text-left rounded-2xl border p-4 transition-all duration-150 hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-purple-500/50 group"
      style={{
        background: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "rgba(124,110,250,0.4)";
        (e.currentTarget as HTMLElement).style.background =
          "rgba(124,110,250,0.06)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLElement).style.background =
          "rgba(255,255,255,0.04)";
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="font-mono text-sm font-bold"
              style={{ color: "#7C6EFA" }}
            >
              {row.hs_code}
            </span>
            {row.category && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  color: "#94A3B8",
                }}
              >
                {row.category}
              </span>
            )}
            {row.lartas_import && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
              >
                <ShieldAlert className="w-2.5 h-2.5" />
                LARTAS
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug text-white">
            {row.description_id}
          </p>
          {row.description_en && (
            <p className="text-xs mt-0.5 truncate" style={{ color: "#64748B" }}>
              {row.description_en}
            </p>
          )}
        </div>
        <ChevronRight
          className="w-4 h-4 shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
          style={{ color: "#475569" }}
        />
      </div>

      {/* Quick rates */}
      <div className="grid grid-cols-4 gap-1.5">
        <RateChip label="BM MFN" value={row.bm_mfn} />
        <RateChip label="ACFTA" value={row.bm_acfta} />
        <RateChip label="PPn" value={row.ppn_rate} accent="purple" />
        <RateChip label="PPh 22" value={row.pph22_rate} accent="blue" />
      </div>
    </button>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────

function DetailView({
  row,
  onClose,
}: {
  row: TariffRow;
  onClose: () => void;
}) {
  const ftaRates: { label: string; key: keyof TariffRow }[] = [
    { label: "BM MFN (Umum)", key: "bm_mfn" },
    { label: "ACFTA – Tiongkok", key: "bm_acfta" },
    { label: "AFTA – ASEAN", key: "bm_afta" },
    { label: "AIFTA – India", key: "bm_aifta" },
    { label: "AANZFTA – ANZ", key: "bm_aanzfta" },
    { label: "AHKFTA – Hong Kong", key: "bm_ahkfta" },
    { label: "ASFTA – Swiss", key: "bm_asfta" },
    { label: "AKFTA – Korea", key: "bm_akfta" },
    { label: "IA-CEPA – Australia", key: "bm_indonesia_australia" },
  ];

  const taxes = [
    { label: "PPn", value: row.ppn_rate, desc: "Pajak Pertambahan Nilai" },
    { label: "PPnBM", value: row.ppnbm_rate, desc: "Penjualan Barang Mewah" },
    { label: "PPh 22 (API)", value: row.pph22_rate, desc: "Importir berizin" },
    { label: "PPh 22 (Non-API)", value: row.pph22_non_api, desc: "Tanpa API" },
  ];

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "#060B18" }}
    >
      {/* Back bar */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.07)" }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-white"
          style={{ color: "#64748B" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </button>
        <div className="flex-1" />
        <span className="font-mono text-sm font-bold" style={{ color: "#7C6EFA" }}>
          {row.hs_code}
        </span>
        {row.lartas_import && (
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
            style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
          >
            <ShieldAlert className="w-3 h-3" /> LARTAS
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-5 space-y-6">

          {/* Identity */}
          <div>
            <h2 className="text-base font-bold text-white leading-snug">
              {row.description_id}
            </h2>
            {row.description_en && (
              <p className="text-sm mt-1" style={{ color: "#64748B" }}>
                {row.description_en}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {row.category && (
                <span
                  className="px-2 py-0.5 rounded-md text-xs font-medium"
                  style={{ background: "rgba(255,255,255,0.08)", color: "#94A3B8" }}
                >
                  {row.category}
                </span>
              )}
              {row.unit && (
                <span
                  className="px-2 py-0.5 rounded-md text-xs"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#64748B" }}
                >
                  Satuan: {row.unit}
                </span>
              )}
              <span
                className="px-2 py-0.5 rounded-md font-mono text-xs"
                style={{ background: "rgba(255,255,255,0.05)", color: "#64748B" }}
              >
                Pos {row.hs_code_4}
              </span>
              <span
                className="px-2 py-0.5 rounded-md font-mono text-xs"
                style={{ background: "rgba(255,255,255,0.05)", color: "#64748B" }}
              >
                Bab {row.hs_code_2}
              </span>
            </div>
          </div>

          <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          {/* Heading-row notice — shown when hs_code has no dots (4/6-digit heading) */}
          {isHeadingRow(row.hs_code) && (
            <div
              className="flex items-start gap-3 px-3 py-3 rounded-xl border"
              style={{
                borderColor: "rgba(251,191,36,0.3)",
                background: "rgba(251,191,36,0.06)",
              }}
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#FCD34D" }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: "#FCD34D" }}>
                  Ini adalah kode pos/heading — bukan kode tarif penuh
                </p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "#94A3B8" }}>
                  Data bea masuk, FTA, dan pajak hanya tersedia di kode HS{" "}
                  <span className="font-mono font-bold text-white/80">10 digit</span>{" "}
                  (format: XXXX.XX.XX). Pilih kode lengkap dari hasil pencarian untuk
                  melihat tarif detail.
                </p>
              </div>
            </div>
          )}

          {/* FTA rates */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4" style={{ color: "#7C6EFA" }} />
              <h3 className="text-sm font-semibold text-white">
                Bea Masuk per Skema FTA
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ftaRates.map(({ label, key }) => {
                const val = row[key] as string | null;
                const display = pct(val);
                const isZero = display === "0%";
                const isEmpty = display === "—";
                const isMFN = key === "bm_mfn";
                return (
                  <div
                    key={String(key)}
                    className={`flex flex-col px-2.5 py-2 rounded-xl border text-center ${
                      isEmpty && !isMFN ? "opacity-40" : ""
                    }`}
                    style={{
                      borderColor: isMFN
                        ? "rgba(124,110,250,0.3)"
                        : "rgba(255,255,255,0.08)",
                      background: isMFN
                        ? "rgba(124,110,250,0.08)"
                        : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <span
                      className="text-[9px] uppercase tracking-wider mb-1"
                      style={{ color: "#475569" }}
                    >
                      {label}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        isEmpty
                          ? "text-white/20"
                          : isZero
                          ? "text-green-400"
                          : "text-amber-400"
                      }`}
                    >
                      {display}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          {/* Pajak impor */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Percent className="w-4 h-4" style={{ color: "#A78BFA" }} />
              <h3 className="text-sm font-semibold text-white">Pajak Impor</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {taxes.map(({ label, value, desc }) => (
                <div
                  key={label}
                  className="flex flex-col px-3 py-2.5 rounded-xl border"
                  style={{
                    borderColor: "rgba(167,139,250,0.2)",
                    background: "rgba(167,139,250,0.05)",
                  }}
                >
                  <span className="text-[10px]" style={{ color: "#64748B" }}>
                    {label}
                  </span>
                  <span className="text-base font-bold mt-0.5" style={{ color: "#C4B5FD" }}>
                    {pct(value)}
                  </span>
                  <span className="text-[10px] mt-0.5" style={{ color: "#475569" }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          {/* LARTAS */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              {row.lartas_import ? (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              )}
              <h3 className="text-sm font-semibold text-white">
                LARTAS (Larangan & Pembatasan)
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div
                className="p-3 rounded-xl border"
                style={{
                  borderColor: row.lartas_import
                    ? "rgba(239,68,68,0.3)"
                    : "rgba(34,197,94,0.2)",
                  background: row.lartas_import
                    ? "rgba(239,68,68,0.06)"
                    : "rgba(34,197,94,0.04)",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-white">Impor</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={
                      row.lartas_import
                        ? { background: "rgba(239,68,68,0.2)", color: "#F87171" }
                        : { background: "rgba(34,197,94,0.15)", color: "#4ADE80" }
                    }
                  >
                    {row.lartas_import ? "LARTAS" : "Bebas"}
                  </span>
                </div>
                {row.regulator_import && (
                  <p className="text-xs" style={{ color: "#64748B" }}>
                    Regulator:{" "}
                    <span className="text-white/70">{row.regulator_import}</span>
                  </p>
                )}
              </div>
              <div
                className="p-3 rounded-xl border"
                style={{
                  borderColor: row.lartas_export
                    ? "rgba(239,68,68,0.3)"
                    : "rgba(255,255,255,0.08)",
                  background: row.lartas_export
                    ? "rgba(239,68,68,0.06)"
                    : "rgba(255,255,255,0.03)",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-white">Ekspor</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={
                      row.lartas_export
                        ? { background: "rgba(239,68,68,0.2)", color: "#F87171" }
                        : { background: "rgba(255,255,255,0.08)", color: "#64748B" }
                    }
                  >
                    {row.lartas_export ? "LARTAS" : "Bebas"}
                  </span>
                </div>
                {row.regulator_export && (
                  <p className="text-xs" style={{ color: "#64748B" }}>
                    Regulator:{" "}
                    <span className="text-white/70">{row.regulator_export}</span>
                  </p>
                )}
              </div>
            </div>
            {row.lartas_desc && (
              <p
                className="text-xs mt-2 px-3 py-2 rounded-lg border"
                style={{
                  color: "#94A3B8",
                  borderColor: "rgba(255,255,255,0.07)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                {row.lartas_desc}
              </p>
            )}
          </div>

          {/* Perizinan impor */}
          {row.perizinan_import && (
            <>
              <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Dokumen Perizinan Impor
                  </h3>
                </div>
                {row.perizinan_import.note && (
                  <p
                    className="text-xs mb-2 px-3 py-2 rounded-lg border"
                    style={{
                      color: "#FCD34D",
                      borderColor: "rgba(252,211,77,0.2)",
                      background: "rgba(252,211,77,0.05)",
                    }}
                  >
                    {row.perizinan_import.note}
                  </p>
                )}
                {row.perizinan_import.docs && row.perizinan_import.docs.length > 0 && (
                  <ul className="space-y-1.5">
                    {row.perizinan_import.docs.map((doc, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-white/80">
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        {doc}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* Perizinan ekspor */}
          {row.perizinan_export && (
            <>
              <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Dokumen Perizinan Ekspor
                  </h3>
                </div>
                {row.perizinan_export.note && (
                  <p
                    className="text-xs mb-2 px-3 py-2 rounded-lg border"
                    style={{
                      color: "#93C5FD",
                      borderColor: "rgba(147,197,253,0.2)",
                      background: "rgba(147,197,253,0.05)",
                    }}
                  >
                    {row.perizinan_export.note}
                  </p>
                )}
                {row.perizinan_export.docs && row.perizinan_export.docs.length > 0 && (
                  <ul className="space-y-1.5">
                    {row.perizinan_export.docs.map((doc, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-white/80">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        {doc}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* Notes */}
          {row.notes && (
            <>
              <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Info className="w-3.5 h-3.5" style={{ color: "#475569" }} />
                  <span className="text-xs font-medium" style={{ color: "#475569" }}>
                    Catatan
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>
                  {row.notes}
                </p>
              </div>
            </>
          )}

          {/* Updated */}
          <p className="text-[10px] text-right pb-2" style={{ color: "#334155" }}>
            Diperbarui:{" "}
            {new Date(row.updated_at).toLocaleDateString("id-ID", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Empty / loading states ────────────────────────────────────────────────────

function EmptyPrompt() {
  const examples = ["laptop", "8471", "tekstil", "kelapa sawit", "baja", "plastik"];
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 pb-16 px-4 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.2)" }}
      >
        <Package className="w-8 h-8" style={{ color: "#7C6EFA" }} />
      </div>
      <div>
        <p className="text-sm font-medium text-white">Cari kode HS atau nama barang</p>
        <p className="text-xs mt-1.5" style={{ color: "#475569" }}>
          Ketik minimal 2 karakter untuk mulai mencari
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 mt-1">
        {examples.map((ex) => (
          <span
            key={ex}
            className="px-2.5 py-1 rounded-full text-xs font-mono"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "#64748B",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {ex}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomsTariff() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<TariffRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 350);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  useEffect(() => {
    setSelected(null);
  }, [debouncedQuery]);

  const { data, isLoading, isError } = useQuery<SearchResult>({
    queryKey: ["cp-customs-search", debouncedQuery],
    queryFn: () =>
      apiFetch<SearchResult>(
        `/api/customs/hs-search?q=${encodeURIComponent(debouncedQuery)}&limit=20`
      ),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60_000,
  });

  const results = data?.results ?? [];
  const total = data?.total ?? 0;

  // ── Split-pane layout: left = search list, right = detail ──────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#060B18", color: "#F0F4FF" }}
    >
      <SEOMeta
        title="Pencarian Tarif BTKI & Kode HS"
        description="Cari kode HS, tarif bea masuk, pajak impor, LARTAS, dan dokumen perizinan dari database BTKI dengan 6.990+ kode. Gratis, tanpa registrasi."
        canonical="/customs-tariff"
      />
      {/* ── Top nav strip ─────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(6,11,24,0.95)" }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 mr-2 group"
          style={{ textDecoration: "none" }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg,#7C6EFA,#5F52D0)",
              boxShadow: "0 2px 10px rgba(124,110,250,0.35)",
            }}
          >
            <Package className="w-3.5 h-3.5 text-white" />
          </div>
          <span
            className="text-sm font-semibold hidden sm:block"
            style={{ color: "#94A3B8" }}
          >
            Creative AI Studio
          </span>
        </Link>
        <span style={{ color: "#334155" }}>/</span>
        <span className="text-sm font-medium text-white">Tarif BTKI & HS Code</span>
        <div className="flex-1" />
        <Link
          href="/tarif-kalkulator"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: "rgba(20,184,166,0.1)",
            color: "#2DD4BF",
            border: "1px solid rgba(20,184,166,0.25)",
            textDecoration: "none",
          }}
        >
          <Calculator className="w-3.5 h-3.5" />
          Kalkulator Tarif
        </Link>
        <span
          className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(255,255,255,0.05)",
            color: "#64748B",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#22C55E" }}
          />
          6.990 kode HS
        </span>
      </header>

      {/* ── Content area ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 53px)" }}>

        {/* Left: search panel */}
        <div
          className={`flex flex-col border-r ${
            selected ? "hidden lg:flex lg:w-[420px] lg:shrink-0" : "flex-1"
          }`}
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          {/* Search header */}
          <div
            className="px-4 pt-4 pb-3 border-b shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <p className="text-xs mb-3" style={{ color: "#475569" }}>
              Cari bea masuk MFN, tarif FTA, pajak impor, LARTAS, dan perizinan dari 6.990 kode HS.
            </p>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                style={{ color: "#475569" }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => handleInput(e.target.value)}
                placeholder="Cari nama barang atau kode HS… (min. 2 karakter)"
                autoFocus
                className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#F0F4FF",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(124,110,250,0.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(124,110,250,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setDebouncedQuery("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:text-white"
                  style={{ color: "#475569" }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {debouncedQuery.length >= 2 && !isLoading && (
              <p className="text-[11px] mt-2" style={{ color: "#334155" }}>
                {total > 0
                  ? `${total.toLocaleString("id")} hasil${total > 20 ? " — menampilkan 20 pertama" : ""}`
                  : `Tidak ditemukan untuk "${debouncedQuery}"`}
              </p>
            )}
          </div>

          {/* Results list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {debouncedQuery.length < 2 && <EmptyPrompt />}

            {isLoading && debouncedQuery.length >= 2 && (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#7C6EFA" }} />
              </div>
            )}

            {isError && (
              <div
                className="flex items-center gap-2.5 text-sm px-4 py-3 rounded-xl border mx-1"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.06)",
                  color: "#FCA5A5",
                }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Gagal memuat data. Periksa koneksi ke server.
              </div>
            )}

            {!isLoading &&
              !isError &&
              results.length === 0 &&
              debouncedQuery.length >= 2 && (
                <div
                  className="flex flex-col items-center gap-2 py-16 text-center"
                  style={{ color: "#334155" }}
                >
                  <Package className="w-8 h-8 opacity-40" />
                  <p className="text-sm">
                    Tidak ada hasil untuk &ldquo;{debouncedQuery}&rdquo;
                  </p>
                </div>
              )}

            {results.map((row) => (
              <TariffCard key={row.id} row={row} onSelect={setSelected} />
            ))}
          </div>

          {/* Disclaimer */}
          <div
            className="px-4 py-2.5 border-t shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.05)" }}
          >
            <p className="text-[10px]" style={{ color: "#1E293B" }}>
              Data tarif bersumber dari BTKI (Buku Tarif Kepabeanan Indonesia) — gunakan sebagai referensi awal, bukan pengganti konsultasi kepabeanan resmi.
            </p>
          </div>
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <DetailView row={selected} onClose={() => setSelected(null)} />
          </div>
        ) : (
          <div
            className="hidden lg:flex flex-1 flex-col items-center justify-center gap-3"
            style={{ color: "#1E293B" }}
          >
            <Package className="w-10 h-10 opacity-20" />
            <p className="text-sm">Pilih kode HS dari daftar untuk melihat detail tarif</p>
          </div>
        )}
      </div>
    </div>
  );
}
