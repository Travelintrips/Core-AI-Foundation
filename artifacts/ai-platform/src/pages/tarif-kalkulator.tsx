/**
 * Kalkulator Tarif Impor — AI Platform Admin
 *
 * Simulasi biaya impor: BM, DPP PPN, PPN, PPh 22, Total DDP
 *
 * API:
 *   GET /api/customs/hs-search?q=...&limit=8
 *   GET /api/customs/hs/:code
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  ArrowLeft,
  Search,
  RefreshCcw,
  Copy,
  Check,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Info,
  ShieldAlert,
} from "lucide-react";

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};


  const res = await fetch(path, { headers });
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

interface SearchResult { results: TariffRow[]; total: number; }

interface CalcResult {
  cif: number;
  bm: number; bmRate: number; bmScheme: string;
  dppPpn: number;
  ppn: number; ppnRate: number;
  pph: number; pphRate: number; isApi: boolean;
  totalPungutan: number;
  totalDdp: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const FTA_OPTIONS: { label: string; key: keyof TariffRow }[] = [
  { label: "BM MFN (Umum)",          key: "bm_mfn" },
  { label: "ACFTA – Tiongkok",       key: "bm_acfta" },
  { label: "AFTA – ASEAN",           key: "bm_afta" },
  { label: "AIFTA – India",          key: "bm_aifta" },
  { label: "AANZFTA – ANZ",          key: "bm_aanzfta" },
  { label: "AHKFTA – Hong Kong",     key: "bm_ahkfta" },
  { label: "ASFTA – Swiss",          key: "bm_asfta" },
  { label: "AKFTA – Korea",          key: "bm_akfta" },
  { label: "IA-CEPA – Australia",    key: "bm_indonesia_australia" },
];

function parseAmt(s: string): number { return parseFloat(s.replace(/[^0-9]/g, "")) || 0; }
function formatRp(n: number): string { return "Rp\u00a0" + Math.round(n).toLocaleString("id-ID"); }
function fmtInput(raw: string): string {
  const d = raw.replace(/[^0-9]/g, "");
  return d ? parseInt(d, 10).toLocaleString("id-ID") : "";
}
function pct(v: string | null | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? "—" : `${n}%`;
}
function isHeadingRow(hs: string): boolean { return !/\./.test(hs); }

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TarifKalkulator() {
  const [, navigate] = useLocation();

  // HS input mode
  const [hsMode, setHsMode]       = useState<"type" | "pick">("type");
  const [hsTyped, setHsTyped]     = useState("");
  const [tariff, setTariff]       = useState<TariffRow | null>(null);
  const [fetchLoading, setFL]     = useState(false);
  const [fetchError, setFE]       = useState<string | null>(null);

  // Pick-mode search
  const [pickQuery, setPickQuery]   = useState("");
  const [debouncedPick, setDP]      = useState("");
  const [showList, setShowList]     = useState(false);
  const pickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickRef      = useRef<HTMLDivElement>(null);

  const handlePickInput = useCallback((val: string) => {
    setPickQuery(val); setShowList(true);
    if (pickDebounce.current) clearTimeout(pickDebounce.current);
    pickDebounce.current = setTimeout(() => setDP(val), 350);
  }, []);

  const { data: pickData, isLoading: pickLoading } = useQuery<SearchResult>({
    queryKey: ["kalk-pick", debouncedPick],
    queryFn: () => apiFetch<SearchResult>(`/api/customs/hs-search?q=${encodeURIComponent(debouncedPick)}&limit=8`),
    enabled: hsMode === "pick" && debouncedPick.length >= 2,
    staleTime: 60_000,
  });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (pickRef.current && !pickRef.current.contains(e.target as Node)) setShowList(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // CIF mode
  const [cifMode, setCifMode]     = useState<"cif" | "fob">("cif");
  const [cifRaw, setCifRaw]       = useState("10000000");
  const [fobRaw, setFobRaw]       = useState("");
  const [freightRaw, setFreightRaw] = useState("");
  const [asuransiRaw, setAsuransiRaw] = useState("");

  // FTA & PPh
  const [ftaKey, setFtaKey]       = useState<string>("bm_mfn");
  const [pphType, setPphType]     = useState<"api" | "nonapi">("api");

  // Result
  const [result, setResult]       = useState<CalcResult | null>(null);
  const [copied, setCopied]       = useState(false);

  const fetchHs = async (code: string) => {
    const c = code.trim(); if (!c) return;
    setFL(true); setFE(null); setResult(null);
    try { setTariff(await apiFetch<TariffRow>(`/api/customs/hs/${encodeURIComponent(c)}`)); }
    catch { setFE("Kode HS tidak ditemukan dalam database BTKI"); setTariff(null); }
    finally { setFL(false); }
  };

  const selectFromList = (row: TariffRow) => {
    setTariff(row); setHsTyped(row.hs_code);
    setPickQuery(`${row.hs_code} — ${row.description_id.slice(0, 40)}`);
    setShowList(false); setResult(null); setFE(null);
  };

  const computeCIF = () =>
    cifMode === "cif"
      ? parseAmt(cifRaw)
      : parseAmt(fobRaw) + parseAmt(freightRaw) + parseAmt(asuransiRaw);

  const calculate = () => {
    if (!tariff || isHeadingRow(tariff.hs_code)) return;
    const cif = computeCIF(); if (cif <= 0) return;
    const resolvedKey = ftaKey as keyof TariffRow;
    const bmRate   = parseFloat((tariff[resolvedKey] as string) || "0") || 0;
    const ppnRate  = parseFloat(tariff.ppn_rate    || "11")  || 11;
    const pphRate  = pphType === "api"
      ? (parseFloat(tariff.pph22_rate    || "2.5") || 2.5)
      : (parseFloat(tariff.pph22_non_api || "7.5") || 7.5);
    const bm             = Math.round(cif * bmRate / 100);
    const dppPpn         = cif + bm;
    const ppn            = Math.round(dppPpn * ppnRate / 100);
    const pph            = Math.round(cif * pphRate / 100);
    const totalPungutan  = bm + ppn + pph;
    const totalDdp       = cif + totalPungutan;
    const bmScheme       = FTA_OPTIONS.find(o => o.key === resolvedKey)?.label ?? "MFN";
    setResult({ cif, bm, bmRate, bmScheme, dppPpn, ppn, ppnRate, pph, pphRate, isApi: pphType === "api", totalPungutan, totalDdp });
  };

  const copyResult = () => {
    if (!result || !tariff) return;
    const txt = [
      `Kalkulator Tarif Impor — ${tariff.hs_code}`,
      tariff.description_id, "",
      `Skema BM   : ${result.bmScheme}`, "",
      `Nilai CIF           : ${formatRp(result.cif)}`,
      `Bea Masuk (${result.bmRate}%) : ${formatRp(result.bm)}`,
      `DPP PPN             : ${formatRp(result.dppPpn)}`,
      `PPN (${result.ppnRate}%)        : ${formatRp(result.ppn)}`,
      `PPh Impor (${result.pphRate}%)  : ${formatRp(result.pph)}`,
      `Total Pungutan      : ${formatRp(result.totalPungutan)}`,
      `Total DDP           : ${formatRp(result.totalDdp)}`,
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const resetAll = () => {
    setTariff(null); setHsTyped(""); setPickQuery(""); setDP(""); setFE(null); setResult(null);
    setCifRaw("10000000"); setFobRaw(""); setFreightRaw(""); setAsuransiRaw("");
    setPphType("api"); setFtaKey("bm_mfn");
  };

  const canCalc   = !!tariff && !isHeadingRow(tariff.hs_code) && computeCIF() > 0;
  const totalCIF  = computeCIF();

  const propBm  = result ? (result.bm  / result.cif) * 100 : 0;
  const propPpn = result ? (result.ppn / result.cif) * 100 : 0;
  const propPph = result ? (result.pph / result.cif) * 100 : 0;
  const rawSum  = propBm + propPpn + propPph;
  const scale   = rawSum > 60 ? 60 / rawSum : 1;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1 text-slate-400" onClick={() => navigate("/customs-tariff")}>
          <ArrowLeft className="w-4 h-4" /> Kembali
        </Button>
        <Separator orientation="vertical" className="h-5 border-slate-700" />
        <Calculator className="w-5 h-5 text-teal-400" />
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Kalkulator Tarif Impor</h1>
          <p className="text-xs text-slate-500">Hitung Bea Masuk, PPN, PPh, dan total DDP (Delivered Duty Paid)</p>
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={resetAll} className="gap-1.5 text-slate-400 border-slate-700">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6">

        {/* ═══ LEFT — Inputs ═════════════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Mode tabs */}
          <div className="flex gap-2">
            {(["type", "pick"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setHsMode(m); setTariff(null); setResult(null); setFE(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  hsMode === m
                    ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-300"
                }`}
              >
                {m === "type" ? "🔍 Ketik Kode HS" : "≡ Pilih dari Daftar"}
              </button>
            ))}
          </div>

          {/* HS Code card */}
          <Card className="border-slate-700 bg-slate-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
                Masukan Kode HS
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hsMode === "type" ? (
                <>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Kode HS (6–10 digit)</label>
                    <div className="flex gap-2">
                      <Input
                        value={hsTyped}
                        onChange={(e) => setHsTyped(e.target.value.replace(/[^0-9.]/g, ""))}
                        onKeyDown={(e) => e.key === "Enter" && fetchHs(hsTyped)}
                        placeholder="cth: 6109.10.00"
                        className="font-mono bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-600"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchHs(hsTyped)}
                        disabled={fetchLoading || !hsTyped.trim()}
                        className="gap-1.5 border-teal-600/40 text-teal-400 hover:bg-teal-500/10 shrink-0"
                      >
                        {fetchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                        Cari
                      </Button>
                    </div>
                  </div>
                  {fetchError && (
                    <div className="flex items-center gap-2 text-xs text-red-400 p-2 rounded bg-red-950/30 border border-red-800">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fetchError}
                    </div>
                  )}
                </>
              ) : (
                <div ref={pickRef} className="relative">
                  <label className="text-xs text-slate-400 mb-1.5 block">Cari nama barang atau kode HS</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <Input
                      value={pickQuery}
                      onChange={(e) => handlePickInput(e.target.value)}
                      onFocus={() => setShowList(true)}
                      placeholder="baju, laptop, 8471…"
                      className="pl-8 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-600"
                    />
                  </div>
                  {showList && debouncedPick.length >= 2 && (
                    <div className="absolute left-0 right-0 mt-1 z-30 rounded-xl overflow-hidden border border-slate-700 bg-slate-900 shadow-2xl max-h-64 overflow-y-auto">
                      {pickLoading && <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-teal-400" /></div>}
                      {!pickLoading && (pickData?.results ?? []).length === 0 && (
                        <p className="text-xs text-center py-3 text-slate-500">Tidak ada hasil</p>
                      )}
                      {(pickData?.results ?? []).map((row) => (
                        <button
                          key={row.id}
                          onClick={() => selectFromList(row)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800 border-b border-slate-800 transition-colors"
                        >
                          <span className="font-mono text-xs font-bold text-teal-400 shrink-0">{row.hs_code}</span>
                          <span className="text-xs text-slate-300 truncate">{row.description_id}</span>
                          {row.lartas_import && <ShieldAlert className="w-3 h-3 text-red-400 shrink-0" />}
                          <ChevronRight className="w-3 h-3 text-slate-600 shrink-0 ml-auto" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tariff card */}
              {tariff && (
                <div className="rounded-lg border border-teal-600/30 bg-teal-950/20 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-teal-400">{tariff.hs_code}</span>
                    {tariff.lartas_import && <Badge className="bg-red-600/80 text-white text-[10px]">LARTAS</Badge>}
                    {tariff.bm_mfn !== null && <Badge variant="outline" className="text-amber-400 border-amber-600/40 text-[10px]">BM {pct(tariff.bm_mfn)}</Badge>}
                    {tariff.ppn_rate !== null && <Badge variant="outline" className="text-purple-400 border-purple-600/40 text-[10px]">PPN {pct(tariff.ppn_rate)}</Badge>}
                    {isHeadingRow(tariff.hs_code) && <Badge className="bg-amber-700/60 text-amber-200 text-[10px]">⚠ Kode heading</Badge>}
                  </div>
                  <p className="text-xs text-slate-300 leading-snug">{tariff.description_id}</p>
                  {tariff.description_en && <p className="text-[10px] text-slate-500">{tariff.description_en}</p>}
                  {isHeadingRow(tariff.hs_code) && (
                    <div className="flex items-start gap-1.5 text-[10px] text-slate-400">
                      <Info className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />
                      Pilih kode HS 10 digit (format XXXX.XX.XX) untuk menghitung tarif.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Nilai Barang card */}
          <Card className="border-slate-700 bg-slate-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
                Nilai Barang
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CIF mode */}
              <div className="flex gap-2">
                {(["cif", "fob"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCifMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      cifMode === m
                        ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
                        : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-300"
                    }`}
                  >
                    {m === "cif" ? "CIF Langsung" : "FOB + Freight + Asuransi"}
                  </button>
                ))}
              </div>

              {cifMode === "cif" ? (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Nilai CIF (IDR)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 select-none">Rp</span>
                    <Input
                      value={fmtInput(cifRaw)}
                      onChange={(e) => setCifRaw(e.target.value.replace(/[^0-9]/g, ""))}
                      className="pl-8 bg-slate-800 border-slate-700 text-slate-100 font-mono"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1">CIF = Cost + Insurance + Freight (nilai di pelabuhan tujuan)</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Nilai FOB (IDR)", raw: fobRaw, set: setFobRaw, ph: "8.000.000" },
                    { label: "Freight (IDR)", raw: freightRaw, set: setFreightRaw, ph: "500.000" },
                    { label: "Asuransi (IDR)", raw: asuransiRaw, set: setAsuransiRaw, ph: "100.000" },
                  ].map(({ label, raw, set, ph }) => (
                    <div key={label}>
                      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 select-none">Rp</span>
                        <Input value={fmtInput(raw)} onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))} placeholder={ph} className="pl-8 bg-slate-800 border-slate-700 text-slate-100 font-mono" inputMode="numeric" />
                      </div>
                    </div>
                  ))}
                  {totalCIF > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-teal-600/30 bg-teal-950/20">
                      <span className="text-xs text-slate-400">Total CIF</span>
                      <span className="text-sm font-bold font-mono text-teal-400">{formatRp(totalCIF)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* FTA selector */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Skema Bea Masuk</label>
                <Select value={ftaKey} onValueChange={setFtaKey}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    {FTA_OPTIONS.map((opt) => (
                      <SelectItem key={String(opt.key)} value={String(opt.key)} className="text-slate-200">
                        <span>{opt.label}</span>
                        {tariff && (
                          <span className="ml-2 font-mono text-amber-400 text-xs">
                            {pct(tariff[opt.key] as string | null)}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* PPh type */}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">PPh Impor</label>
                <div className="flex gap-2">
                  {(["api", "nonapi"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setPphType(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex-1 ${
                        pphType === t
                          ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
                          : "border-slate-700 bg-slate-800/60 text-slate-400"
                      }`}
                    >
                      {t === "api"
                        ? `API Importir (${tariff?.pph22_rate ? pct(tariff.pph22_rate) : "2.5%"})`
                        : `NON-API (${tariff?.pph22_non_api ? pct(tariff.pph22_non_api) : "7.5%"})`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculate */}
              <Button
                className="w-full gap-2 bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40"
                onClick={calculate}
                disabled={!canCalc}
              >
                <Calculator className="w-4 h-4" />
                Hitung Tarif Impor
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ═══ RIGHT — Results ═══════════════════════════════════════════════ */}
        <div>
          {!result ? (
            <Card className="border-slate-700 bg-slate-900/40 h-full min-h-[400px]">
              <CardContent className="flex flex-col items-center justify-center h-full gap-4 py-16 text-center">
                <div className="w-14 h-14 rounded-2xl border border-teal-600/30 bg-teal-950/30 flex items-center justify-center">
                  <Calculator className="w-7 h-7 text-teal-500 opacity-50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-300">Simulasi Tarif Impor</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
                    Pilih kode HS, masukkan nilai barang, lalu klik <span className="text-teal-400 font-medium">Hitung Tarif Impor</span>.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 max-w-sm w-full">
                  {[
                    { l: "Bea Masuk (BM)", s: "% × CIF" },
                    { l: "PPN Impor",       s: "11% × (CIF + BM)" },
                    { l: "PPh Impor",       s: "2.5% / 7.5% × CIF" },
                    { l: "Total DDP",       s: "CIF + semua pungutan" },
                  ].map((x) => (
                    <div key={x.l} className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-left">
                      <p className="text-xs font-medium text-slate-400">{x.l}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{x.s}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Calculator className="w-4 h-4 text-teal-400" />
                    <span className="text-sm font-semibold text-slate-100">Rincian Tarif Impor</span>
                  </div>
                  {tariff && (
                    <p className="text-xs text-slate-500">
                      <span className="font-mono font-bold text-teal-400">{tariff.hs_code}</span>
                      {" — "}
                      {tariff.description_id.slice(0, 60)}{tariff.description_id.length > 60 ? "…" : ""}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={copyResult} className={`gap-1.5 shrink-0 border-slate-700 ${copied ? "text-green-400 border-green-700" : "text-slate-400"}`}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Disalin!" : "Salin"}
                </Button>
              </div>

              {/* Breakdown */}
              <Card className="border-slate-700 bg-slate-900/60">
                <CardContent className="p-5 space-y-0">
                  {[
                    { l: "Nilai Barang (CIF)", s: "Cost + Insurance + Freight", v: result.cif, indent: false },
                    { l: "Bea Masuk",  s: `${result.bmRate}% × CIF  —  ${result.bmScheme}`, v: result.bm,   indent: true },
                    { l: "DPP PPN",   s: "CIF + Bea Masuk",                                  v: result.dppPpn, indent: true },
                    { l: "PPN",       s: `${result.ppnRate}% × DPP`,                          v: result.ppn,  indent: true },
                    { l: "PPh Impor", s: `${result.pphRate}% × CIF  (${result.isApi ? "API Importir" : "NON-API"})`, v: result.pph, indent: true },
                  ].map((r, i) => (
                    <div key={i}>
                      {i === 1 && <Separator className="border-slate-800 my-2" />}
                      <div className={`flex items-center justify-between gap-4 py-2.5 ${r.indent ? "pl-4 border-l border-slate-800" : ""}`}>
                        <div>
                          <p className="text-sm font-medium text-slate-300">{r.l}</p>
                          <p className="text-[10px] text-slate-600">{r.s}</p>
                        </div>
                        <span className="text-sm font-mono font-semibold text-slate-300 shrink-0">{formatRp(r.v)}</span>
                      </div>
                    </div>
                  ))}
                  <Separator className="border-slate-700 my-2" />
                  <div className="flex items-center justify-between gap-4 py-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">Total Pungutan</p>
                      <p className="text-[10px] text-slate-500">BM + PPN + PPh</p>
                    </div>
                    <span className="text-base font-bold font-mono text-slate-100">{formatRp(result.totalPungutan)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Total DDP */}
              <div className="rounded-xl border border-teal-600/30 bg-teal-950/20 p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-100">Total DDP</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Delivered Duty Paid — nilai akhir setelah semua pungutan</p>
                </div>
                <span className="text-xl font-bold font-mono text-teal-400">{formatRp(result.totalDdp)}</span>
              </div>

              {/* Proportion bar */}
              <Card className="border-slate-700 bg-slate-900/40">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-xs text-slate-500">Proporsi pungutan terhadap nilai barang (CIF)</span>
                  </div>
                  <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-slate-800">
                    {propBm  * scale > 0 && <div className="rounded-full transition-all duration-500" style={{ width: `${propBm  * scale}%`, background: "#F59E0B" }} />}
                    {propPpn * scale > 0 && <div className="rounded-full transition-all duration-500" style={{ width: `${propPpn * scale}%`, background: "#7C6EFA" }} />}
                    {propPph * scale > 0 && <div className="rounded-full transition-all duration-500" style={{ width: `${propPph * scale}%`, background: "#38BDF8" }} />}
                    <div className="flex-1 rounded-full bg-slate-700/50" />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {[
                      { label: `Bea Masuk (${result.bmRate.toFixed(1)}%)`, color: "#F59E0B" },
                      { label: `PPN (${result.ppnRate.toFixed(1)}%)`,      color: "#7C6EFA" },
                      { label: `PPh (${result.pphRate.toFixed(1)}%)`,      color: "#38BDF8" },
                    ].map((s) => (
                      <span key={s.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { l: "Efektif BM",  v: result.cif > 0 ? (result.bm  / result.cif * 100).toFixed(2) + "%" : "—", c: "text-amber-400" },
                      { l: "Efektif PPN", v: result.cif > 0 ? (result.ppn / result.cif * 100).toFixed(2) + "%" : "—", c: "text-purple-400" },
                      { l: "Efektif PPh", v: result.cif > 0 ? (result.pph / result.cif * 100).toFixed(2) + "%" : "—", c: "text-sky-400" },
                    ].map((s) => (
                      <div key={s.l} className="flex flex-col items-center p-2 rounded-lg border border-slate-800 bg-slate-900/40">
                        <span className="text-[10px] text-slate-500">{s.l}</span>
                        <span className={`text-sm font-bold mt-0.5 ${s.c}`}>{s.v}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <p className="text-[10px] text-slate-600 text-center">
                Estimasi berdasarkan data BTKI. Konsultasikan dengan PPJK atau Bea Cukai untuk penetapan tarif resmi.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
