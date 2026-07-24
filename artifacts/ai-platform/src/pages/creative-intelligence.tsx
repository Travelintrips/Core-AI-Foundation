import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Shield, Clock, Sparkles, RefreshCw, AlertCircle,
  CheckCircle2, Layers, BarChart3, TrendingUp, Cpu,
  Palette, Copy, ChevronRight, Search, Lightbulb,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ── Admin API helper ───────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),

      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdminBrandIntelligenceStats {
  totalClientsAnalyzed: number;
  averageCompletenessScore: number;
  averageConsistencyScore: number;
  averageConfidenceScore: number;
  highConfidenceClients: number;
  clientsWithLogo: number;
}

interface BrandDnaView {
  clientId: string;
  brandPersonality: string[];
  brandVoice: string;
  writingStyle: string;
  photographyStyle: string;
  illustrationStyle: string;
  layoutStyle: string;
  detectedColors: { primary: string | null; secondary: string | null; accent: string | null };
  completenessScore: number;
  consistencyScore: number;
  confidenceScore: number;
  industry: string;
  analyzedAt: string;
}

interface BrandRecommendation {
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  missingItems: string[];
}

interface CreativeDirectorRec {
  creativeStrategy: string;
  visualDirection: string;
  communicationDirection: string;
  designRecommendations: string[];
  templateRecommendations: string[];
  priorityActions: string[];
  generatedAt: string;
}

interface DuplicateReport {
  clientId: string;
  totalDuplicatesFound: number;
  duplicateGroups: Array<{
    perceptualHash: string;
    assetIds: number[];
    versionTypes: string[];
    recommendation: string;
  }>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: color ?? "inherit" }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "#34D399" : score >= 50 ? "#FBBF24" : "#F87171";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span><span style={{ color }}>{score}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  return (
    <Badge variant={priority === "high" ? "destructive" : priority === "medium" ? "secondary" : "outline"}>
      {priority}
    </Badge>
  );
}

