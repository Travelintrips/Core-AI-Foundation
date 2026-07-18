/**
 * Kalkulator Tarif Impor — Customer Portal
 *
 * Simulasi biaya impor lengkap:
 *   Bea Masuk (BM), DPP PPN, PPN, PPh 22, Total Pungutan, Total DDP
 *
 * API:
 *   GET /api/customs/hs-search?q=...&limit=8   (Pilih dari daftar)
 *   GET /api/customs/hs/:code                   (Cari kode HS)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Calculator,
  ArrowLeft,
  Search,
  RefreshCcw,
  Copy,
  Check,
  RotateCcw,
  Package,
  Loader2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Info,
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
  hs_code_2: string;
  hs_code_4: string;
  description_id: string;
  description_en: string | null;
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
}

interface SearchResult {
  results: TariffRow[];
  total: number;
}

interface CalcResult {
  cif: number;
  bm: number;
  bmRate: number;
  bmScheme: string;
  dppPpn: number;
  ppn: number;
  ppnRate: number;
  pph: number;
  pphRate: number;
  isApi: boolean;
  totalPungutan: number;
  totalDdp: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const FTA_OPTIONS: { label: string; key: keyof TariffRow }[] = [
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

function parseAmt(s: string): number {
  return parseFloat(s.replace(/[^0-9]/g, "")) || 0;
}

function formatRp(n: number): string {
  return "Rp\u00a0" + Math.round(n).toLocaleString("id-ID");
}

function fmtInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  return parseInt(digits, 10).toLocaleString("id-ID");
}

function pct(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `${n}%`;
}

function isHeadingRow(hs: string): boolean {
  return !/\./.test(hs);
}

// ── Chip ──────────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={
        active
          ? { background: "rgba(20,184,166,0.15)", color: "#2DD4BF", border: "1px solid rgba(20,184,166,0.4)" }
          : { background: "rgba(255,255,255,0.05)", color: "#64748B", border: "1px solid rgba(255,255,255,0.08)" }
      }
    >
      {label}
    </button>
  );
}

// ── Number input ──────────────────────────────────────────────────────────────
function AmountInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span
        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium select-none"
        style={{ color: "#475569" }}
      >
        Rp
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={fmtInput(value)}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder={placeholder ?? "0"}
        className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl outline-none transition-all"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#F0F4FF",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(45,212,191,0.5)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(45,212,191,0.08)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
    </div>
  );
}

// ── Result line ───────────────────────────────────────────────────────────────
function ResultLine({
  label,
  sub,
  value,
  indent,
  highlight,
}: {
  label: string;
  sub?: string;
  value: number;
  indent?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-2.5 ${indent ? "pl-3 border-l" : ""}`}
      style={indent ? { borderColor: "rgba(255,255,255,0.07)" } : undefined}
    >
      <div>
        <p
          className="text-sm font-medium"
          style={{ color: highlight ? "#F0F4FF" : "#CBD5E1" }}
        >
          {label}
        </p>
        {sub && (
          <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>
            {sub}
          </p>
        )}
      </div>
      <span
        className="text-sm font-bold shrink-0 font-mono"
        style={{ color: highlight ? "#F0F4FF" : "#94A3B8" }}
      >
        {formatRp(value)}
      </span>
    </div>
  );
}

// ── Main Calculator ───────────────────────────────────────────────────────────
export default function TarifKalkulator() {
  // ── HS mode
  const [hsMode, setHsMode] = useState<"type" | "pick">("type");
  const [hsTyped, setHsTyped] = useState("");
  const [tariff, setTariff] = useState<TariffRow | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Pick mode search
  const [pickQuery, setPickQuery] = useState("");
  const [debouncedPick, setDebouncedPick] = useState("");
  const [showPickList, setShowPickList] = useState(false);
  const pickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  const handlePickInput = useCallback((val: string) => {
    setPickQuery(val);
    setShowPickList(true);
    if (pickDebounce.current) clearTimeout(pickDebounce.current);
    pickDebounce.current = setTimeout(() => setDebouncedPick(val), 350);
  }, []);

  const { data: pickData, isLoading: pickLoading } = useQuery<SearchResult>({
    queryKey: ["calc-pick", debouncedPick],
    queryFn: () =>
      apiFetch<SearchResult>(
        `/api/customs/hs-search?q=${encodeURIComponent(debouncedPick)}&limit=8`
      ),
    enabled: hsMode === "pick" && debouncedPick.length >= 2,
    staleTime: 60_000,
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) {
        setShowPickList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── CIF mode
  const [cifMode, setCifMode] = useState<"cif" | "fob">("cif");
  const [cifRaw, setCifRaw] = useState("10000000");
  const [fobRaw, setFobRaw] = useState("");
  const [freightRaw, setFreightRaw] = useState("");
  const [asuransiRaw, setAsuransiRaw] = useState("");

  // ── FTA & PPh
  const [ftaKey, setFtaKey] = useState<keyof TariffRow>("bm_mfn");
  const [showFtaMenu, setShowFtaMenu] = useState(false);
  const [pphType, setPphType] = useState<"api" | "nonapi">("api");

  // ── Result
  const [result, setResult] = useState<CalcResult | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Fetch HS by typed code
  const fetchHs = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    setFetchLoading(true);
    setFetchError(null);
    setResult(null);
    try {
      const data = await apiFetch<TariffRow>(`/api/customs/hs/${encodeURIComponent(clean)}`);
      setTariff(data);
    } catch {
      setFetchError("Kode HS tidak ditemukan dalam database BTKI");
      setTariff(null);
    } finally {
      setFetchLoading(false);
    }
  };

  // ── Pick from list
  const selectFromList = (row: TariffRow) => {
    setTariff(row);
    setHsTyped(row.hs_code);
    setPickQuery(row.hs_code + " — " + row.description_id.substring(0, 40));
    setShowPickList(false);
    setResult(null);
    setFetchError(null);
  };

  // ── Compute CIF
  const computeCIF = (): number => {
    if (cifMode === "cif") return parseAmt(cifRaw);
    return parseAmt(fobRaw) + parseAmt(freightRaw) + parseAmt(asuransiRaw);
  };

  // ── Calculate
  const calculate = () => {
    if (!tariff || isHeadingRow(tariff.hs_code)) return;
    const cif = computeCIF();
    if (cif <= 0) return;

    const bmRate = parseFloat((tariff[ftaKey] as string) || "0") || 0;
    const ppnRate = parseFloat(tariff.ppn_rate || "11") || 11;
    const pphRate =
      pphType === "api"
        ? parseFloat(tariff.pph22_rate || "2.5") || 2.5
        : parseFloat(tariff.pph22_non_api || "7.5") || 7.5;

    const bm = Math.round((cif * bmRate) / 100);
    const dppPpn = cif + bm;
    const ppn = Math.round((dppPpn * ppnRate) / 100);
    const pph = Math.round((cif * pphRate) / 100);
    const totalPungutan = bm + ppn + pph;
    const totalDdp = cif + totalPungutan;

    const ftaLabel = FTA_OPTIONS.find((o) => o.key === ftaKey)?.label ?? "MFN";

    setResult({
      cif,
      bm,
      bmRate,
      bmScheme: ftaLabel,
      dppPpn,
      ppn,
      ppnRate,
      pph,
      pphRate,
      isApi: pphType === "api",
      totalPungutan,
      totalDdp,
    });
  };

  // ── Copy to clipboard
  const copyResult = () => {
    if (!result || !tariff) return;
    const text = [
      `Kalkulator Tarif Impor — ${tariff.hs_code}`,
      `${tariff.description_id}`,
      ``,
      `Skema BM : ${result.bmScheme}`,
      ``,
      `Nilai CIF           : ${formatRp(result.cif)}`,
      `Bea Masuk (${result.bmRate}%) : ${formatRp(result.bm)}`,
      `DPP PPN             : ${formatRp(result.dppPpn)}`,
      `PPN (${result.ppnRate}%)        : ${formatRp(result.ppn)}`,
      `PPh Impor (${result.pphRate}%)  : ${formatRp(result.pph)}`,
      `Total Pungutan      : ${formatRp(result.totalPungutan)}`,
      `Total DDP           : ${formatRp(result.totalDdp)}`,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Reset
  const resetAll = () => {
    setTariff(null);
    setHsTyped("");
    setPickQuery("");
    setDebouncedPick("");
    setFetchError(null);
    setResult(null);
    setCifRaw("10000000");
    setFobRaw("");
    setFreightRaw("");
    setAsuransiRaw("");
    setPphType("api");
    setFtaKey("bm_mfn");
  };

  // ── Proportion bar
  const propBm  = result ? (result.bm  / result.cif) * 100 : 0;
  const propPpn = result ? (result.ppn / result.cif) * 100 : 0;
  const propPph = result ? (result.pph / result.cif) * 100 : 0;
  const rawSum  = propBm + propPpn + propPph;
  const scale   = rawSum > 60 ? 60 / rawSum : 1; // cap at 60% of bar width
  const wBm  = propBm  * scale;
  const wPpn = propPpn * scale;
  const wPph = propPph * scale;

  const canCalc = !!tariff && !isHeadingRow(tariff.hs_code) && computeCIF() > 0;

  const ftaLabel = FTA_OPTIONS.find((o) => o.key === ftaKey)?.label ?? "MFN";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#060B18", color: "#F0F4FF" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(6,11,24,0.97)" }}
      >
        <Link href="/customs-tariff" className="flex items-center gap-1.5 text-sm transition-colors hover:text-white" style={{ color: "#64748B", textDecoration: "none" }}>
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:block">Tarif BTKI</span>
        </Link>
        <span style={{ color: "#334155" }}>/</span>
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4" style={{ color: "#2DD4BF" }} />
          <span className="text-sm font-semibold text-white">Kalkulator Tarif Impor</span>
        </div>
        <p className="hidden lg:block text-xs ml-2" style={{ color: "#334155" }}>
          Hitung Bea Masuk, PPN, PPh, dan total DDP (Delivered Duty Paid)
        </p>
        <div className="flex-1" />
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 text-xs transition-colors hover:text-white px-3 py-1.5 rounded-lg"
          style={{ color: "#475569", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-0 overflow-auto">

        {/* ════ LEFT — inputs ════════════════════════════════════════════════ */}
        <div
          className="w-full lg:w-[420px] lg:shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* Mode tabs */}
            <div className="flex gap-2">
              <Chip label="≡  Pilih dari Daftar" active={hsMode === "pick"} onClick={() => { setHsMode("pick"); setTariff(null); setResult(null); setFetchError(null); }} />
              <Chip label="🔍  Ketik Kode HS"    active={hsMode === "type"} onClick={() => { setHsMode("type"); setTariff(null); setResult(null); setFetchError(null); }} />
            </div>

            {/* ── HS Code section ─────────────────────────────────────────── */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#334155" }}>
                Masukan Kode HS
              </p>

              {hsMode === "type" ? (
                <>
                  <div>
                    <label className="text-xs mb-1.5 block" style={{ color: "#64748B" }}>
                      Kode HS (6–10 digit)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={hsTyped}
                        onChange={(e) => setHsTyped(e.target.value.replace(/[^0-9.]/g, ""))}
                        onKeyDown={(e) => e.key === "Enter" && fetchHs(hsTyped)}
                        placeholder="cth: 6109.10.00"
                        className="flex-1 px-3 py-2.5 text-sm rounded-xl font-mono outline-none transition-all"
                        style={{
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#F0F4FF",
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(45,212,191,0.5)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                      />
                      <button
                        onClick={() => fetchHs(hsTyped)}
                        disabled={fetchLoading || !hsTyped.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40"
                        style={{ background: "rgba(45,212,191,0.1)", color: "#2DD4BF", border: "1px solid rgba(45,212,191,0.25)" }}
                      >
                        {fetchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                        Cari
                      </button>
                    </div>
                  </div>
                  {fetchError && (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fetchError}
                    </div>
                  )}
                </>
              ) : (
                /* Pick mode search */
                <div ref={pickRef} className="relative">
                  <label className="text-xs mb-1.5 block" style={{ color: "#64748B" }}>
                    Cari nama barang atau kode HS
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "#475569" }} />
                    <input
                      type="text"
                      value={pickQuery}
                      onChange={(e) => handlePickInput(e.target.value)}
                      onFocus={() => setShowPickList(true)}
                      placeholder="baju, laptop, 8471…"
                      className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl outline-none transition-all"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#F0F4FF",
                      }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                    />
                  </div>
                  {showPickList && debouncedPick.length >= 2 && (
                    <div
                      className="absolute left-0 right-0 mt-1 z-30 rounded-xl overflow-hidden border shadow-2xl"
                      style={{ background: "#0D1525", borderColor: "rgba(255,255,255,0.1)", maxHeight: 280, overflowY: "auto" }}
                    >
                      {pickLoading && (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#2DD4BF" }} />
                        </div>
                      )}
                      {!pickLoading && (pickData?.results ?? []).length === 0 && (
                        <p className="text-xs text-center py-4" style={{ color: "#475569" }}>Tidak ada hasil</p>
                      )}
                      {(pickData?.results ?? []).map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => selectFromList(row)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors"
                          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(45,212,191,0.05)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <span className="font-mono text-xs font-bold shrink-0" style={{ color: "#2DD4BF" }}>{row.hs_code}</span>
                          <span className="text-xs truncate" style={{ color: "#CBD5E1" }}>{row.description_id}</span>
                          {row.lartas_import && <ShieldAlert className="w-3 h-3 shrink-0 text-red-400" />}
                          <ChevronRight className="w-3 h-3 shrink-0 ml-auto" style={{ color: "#334155" }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tariff data card */}
              {tariff && (
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: "rgba(45,212,191,0.04)", border: "1px solid rgba(45,212,191,0.15)" }}
                >
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-sm font-bold" style={{ color: "#2DD4BF" }}>{tariff.hs_code}</span>
                    {tariff.lartas_import && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}>
                        <ShieldAlert className="w-2.5 h-2.5" /> LARTAS
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-snug" style={{ color: "#CBD5E1" }}>{tariff.description_id}</p>
                  {tariff.description_en && (
                    <p className="text-[10px]" style={{ color: "#475569" }}>{tariff.description_en}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {tariff.bm_mfn !== null && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: "rgba(251,191,36,0.12)", color: "#FCD34D" }}>
                        BM {pct(tariff.bm_mfn)}
                      </span>
                    )}
                    {tariff.ppn_rate !== null && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: "rgba(167,139,250,0.12)", color: "#C4B5FD" }}>
                        PPN {pct(tariff.ppn_rate)}
                      </span>
                    )}
                    {isHeadingRow(tariff.hs_code) && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: "rgba(251,191,36,0.12)", color: "#FCD34D" }}>
                        ⚠ Kode heading
                      </span>
                    )}
                  </div>
                  {isHeadingRow(tariff.hs_code) && (
                    <div className="flex items-start gap-2 text-[10px] leading-relaxed" style={{ color: "#94A3B8" }}>
                      <Info className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />
                      Pilih kode HS 10 digit (format XXXX.XX.XX) untuk menghitung tarif.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Nilai Barang ─────────────────────────────────────────────── */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#334155" }}>
                Nilai Barang
              </p>

              <div className="flex gap-2">
                <Chip label="CIF Langsung"       active={cifMode === "cif"} onClick={() => setCifMode("cif")} />
                <Chip label="FOB + Freight + Asuransi" active={cifMode === "fob"} onClick={() => setCifMode("fob")} />
              </div>

              {cifMode === "cif" ? (
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "#64748B" }}>
                    Nilai CIF (IDR)
                  </label>
                  <AmountInput value={cifRaw} onChange={setCifRaw} placeholder="10.000.000" />
                  <p className="text-[10px] mt-1.5" style={{ color: "#334155" }}>
                    CIF = Cost + Insurance + Freight (nilai di pelabuhan tujuan)
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: "#64748B" }}>Nilai FOB (IDR)</label>
                    <AmountInput value={fobRaw} onChange={setFobRaw} placeholder="8.000.000" />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: "#64748B" }}>Freight / Ongkos Kirim (IDR)</label>
                    <AmountInput value={freightRaw} onChange={setFreightRaw} placeholder="500.000" />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: "#64748B" }}>Asuransi (IDR)</label>
                    <AmountInput value={asuransiRaw} onChange={setAsuransiRaw} placeholder="100.000" />
                  </div>
                  {(parseAmt(fobRaw) + parseAmt(freightRaw) + parseAmt(asuransiRaw)) > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: "rgba(45,212,191,0.06)", border: "1px solid rgba(45,212,191,0.15)" }}>
                      <span className="text-xs" style={{ color: "#64748B" }}>Total CIF</span>
                      <span className="text-sm font-bold font-mono" style={{ color: "#2DD4BF" }}>
                        {formatRp(parseAmt(fobRaw) + parseAmt(freightRaw) + parseAmt(asuransiRaw))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* FTA scheme selector */}
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: "#64748B" }}>Skema Bea Masuk</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowFtaMenu(!showFtaMenu)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#F0F4FF",
                    }}
                  >
                    <span>{ftaLabel}</span>
                    <ChevronDown className="w-4 h-4" style={{ color: "#475569" }} />
                  </button>
                  {showFtaMenu && (
                    <div
                      className="absolute left-0 right-0 mt-1 z-20 rounded-xl overflow-hidden border shadow-xl"
                      style={{ background: "#0D1525", borderColor: "rgba(255,255,255,0.1)" }}
                    >
                      {FTA_OPTIONS.map((opt) => (
                        <button
                          key={String(opt.key)}
                          type="button"
                          onClick={() => { setFtaKey(opt.key); setShowFtaMenu(false); }}
                          className="w-full text-left px-3 py-2 text-xs transition-colors"
                          style={{
                            color: ftaKey === opt.key ? "#2DD4BF" : "#94A3B8",
                            background: ftaKey === opt.key ? "rgba(45,212,191,0.06)" : "transparent",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                          }}
                          onMouseEnter={(e) => { if (ftaKey !== opt.key) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                          onMouseLeave={(e) => { if (ftaKey !== opt.key) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          {opt.label}
                          {tariff && (
                            <span className="ml-2 font-mono font-bold" style={{ color: "#FCD34D" }}>
                              {pct(tariff[opt.key] as string | null)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* PPh type */}
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: "#64748B" }}>PPh Impor</label>
                <div className="flex gap-2">
                  <Chip
                    label={`API Importir (${tariff?.pph22_rate ? pct(tariff.pph22_rate) : "2.5%"})`}
                    active={pphType === "api"}
                    onClick={() => setPphType("api")}
                  />
                  <Chip
                    label={`NON-API (${tariff?.pph22_non_api ? pct(tariff.pph22_non_api) : "7.5%"})`}
                    active={pphType === "nonapi"}
                    onClick={() => setPphType("nonapi")}
                  />
                </div>
              </div>
            </div>

            {/* Calculate button */}
            <button
              type="button"
              onClick={calculate}
              disabled={!canCalc}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                canCalc
                  ? { background: "linear-gradient(135deg,#0D9488,#14B8A6)", color: "#fff", boxShadow: "0 4px 20px rgba(20,184,166,0.3)" }
                  : { background: "rgba(255,255,255,0.05)", color: "#475569", border: "1px solid rgba(255,255,255,0.07)" }
              }
            >
              <Calculator className="w-4 h-4" />
              Hitung Tarif Impor
            </button>
          </div>
        </div>

        {/* ════ RIGHT — results ══════════════════════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {!result ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pb-16">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(45,212,191,0.07)", border: "1px solid rgba(45,212,191,0.15)" }}
              >
                <Calculator className="w-8 h-8" style={{ color: "#2DD4BF", opacity: 0.5 }} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Simulasi Tarif Impor</p>
                <p className="text-xs mt-2 leading-relaxed max-w-xs" style={{ color: "#334155" }}>
                  Pilih kode HS, masukkan nilai barang, lalu klik <strong style={{ color: "#2DD4BF" }}>Hitung Tarif Impor</strong> untuk melihat rincian BM, PPN, PPh, dan Total DDP.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-sm mt-2 w-full">
                {[
                  { label: "Bea Masuk (BM)", sub: "% × CIF" },
                  { label: "PPN Impor", sub: "11% × (CIF + BM)" },
                  { label: "PPh Impor", sub: "2.5% / 7.5% × CIF" },
                  { label: "Total DDP", sub: "CIF + semua pungutan" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="px-3 py-2.5 rounded-xl border text-left"
                    style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                  >
                    <p className="text-xs font-medium" style={{ color: "#94A3B8" }}>{item.label}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "#334155" }}>{item.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Results */
            <div className="px-6 py-6 max-w-xl w-full mx-auto">

              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Calculator className="w-4 h-4" style={{ color: "#2DD4BF" }} />
                    <span className="text-sm font-semibold text-white">Rincian Tarif Impor</span>
                  </div>
                  {tariff && (
                    <>
                      <span className="font-mono text-xs font-bold" style={{ color: "#2DD4BF" }}>
                        {tariff.hs_code}
                      </span>
                      <span className="text-xs ml-2" style={{ color: "#475569" }}>
                        — {tariff.description_id.substring(0, 60)}{tariff.description_id.length > 60 ? "…" : ""}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={copyResult}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-all"
                  style={{
                    background: copied ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.06)",
                    color: copied ? "#4ADE80" : "#94A3B8",
                    border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Disalin!" : "Salin"}
                </button>
              </div>

              {/* Breakdown card */}
              <div
                className="rounded-2xl p-5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <ResultLine
                  label="Nilai Barang (CIF)"
                  sub="Cost + Insurance + Freight"
                  value={result.cif}
                />
                <div className="h-px my-1" style={{ background: "rgba(255,255,255,0.05)" }} />
                <ResultLine
                  label="Bea Masuk"
                  sub={`${result.bmRate}% × CIF  —  ${result.bmScheme}`}
                  value={result.bm}
                  indent
                />
                <ResultLine
                  label="DPP PPN"
                  sub="CIF + Bea Masuk"
                  value={result.dppPpn}
                  indent
                />
                <ResultLine
                  label="PPN"
                  sub={`${result.ppnRate}% × DPP`}
                  value={result.ppn}
                  indent
                />
                <ResultLine
                  label="PPh Impor"
                  sub={`${result.pphRate}% × CIF  (${result.isApi ? "API Importir" : "NON-API"})`}
                  value={result.pph}
                  indent
                />
                <div className="h-px my-2" style={{ background: "rgba(255,255,255,0.08)" }} />
                <ResultLine
                  label="Total Pungutan"
                  sub="BM + PPN + PPh"
                  value={result.totalPungutan}
                  highlight
                />
              </div>

              {/* Total DDP box */}
              <div
                className="rounded-2xl p-5 mt-3 flex items-center justify-between"
                style={{
                  background: "linear-gradient(135deg,rgba(13,148,136,0.12),rgba(20,184,166,0.06))",
                  border: "1px solid rgba(20,184,166,0.25)",
                }}
              >
                <div>
                  <p className="text-sm font-bold text-white">Total DDP</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>
                    Delivered Duty Paid — nilai akhir setelah semua pungutan
                  </p>
                </div>
                <span className="text-xl font-bold font-mono" style={{ color: "#2DD4BF" }}>
                  {formatRp(result.totalDdp)}
                </span>
              </div>

              {/* Proportion bar */}
              <div
                className="rounded-2xl p-4 mt-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <Info className="w-3.5 h-3.5" style={{ color: "#475569" }} />
                  <span className="text-xs" style={{ color: "#475569" }}>
                    Proporsi pungutan terhadap nilai barang (CIF)
                  </span>
                </div>

                {/* Bar */}
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5" style={{ background: "rgba(255,255,255,0.05)" }}>
                  {wBm > 0 && (
                    <div className="rounded-full transition-all duration-500" style={{ width: `${wBm}%`, background: "#F59E0B" }} />
                  )}
                  {wPpn > 0 && (
                    <div className="rounded-full transition-all duration-500" style={{ width: `${wPpn}%`, background: "#7C6EFA" }} />
                  )}
                  {wPph > 0 && (
                    <div className="rounded-full transition-all duration-500" style={{ width: `${wPph}%`, background: "#38BDF8" }} />
                  )}
                  <div className="flex-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }} />
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                  <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "#94A3B8" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#F59E0B" }} />
                    Bea Masuk ({result.bmRate.toFixed(1)}%)
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "#94A3B8" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#7C6EFA" }} />
                    PPN ({result.ppnRate.toFixed(1)}%)
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "#94A3B8" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#38BDF8" }} />
                    PPh ({result.pphRate.toFixed(1)}%)
                  </span>
                </div>

                {/* Summary table */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: "Efektif BM",  val: result.cif > 0 ? (result.bm  / result.cif * 100).toFixed(1) + "%" : "—", color: "#F59E0B" },
                    { label: "Efektif PPN", val: result.cif > 0 ? (result.ppn / result.cif * 100).toFixed(1) + "%" : "—", color: "#7C6EFA" },
                    { label: "Efektif PPh", val: result.cif > 0 ? (result.pph / result.cif * 100).toFixed(1) + "%" : "—", color: "#38BDF8" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex flex-col items-center py-2 rounded-xl border"
                      style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                    >
                      <span className="text-[10px]" style={{ color: "#475569" }}>{s.label}</span>
                      <span className="text-sm font-bold mt-0.5" style={{ color: s.color }}>{s.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disclaimer */}
              <p className="text-[10px] text-center mt-4 leading-relaxed" style={{ color: "#1E293B" }}>
                Hasil kalkulasi bersifat estimasi berdasarkan data BTKI. Konsultasikan dengan PPJK atau Bea Cukai untuk penetapan tarif resmi.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
