/**
 * Brand Intelligence 2.0 — Customer Portal Page (Team 5)
 *
 * Public-facing view using the redacted V2 profile.
 * Accessed via workspace token — no admin credentials needed.
 * Route: /workspace/:token/brand-intelligence-v2
 * (Registration via integration manifest — Team 24 wires this into App.tsx)
 */
import { useState } from "react";

// ── Types (local copy — no barrel import, public shape only) ──────────────────
interface DimConfEntry { score: number }
interface DimConf {
  visualLanguage: DimConfEntry; toneWriting: DimConfEntry;
  colorPsychology: DimConfEntry; typography: DimConfEntry;
  photography: DimConfEntry; illustration: DimConfEntry;
  interior: DimConfEntry; fashion: DimConfEntry;
  creativeMemory: DimConfEntry; overall: number;
}
interface PublicProfile {
  visualLanguage: { gridSystem: string; motionPrinciple: string; contrastStyle: string; borderStyle: string; shadowStyle: string };
  toneWritingStyle: { formalityLevel: number; formalityLabel: string; vocabularyComplexity: string; sentenceStructure: string; ctaStyle: string; emotionalRegister: string; proofTone: string };
  colorPsychologyDetailed: Array<{ colorMask: string; role: string; emotions: string[]; associations: string[]; recommendedUsage: string; confidence: number }>;
  typographyProfile: { scaleRatioLabel: string; scaleRatio: number; weightUsage: { primary: string; secondary: string; accent: string }; lineHeightStyle: string; letterSpacingStyle: string; fontPairingRationale: string; accessibilityScore: number };
  photographyStyleDetailed: { shotTypes: string[]; lightingMood: string; colorGrading: string; subjectFocus: string; depthOfField: string; humanPresence: string };
  illustrationStyleDetailed: { complexity: string; strokeWeight: string; colorUsage: string; culturalReferences: string[]; dimensionality: string; textureUsage: string };
  materialStyleInterior: { materials: string[]; styleFamily: string; lightingApproach: string; spacePhilosophy: string; texturePreference: string; colorPalette: string[] };
  motifStyleFashion: { patterns: string[]; silhouette: string; textiles: string[]; colorway: string; occasions: string[] };
  creativeMemory: { keyInsights: Array<{ key: string; insight: string; confidence: number }>; crossProjectLearnings: string[]; preferencePatterns: Array<{ pattern: string; frequency: number; confidence: number }> };
  dimensionConfidence: DimConf;
  recommendationExplanations: Array<{ id: string; dimension: string; recommendation: string; priority: string; expectedImpact: string; confidence: number }>;
  analysisVersion: string;
  analyzedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ConfBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? "#10b981" : score >= 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-white/50 w-10 text-right">{pct}%</span>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-md bg-white/10 text-white/70 text-xs border border-white/10">
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-5 flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-white/90">{title}</h3>
      {children}
    </section>
  );
}

const DIM_LABELS: Record<string, string> = {
  visualLanguage: "Visual Language", toneWriting: "Tone & Writing",
  colorPsychology: "Color Psychology", typography: "Typography",
  photography: "Photography", illustration: "Illustration",
  interior: "Interior Style", fashion: "Fashion Motif",
  creativeMemory: "Creative Memory",
};

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  params?: { token?: string };
}

