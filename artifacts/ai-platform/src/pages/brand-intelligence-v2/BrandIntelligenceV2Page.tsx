/**
 * Brand Intelligence 2.0 — Admin Platform Page (Team 5)
 *
 * Full admin view with exact hex colors, avoidWords, avoidPatterns,
 * evidence chains, and all recommendation explanations.
 * Route: /brand-intelligence-v2
 * (Registration via integration manifest — Team 24 wires this into App.tsx)
 */
import { useState } from "react";
import { DimensionCard } from "./components/DimensionCard.js";
import { ConfidenceBar } from "./components/ConfidenceBar.js";

// ── Types (local — avoids cross-artifact barrel imports) ──────────────────────
interface BrandIntelligenceV2 {
  clientId: string;
  visualLanguage: { gridSystem: string; motionPrinciple: string; contrastStyle: string; borderStyle: string; shadowStyle: string };
  toneWritingStyle: { formalityLevel: number; formalityLabel: string; vocabularyComplexity: string; sentenceStructure: string; ctaStyle: string; emotionalRegister: string; proofTone: string; avoidWords: string[] };
  colorPsychologyDetailed: Array<{ color: string; colorMask: string; role: string; emotions: string[]; associations: string[]; recommendedUsage: string; confidence: number }>;
  typographyProfile: { scaleRatioLabel: string; scaleRatio: number; weightUsage: { primary: string; secondary: string; accent: string }; lineHeightStyle: string; letterSpacingStyle: string; fontPairingRationale: string; accessibilityScore: number };
  photographyStyleDetailed: { shotTypes: string[]; lightingMood: string; colorGrading: string; subjectFocus: string; depthOfField: string; humanPresence: string };
  illustrationStyleDetailed: { complexity: string; strokeWeight: string; colorUsage: string; culturalReferences: string[]; dimensionality: string; textureUsage: string };
  materialStyleInterior: { materials: string[]; styleFamily: string; lightingApproach: string; spacePhilosophy: string; texturePreference: string; colorPalette: string[] };
  motifStyleFashion: { patterns: string[]; silhouette: string; textiles: string[]; culturalReferences: string[]; colorway: string; occasions: string[] };
  creativeMemory: { keyInsights: Array<{ key: string; insight: string; source: string; confidence: number; addedAt: string }>; crossProjectLearnings: string[]; preferencePatterns: Array<{ pattern: string; frequency: number; confidence: number }>; avoidPatterns: string[] };
  dimensionConfidence: {
    visualLanguage: { score: number; evidence: string[]; gaps: string[] };
    toneWriting: { score: number; evidence: string[]; gaps: string[] };
    colorPsychology: { score: number; evidence: string[]; gaps: string[] };
    typography: { score: number; evidence: string[]; gaps: string[] };
    photography: { score: number; evidence: string[]; gaps: string[] };
    illustration: { score: number; evidence: string[]; gaps: string[] };
    interior: { score: number; evidence: string[]; gaps: string[] };
    fashion: { score: number; evidence: string[]; gaps: string[] };
    creativeMemory: { score: number; evidence: string[]; gaps: string[] };
    overall: number;
  };
  recommendationExplanations: Array<{ id: string; dimension: string; recommendation: string; evidence: string[]; confidence: number; priority: string; expectedImpact: string; missingData: string[] }>;
  sourceBrandDnaVersion: string;
  analysisVersion: string;
  analyzedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Chip({ label, variant = "default" }: { label: string; variant?: "default" | "red" | "green" }) {
  const cls = {
    default: "bg-muted text-muted-foreground border-border",
    red: "bg-red-500/10 text-red-600 border-red-500/20",
    green: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  }[variant];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs border ${cls}`}>{label}</span>;
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium capitalize text-foreground">{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BrandIntelligenceV2Page() {
  const [clientId, setClientId] = useState("");
  const [profile, setProfile] = useState<BrandIntelligenceV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "dimensions" | "memory" | "recommendations">("overview");

  const BASE = "";

  const analyze = async () => {
    if (!clientId.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/api/ai/brand-intelligence-v2/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Api-Key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },
        body: JSON.stringify({ clientId: clientId.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json() as BrandIntelligenceV2);
      setActiveTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!profile) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/api/ai/brand-intelligence-v2/${profile.clientId}/refresh`, {
        method: "POST",
        headers: { "X-Admin-Api-Key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json() as BrandIntelligenceV2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  const dc = profile?.dimensionConfidence;
  const critCount = profile?.recommendationExplanations.filter((r) => r.priority === "critical").length ?? 0;
  const highCount = profile?.recommendationExplanations.filter((r) => r.priority === "high").length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            🧬 Brand Intelligence 2.0
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Deterministic multi-dimensional brand analysis with per-dimension confidence scoring.
          </p>
        </div>
        {profile && (
          <button
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm rounded-lg disabled:opacity-50 transition-colors border border-border"
          >
            {loading ? "Refreshing…" : "↻ Refresh Analysis"}
          </button>
        )}
      </div>

      {/* Analyze form */}
      <div className="flex gap-3 items-end">
        <div className="flex flex-col gap-1.5 flex-1 max-w-sm">
          <label className="text-sm font-medium text-foreground">Client ID</label>
          <input
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. sha256_email_hash or clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
          />
        </div>
        <button
          onClick={analyze}
          disabled={loading || !clientId.trim()}
          className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Profile view */}
      {profile && dc && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Overall Confidence", value: `${Math.round(dc.overall * 100)}%`, sub: "weighted average" },
              { label: "Critical Issues", value: critCount, sub: "need attention" },
              { label: "High Priority", value: highCount, sub: "recommended" },
              { label: "Source DNA", value: `v${profile.sourceBrandDnaVersion}`, sub: `v${profile.analysisVersion} analysis` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="text-2xl font-bold text-foreground">{s.value}</span>
                <span className="text-xs text-muted-foreground">{s.sub}</span>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0 -mb-2">
            {(["overview", "dimensions", "memory", "recommendations"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize rounded-t-lg transition-colors ${
                  activeTab === tab
                    ? "bg-card border border-b-card border-border text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {activeTab === "overview" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold text-sm mb-4">Dimension Confidence</h3>
                <div className="flex flex-col gap-3">
                  {[
                    ["Visual Language", dc.visualLanguage],
                    ["Tone & Writing", dc.toneWriting],
                    ["Color Psychology", dc.colorPsychology],
                    ["Typography", dc.typography],
                    ["Photography", dc.photography],
                    ["Illustration", dc.illustration],
                    ["Interior Style", dc.interior],
                    ["Fashion Motif", dc.fashion],
                    ["Creative Memory", dc.creativeMemory],
                  ].map(([label, entry]) => (
                    <div key={label as string} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-36 shrink-0">{label as string}</span>
                      <div className="flex-1">
                        <ConfidenceBar score={(entry as { score: number }).score} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab: Dimensions */}
          {activeTab === "dimensions" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DimensionCard title="Visual Language" icon="🎨" confidence={dc.visualLanguage}>
                <div className="grid grid-cols-2 gap-2">
                  <KV label="Grid" value={profile.visualLanguage.gridSystem} />
                  <KV label="Motion" value={profile.visualLanguage.motionPrinciple} />
                  <KV label="Contrast" value={profile.visualLanguage.contrastStyle} />
                  <KV label="Border" value={profile.visualLanguage.borderStyle} />
                  <KV label="Shadow" value={profile.visualLanguage.shadowStyle} />
                </div>
              </DimensionCard>

              <DimensionCard title="Tone & Writing Style" icon="✍️" confidence={dc.toneWriting}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Formality" value={`${profile.toneWritingStyle.formalityLabel} (${profile.toneWritingStyle.formalityLevel}/5)`} />
                    <KV label="Vocabulary" value={profile.toneWritingStyle.vocabularyComplexity} />
                    <KV label="Sentences" value={profile.toneWritingStyle.sentenceStructure} />
                    <KV label="CTA" value={profile.toneWritingStyle.ctaStyle} />
                    <KV label="Register" value={profile.toneWritingStyle.emotionalRegister} />
                    <KV label="Proof Tone" value={profile.toneWritingStyle.proofTone} />
                  </div>
                  {profile.toneWritingStyle.avoidWords.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Avoid words:</p>
                      <div className="flex flex-wrap gap-1">
                        {profile.toneWritingStyle.avoidWords.map((w) => <Chip key={w} label={w} variant="red" />)}
                      </div>
                    </div>
                  )}
                </div>
              </DimensionCard>

              <DimensionCard title="Color Psychology" icon="🎨" confidence={dc.colorPsychology}>
                <div className="flex flex-col gap-3">
                  {profile.colorPsychologyDetailed.length === 0 && (
                    <p className="text-xs text-muted-foreground">No color data yet. Upload brand palette.</p>
                  )}
                  {profile.colorPsychologyDetailed.map((entry, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div
                        className="w-7 h-7 rounded-md border border-border shrink-0"
                        style={{ backgroundColor: entry.color }}
                        title={entry.color}
                      />
                      <div className="flex-1">
                        <p className="text-xs font-medium capitalize">{entry.role} — {entry.color}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {entry.emotions.map((e) => <Chip key={e} label={e} />)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{entry.recommendedUsage}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{Math.round(entry.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </DimensionCard>

              <DimensionCard title="Typography Profile" icon="🔤" confidence={dc.typography}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Scale" value={profile.typographyProfile.scaleRatioLabel} />
                    <KV label="A11y Score" value={`${profile.typographyProfile.accessibilityScore}/100`} />
                    <KV label="Line Height" value={profile.typographyProfile.lineHeightStyle} />
                    <KV label="Letter Spacing" value={profile.typographyProfile.letterSpacingStyle} />
                    <KV label="Primary Weight" value={profile.typographyProfile.weightUsage.primary} />
                    <KV label="Body Weight" value={profile.typographyProfile.weightUsage.secondary} />
                  </div>
                  {profile.typographyProfile.fontPairingRationale && (
                    <p className="text-xs text-muted-foreground italic">{profile.typographyProfile.fontPairingRationale}</p>
                  )}
                </div>
              </DimensionCard>

              <DimensionCard title="Photography Style" icon="📷" confidence={dc.photography}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Lighting" value={profile.photographyStyleDetailed.lightingMood} />
                    <KV label="Grading" value={profile.photographyStyleDetailed.colorGrading} />
                    <KV label="Subject" value={profile.photographyStyleDetailed.subjectFocus} />
                    <KV label="Depth of Field" value={profile.photographyStyleDetailed.depthOfField} />
                    <KV label="Human Presence" value={profile.photographyStyleDetailed.humanPresence} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.photographyStyleDetailed.shotTypes.map((s) => <Chip key={s} label={s} />)}
                  </div>
                </div>
              </DimensionCard>

              <DimensionCard title="Illustration Style" icon="✏️" confidence={dc.illustration}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Complexity" value={profile.illustrationStyleDetailed.complexity} />
                    <KV label="Stroke" value={profile.illustrationStyleDetailed.strokeWeight} />
                    <KV label="Color Usage" value={profile.illustrationStyleDetailed.colorUsage} />
                    <KV label="Dimension" value={profile.illustrationStyleDetailed.dimensionality} />
                    <KV label="Texture" value={profile.illustrationStyleDetailed.textureUsage} />
                  </div>
                  {profile.illustrationStyleDetailed.culturalReferences.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {profile.illustrationStyleDetailed.culturalReferences.map((r) => <Chip key={r} label={r} />)}
                    </div>
                  )}
                </div>
              </DimensionCard>

              <DimensionCard title="Interior Style" icon="🏛️" confidence={dc.interior}>
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-sm">{profile.materialStyleInterior.styleFamily}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Lighting" value={profile.materialStyleInterior.lightingApproach} />
                    <KV label="Space" value={profile.materialStyleInterior.spacePhilosophy} />
                    <KV label="Texture" value={profile.materialStyleInterior.texturePreference} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.materialStyleInterior.materials.map((m) => <Chip key={m} label={m} />)}
                  </div>
                </div>
              </DimensionCard>

              <DimensionCard title="Fashion Motif" icon="👗" confidence={dc.fashion}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KV label="Silhouette" value={profile.motifStyleFashion.silhouette} />
                    <KV label="Colorway" value={profile.motifStyleFashion.colorway} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.motifStyleFashion.patterns.map((p) => <Chip key={p} label={p} />)}
                    {profile.motifStyleFashion.textiles.map((t) => <Chip key={t} label={t} />)}
                  </div>
                  {profile.motifStyleFashion.occasions.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Occasions: {profile.motifStyleFashion.occasions.join(", ")}
                    </p>
                  )}
                </div>
              </DimensionCard>
            </div>
          )}

          {/* Tab: Memory */}
          {activeTab === "memory" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
                  <h3 className="font-semibold text-sm">Key Insights</h3>
                  {profile.creativeMemory.keyInsights.length === 0
                    ? <p className="text-xs text-muted-foreground">No brand memories yet.</p>
                    : profile.creativeMemory.keyInsights.map((ins) => (
                      <div key={ins.key} className="flex items-start gap-2 text-sm">
                        <span className="text-muted-foreground shrink-0 text-xs mt-0.5 capitalize">{ins.source}</span>
                        <p className="text-foreground/80 flex-1 text-xs">{ins.insight}</p>
                        <span className="text-muted-foreground text-xs shrink-0">{Math.round(ins.confidence * 100)}%</span>
                      </div>
                    ))}
                </div>
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
                  <h3 className="font-semibold text-sm">Preference Patterns</h3>
                  {profile.creativeMemory.preferencePatterns.length === 0
                    ? <p className="text-xs text-muted-foreground">No patterns detected yet.</p>
                    : profile.creativeMemory.preferencePatterns.map((p) => (
                      <div key={p.pattern} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground capitalize w-24 shrink-0">{p.pattern}</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-1.5 bg-violet-500 rounded-full" style={{ width: `${Math.min(p.frequency * 20, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-10 text-right">{p.frequency}×</span>
                      </div>
                    ))}
                  {profile.creativeMemory.avoidPatterns.length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <p className="text-xs font-medium text-destructive mb-1">Avoid Patterns</p>
                      <div className="flex flex-wrap gap-1">
                        {profile.creativeMemory.avoidPatterns.map((p, i) => <Chip key={i} label={p} variant="red" />)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {profile.creativeMemory.crossProjectLearnings.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-semibold text-sm mb-3">Cross-Project Learnings</h3>
                  <ul className="flex flex-col gap-2">
                    {profile.creativeMemory.crossProjectLearnings.map((l, i) => (
                      <li key={i} className="text-sm text-foreground/70 flex gap-2">
                        <span className="text-muted-foreground shrink-0">→</span> {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Tab: Recommendations */}
          {activeTab === "recommendations" && (
            <div className="flex flex-col gap-3">
              {profile.recommendationExplanations.length === 0 && (
                <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  No recommendations — brand data is comprehensive. ✓
                </div>
              )}
              {profile.recommendationExplanations.map((rec) => (
                <div key={rec.id} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        rec.priority === "critical" ? "bg-destructive/10 text-destructive" :
                        rec.priority === "high" ? "bg-amber-500/10 text-amber-600" :
                        "bg-muted text-muted-foreground"
                      }`}>{rec.priority}</span>
                      <span className="text-sm font-medium text-foreground">{rec.dimension}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{Math.round(rec.confidence * 100)}% conf.</span>
                  </div>
                  <p className="text-sm text-foreground/80">{rec.recommendation}</p>
                  <p className="text-xs text-emerald-600">
                    <span className="font-medium">Expected impact:</span> {rec.expectedImpact}
                  </p>
                  {(rec.evidence.length > 0 || rec.missingData.length > 0) && (
                    <div className="pt-2 border-t border-border flex flex-col gap-1">
                      {rec.evidence.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <span className="text-emerald-600 font-medium">Evidence: </span>
                          {rec.evidence.join(", ")}
                        </p>
                      )}
                      {rec.missingData.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <span className="text-destructive font-medium">Missing: </span>
                          {rec.missingData.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