function ColorDot({ color }: { color: string | null }) {
  if (!color) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-4 h-4 rounded-full inline-block border border-border" style={{ background: color }} />
      <span className="text-xs font-mono text-muted-foreground">{color}</span>
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CreativeIntelligencePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [clientIdInput, setClientIdInput] = useState("");
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "dna" | "recs" | "director" | "duplicates">("overview");

  // ── Queries ──────────────────────────────────────────────────────────────────

  const statsQuery = useQuery<AdminBrandIntelligenceStats>({
    queryKey: ["admin-brand-intelligence-stats"],
    queryFn: () => apiFetch("/api/ai/brand-intelligence/stats"),
    staleTime: 60_000,
  });

  const dnaQuery = useQuery<BrandDnaView>({
    queryKey: ["admin-brand-dna", activeClientId],
    queryFn: () => apiFetch(`/api/ai/brand-intelligence/${activeClientId}`),
    enabled: !!activeClientId,
    retry: false,
  });

  const recsQuery = useQuery<{ items: BrandRecommendation[] }>({
    queryKey: ["admin-brand-recs", activeClientId],
    queryFn: () => apiFetch(`/api/ai/brand-intelligence/${activeClientId}/recommendations`),
    enabled: !!activeClientId && activeTab === "recs",
  });

  const directorQuery = useQuery<CreativeDirectorRec>({
    queryKey: ["admin-creative-director", activeClientId],
    queryFn: () => apiFetch(`/api/ai/brand-intelligence/${activeClientId}/creative-director`),
    enabled: !!activeClientId && activeTab === "director",
  });

  const duplicatesQuery = useQuery<DuplicateReport>({
    queryKey: ["admin-duplicate-report", activeClientId],
    queryFn: () => apiFetch(`/api/ai/asset-intelligence/duplicates/${activeClientId}`),
    enabled: !!activeClientId && activeTab === "duplicates",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const analyzeMutation = useMutation({
    mutationFn: (clientId: string) =>
      apiFetch<BrandDnaView>("/api/ai/brand-intelligence/analyze", {
        method: "POST",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: (data) => {
      toast({ title: "Brand DNA Analyzed", description: `Completeness: ${data.completenessScore}%` });
      const id = clientIdInput.trim();
      setActiveClientId(id);
      qc.invalidateQueries({ queryKey: ["admin-brand-dna", id] });
      qc.invalidateQueries({ queryKey: ["admin-brand-intelligence-stats"] });
    },
    onError: (e: Error) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: (clientId: string) =>
      apiFetch<BrandDnaView>(`/api/ai/brand-intelligence/${clientId}/refresh`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Brand DNA refreshed" });
      qc.invalidateQueries({ queryKey: ["admin-brand-dna", activeClientId] });
    },
    onError: (e: Error) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const stats = statsQuery.data;
  const dna = dnaQuery.data;
  const recs = recsQuery.data?.items ?? [];
  const director = directorQuery.data;
  const duplicates = duplicatesQuery.data;

  const TABS = [
    { id: "overview" as const, label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "dna" as const, label: "Brand DNA", icon: <Brain className="w-4 h-4" /> },
    { id: "recs" as const, label: "Recommendations", icon: <Lightbulb className="w-4 h-4" /> },
    { id: "director" as const, label: "AI Director", icon: <Sparkles className="w-4 h-4" /> },
    { id: "duplicates" as const, label: "Duplicates", icon: <Copy className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6 text-violet-400" />
          Creative Intelligence
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Brand DNA Engine · Auto Asset Analyzer · AI Creative Director
        </p>
      </div>

      {/* Global stats */}
      {statsQuery.isLoading && <p className="text-muted-foreground text-sm">Loading stats…</p>}
      {stats && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Clients Analyzed" value={stats.totalClientsAnalyzed} />
          <StatCard label="Avg Completeness" value={`${stats.averageCompletenessScore}%`} color="#7C6EFA" />
          <StatCard label="Avg Consistency" value={`${stats.averageConsistencyScore}%`}
            color={stats.averageConsistencyScore >= 70 ? "#34D399" : "#FBBF24"} />
          <StatCard label="Avg Confidence" value={`${Math.round(stats.averageConfidenceScore * 100)}%`} color="#60A5FA" />
          <StatCard label="High Confidence" value={stats.highConfidenceClients} sub="clients ≥70%" />
          <StatCard label="With Logo" value={stats.clientsWithLogo} />
        </div>
      )}

      {/* Client search */}
      <div className="rounded-xl border bg-card p-4 flex gap-3 items-center">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <Input
          placeholder="Enter client ID (email hash)…"
          value={clientIdInput}
          onChange={(e) => setClientIdInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && clientIdInput.trim()) setActiveClientId(clientIdInput.trim());
          }}
          className="border-0 bg-transparent p-0 text-sm focus-visible:ring-0 flex-1"
        />
        <Button size="sm" variant="secondary"
          onClick={() => { if (clientIdInput.trim()) setActiveClientId(clientIdInput.trim()); }}>
          Load
        </Button>
        <Button
          size="sm"
          onClick={() => { if (clientIdInput.trim()) analyzeMutation.mutate(clientIdInput.trim()); }}
          disabled={analyzeMutation.isPending || !clientIdInput.trim()}
        >
          {analyzeMutation.isPending
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analyzing…</>
            : "Analyze Brand"}
        </Button>
        {activeClientId && (
          <Button size="sm" variant="ghost"
            onClick={() => refreshMutation.mutate(activeClientId)}
            disabled={refreshMutation.isPending}
            title="Refresh Brand DNA">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      {activeClientId && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {activeTab === "overview" && (
            <>
              {dnaQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
              {dna && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="rounded-xl border bg-card p-5 space-y-4">
                    <h2 className="font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-violet-400" />Brand Scores
                    </h2>
                    <ScoreBar score={dna.completenessScore} label="Completeness" />
                    <ScoreBar score={dna.consistencyScore} label="Consistency" />
                    <ScoreBar score={Math.round(dna.confidenceScore * 100)} label="Confidence" />
                  </div>
                  <div className="rounded-xl border bg-card p-5 space-y-3">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Palette className="w-4 h-4 text-violet-400" />Visual Identity
                    </h2>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {[
                        ["Voice", dna.brandVoice],
                        ["Style", dna.writingStyle],
                        ["Photo", dna.photographyStyle],
                        ["Layout", dna.layoutStyle],
                        ["Industry", dna.industry],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <span className="text-muted-foreground text-xs">{k}</span>
                          <p className="font-medium">{v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card p-5 space-y-3 lg:col-span-2">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Layers className="w-4 h-4 text-violet-400" />Detected Colors
                    </h2>
                    <div className="flex gap-6">
                      <div><p className="text-xs text-muted-foreground mb-1">Primary</p><ColorDot color={dna.detectedColors.primary} /></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Secondary</p><ColorDot color={dna.detectedColors.secondary} /></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Accent</p><ColorDot color={dna.detectedColors.accent} /></div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Brand Personality</p>
                      <div className="flex flex-wrap gap-2">
                        {dna.brandPersonality.map((p) => <Badge key={p} variant="secondary">{p}</Badge>)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {dnaQuery.error && (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">No Brand DNA found for this client.</p>
                  <p className="text-xs mt-1">Click "Analyze Brand" to run the analysis.</p>
                </div>
              )}
            </>
          )}

          {/* Tab: Brand DNA detail */}
          {activeTab === "dna" && (
            <>
              {dnaQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
              {dna && (
                <div className="rounded-xl border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-5 h-5 text-violet-400" />
                    <h2 className="font-semibold">Brand DNA — {activeClientId}</h2>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Analyzed {new Date(dna.analyzedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                    {[
                      ["Brand Voice", dna.brandVoice],
                      ["Writing Style", dna.writingStyle],
                      ["Photography", dna.photographyStyle],
                      ["Illustration", dna.illustrationStyle],
                      ["Layout", dna.layoutStyle],
                      ["Industry", dna.industry],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">{k}</p>
                        <p className="font-medium mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {dnaQuery.error && (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                  <p>No Brand DNA found. Click "Analyze Brand" to run analysis.</p>
                </div>
              )}
            </>
          )}

          {/* Tab: Recommendations */}
          {activeTab === "recs" && (
            <>
              {recsQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
              {recs.length === 0 && !recsQuery.isLoading && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                  <p>No recommendations — brand kit looks complete.</p>
                </div>
              )}
              <div className="space-y-3">
                {recs.map((rec, i) => (
                  <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{rec.title}</p>
                      <PriorityBadge priority={rec.priority} />
                    </div>
                    <p className="text-sm text-muted-foreground">{rec.description}</p>
                    <p className="text-xs text-emerald-400">↑ {rec.expectedImpact}</p>
                    {rec.missingItems.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {rec.missingItems.map((item) => (
                          <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Tab: AI Creative Director */}
          {activeTab === "director" && (
            <>
              {directorQuery.isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Cpu className="w-6 h-6 text-violet-400 animate-pulse mr-2" />
                  <span className="text-muted-foreground text-sm">Generating creative direction…</span>
                </div>
              )}
              {director && (
                <div className="space-y-4">
                  {[
                    { title: "Creative Strategy", icon: <Brain className="w-4 h-4 text-violet-400" />, content: director.creativeStrategy },
                    { title: "Visual Direction", icon: <Palette className="w-4 h-4 text-violet-400" />, content: director.visualDirection },
                    { title: "Communication Direction", icon: <Cpu className="w-4 h-4 text-violet-400" />, content: director.communicationDirection },
                  ].map((s) => (
                    <div key={s.title} className="rounded-xl border bg-card p-4">
                      <h3 className="font-semibold flex items-center gap-2 mb-2">{s.icon}{s.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.content}</p>
                    </div>
                  ))}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border bg-card p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-violet-400" />Design Recommendations
                      </h3>
                      <ul className="space-y-1.5">
                        {director.designRecommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <ChevronRight className="w-4 h-4 flex-shrink-0 text-violet-400 mt-0.5" />{r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400" />Template Recommendations
                      </h3>
                      <ul className="space-y-1.5">
                        {director.templateRecommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <ChevronRight className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />{r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {director.priorityActions.length > 0 && (
                    <div className="rounded-xl border bg-card p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-400" />Priority Actions
                      </h3>
                      <ol className="space-y-2">
                        {director.priorityActions.map((a, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                              {i + 1}
                            </span>
                            <span className="text-muted-foreground">{a}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground text-right">
                    Generated {new Date(director.generatedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Tab: Duplicates */}
          {activeTab === "duplicates" && (
            <>
              {duplicatesQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
              {duplicates && (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
                    <Copy className="w-5 h-5 text-amber-400" />
                    <div>
                      <p className="font-semibold">{duplicates.totalDuplicatesFound} duplicate asset(s) detected</p>
                      <p className="text-xs text-muted-foreground">{duplicates.duplicateGroups.length} group(s) found</p>
                    </div>
                  </div>
                  {duplicates.duplicateGroups.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
                      <p>No duplicates found for this client.</p>
                    </div>
                  )}
                  {duplicates.duplicateGroups.map((group, i) => (
                    <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary">IDs: {group.assetIds.join(", ")}</Badge>
                        {group.versionTypes.map((vt) => (
                          <Badge key={vt} variant="outline" className="text-xs">{vt}</Badge>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">{group.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {!activeClientId && !statsQuery.isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <Brain className="w-10 h-10 mx-auto mb-4 opacity-40" />
          <p className="text-sm">Enter a client ID above to load their Brand Intelligence profile.</p>
        </div>
      )}
    </div>
  );
}