export default function BrandIntelligenceV2Page({ params }: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = params?.token ?? "";

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const load = async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const url = force
        ? `${BASE}/public/customer/workspace/${token}/brand-intelligence-v2/refresh`
        : `${BASE}/public/customer/workspace/${token}/brand-intelligence-v2`;
      const res = await fetch(url, { method: force ? "POST" : "GET" });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json() as PublicProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  if (!profile && !loading && !error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-violet-600/20 flex items-center justify-center text-3xl">🧬</div>
          <h1 className="text-xl font-bold text-white">Brand Intelligence 2.0</h1>
          <p className="text-white/50 text-sm max-w-xs">
            Deep multi-dimensional analysis of your brand's visual language, tone, and creative DNA.
          </p>
          <button
            onClick={() => load()}
            className="mt-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Analyze My Brand
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          <p className="text-white/50 text-sm">Analyzing brand dimensions…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
        <div className="text-center flex flex-col items-center gap-4">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => load()} className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const dc = profile.dimensionConfidence;
  const criticalRecs = profile.recommendationExplanations.filter((r) => r.priority === "critical" || r.priority === "high");

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧬</span>
          <div>
            <h1 className="font-bold text-base">Brand Intelligence 2.0</h1>
            <p className="text-xs text-white/40">
              Overall confidence: {Math.round(dc.overall * 100)}% · v{profile.analysisVersion} ·{" "}
              {new Date(profile.analyzedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 disabled:opacity-50 rounded-lg transition-colors"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">

        {/* Overall confidence radar */}
        <Section title="Dimension Confidence Overview">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(DIM_LABELS).map(([key, label]) => {
              const entry = dc[key as keyof DimConf] as DimConfEntry | undefined;
              if (!entry) return null;
              return (
                <div key={key} className="flex flex-col gap-1">
                  <span className="text-xs text-white/60">{label}</span>
                  <ConfBar score={entry.score} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-white/40">Overall</span>
            <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-2 rounded-full bg-violet-500 transition-all" style={{ width: `${Math.round(dc.overall * 100)}%` }} />
            </div>
            <span className="text-sm font-bold text-violet-400">{Math.round(dc.overall * 100)}%</span>
          </div>
        </Section>

        {/* Visual Language */}
        <Section title="🎨 Visual Language">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ["Grid", profile.visualLanguage.gridSystem],
              ["Motion", profile.visualLanguage.motionPrinciple],
              ["Contrast", profile.visualLanguage.contrastStyle],
              ["Border", profile.visualLanguage.borderStyle],
              ["Shadow", profile.visualLanguage.shadowStyle],
            ].map(([label, val]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-white/40">{label}</span>
                <span className="text-sm font-medium capitalize">{val}</span>
              </div>
            ))}
          </div>
          <ConfBar score={dc.visualLanguage.score} />
        </Section>

        {/* Tone & Writing Style */}
        <Section title="✍️ Tone & Writing Style">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ["Formality", `${profile.toneWritingStyle.formalityLabel} (${profile.toneWritingStyle.formalityLevel}/5)`],
              ["Vocabulary", profile.toneWritingStyle.vocabularyComplexity],
              ["Sentences", profile.toneWritingStyle.sentenceStructure],
              ["CTA Style", profile.toneWritingStyle.ctaStyle],
              ["Register", profile.toneWritingStyle.emotionalRegister],
              ["Proof Tone", profile.toneWritingStyle.proofTone],
            ].map(([label, val]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-white/40">{label}</span>
                <span className="text-sm font-medium capitalize">{val}</span>
              </div>
            ))}
          </div>
          <ConfBar score={dc.toneWriting.score} />
        </Section>

        {/* Color Psychology */}
        {profile.colorPsychologyDetailed.length > 0 && (
          <Section title="🎨 Color Psychology">
            <div className="flex flex-col gap-3">
              {profile.colorPsychologyDetailed.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 w-8 h-8 rounded-md bg-white/15 flex items-center justify-center text-xs font-mono text-white/50 shrink-0">
                    {entry.colorMask}
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize text-white/80">{entry.role}</span>
                      <span className="text-xs text-white/30">·</span>
                      <span className="text-xs text-white/50">{Math.round(entry.confidence * 100)}% confidence</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {entry.emotions.map((e) => <Chip key={e} label={e} />)}
                    </div>
                    <p className="text-xs text-white/40">{entry.recommendedUsage}</p>
                  </div>
                </div>
              ))}
            </div>
            <ConfBar score={dc.colorPsychology.score} />
          </Section>
        )}

        {/* Typography */}
        <Section title="🔤 Typography Profile">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ["Scale", profile.typographyProfile.scaleRatioLabel],
              ["Line Height", profile.typographyProfile.lineHeightStyle],
              ["Letter Spacing", profile.typographyProfile.letterSpacingStyle],
              ["Primary Weight", profile.typographyProfile.weightUsage.primary],
              ["Body Weight", profile.typographyProfile.weightUsage.secondary],
              ["A11y Score", `${profile.typographyProfile.accessibilityScore}/100`],
            ].map(([label, val]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-white/40">{label}</span>
                <span className="text-sm font-medium">{val}</span>
              </div>
            ))}
          </div>
          {profile.typographyProfile.fontPairingRationale && (
            <p className="text-xs text-white/40 italic">{profile.typographyProfile.fontPairingRationale}</p>
          )}
          <ConfBar score={dc.typography.score} />
        </Section>

        {/* Photography + Illustration side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Section title="📷 Photography Style">
            <div className="flex flex-col gap-2">
              {[
                ["Lighting", profile.photographyStyleDetailed.lightingMood],
                ["Grading", profile.photographyStyleDetailed.colorGrading],
                ["Subject", profile.photographyStyleDetailed.subjectFocus],
                ["Depth of Field", profile.photographyStyleDetailed.depthOfField],
                ["People", profile.photographyStyleDetailed.humanPresence],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-xs capitalize font-medium">{val}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 mt-1">
                {profile.photographyStyleDetailed.shotTypes.map((s) => <Chip key={s} label={s} />)}
              </div>
            </div>
            <ConfBar score={dc.photography.score} />
          </Section>

          <Section title="✏️ Illustration Style">
            <div className="flex flex-col gap-2">
              {[
                ["Complexity", profile.illustrationStyleDetailed.complexity],
                ["Stroke", profile.illustrationStyleDetailed.strokeWeight],
                ["Color Usage", profile.illustrationStyleDetailed.colorUsage],
                ["Dimension", profile.illustrationStyleDetailed.dimensionality],
                ["Texture", profile.illustrationStyleDetailed.textureUsage],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-xs capitalize font-medium">{val}</span>
                </div>
              ))}
              {profile.illustrationStyleDetailed.culturalReferences.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {profile.illustrationStyleDetailed.culturalReferences.map((r) => <Chip key={r} label={r} />)}
                </div>
              )}
            </div>
            <ConfBar score={dc.illustration.score} />
          </Section>
        </div>

        {/* Interior + Fashion side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Section title="🏛️ Interior Style">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-violet-300">{profile.materialStyleInterior.styleFamily}</div>
              {[
                ["Lighting", profile.materialStyleInterior.lightingApproach],
                ["Space", profile.materialStyleInterior.spacePhilosophy],
                ["Texture", profile.materialStyleInterior.texturePreference],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-xs capitalize font-medium">{val}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 mt-1">
                {profile.materialStyleInterior.materials.slice(0, 5).map((m) => <Chip key={m} label={m} />)}
              </div>
            </div>
            <ConfBar score={dc.interior.score} />
          </Section>

          <Section title="👗 Fashion Motif">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-violet-300 capitalize">{profile.motifStyleFashion.silhouette} silhouette</div>
              {[
                ["Colorway", profile.motifStyleFashion.colorway],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-xs capitalize font-medium">{val}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 mt-1">
                {profile.motifStyleFashion.patterns.map((p) => <Chip key={p} label={p} />)}
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.motifStyleFashion.textiles.slice(0, 4).map((t) => <Chip key={t} label={t} />)}
              </div>
            </div>
            <ConfBar score={dc.fashion.score} />
          </Section>
        </div>

        {/* Creative Memory */}
        {(profile.creativeMemory.keyInsights.length > 0 || profile.creativeMemory.crossProjectLearnings.length > 0) && (
          <Section title="🧠 Creative Memory">
            {profile.creativeMemory.keyInsights.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-white/40 uppercase tracking-wider">Key Insights</p>
                {profile.creativeMemory.keyInsights.slice(0, 4).map((ins) => (
                  <div key={ins.key} className="flex items-start gap-2">
                    <span className="text-xs text-violet-400 shrink-0 mt-0.5">◆</span>
                    <p className="text-xs text-white/70">{ins.insight}</p>
                    <span className="text-xs text-white/30 shrink-0 ml-auto">{Math.round(ins.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            {profile.creativeMemory.crossProjectLearnings.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-white/40 uppercase tracking-wider">Cross-Project Learnings</p>
                {profile.creativeMemory.crossProjectLearnings.map((l, i) => (
                  <p key={i} className="text-xs text-white/60">→ {l}</p>
                ))}
              </div>
            )}
            <ConfBar score={dc.creativeMemory.score} />
          </Section>
        )}

        {/* Recommendations */}
        {criticalRecs.length > 0 && (
          <Section title="💡 Priority Recommendations">
            <div className="flex flex-col gap-3">
              {criticalRecs.slice(0, 5).map((rec) => (
                <div key={rec.id} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${
                    rec.priority === "critical"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-amber-500/20 text-amber-400"
                  }`}>
                    {rec.priority}
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-white/80">{rec.dimension}</p>
                    <p className="text-xs text-white/50">{rec.recommendation}</p>
                    <p className="text-xs text-emerald-400/70">Impact: {rec.expectedImpact}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
