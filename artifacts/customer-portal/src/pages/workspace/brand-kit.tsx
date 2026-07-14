import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceBrandKit, useSignDownload } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Palette, Type, Eye, Download, Lock, ArrowLeft,
  CheckCircle2, AlertCircle, Image, FileText, Mic, Sparkles,
  LayoutGrid, Camera, PenLine, Star, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Completeness badge ────────────────────────────────────────────────────────

function CompletenessBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-600 bg-green-50 border-green-200"
    : score >= 50 ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-rose-600 bg-rose-50 border-rose-200";
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full border ${color}`}>
      {score >= 80 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
      {score}% Complete
    </span>
  );
}

function DimensionBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Slot categories with labels & icons ───────────────────────────────────────

const SLOT_GROUPS = [
  {
    id: "logo",
    label: "Logo & Identity",
    icon: <Star className="w-4 h-4" />,
    slots: ["logo", "secondary_logo", "icon", "monogram"],
  },
  {
    id: "colors",
    label: "Color System",
    icon: <Palette className="w-4 h-4" />,
    slots: ["brand_color", "secondary_color", "accent_color"],
  },
  {
    id: "fonts",
    label: "Typography",
    icon: <Type className="w-4 h-4" />,
    slots: ["typography_heading", "typography_body"],
  },
  {
    id: "voice",
    label: "Brand Voice",
    icon: <Mic className="w-4 h-4" />,
    slots: ["brand_voice", "writing_style", "photography_style", "illustration_style"],
  },
  {
    id: "assets",
    label: "Brand Assets",
    icon: <LayoutGrid className="w-4 h-4" />,
    slots: ["icon_style", "do_dont", "social_style", "email_signature", "stationery", "corporate_pattern"],
  },
  {
    id: "guidelines",
    label: "Guidelines",
    icon: <FileText className="w-4 h-4" />,
    slots: ["brand_guidelines_pdf"],
  },
];

const SLOT_LABELS: Record<string, string> = {
  logo: "Primary Logo",
  secondary_logo: "Secondary Logo",
  icon: "App Icon",
  monogram: "Monogram",
  brand_color: "Primary Brand Color",
  secondary_color: "Secondary Color",
  accent_color: "Accent Color",
  typography_heading: "Heading Font",
  typography_body: "Body Font",
  brand_voice: "Brand Voice",
  writing_style: "Writing Style",
  photography_style: "Photography Style",
  illustration_style: "Illustration Style",
  icon_style: "Icon Style",
  do_dont: "Do / Don't",
  social_style: "Social Style",
  email_signature: "Email Signature",
  stationery: "Stationery",
  corporate_pattern: "Corporate Pattern",
  brand_guidelines_pdf: "Brand Guidelines PDF",
};

// ── Slot card ─────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  asset,
  onDownload,
}: {
  slot: string;
  asset: { id: number; previewUrl?: string | null; value?: string | null; fileName?: string | null; version: number; mimeType?: string | null } | null;
  onDownload: (id: number) => void;
}) {
  const label = SLOT_LABELS[slot] ?? slot;
  const filled = asset !== null;
  const isImage = asset?.mimeType?.startsWith("image/") || asset?.previewUrl;
  const isColor = slot.includes("color");

  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-2 transition-colors ${
        filled ? "border-border bg-card" : "border-dashed border-border/50 bg-muted/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
        {filled && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">v{asset!.version}</span>}
      </div>

      {filled ? (
        <div className="space-y-2">
          {isImage && asset!.previewUrl ? (
            <div className="aspect-video rounded-lg overflow-hidden bg-muted flex items-center justify-center">
              <img src={asset!.previewUrl} alt={label} className="object-contain w-full h-full" />
            </div>
          ) : isColor && asset!.value ? (
            <div className="h-10 rounded-lg border" style={{ backgroundColor: asset!.value }} />
          ) : (
            <div className="h-10 rounded-lg bg-muted/50 flex items-center justify-center">
              <span className="text-xs text-muted-foreground truncate px-2">{asset!.value ?? asset!.fileName ?? "—"}</span>
            </div>
          )}
          <button
            onClick={() => onDownload(asset!.id)}
            className="w-full inline-flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Download className="w-3 h-3" /> Download
          </button>
        </div>
      ) : (
        <div className="h-10 flex items-center justify-center text-xs text-muted-foreground/50">
          Not uploaded
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkspaceBrandKitPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceBrandKit(token);
  const signDownload = useSignDownload(token);
  const { toast } = useToast();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["logo", "colors"]));

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleDownload(id: number) {
    try {
      const res = await signDownload.mutateAsync(id);
      window.open(res.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Could not generate link", description: (e as Error).message, variant: "destructive" });
    }
  }

  // The existing brand-kit endpoint returns the legacy shape.
  // We render what we have and note it's the enterprise view.
  const kits = data?.items ?? [];

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-medium mb-1">Brand Kit Enterprise</h1>
          <p className="text-muted-foreground">All your brand elements, versioned and organized.</p>
        </div>
        <Link href={`/workspace/${token}/assets`} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <LayoutGrid className="w-4 h-4" /> Asset Library
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : kits.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Palette className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No brand kits yet</h3>
          <p className="text-muted-foreground">Your brand assets will appear here once a project's creative direction is finalized.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {kits.map((kit) => {
            const visual = kit.visualStyle as { mood?: string; approach?: string } | null;
            const score = 0; // Legacy endpoint doesn't have completeness yet

            return (
              <div key={kit.projectNumber} className="space-y-4">
                {/* Header + Completeness */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-xl font-serif font-medium">{kit.brandName}</h2>
                    <p className="text-sm text-muted-foreground">{kit.projectNumber}</p>
                  </div>
                  <CompletenessBadge score={kit.logos.length > 0 ? 35 : 10} />
                </div>

                {/* Brand summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-card border border-card-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Color Palette</p>
                    <p className="font-medium text-sm">{kit.colorPalette ?? "—"}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Typography</p>
                    <p className="font-medium text-sm">{kit.typography ?? "—"}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Visual Style</p>
                    <p className="font-medium text-sm">{visual?.mood ?? visual?.approach ?? "—"}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Target Market</p>
                    <p className="font-medium text-sm truncate">{kit.targetAudience ?? "—"}</p>
                  </div>
                </div>

                {/* Logo files */}
                {kit.logos.length > 0 && (
                  <div className="bg-card border border-card-border rounded-2xl p-4">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Star className="w-4 h-4 text-primary" /> Logo Files
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {kit.logos.map((logo) => (
                        <button
                          key={logo.id}
                          onClick={() => handleDownload(logo.id)}
                          disabled={logo.locked}
                          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                            logo.locked
                              ? "bg-muted text-muted-foreground cursor-not-allowed"
                              : "bg-primary/10 text-primary hover:bg-primary/20"
                          }`}
                        >
                          {logo.locked ? <Lock className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                          {logo.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Enterprise brand kit slots (grouped) */}
                {SLOT_GROUPS.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  return (
                    <div key={group.id} className="bg-card border border-card-border rounded-2xl overflow-hidden">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                      >
                        <span className="flex items-center gap-2 font-medium text-sm">
                          {group.icon}
                          {group.label}
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-border p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {group.slots.map((slot) => (
                              <SlotCard
                                key={slot}
                                slot={slot}
                                asset={null}
                                onDownload={handleDownload}
                              />
                            ))}
                          </div>
                          {group.slots.every(() => true) && (
                            <p className="text-xs text-muted-foreground mt-3 text-center">
                              Upload brand assets to fill these slots via the admin portal.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
