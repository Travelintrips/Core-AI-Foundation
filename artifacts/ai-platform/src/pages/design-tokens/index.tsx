// Team 10 — Design Tokens Hub Page
// Route: /admin/design-tokens  (Team 24 registers this route)

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { Type, Palette, Building2, Sparkles, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── API helper ────────────────────────────────────────────────────────────────
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_KEY, ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface IndustryRecommendation {
  industry: string;
  recommendedFontPairSlugs: string[];
  recommendedPaletteSlugs: string[];
  rationale: string;
  primaryMood: string;
  avoidMoods: string[];
  colorNotes: string;
  typographyNotes: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INDUSTRY_LABELS: Record<string, string> = {
  technology: "Technology", finance: "Finance", healthcare: "Healthcare",
  education: "Education", creative: "Creative", retail: "Retail",
  hospitality: "Hospitality", legal: "Legal", nonprofit: "Nonprofit",
  media: "Media", logistics: "Logistics", manufacturing: "Manufacturing",
  real_estate: "Real Estate", food_beverage: "Food & Beverage",
  fashion: "Fashion", automotive: "Automotive", general: "General",
};

const MOOD_COLORS: Record<string, string> = {
  professional: "bg-blue-100 text-blue-800",
  modern: "bg-purple-100 text-purple-800",
  elegant: "bg-amber-100 text-amber-800",
  bold: "bg-red-100 text-red-800",
  playful: "bg-pink-100 text-pink-800",
  minimal: "bg-gray-100 text-gray-700",
  friendly: "bg-green-100 text-green-800",
  traditional: "bg-orange-100 text-orange-800",
};

// ── Main Component ────────────────────────────────────────────────────────────

export function DesignTokensPage() {
  const [, navigate] = useLocation();
  const [selectedIndustry, setSelectedIndustry] = useState("technology");

  const { data: industries = [] } = useQuery<string[]>({
    queryKey: ["design-tokens-industries"],
    queryFn: () => apiFetch("/api/ai/design-tokens/industries").then((r) => r.data),
  });

  const { data: recommendation, isLoading: recLoading } = useQuery<IndustryRecommendation>({
    queryKey: ["design-tokens-industry-rec", selectedIndustry],
    queryFn: () => apiFetch(`/api/ai/design-tokens/industries/${selectedIndustry}`),
    enabled: !!selectedIndustry,
  });

  const { data: fontPairsData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["design-tokens-font-pairs-summary"],
    queryFn: () => apiFetch("/api/ai/design-tokens/font-pairs?limit=5&activeOnly=true"),
  });

  const { data: palettesData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["design-tokens-palettes-summary"],
    queryFn: () => apiFetch("/api/ai/design-tokens/color-palettes?limit=5&activeOnly=true"),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Typography & Color Palette Engine</h1>
          <p className="text-muted-foreground mt-1">
            Manage font pairs, color palettes, WCAG contrast, and industry recommendations.
          </p>
        </div>
        <Badge variant="outline" className="text-xs">Team 10 Domain</Badge>
      </div>

      {/* Quick-access cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/design-tokens/font-pairs")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Type className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-base">Font Pairs</CardTitle>
                <CardDescription>Registry & typography roles</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {fontPairsData?.total ?? fontPairsData?.data?.length ?? "—"} active pairs
              </div>
              <Button variant="ghost" size="sm" className="gap-1">
                Manage <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/design-tokens/color-palettes")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Palette className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-base">Color Palettes</CardTitle>
                <CardDescription>Semantic roles & contrast validation</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {palettesData?.data?.length ?? "—"} active palettes
              </div>
              <Button variant="ghost" size="sm" className="gap-1">
                Manage <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Industry Recommendation Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Industry Recommendations</CardTitle>
          </div>
          <CardDescription>
            Font and palette guidance tailored to a specific industry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {industries.map((ind) => (
                  <SelectItem key={ind} value={ind}>
                    {INDUSTRY_LABELS[ind] ?? ind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {recLoading ? (
            <div className="text-sm text-muted-foreground">Loading recommendation…</div>
          ) : recommendation ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Primary mood</span>
                <Badge className={MOOD_COLORS[recommendation.primaryMood] ?? "bg-gray-100 text-gray-700"}>
                  {recommendation.primaryMood}
                </Badge>
                {recommendation.avoidMoods.length > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">Avoid:</span>
                    {recommendation.avoidMoods.map((m) => (
                      <Badge key={m} variant="outline" className="text-xs text-muted-foreground">
                        {m}
                      </Badge>
                    ))}
                  </>
                )}
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">{recommendation.rationale}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    <Type className="h-3 w-3" /> Typography notes
                  </div>
                  <p className="text-sm">{recommendation.typographyNotes}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    <Palette className="h-3 w-3" /> Colour notes
                  </div>
                  <p className="text-sm">{recommendation.colorNotes}</p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Quick colour contrast tool */}
      <ContrastCheckerWidget />
    </div>
  );
}

// ── Inline Contrast Checker ───────────────────────────────────────────────────

function ContrastCheckerWidget() {
  const [hex1, setHex1] = useState("#000000");
  const [hex2, setHex2] = useState("#ffffff");

  interface ContrastResult { ratio: number; ratioFormatted: string; level: string; wcagAA: boolean; wcagAAA: boolean; }
  const { data: result, refetch, isFetching } = useQuery<ContrastResult>({
    queryKey: ["contrast-check", hex1, hex2],
    queryFn: () =>
      apiFetch<ContrastResult>("/api/ai/design-tokens/color-palettes/contrast-check", {
        method: "POST",
        body: JSON.stringify({ hex1, hex2 }),
      }),
    enabled: false,
  });

  const ratio = result?.ratio ?? null;
  const levelColor =
    result?.level === "AAA"
      ? "text-green-600"
      : result?.level === "AA"
      ? "text-yellow-600"
      : "text-red-600";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Quick Contrast Checker</CardTitle>
        </div>
        <CardDescription>Check WCAG contrast between any two colours.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Foreground</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hex1}
                onChange={(e) => setHex1(e.target.value)}
                className="h-9 w-12 rounded cursor-pointer border"
              />
              <input
                type="text"
                value={hex1}
                onChange={(e) => setHex1(e.target.value)}
                className="w-24 rounded-md border px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Background</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hex2}
                onChange={(e) => setHex2(e.target.value)}
                className="h-9 w-12 rounded cursor-pointer border"
              />
              <input
                type="text"
                value={hex2}
                onChange={(e) => setHex2(e.target.value)}
                className="w-24 rounded-md border px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>

          <Button onClick={() => refetch()} disabled={isFetching}>
            Check Contrast
          </Button>

          {result && (
            <div className="flex items-center gap-4 ml-2">
              <div
                className="h-9 w-20 rounded-md border flex items-center justify-center text-sm font-semibold"
                style={{ backgroundColor: hex2, color: hex1 }}
              >
                Aa
              </div>
              <div>
                <div className={`text-lg font-bold font-mono ${levelColor}`}>
                  {result.ratioFormatted}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  {result.level !== "fail" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className={levelColor}>WCAG {result.level}</span>
                  <span className="text-muted-foreground">
                    {result.wcagAA ? "· AA ✓" : "· AA ✗"}
                    {result.wcagAAA ? " · AAA ✓" : " · AAA ✗"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default DesignTokensPage;
