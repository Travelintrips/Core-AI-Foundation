import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Sparkles, RefreshCw, ChevronRight, AlertCircle,
  CheckCircle2, Lightbulb, ArrowLeft, Palette, Type, Camera,
  MessageSquare, LayoutGrid, Target, Shield, Clock, Cpu,
  TrendingUp, BarChart3, Layers,
} from "lucide-react";

// ── API helpers ────────────────────────────────────────────────────────────────

const base = (token: string) => `/api/public/customer/workspace/${token}`;

async function customFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface BrandDnaView {
  clientId: string;
  brandPersonality: string[];
  brandVoice: string;
  writingStyle: string;
  photographyStyle: string;
  illustrationStyle: string;
  iconStyle: string;
  layoutStyle: string;
  visualDensity: string;
  spacingStyle: string;
  detectedColors: { primary: string | null; secondary: string | null; accent: string | null; palette: string[] };
  colorPsychology: string[];
  detectedTypography: { heading: string | null; body: string | null; style: string };
  targetAudience: { primary: string; secondary: string; demographics: string[]; psychographics: string[] };
  industry: string;
  riskProfile: string;
  completenessScore: number;
  consistencyScore: number;
  confidenceScore: number;
  dataSourcesSummary: { brandKitSlots: number; assetCount: number; projectCount: number; memoryCount: number };
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

interface ConsistencyReport {
  overallScore: number;
  checklist: Record<string, boolean>;
  warnings: string[];
  suggestions: string[];
  assetsChecked: number;
}

interface CreativeMemoryView {
  totalProjects: number;
  totalMemories: number;
  projectHistory: Array<{ projectId: string; brandName: string; status: string; createdAt: string }>;
  memories: Array<{ key: string; value: string; category: string; confidence: number }>;
}

interface BrandIntelligenceDashboard {
  dna: BrandDnaView | null;
  recommendations: BrandRecommendation[];
  consistencyReport: ConsistencyReport;
  memory: CreativeMemoryView;
}

interface CreativeDirectorRec {
  creativeStrategy: string;
  visualDirection: string;
  communicationDirection: string;
  designRecommendations: string[];
  brandComplianceNotes: string[];
  templateRecommendations: string[];
  priorityActions: string[];
  generatedAt: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r={radius} fill="none" stroke="#1E293B" strokeWidth="8" />
          <circle cx="48" cy="48" r={radius} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-white">{score}</span>
        </div>
      </div>
      <span className="text-xs text-slate-400 font-medium">{label}</span>
    </div>
  );
}

