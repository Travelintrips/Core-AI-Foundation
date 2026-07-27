/**
 * Team 17 — Interior Design Planning — Customer output view
 * Shows: moodboard, space plan, furniture placement, circulation, materials,
 * lighting, visual concept, vendor categories, validation, safety disclaimers.
 *
 * Images: fetched via the output endpoint's `images` map (keyed by
 * "{itemType}:{itemId}"). Falls back to swatch/emoji/icon when no image.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle, Home, Palette,
  Layers, Lightbulb, ShoppingBag, Shield, RefreshCw, Sofa,
} from "lucide-react";

// ── Thumbnail component ────────────────────────────────────────────────────────

interface ThumbnailProps {
  thumbnailUrl?: string | null;
  imageAlt?: string | null;
  fallback: React.ReactNode;
  className?: string;
}

function ItemThumbnail({ thumbnailUrl, imageAlt, fallback, className = "" }: ThumbnailProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    thumbnailUrl ? "loading" : "error",
  );

  useEffect(() => {
    setState(thumbnailUrl ? "loading" : "error");
  }, [thumbnailUrl]);

  if (!thumbnailUrl || state === "error") {
    return <>{fallback}</>;
  }

  return (
    <div className={`relative shrink-0 rounded-xl overflow-hidden ${className}`} style={{ background: "rgba(255,255,255,0.06)" }}>
      {state === "loading" && (
        <div className="absolute inset-0 animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
      )}
      <img
        src={thumbnailUrl}
        alt={imageAlt ?? "interior item"}
        className="w-full h-full object-cover"
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        style={{ display: state === "loaded" ? "block" : "block", opacity: state === "loading" ? 0 : 1, transition: "opacity 0.2s" }}
      />
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectData {
  id: number;
  title: string;
  roomType: string;
  status: string;
  clientName?: string | null;
}

interface BriefData {
  roomLengthM: string;
  roomWidthM: string;
  ceilingHeightM: string;
  style: string;
  furnitureNeeds: string[];
  budgetNotes?: string | null;
}

interface OutputData {
  moodboard?: {
    palette?: string[];
    moodWords?: string[];
    styleDescription?: string;
    textureDescriptions?: string[];
    lightingMood?: string;
  } | null;
  spacePlan?: {
    zones?: Array<{ id: string; label: string; purpose: string }>;
    notes?: string;
  } | null;
  furniturePlacement?: Array<{
    item: string;
    widthM: number;
    depthM: number;
    heightM?: number;
    clearanceFront: number;
    clearanceSide: number;
    note: string;
  }> | null;
  circulationAnalysis?: string | null;
  materialRecommendations?: {
    flooring?: { primary?: string; alternative?: string; why?: string };
    walls?: { primary?: string; accent?: string; why?: string };
    ceiling?: { treatment?: string; why?: string };
    textiles?: { curtains?: string; rugs?: string; upholstery?: string };
  } | null;
  lightingRecommendations?: {
    ambient?: { type?: string; placement?: string; colorTemp?: string };
    task?: { type?: string; placement?: string; colorTemp?: string };
    accent?: { type?: string; purpose?: string };
    natural?: { strategy?: string };
  } | null;
  visualConcept?: string | null;
  vendorCategories?: Array<{ category: string; examples?: string; why: string }> | null;
  validationResults?: {
    dimensionWarnings?: string[];
    clearanceWarnings?: string[];
    circulationWarnings?: string[];
    passedChecks?: string[];
  } | null;
  safetyDisclaimers?: string[];
  aiModelUsed?: string | null;
}

/** Slim image record returned by the public output endpoint */
interface AssetImage {
  thumbnailUrl: string | null;
  imageAlt: string | null;
  isManualUpload: boolean;
}

// ── Fallback swatches ──────────────────────────────────────────────────────────

