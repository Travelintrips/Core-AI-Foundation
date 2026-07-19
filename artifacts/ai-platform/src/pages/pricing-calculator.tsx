/**
 * Pricing Calculator — Kalkulasi Modal AI, Harga Jual & Profit
 *
 * Formula: Harga Jual = Modal × (1 + Profit% / 100)
 *          Profit     = Harga Jual − Modal
 */

import { useState, useMemo } from "react";
import {
  Calculator,
  TrendingUp,
  DollarSign,
  Percent,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// ─── AI Model pricing (from seed.ts, per token) ───────────────────────────────
const AI_MODELS = [
  { name: "GPT-4o",               provider: "OpenAI",     inputPerM: 2.50,  outputPerM: 10.00 },
  { name: "GPT-4.1",              provider: "OpenAI",     inputPerM: 1.25,  outputPerM: 10.00 },
  { name: "GPT-4o mini",          provider: "OpenAI",     inputPerM: 0.15,  outputPerM: 0.60  },
  { name: "Claude 3.5 Sonnet",    provider: "Anthropic",  inputPerM: 1.10,  outputPerM: 4.40  },
  { name: "Claude 3 Opus",        provider: "Anthropic",  inputPerM: 15.00, outputPerM: 75.00 },
  { name: "Claude Haiku",         provider: "Anthropic",  inputPerM: 0.15,  outputPerM: 0.60  },
  { name: "Gemini Flash",         provider: "Google",     inputPerM: 0.80,  outputPerM: 4.00  },
  { name: "Gemini Flash 2.0",     provider: "Google",     inputPerM: 0.15,  outputPerM: 0.60  },
  { name: "Gemini Flash 2.0 Lite",provider: "Google",     inputPerM: 0.10,  outputPerM: 0.40  },
  { name: "Mistral Small",        provider: "Mistral",    inputPerM: 1.00,  outputPerM: 3.00  },
  { name: "Mistral Medium",       provider: "Mistral",    inputPerM: 3.00,  outputPerM: 9.00  },
];

// ─── Service catalog — modalIdr = total cost (API + server + tenaga manusia) ──
// Harga Jual = modalIdr × 3 (profit 200%). Modal breakdown:
//   - AI API:  Rp 1.500–5.000/proyek (negligible)
//   - Server:  Rp 15.000/proyek (alokasi bulanan)
//   - Tenaga:  Rp 75.000/jam (tarif profesional Indonesia)
type ServiceEntry = {
  name: string;
  category: string;
  agents: number;
  complexity: "simple" | "medium" | "complex";
  modalIdr: number;      // total cost = API + server + labor (IDR)
  laborHours: number;    // estimasi jam kerja
  withImages: boolean;
};

const SERVICES: ServiceEntry[] = [
  // Branding & Logo
  { name: "Konsep Logo AI",           category: "Branding",    agents: 2, complexity: "simple",  modalIdr: 150_000, laborHours: 2,   withImages: true  },
  { name: "Paket Identitas Brand",    category: "Branding",    agents: 3, complexity: "complex", modalIdr: 500_000, laborHours: 6.5, withImages: true  },
  { name: "Strategi Brand",           category: "Branding",    agents: 1, complexity: "medium",  modalIdr: 300_000, laborHours: 4,   withImages: false },
  // Desain Kreatif
  { name: "Desain Media Sosial",      category: "Desain",      agents: 1, complexity: "simple",  modalIdr:  50_000, laborHours: 0.5, withImages: true  },
  { name: "Konsep Kemasan",           category: "Desain",      agents: 1, complexity: "medium",  modalIdr: 250_000, laborHours: 3,   withImages: true  },
  // Dokumen & Presentasi
  { name: "Company Profile Dokumen",  category: "Dokumen",     agents: 2, complexity: "medium",  modalIdr: 350_000, laborHours: 4.5, withImages: false },
  { name: "Company Profile",          category: "Dokumen",     agents: 2, complexity: "medium",  modalIdr: 250_000, laborHours: 3,   withImages: false },
  { name: "Pitch Deck / Presentasi",  category: "Dokumen",     agents: 2, complexity: "medium",  modalIdr: 350_000, laborHours: 4.5, withImages: true  },
  { name: "Proposal Bisnis",          category: "Dokumen",     agents: 1, complexity: "simple",  modalIdr: 250_000, laborHours: 3,   withImages: false },
  { name: "Katalog Produk",           category: "Dokumen",     agents: 2, complexity: "medium",  modalIdr: 350_000, laborHours: 4.5, withImages: true  },
  { name: "Laporan Tahunan",          category: "Dokumen",     agents: 2, complexity: "complex", modalIdr: 750_000, laborHours: 9,   withImages: false },
  { name: "Executive Summary",        category: "Dokumen",     agents: 1, complexity: "simple",  modalIdr: 100_000, laborHours: 1,   withImages: false },
  { name: "White Paper",              category: "Dokumen",     agents: 2, complexity: "complex", modalIdr: 500_000, laborHours: 6,   withImages: false },
  { name: "Case Study",               category: "Dokumen",     agents: 2, complexity: "medium",  modalIdr: 350_000, laborHours: 4.5, withImages: false },
  { name: "E-Book",                   category: "Dokumen",     agents: 2, complexity: "complex", modalIdr: 500_000, laborHours: 6,   withImages: false },
  // Marketing
  { name: "Rencana Marketing",        category: "Marketing",   agents: 1, complexity: "medium",  modalIdr: 250_000, laborHours: 3,   withImages: false },
  { name: "Rencana Kampanye",         category: "Marketing",   agents: 1, complexity: "medium",  modalIdr: 400_000, laborHours: 5,   withImages: false },
  { name: "Kalender Konten 30 Hari",  category: "Marketing",   agents: 1, complexity: "simple",  modalIdr: 150_000, laborHours: 2,   withImages: false },
  { name: "Analisis Kompetitor",      category: "Marketing",   agents: 1, complexity: "medium",  modalIdr: 350_000, laborHours: 4.5, withImages: false },
  { name: "Paket Persona Pelanggan",  category: "Marketing",   agents: 1, complexity: "simple",  modalIdr: 250_000, laborHours: 3,   withImages: false },
  // Keuangan
  { name: "Analisis Keuangan",        category: "Keuangan",    agents: 1, complexity: "complex", modalIdr: 500_000, laborHours: 6,   withImages: false },
  { name: "Analisis Cash Flow",       category: "Keuangan",    agents: 1, complexity: "medium",  modalIdr: 500_000, laborHours: 6,   withImages: false },
  { name: "Perkiraan Keuangan",       category: "Keuangan",    agents: 1, complexity: "complex", modalIdr: 1_000_000, laborHours: 0, withImages: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  "Rp " + Math.round(n).toLocaleString("id-ID");

const providerColor: Record<string, string> = {
  OpenAI:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Anthropic: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Google:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Mistral:   "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const complexityColor: Record<string, string> = {
  simple:  "bg-green-500/20 text-green-400",
  medium:  "bg-yellow-500/20 text-yellow-400",
  complex: "bg-red-500/20 text-red-400",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function PricingCalculator() {
  const [exchangeRate, setExchangeRate] = useState(16300);
  const [profitPct, setProfitPct] = useState(200);
  const [modelOpen, setModelOpen] = useState(false);

  // Interactive token calculator state
  const [calcInputTokens, setCalcInputTokens] = useState(10000);
  const [calcOutputTokens, setCalcOutputTokens] = useState(8000);
  const [calcModelIdx, setCalcModelIdx] = useState(0); // GPT-4o

  // Derived service data — modalIdr is total cost (API + server + tenaga)
  const services = useMemo(() => {
    return SERVICES.map((s) => {
      const hargaJual = s.modalIdr * (1 + profitPct / 100);
      const profit = hargaJual - s.modalIdr;
      return { ...s, hargaJual, profit, margin: profitPct };
    });
  }, [profitPct]);

  // Summary stats
  const totalModal    = useMemo(() => services.reduce((a, s) => a + s.modalIdr, 0), [services]);  // eslint-disable-line
  const totalHarga    = useMemo(() => services.reduce((a, s) => a + s.hargaJual, 0), [services]);
  const totalProfit   = useMemo(() => services.reduce((a, s) => a + s.profit, 0), [services]);
  const avgModal      = totalModal / services.length;
  const avgHarga      = totalHarga / services.length;
  const avgProfit     = totalProfit / services.length;

  // Interactive calculator
  const calcModel = AI_MODELS[calcModelIdx];
  const calcCostUsd = (calcInputTokens * calcModel.inputPerM + calcOutputTokens * calcModel.outputPerM) / 1_000_000;
  const calcModalIdr = calcCostUsd * exchangeRate;
  const calcHargaJual = calcModalIdr * (1 + profitPct / 100);
  const calcProfit = calcHargaJual - calcModalIdr;

  // Group services by category
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof services>();
    services.forEach((s) => {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    });
    return map;
  }, [services]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Calculator className="h-6 w-6 text-primary" />
          Kalkulator Harga AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Kalkulasi modal API AI, harga jual, dan profit per layanan
        </p>
      </div>

      {/* Settings Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Kurs USD → IDR</Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-muted-foreground">Rp</span>
                  <Input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    className="h-8 w-32 text-sm"
                    min={10000}
                    max={25000}
                    step={100}
                  />
                  <span className="text-xs text-muted-foreground">per 1 USD</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Percent className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Target Profit</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    value={profitPct}
                    onChange={(e) => setProfitPct(Math.max(1, Number(e.target.value)))}
                    className="h-8 w-24 text-sm"
                    min={1}
                    max={10000}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    → Harga Jual = Modal × {(1 + profitPct / 100).toFixed(1)}×
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-red-950/30 border-red-900/40">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Rata-rata Modal AI</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{fmt(avgModal)}</p>
            <p className="text-xs text-muted-foreground mt-1">biaya API per proyek</p>
          </CardContent>
        </Card>

        <Card className="bg-blue-950/30 border-blue-900/40">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Rata-rata Harga Jual</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{fmt(avgHarga)}</p>
            <p className="text-xs text-muted-foreground mt-1">harga ke klien</p>
          </CardContent>
        </Card>

        <Card className="bg-green-950/30 border-green-900/40">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Rata-rata Profit</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{fmt(avgProfit)}</p>
            <p className="text-xs text-muted-foreground mt-1">{profitPct}% dari modal</p>
          </CardContent>
        </Card>
      </div>

      {/* Formula Banner */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-medium">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <span className="text-red-400 text-xs uppercase tracking-wider">Modal</span>
              <span className="text-white font-bold">{fmt(avgModal)}</span>
            </div>
            <span className="text-muted-foreground text-xl">+</span>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <span className="text-blue-400 text-xs uppercase tracking-wider">Profit</span>
              <span className="text-white font-bold">{fmt(avgProfit)}</span>
            </div>
            <span className="text-muted-foreground text-xl">=</span>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
              <span className="text-green-400 text-xs uppercase tracking-wider">Harga Jual</span>
              <span className="text-white font-bold">{fmt(avgHarga)}</span>
            </div>
            <Badge variant="outline" className="ml-2 text-primary border-primary/40">
              <TrendingUp className="h-3 w-3 mr-1" />
              {profitPct}% profit margin
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Interactive Token Calculator */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Kalkulator Token Interaktif
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Model AI</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                value={calcModelIdx}
                onChange={(e) => setCalcModelIdx(Number(e.target.value))}
              >
                {AI_MODELS.map((m, i) => (
                  <option key={m.name} value={i}>
                    {m.name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Input Tokens</Label>
              <Input
                type="number"
                value={calcInputTokens}
                onChange={(e) => setCalcInputTokens(Number(e.target.value))}
                className="mt-1 h-9 text-sm"
                min={0}
                step={1000}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Output Tokens</Label>
              <Input
                type="number"
                value={calcOutputTokens}
                onChange={(e) => setCalcOutputTokens(Number(e.target.value))}
                className="mt-1 h-9 text-sm"
                min={0}
                step={1000}
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Biaya API (USD)</p>
              <p className="text-lg font-bold text-white mt-0.5">
                ${calcCostUsd.toFixed(6)}
              </p>
            </div>
            <div className="rounded-lg bg-red-950/40 border border-red-900/30 p-3">
              <p className="text-xs text-muted-foreground">Modal (IDR)</p>
              <p className="text-lg font-bold text-red-400 mt-0.5">{fmt(calcModalIdr)}</p>
            </div>
            <div className="rounded-lg bg-blue-950/40 border border-blue-900/30 p-3">
              <p className="text-xs text-muted-foreground">Harga Jual (IDR)</p>
              <p className="text-lg font-bold text-blue-400 mt-0.5">{fmt(calcHargaJual)}</p>
            </div>
            <div className="rounded-lg bg-green-950/40 border border-green-900/30 p-3">
              <p className="text-xs text-muted-foreground">Profit (IDR)</p>
              <p className="text-lg font-bold text-green-400 mt-0.5">{fmt(calcProfit)}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Kurs aktif: $1 = Rp {exchangeRate.toLocaleString("id-ID")} · Model: {calcModel.name} ·
              Input ${calcModel.inputPerM}/1M token · Output ${calcModel.outputPerM}/1M token
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Service Pricing Table by Category */}
      {Array.from(byCategory.entries()).map(([category, svcList]) => (
        <Card key={category} className="bg-card border-border">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-base text-white">{category}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6 text-xs">Layanan</TableHead>
                  <TableHead className="text-xs">Kompleksitas</TableHead>
                  <TableHead className="text-xs">Agent AI</TableHead>
                  <TableHead className="text-xs text-red-400">Modal</TableHead>
                  <TableHead className="text-xs text-blue-400">Harga Jual</TableHead>
                  <TableHead className="text-xs text-green-400">Profit</TableHead>
                  <TableHead className="pr-6 text-xs text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {svcList.map((s) => (
                  <TableRow key={s.name} className="border-border hover:bg-muted/20">
                    <TableCell className="pl-6 font-medium text-sm">
                      {s.name}
                      {s.withImages && (
                        <Badge variant="outline" className="ml-2 text-xs py-0 h-4 border-muted-foreground/30 text-muted-foreground">
                          + gambar
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${complexityColor[s.complexity]}`}>
                        {s.complexity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.agents}</TableCell>
                    <TableCell className="text-sm font-medium text-red-400">{fmt(s.modalIdr)}</TableCell>
                    <TableCell className="text-sm font-medium text-blue-400">{fmt(s.hargaJual)}</TableCell>
                    <TableCell className="text-sm font-medium text-green-400">{fmt(s.profit)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <Badge className="bg-green-500/15 text-green-400 border-green-500/20">
                        {s.margin}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* Model Pricing Reference */}
      <Collapsible open={modelOpen} onOpenChange={setModelOpen}>
        <Card className="bg-card border-border">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full flex items-center justify-between p-4 h-auto rounded-lg"
            >
              <span className="font-semibold text-sm">Referensi Harga Model AI (per 1 Juta Token)</span>
              {modelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-0 pb-2">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="pl-6 text-xs">Model</TableHead>
                    <TableHead className="text-xs">Provider</TableHead>
                    <TableHead className="text-xs">Input / 1M token</TableHead>
                    <TableHead className="text-xs">Output / 1M token</TableHead>
                    <TableHead className="pr-6 text-xs text-right">Input (IDR / 1M)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AI_MODELS.map((m) => (
                    <TableRow key={m.name} className="border-border hover:bg-muted/20">
                      <TableCell className="pl-6 font-medium text-sm">{m.name}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${providerColor[m.provider] ?? ""}`}>
                          {m.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono">${m.inputPerM.toFixed(2)}</TableCell>
                      <TableCell className="text-sm font-mono">${m.outputPerM.toFixed(2)}</TableCell>
                      <TableCell className="pr-6 text-right text-sm text-muted-foreground">
                        {fmt(m.inputPerM * exchangeRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Total Summary Row */}
      <Card className="bg-gradient-to-r from-primary/10 via-card to-green-950/20 border-primary/20">
        <CardContent className="pt-4 pb-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            Total Semua Layanan ({services.length} layanan)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Modal AI</p>
              <p className="text-xl font-bold text-red-400">{fmt(totalModal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Harga Jual</p>
              <p className="text-xl font-bold text-blue-400">{fmt(totalHarga)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Profit</p>
              <p className="text-xl font-bold text-green-400">{fmt(totalProfit)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