function ColorSwatch({ color }: { color: string | null }) {
  if (!color) return <div className="w-8 h-8 rounded-full border border-slate-600 bg-slate-700 flex items-center justify-center"><span className="text-xs text-slate-500">?</span></div>;
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full border border-slate-600" style={{ background: color }} title={color} />
      <span className="text-xs text-slate-400 font-mono">{color}</span>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-rose-900/40 text-rose-300 border-rose-700",
    medium: "bg-amber-900/40 text-amber-300 border-amber-700",
    low: "bg-blue-900/40 text-blue-300 border-blue-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${styles[priority]}`}>
      {priority.toUpperCase()}
    </span>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full border font-medium"
      style={{ background: "rgba(124,110,250,0.12)", borderColor: "rgba(124,110,250,0.3)", color: "#A89CFF" }}>
      {label}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BrandIntelligencePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"dna" | "consistency" | "memory" | "director">("dna");

  const { data, isLoading, error } = useQuery<BrandIntelligenceDashboard>({
    queryKey: ["brand-intelligence", token],
    queryFn: () => customFetch(base(token) + "/brand-intelligence"),
    staleTime: 60_000,
  });

  const directorQuery = useQuery<CreativeDirectorRec>({
    queryKey: ["creative-director", token],
    queryFn: () => customFetch(base(token) + "/brand-intelligence/creative-director"),
    enabled: activeTab === "director",
    staleTime: 120_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => customFetch(base(token) + "/brand-intelligence/refresh", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-intelligence", token] });
      toast({ title: "Brand DNA refreshed", description: "Analysis updated with latest data." });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const dna = data?.dna;
  const recs = data?.recommendations ?? [];
  const consistency = data?.consistencyReport;
  const memory = data?.memory;

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center animate-pulse"
              style={{ background: "linear-gradient(135deg,#7C6EFA 0%,#5F52D0 100%)" }}>
              <Brain className="w-6 h-6 text-white" />
            </div>
            <p className="text-slate-400 text-sm">Analyzing brand identity…</p>
          </div>
        </div>
      </WorkspaceLayout>
    );
  }

  if (error) {
    return (
      <WorkspaceLayout token={token}>
        <div className="p-8 text-center">
          <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
          <p className="text-slate-300">Could not load Brand Intelligence.</p>
          <Link href={`/workspace/${token}`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const TABS = [
    { id: "dna" as const, label: "Brand DNA", icon: <Brain className="w-4 h-4" /> },
    { id: "consistency" as const, label: "Consistency", icon: <Shield className="w-4 h-4" /> },
    { id: "memory" as const, label: "Creative Memory", icon: <Clock className="w-4 h-4" /> },
    { id: "director" as const, label: "AI Director", icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <WorkspaceLayout token={token}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/workspace/${token}`} className="text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#7C6EFA 0%,#5F52D0 100%)" }}>
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white" style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                Brand Intelligence
              </h1>
              <p className="text-xs text-slate-400">AI-powered brand analysis & creative direction</p>
            </div>
          </div>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border"
            style={{ borderColor: "rgba(124,110,250,0.4)", color: "#A89CFF", background: "rgba(124,110,250,0.08)" }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            {refreshMutation.isPending ? "Analyzing…" : "Refresh"}
          </button>
        </div>

        {/* Score Cards */}
        {dna && (
          <div className="grid grid-cols-3 gap-4 p-5 rounded-2xl border"
            style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
            <ScoreRing score={dna.completenessScore} label="Completeness" color="#7C6EFA" />
            <ScoreRing
              score={dna.consistencyScore} label="Consistency"
              color={dna.consistencyScore >= 80 ? "#34D399" : dna.consistencyScore >= 50 ? "#FBBF24" : "#F87171"}
            />
            <ScoreRing score={Math.round(dna.confidenceScore * 100)} label="Confidence" color="#60A5FA" />
          </div>
        )}

        {/* Data sources */}
        {dna && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Brand Kit Slots", value: dna.dataSourcesSummary.brandKitSlots, icon: <Layers className="w-4 h-4" /> },
              { label: "Assets", value: dna.dataSourcesSummary.assetCount, icon: <BarChart3 className="w-4 h-4" /> },
              { label: "Projects", value: dna.dataSourcesSummary.projectCount, icon: <TrendingUp className="w-4 h-4" /> },
              { label: "Memory Entries", value: dna.dataSourcesSummary.memoryCount, icon: <Cpu className="w-4 h-4" /> },
            ].map((s) => (
              <div key={s.label} className="p-4 rounded-xl border text-center"
                style={{ background: "rgba(15,20,40,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="text-slate-500 flex justify-center mb-1">{s.icon}</div>
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border"
          style={{ background: "rgba(15,20,40,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: activeTab === tab.id ? "linear-gradient(135deg,#7C6EFA 0%,#5F52D0 100%)" : "transparent",
                color: activeTab === tab.id ? "#fff" : "#8B9BC4",
              }}
            >
              {tab.icon}
              <span className="hidden sm:block">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab: Brand DNA */}
        {activeTab === "dna" && dna && (
          <div className="space-y-5">
            {/* Personality & Voice */}
            <div className="p-5 rounded-2xl border space-y-4"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-violet-400" /> Brand Personality & Voice
              </h2>
              <div>
                <p className="text-xs text-slate-500 mb-2">Personality</p>
                <div className="flex flex-wrap gap-2">
                  {dna.brandPersonality.map((p) => <Tag key={p} label={p} />)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-slate-500 mb-1">Brand Voice</p><p className="text-sm text-white font-medium">{dna.brandVoice}</p></div>
                <div><p className="text-xs text-slate-500 mb-1">Writing Style</p><p className="text-sm text-white font-medium">{dna.writingStyle}</p></div>
              </div>
              {dna.colorPsychology.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Color Psychology</p>
                  <div className="flex flex-wrap gap-2">{dna.colorPsychology.map((p) => <Tag key={p} label={p} />)}</div>
                </div>
              )}
            </div>

            {/* Visual Identity */}
            <div className="p-5 rounded-2xl border space-y-4"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Palette className="w-4 h-4 text-violet-400" /> Visual Identity
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Photography Style", value: dna.photographyStyle, icon: <Camera className="w-3.5 h-3.5" /> },
                  { label: "Illustration Style", value: dna.illustrationStyle, icon: <Sparkles className="w-3.5 h-3.5" /> },
                  { label: "Icon Style", value: dna.iconStyle, icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                  { label: "Layout Style", value: dna.layoutStyle, icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                  { label: "Visual Density", value: dna.visualDensity, icon: <Layers className="w-3.5 h-3.5" /> },
                  { label: "Spacing Style", value: dna.spacingStyle, icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">{item.icon}{item.label}</p>
                    <p className="text-sm text-white font-medium">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Colors */}
            <div className="p-5 rounded-2xl border space-y-3"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Palette className="w-4 h-4 text-violet-400" /> Detected Colors
              </h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Primary</span><ColorSwatch color={dna.detectedColors.primary} /></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Secondary</span><ColorSwatch color={dna.detectedColors.secondary} /></div>
                <div className="flex items-center justify-between"><span className="text-xs text-slate-500">Accent</span><ColorSwatch color={dna.detectedColors.accent} /></div>
              </div>
            </div>

            {/* Typography */}
            <div className="p-5 rounded-2xl border space-y-3"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Type className="w-4 h-4 text-violet-400" /> Detected Typography
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-slate-500 mb-1">Heading Font</p><p className="text-sm text-white font-medium">{dna.detectedTypography.heading ?? "Not set"}</p></div>
                <div><p className="text-xs text-slate-500 mb-1">Body Font</p><p className="text-sm text-white font-medium">{dna.detectedTypography.body ?? "Not set"}</p></div>
              </div>
            </div>

            {/* Target Audience */}
            <div className="p-5 rounded-2xl border space-y-3"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-violet-400" /> Target Audience
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-slate-500 mb-1">Primary</p><p className="text-sm text-white font-medium">{dna.targetAudience.primary}</p></div>
                <div><p className="text-xs text-slate-500 mb-1">Industry</p><p className="text-sm text-white font-medium">{dna.industry}</p></div>
              </div>
            </div>

            {/* Recommendations */}
            {recs.length > 0 && (
              <div className="space-y-3">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" /> Recommendations
                </h2>
                {recs.map((rec, i) => (
                  <div key={i} className="p-4 rounded-xl border space-y-2"
                    style={{ background: "rgba(15,20,40,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">{rec.title}</p>
                      <PriorityBadge priority={rec.priority} />
                    </div>
                    <p className="text-xs text-slate-400">{rec.description}</p>
                    <p className="text-xs text-emerald-400">↑ {rec.expectedImpact}</p>
                    {rec.missingItems.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {rec.missingItems.map((item) => (
                          <span key={item} className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">{item}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Consistency */}
        {activeTab === "consistency" && consistency && (
          <div className="space-y-5">
            <div className="p-5 rounded-2xl border space-y-5"
              style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-400" /> Brand Consistency Checklist
                </h2>
                <span className="text-2xl font-bold text-white">
                  {consistency.overallScore}<span className="text-sm text-slate-500">/100</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(consistency.checklist).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2.5 p-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)" }}>
                    {val
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    }
                    <span className="text-xs text-slate-300">
                      {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {consistency.warnings.length > 0 && (
              <div className="p-4 rounded-xl border border-rose-800/40 bg-rose-900/10 space-y-2">
                <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Warnings
                </h3>
                {consistency.warnings.map((w, i) => <p key={i} className="text-xs text-rose-400">{w}</p>)}
              </div>
            )}

            {consistency.suggestions.length > 0 && (
              <div className="p-4 rounded-xl border border-amber-800/40 bg-amber-900/10 space-y-2">
                <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" /> Suggestions
                </h3>
                {consistency.suggestions.map((s, i) => <p key={i} className="text-xs text-amber-400">{s}</p>)}
              </div>
            )}

            <p className="text-xs text-slate-600 text-center">{consistency.assetsChecked} assets checked</p>
          </div>
        )}

        {/* Tab: Creative Memory */}
        {activeTab === "memory" && memory && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border text-center"
                style={{ background: "rgba(15,20,40,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="text-3xl font-bold text-violet-400">{memory.totalProjects}</div>
                <div className="text-xs text-slate-500 mt-1">Projects in Memory</div>
              </div>
              <div className="p-4 rounded-xl border text-center"
                style={{ background: "rgba(15,20,40,0.6)", borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="text-3xl font-bold text-blue-400">{memory.totalMemories}</div>
                <div className="text-xs text-slate-500 mt-1">Brand Preferences Stored</div>
              </div>
            </div>

            {memory.projectHistory.length > 0 && (
              <div className="p-5 rounded-2xl border space-y-3"
                style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                <h2 className="font-semibold text-white">Project History</h2>
                {memory.projectHistory.map((p) => (
                  <div key={p.projectId} className="flex items-center justify-between p-3 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div>
                      <p className="text-sm font-medium text-white">{p.brandName}</p>
                      <p className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">{p.status}</span>
                  </div>
                ))}
              </div>
            )}

            {memory.memories.length > 0 && (
              <div className="p-5 rounded-2xl border space-y-3"
                style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                <h2 className="font-semibold text-white">Stored Brand Preferences</h2>
                <div className="grid grid-cols-1 gap-2">
                  {memory.memories.slice(0, 12).map((m) => (
                    <div key={m.key} className="flex items-center justify-between p-2.5 rounded-lg text-sm"
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      <span className="text-slate-400 capitalize">{m.key.replace(/_/g, " ")}</span>
                      <span className="text-white font-medium truncate max-w-[180px]">{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {memory.totalMemories === 0 && memory.totalProjects === 0 && (
              <div className="text-center py-12 text-slate-500">
                <Clock className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No creative memory yet. Complete your first project to start building brand memory.</p>
              </div>
            )}
          </div>
        )}

        {/* Tab: AI Creative Director */}
        {activeTab === "director" && (
          <div className="space-y-5">
            {directorQuery.isLoading && (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <Cpu className="w-8 h-8 text-violet-400 animate-pulse" />
                  <p className="text-sm text-slate-400">AI Creative Director is thinking…</p>
                </div>
              </div>
            )}
            {directorQuery.data && (() => {
              const d = directorQuery.data;
              return (
                <>
                  {[
                    { title: "Creative Strategy", icon: <Brain className="w-4 h-4 text-violet-400" />, content: d.creativeStrategy },
                    { title: "Visual Direction", icon: <Palette className="w-4 h-4 text-violet-400" />, content: d.visualDirection },
                    { title: "Communication Direction", icon: <MessageSquare className="w-4 h-4 text-violet-400" />, content: d.communicationDirection },
                  ].map((section) => (
                    <div key={section.title} className="p-5 rounded-2xl border"
                      style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                      <h2 className="font-semibold text-white flex items-center gap-2 mb-3">{section.icon}{section.title}</h2>
                      <p className="text-sm text-slate-300 leading-relaxed">{section.content}</p>
                    </div>
                  ))}

                  <div className="p-5 rounded-2xl border space-y-3"
                    style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-violet-400" /> Design Recommendations
                    </h2>
                    <ul className="space-y-2">
                      {d.designRecommendations.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                          <ChevronRight className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />{r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 rounded-2xl border space-y-3"
                    style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" /> Template Recommendations
                    </h2>
                    <ul className="space-y-2">
                      {d.templateRecommendations.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                          <ChevronRight className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />{r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {d.priorityActions.length > 0 && (
                    <div className="p-5 rounded-2xl border space-y-3"
                      style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
                      <h2 className="font-semibold text-white flex items-center gap-2">
                        <Target className="w-4 h-4 text-emerald-400" /> Priority Actions
                      </h2>
                      <ol className="space-y-2">
                        {d.priorityActions.map((a, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                              style={{ background: "rgba(124,110,250,0.2)", color: "#A89CFF" }}>{i + 1}</span>
                            <span className="text-slate-300">{a}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <p className="text-xs text-slate-600 text-center">
                    Generated {new Date(d.generatedAt).toLocaleString()}
                  </p>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}