const ZONE_EMOJIS: Record<string, string> = {
  living: "🛋️", bedroom: "🛏️", kitchen: "🍳", dining: "🪑", bathroom: "🚿",
  office: "💻", hall: "🚪", foyer: "🏛️", balcony: "🌿",
};
function getZoneEmoji(label: string): string {
  const l = label.toLowerCase();
  return Object.entries(ZONE_EMOJIS).find(([k]) => l.includes(k))?.[1] ?? "📐";
}

const FURNITURE_EMOJIS: Record<string, string> = {
  sofa: "🛋️", chair: "🪑", table: "🪵", bed: "🛏️", cabinet: "🗄️",
  wardrobe: "🚪", shelf: "📚", desk: "🖥️", bench: "🪑", stool: "🪑",
};
function getFurnitureEmoji(name: string): string {
  const n = name.toLowerCase();
  return Object.entries(FURNITURE_EMOJIS).find(([k]) => n.includes(k))?.[1] ?? "🪑";
}

const MATERIAL_ICONS: Record<string, string> = {
  flooring: "🪵", walls: "🎨", ceiling: "⬜", textiles: "🧵",
};

const LIGHTING_ICONS: Record<string, string> = {
  ambient: "💡", task: "🔦", accent: "✨", natural: "☀️",
};

// ── Layout helpers ─────────────────────────────────────────────────────────────

