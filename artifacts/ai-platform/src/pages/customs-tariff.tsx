/**
 * CustomsTariff — HS Code & Tariff Search
 *
 * Search by keyword or HS code → card results showing:
 *   BM MFN, ACFTA, PPn 11%, PPh 22, LARTAS badge, dokumen perizinan
 *
 * API: GET /api/customs/hs-search?q=...
 *      GET /api/customs/hs/:code
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Package,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Globe,
  FileText,
  Percent,
  X,
  Info,
  Calculator,
} from "lucide-react";

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
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
function pct(val: string | null): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `${n}%`;
}

/**
 * Heading rows (4 or 6-digit codes without dots, e.g. "6105", "610510")
 * are chapter/subchapter headings — all FTA/tariff fields are null.
 * Only 10-digit dotted codes (e.g. "6109.10.00") have real tariff data.
 */
function isHeadingRow(hs_code: string): boolean {
  return !/\./.test(hs_code);
}

function RateBadge({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean }) {
  const display = pct(value);
  const isZero = display === "0%";
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-lg border ${highlight ? "border-blue-500/50 bg-blue-950/40" : "border-slate-700 bg-slate-800/60"}`}>
      <span className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</span>
      <span className={`text-sm font-semibold ${isZero ? "text-green-400" : display === "—" ? "text-slate-500" : "text-amber-400"}`}>
        {display}
      </span>
    </div>
  );
}

// ── Kalkulator link button ────────────────────────────────────────────────────
function KalkulatorLink() {
  const [, navigate] = useLocation();
  return (
    <button
      onClick={() => navigate("/tarif-kalkulator")}
      className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-teal-600/40 bg-teal-950/30 text-teal-400 hover:bg-teal-900/40 transition-colors"
    >
      <Calculator className="w-3.5 h-3.5" />
      Kalkulator
    </button>
  );
}

// ── Tariff Card (search result) ───────────────────────────────────────────────
function TariffCard({ row, onSelect }: { row: TariffRow; onSelect: (row: TariffRow) => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-blue-500/60 transition-colors border-slate-700 bg-slate-900/60"
      onClick={() => onSelect(row)}
    >
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-sm font-semibold text-blue-400">{row.hs_code}</span>
              {row.category && (
                <Badge variant="secondary" className="text-[10px] py-0 h-5">{row.category}</Badge>
              )}
              {row.lartas_import && (
                <Badge className="bg-red-600/80 text-white text-[10px] py-0 h-5">LARTAS</Badge>
              )}
            </div>
            <p className="text-sm text-slate-100 font-medium leading-snug">{row.description_id}</p>
            {row.description_en && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">{row.description_en}</p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-1" />
        </div>

        {/* Quick rates */}
        <div className="grid grid-cols-4 gap-2">
          <RateBadge label="BM MFN" value={row.bm_mfn} />
          <RateBadge label="ACFTA" value={row.bm_acfta} />
          <RateBadge label="PPn" value={row.ppn_rate} highlight />
          <RateBadge label="PPh 22" value={row.pph22_rate} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
function DetailPanel({ row, onClose }: { row: TariffRow; onClose: () => void }) {
  const ftaRates: { label: string; key: keyof TariffRow }[] = [
    { label: "BM MFN", key: "bm_mfn" },
    { label: "ACFTA (Tiongkok)", key: "bm_acfta" },
    { label: "AFTA (ASEAN)", key: "bm_afta" },
    { label: "AIFTA (India)", key: "bm_aifta" },
    { label: "AANZFTA (ANZ)", key: "bm_aanzfta" },
    { label: "AHKFTA (HK)", key: "bm_ahkfta" },
    { label: "ASFTA (Swiss)", key: "bm_asfta" },
    { label: "AKFTA (Korea)", key: "bm_akfta" },
    { label: "IA-CEPA (Australia)", key: "bm_indonesia_australia" },
  ];

  const taxRows = [
    { label: "PPn", value: row.ppn_rate, desc: "Pajak Pertambahan Nilai" },
    { label: "PPnBM", value: row.ppnbm_rate, desc: "Pajak Penjualan Barang Mewah" },
    { label: "PPh 22 (API)", value: row.pph22_rate, desc: "Untuk importir berizin API" },
    { label: "PPh 22 (Non-API)", value: row.pph22_non_api, desc: "Tanpa API" },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Top bar */}
      <div className="flex items-center gap-3 p-4 border-b border-slate-700 shrink-0">
        <Button variant="ghost" size="sm" className="gap-1 text-slate-400" onClick={onClose}>
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </Button>
        <div className="flex-1" />
        <span className="font-mono text-blue-400 font-semibold">{row.hs_code}</span>
      </div>

      <div className="p-5 space-y-5">
        {/* Identity */}
        <div>
          <h2 className="text-base font-semibold text-slate-100">{row.description_id}</h2>
          {row.description_en && <p className="text-sm text-slate-400 mt-1">{row.description_en}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            {row.category && <Badge variant="secondary">{row.category}</Badge>}
            {row.unit && <Badge variant="outline" className="text-slate-400">Satuan: {row.unit}</Badge>}
            <Badge variant="outline" className="font-mono text-xs text-slate-400">Pos 4: {row.hs_code_4}</Badge>
            <Badge variant="outline" className="font-mono text-xs text-slate-400">Bab 2: {row.hs_code_2}</Badge>
          </div>
        </div>

        <Separator className="border-slate-700" />

        {/* Heading-row notice */}
        {isHeadingRow(row.hs_code) && (
          <div className="flex items-start gap-3 px-3 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-yellow-400" />
            <div>
              <p className="text-xs font-semibold text-yellow-400">
                Ini adalah kode pos/heading — bukan kode tarif penuh
              </p>
              <p className="text-xs mt-1 leading-relaxed text-slate-400">
                Data bea masuk, FTA, dan pajak hanya tersedia di kode HS{" "}
                <span className="font-mono font-bold text-white/80">10 digit</span>{" "}
                (format: XXXX.XX.XX). Pilih kode lengkap dari hasil pencarian
                untuk melihat tarif detail.
              </p>
            </div>
          </div>
        )}

        {/* BM per FTA */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">Bea Masuk per Skema FTA</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ftaRates.map(({ label, key }) => {
              const val = row[key] as string | null;
              const display = pct(val);
              const isZero = display === "0%";
              const isMFN = key === "bm_mfn";
              return (
                <div
                  key={key}
                  className={`flex flex-col px-3 py-2 rounded-lg border text-center ${
                    isMFN
                      ? "border-slate-500 bg-slate-800"
                      : display === "—"
                      ? "border-slate-800 bg-slate-900/40 opacity-50"
                      : "border-slate-700 bg-slate-800/50"
                  }`}
                >
                  <span className="text-[10px] text-slate-400 mb-1">{label}</span>
                  <span className={`text-sm font-semibold ${isZero ? "text-green-400" : display === "—" ? "text-slate-600" : "text-amber-400"}`}>
                    {display}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <Separator className="border-slate-700" />

        {/* Pajak */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Percent className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-slate-200">Pajak Impor</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {taxRows.map(({ label, value, desc }) => (
              <div key={label} className="flex flex-col px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50">
                <span className="text-[10px] text-slate-400">{label}</span>
                <span className="text-sm font-semibold text-purple-300 mt-0.5">{pct(value)}</span>
                <span className="text-[10px] text-slate-500 mt-0.5">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator className="border-slate-700" />

        {/* LARTAS */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            {row.lartas_import ? (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-green-400" />
            )}
            <h3 className="text-sm font-semibold text-slate-200">LARTAS (Larangan & Pembatasan)</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Impor */}
            <div className={`p-3 rounded-lg border ${row.lartas_import ? "border-red-600/50 bg-red-950/30" : "border-green-700/40 bg-green-950/20"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-300">Impor</span>
                <Badge className={row.lartas_import ? "bg-red-600 text-white text-[10px]" : "bg-green-700 text-white text-[10px]"}>
                  {row.lartas_import ? "LARTAS" : "Bebas"}
                </Badge>
              </div>
              {row.regulator_import && (
                <p className="text-xs text-slate-400">Regulator: <span className="text-slate-300">{row.regulator_import}</span></p>
              )}
            </div>

            {/* Ekspor */}
            <div className={`p-3 rounded-lg border ${row.lartas_export ? "border-red-600/50 bg-red-950/30" : "border-slate-700 bg-slate-800/40"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-300">Ekspor</span>
                <Badge className={row.lartas_export ? "bg-red-600 text-white text-[10px]" : "bg-slate-600 text-white text-[10px]"}>
                  {row.lartas_export ? "LARTAS" : "Bebas"}
                </Badge>
              </div>
              {row.regulator_export && (
                <p className="text-xs text-slate-400">Regulator: <span className="text-slate-300">{row.regulator_export}</span></p>
              )}
            </div>
          </div>

          {row.lartas_desc && (
            <p className="text-xs text-slate-400 mt-2 p-2 rounded bg-slate-800/60 border border-slate-700">{row.lartas_desc}</p>
          )}
        </div>

        {/* Perizinan */}
        {row.perizinan_import && (
          <>
            <Separator className="border-slate-700" />
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-200">Dokumen Perizinan Impor</h3>
              </div>
              {row.perizinan_import.note && (
                <p className="text-xs text-amber-300 mb-2 p-2 rounded bg-amber-950/30 border border-amber-700/40">
                  {row.perizinan_import.note}
                </p>
              )}
              {row.perizinan_import.docs && row.perizinan_import.docs.length > 0 && (
                <ul className="space-y-1">
                  {row.perizinan_import.docs.map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
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
            <Separator className="border-slate-700" />
            <div>
              <p className="text-xs text-slate-400 leading-relaxed">{row.notes}</p>
            </div>
          </>
        )}

        <div className="text-[10px] text-slate-600 text-right pt-1">
          Diperbarui: {new Date(row.updated_at).toLocaleDateString("id-ID", { year: "numeric", month: "long", day: "numeric" })}
        </div>
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

  // Debounce 350 ms
  const handleInput = useCallback((val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 350);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Clear selection when query changes
  useEffect(() => { setSelected(null); }, [debouncedQuery]);

  const { data, isLoading, isError } = useQuery<SearchResult>({
    queryKey: ["customs-search", debouncedQuery],
    queryFn: () => apiFetch<SearchResult>(`/api/customs/hs-search?q=${encodeURIComponent(debouncedQuery)}&limit=20`),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const results = data?.results ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* ── Left panel: search + results ────────────────────────────── */}
      <div className={`flex flex-col ${selected ? "hidden lg:flex w-[420px] shrink-0" : "flex-1"} border-r border-slate-800`}>
        {/* Search header */}
        <div className="p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg font-semibold text-slate-100">Tarif BTKI & HS Code</h1>
            <KalkulatorLink />
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Cari 6.990 kode HS — BM MFN, FTA, PPn, PPh 22, LARTAS, perizinan impor
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Ketik nama barang atau kode HS… (min. 2 karakter)"
              className="pl-9 pr-9 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setDebouncedQuery(""); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {debouncedQuery.length >= 2 && !isLoading && (
            <p className="text-xs text-slate-500 mt-2">
              {total > 0 ? `${total} hasil ditemukan${total > 20 ? " (menampilkan 20 pertama)" : ""}` : "Tidak ada hasil"}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {debouncedQuery.length < 2 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 gap-3 pb-12">
              <Search className="w-10 h-10 opacity-30" />
              <div>
                <p className="text-sm font-medium">Mulai ketik untuk mencari</p>
                <p className="text-xs mt-1">Contoh: "laptop", "8471", "tekstil", "kelapa sawit"</p>
              </div>
            </div>
          )}

          {isLoading && debouncedQuery.length >= 2 && (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-red-400 text-sm p-3 rounded bg-red-950/30 border border-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Gagal memuat data. Periksa koneksi ke server.
            </div>
          )}

          {!isLoading && !isError && results.length === 0 && debouncedQuery.length >= 2 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2 pb-12">
              <Package className="w-8 h-8 opacity-30" />
              <p className="text-sm">Tidak ada kode HS untuk "{debouncedQuery}"</p>
            </div>
          )}

          {results.map((row) => (
            <TariffCard key={row.id} row={row} onSelect={setSelected} />
          ))}
        </div>
      </div>

      {/* ── Right panel: detail ──────────────────────────────────────── */}
      {selected ? (
        <div className={`flex-1 ${selected ? "flex" : "hidden lg:flex"} flex-col bg-slate-950`}>
          <DetailPanel row={selected} onClose={() => setSelected(null)} />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 flex-col items-center justify-center text-slate-600 gap-3">
          <ChevronDown className="w-8 h-8 opacity-20" />
          <p className="text-sm">Pilih kode HS dari daftar untuk melihat detail tarif</p>
        </div>
      )}
    </div>
  );
}