const ROOM_LABELS: Record<string, string> = {
  living_room: "Ruang Tamu",
  bedroom: "Kamar Tidur",
  kitchen: "Dapur",
  office: "Ruang Kerja",
  cafe: "Kafe",
  restaurant: "Restoran",
  hotel: "Kamar Hotel",
  lobby: "Lobi",
  booth: "Booth",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#6B7280" },
  brief_submitted: { label: "Brief Diterima", color: "#7C6EFA" },
  analyzing: { label: "Sedang Dianalisis...", color: "#F59E0B" },
  outputs_ready: { label: "Konsep Siap", color: "#10B981" },
  revision_requested: { label: "Revisi Diminta", color: "#F97316" },
  completed: { label: "Selesai", color: "#10B981" },
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(124,110,250,0.15)" }}>
          {icon}
        </div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

/**
 * params.id is the accessToken (UUID), NOT a numeric project ID.
 * The token-based URL prevents IDOR: possession of the token = ownership.
 */
export default function InteriorDesignProjectPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [output, setOutput] = useState<OutputData | null>(null);
  const [images, setImages] = useState<Record<string, AssetImage>>({});
  const [error, setError] = useState<string | null>(null);

  // params.id is the accessToken (UUID) — used directly in the token-based URL
  const accessToken = params.id;

  /** Look up image for an item; returns null when no image available. */
  const getImg = (itemType: string, itemId: string): AssetImage | null =>
    images[`${itemType}:${itemId}`] ?? null;

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Token in path param — server verifies ownership; numeric id not accepted
      const res = await fetch(`/api/public/interior-design/projects/${accessToken}/outputs`);
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const d = (await res.json()) as {
        project: ProjectData;
        brief: BriefData | null;
        output: OutputData | null;
        images?: Record<string, AssetImage>;
      };
      setProject(d.project);
      setBrief(d.brief);
      setOutput(d.output);
      setImages(d.images ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
      setPolling(false);
    }
  }

  useEffect(() => {
    void load();
  }, [accessToken]);

  // Poll while analyzing
  useEffect(() => {
    if (project?.status === "analyzing") {
      const id = setInterval(() => {
        setPolling(true);
        void load(true);
      }, 5000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [project?.status]);

  if (loading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center min-h-screen" style={{ background: "#060B18" }}>
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#7C6EFA" }} />
            <p className="text-sm" style={{ color: "#8B9BC4" }}>Memuat proyek...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !project) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center min-h-screen" style={{ background: "#060B18" }}>
          <div className="text-center max-w-md">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <h2 className="text-xl font-semibold text-white mb-2">Proyek Tidak Ditemukan</h2>
            <p className="text-sm mb-6" style={{ color: "#8B9BC4" }}>{error ?? "Proyek ini tidak tersedia."}</p>
            <button onClick={() => navigate("/interior-design")} className="px-6 py-3 rounded-xl text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
              Buat Brief Baru
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const statusInfo = STATUS_LABELS[project.status] ?? { label: project.status, color: "#6B7280" };
  const allWarnings = [
    ...(output?.validationResults?.dimensionWarnings ?? []),
    ...(output?.validationResults?.clearanceWarnings ?? []),
    ...(output?.validationResults?.circulationWarnings ?? []),
  ];

  return (
    <Layout>
      <div className="min-h-screen" style={{ background: "#060B18" }}>
        <div className="container mx-auto px-4 py-12 max-w-4xl">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate("/interior-design")}
              className="inline-flex items-center gap-1.5 text-sm mb-6 transition-colors hover:opacity-80"
              style={{ color: "#8B9BC4" }}
            >
              <ArrowLeft className="w-4 h-4" />
              Brief Baru
            </button>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
                    <Home className="w-5 h-5 text-white" />
                  </div>
                  <h1 className="text-2xl font-bold text-white">{project.title}</h1>
                </div>
                <div className="flex items-center gap-3 ml-13">
                  <span className="text-sm" style={{ color: "#8B9BC4" }}>
                    {ROOM_LABELS[project.roomType] ?? project.roomType}
                    {brief && ` · ${brief.roomLengthM}m × ${brief.roomWidthM}m`}
                  </span>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: `${statusInfo.color}20`, color: statusInfo.color, border: `1px solid ${statusInfo.color}30` }}
                  >
                    {statusInfo.label}
                  </span>
                  {polling && <RefreshCw className="w-3 h-3 animate-spin" style={{ color: "#7C6EFA" }} />}
                </div>
              </div>
              <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#5A6B8C" }}>
                #{project.id}
              </span>
            </div>
          </div>

          {/* Analyzing state */}
          {project.status === "analyzing" && (
            <div className="mb-8 p-6 rounded-2xl flex items-center gap-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <Loader2 className="w-6 h-6 animate-spin flex-shrink-0" style={{ color: "#F59E0B" }} />
              <div>
                <p className="font-medium" style={{ color: "#F59E0B" }}>AI sedang menyiapkan konsep desain Anda...</p>
                <p className="text-sm mt-0.5" style={{ color: "#9A7B2A" }}>Biasanya selesai dalam 30–60 detik. Halaman akan otomatis diperbarui.</p>
              </div>
            </div>
          )}

          {/* Brief submitted — awaiting generation */}
          {project.status === "brief_submitted" && !output && (
            <div className="mb-8 p-6 rounded-2xl" style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.15)" }}>
              <p className="font-medium" style={{ color: "#7C6EFA" }}>Brief Diterima ✓</p>
              <p className="text-sm mt-1" style={{ color: "#5A6B8C" }}>Tim kami akan segera memproses dan menghasilkan konsep desain Anda.</p>
            </div>
          )}

          {output && (
            <div className="space-y-6">
              {/* Validation warnings */}
              {allWarnings.length > 0 && (
                <div className="p-5 rounded-2xl" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4" style={{ color: "#F59E0B" }} />
                    <p className="text-sm font-semibold" style={{ color: "#F59E0B" }}>Catatan Teknis dari Validasi</p>
                  </div>
                  <ul className="space-y-1.5">
                    {allWarnings.map((w, i) => (
                      <li key={i} className="text-xs flex items-start gap-2" style={{ color: "#9A7B2A" }}>
                        <span className="mt-0.5 flex-shrink-0">•</span>{w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Moodboard */}
              {output.moodboard && (
                <Section icon={<Palette className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Moodboard">
                  {output.moodboard.palette && output.moodboard.palette.length > 0 && (
                    <div className="flex gap-2 mb-4">
                      {output.moodboard.palette.map((color, i) => (
                        <div key={i} className="flex-1 h-12 rounded-xl border" style={{ background: color, borderColor: "rgba(255,255,255,0.1)" }} title={color} />
                      ))}
                    </div>
                  )}
                  {output.moodboard.moodWords && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {output.moodboard.moodWords.map((w, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(124,110,250,0.1)", color: "#7C6EFA", border: "1px solid rgba(124,110,250,0.2)" }}>
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                  {output.moodboard.styleDescription && (
                    <p className="text-sm" style={{ color: "#8B9BC4" }}>{output.moodboard.styleDescription}</p>
                  )}
                  {output.moodboard.lightingMood && (
                    <p className="text-xs mt-2" style={{ color: "#5A6B8C" }}>
                      <strong style={{ color: "#8B9BC4" }}>Suasana cahaya:</strong> {output.moodboard.lightingMood}
                    </p>
                  )}
                </Section>
              )}

              {/* Visual concept */}
              {output.visualConcept && (
                <Section icon={<Layers className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Konsep Visual">
                  <p className="text-sm leading-relaxed" style={{ color: "#8B9BC4" }}>{output.visualConcept}</p>
                </Section>
              )}

              {/* Space Plan zones — with thumbnails */}
              {output.spacePlan?.zones && (
                <Section icon={<Home className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Rencana Ruang (Space Plan)">
                  <div className="space-y-3">
                    {output.spacePlan.zones.map((zone) => {
                      const img = getImg("space_plan", zone.id);
                      return (
                        <div
                          key={zone.id}
                          className="flex items-center gap-3 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <ItemThumbnail
                            thumbnailUrl={img?.thumbnailUrl}
                            imageAlt={img?.imageAlt ?? `${zone.label} floor plan diagram`}
                            className="w-14 h-14 rounded-xl shrink-0"
                            fallback={
                              <div
                                className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center text-2xl"
                                style={{ background: "rgba(124,110,250,0.12)", border: "1px solid rgba(124,110,250,0.15)" }}
                              >
                                {getZoneEmoji(zone.label)}
                              </div>
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white mb-0.5">{zone.label}</p>
                            <p className="text-xs" style={{ color: "#5A6B8C" }}>{zone.purpose}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {output.spacePlan.notes && (
                    <p className="text-xs mt-3" style={{ color: "#5A6B8C" }}>{output.spacePlan.notes}</p>
                  )}
                </Section>
              )}

              {/* Furniture placement — with thumbnails */}
              {output.furniturePlacement && output.furniturePlacement.length > 0 && (
                <Section icon={<Sofa className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Penempatan Furnitur">
                  <div className="space-y-3">
                    {output.furniturePlacement.map((item, i) => {
                      // Stable key: normalized item name (concept draft uses same name-based id)
                      const itemId = `furniture_${i}`;
                      const img = getImg("furniture", itemId);
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <ItemThumbnail
                            thumbnailUrl={img?.thumbnailUrl}
                            imageAlt={img?.imageAlt ?? `${item.item} furniture product white background`}
                            className="w-14 h-14 rounded-xl shrink-0"
                            fallback={
                              <div
                                className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center text-2xl"
                                style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.12)" }}
                              >
                                {getFurnitureEmoji(item.item)}
                              </div>
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{item.item}</p>
                            <p className="text-xs mt-0.5" style={{ color: "#5A6B8C" }}>{item.note}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-mono" style={{ color: "#7C6EFA" }}>{item.widthM}×{item.depthM}m</p>
                            <p className="text-xs" style={{ color: "#5A6B8C" }}>klirens {item.clearanceFront}m depan</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Circulation */}
              {output.circulationAnalysis && (
                <Section icon={<RefreshCw className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Analisis Sirkulasi">
                  <p className="text-sm leading-relaxed" style={{ color: "#8B9BC4" }}>{output.circulationAnalysis}</p>
                </Section>
              )}

              {/* Materials — with thumbnails */}
              {output.materialRecommendations && (
                <Section icon={<Layers className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Rekomendasi Material">
                  <div className="space-y-3">
                    {Object.entries(output.materialRecommendations).map(([key, val]) => {
                      const img = getImg("material", key);
                      const emoji = MATERIAL_ICONS[key] ?? "🪟";
                      return (
                        <div
                          key={key}
                          className="flex items-start gap-3 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <ItemThumbnail
                            thumbnailUrl={img?.thumbnailUrl}
                            imageAlt={img?.imageAlt ?? `${key} material texture close-up`}
                            className="w-14 h-14 rounded-xl shrink-0"
                            fallback={
                              <div
                                className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center text-2xl"
                                style={{ background: "rgba(92,70,180,0.12)", border: "1px solid rgba(92,70,180,0.18)" }}
                              >
                                {emoji}
                              </div>
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white mb-1 capitalize">{key}</p>
                            {val && typeof val === "object" &&
                              Object.entries(val as Record<string, string>).map(([k, v]) => (
                                <p key={k} className="text-xs" style={{ color: "#5A6B8C" }}>
                                  <span style={{ color: "#8B9BC4" }}>{k}:</span> {v}
                                </p>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Lighting — with thumbnails */}
              {output.lightingRecommendations && (
                <Section icon={<Lightbulb className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Rekomendasi Pencahayaan">
                  <div className="space-y-3">
                    {Object.entries(output.lightingRecommendations).map(([key, val]) => {
                      const img = getImg("lighting", key);
                      const emoji = LIGHTING_ICONS[key] ?? "💡";
                      return (
                        <div
                          key={key}
                          className="flex items-start gap-3 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <ItemThumbnail
                            thumbnailUrl={img?.thumbnailUrl}
                            imageAlt={img?.imageAlt ?? `${key} light fixture lamp`}
                            className="w-14 h-14 rounded-xl shrink-0"
                            fallback={
                              <div
                                className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center text-2xl"
                                style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.15)" }}
                              >
                                {emoji}
                              </div>
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white mb-1 capitalize">{key}</p>
                            {val && typeof val === "object" &&
                              Object.entries(val as Record<string, string>).map(([k, v]) => (
                                <p key={k} className="text-xs" style={{ color: "#5A6B8C" }}>
                                  <span style={{ color: "#8B9BC4" }}>{k}:</span> {v}
                                </p>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Vendor categories */}
              {output.vendorCategories && output.vendorCategories.length > 0 && (
                <Section icon={<ShoppingBag className="w-4 h-4" style={{ color: "#7C6EFA" }} />} title="Kategori Vendor yang Direkomendasikan">
                  <div className="grid grid-cols-2 gap-2">
                    {output.vendorCategories.map((v, i) => (
                      <div key={i} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <p className="text-sm font-medium text-white">{v.category}</p>
                        <p className="text-xs mt-0.5" style={{ color: "#5A6B8C" }}>{v.why}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Validation passed */}
              {(output.validationResults?.passedChecks?.length ?? 0) > 0 && (
                <Section icon={<CheckCircle className="w-4 h-4 text-green-400" />} title="Validasi Lulus">
                  <ul className="space-y-1">
                    {output.validationResults!.passedChecks!.map((c, i) => (
                      <li key={i} className="text-xs flex items-center gap-2" style={{ color: "#4ADE80" }}>
                        <CheckCircle className="w-3 h-3 flex-shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Safety disclaimers */}
              {(output.safetyDisclaimers?.length ?? 0) > 0 && (
                <Section icon={<Shield className="w-4 h-4 text-amber-400" />} title="Disclaimer Keselamatan & Cakupan">
                  <ul className="space-y-2">
                    {output.safetyDisclaimers!.map((d, i) => (
                      <li key={i} className="text-xs" style={{ color: "#9A7B2A" }}>{d}</li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}

          {/* CTA */}
          <div className="mt-8 text-center">
            <button
              onClick={() => navigate("/interior-design")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-white"
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
            >
              <Home className="w-4 h-4" />
              Buat Brief Baru
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
