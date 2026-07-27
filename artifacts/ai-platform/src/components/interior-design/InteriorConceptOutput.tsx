/**
 * InteriorConceptOutput — rich renderer for the Interior Design Concept Architect
 * agent output (Agent 1 in interiorDesignAiService.ts).
 *
 * Replaces the generic renderOutput() call which rendered nested objects as raw
 * JSON. Each sub-concept (color, style, spatial, signature elements) is displayed
 * with a purpose-built layout.
 *
 * Backward-compatible:
 *  - string input → plain text
 *  - JSON-string input → parsed then rendered
 *  - nested object with design_concept/color_concept/… keys → rich layout
 *  - legacy object with visualConcept/concept keys → plain text block
 *  - partial / missing fields → gracefully skipped, no "undefined" shown
 *  - camelCase or snake_case keys → both accepted
 */

import { useState } from "react";
import { Palette, ChevronDown, ChevronUp } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesignConcept {
  title?: string;
  narrative?: string;
  design_philosophy?: string;
  emotional_intent?: string;
}

export interface StyleDirection {
  primary_style?: string;
  style_blend?: string;
  local_cultural_integration?: string;
  contemporary_vs_traditional_balance?: string;
}

export interface SpatialConcept {
  overall_flow?: string;
  focal_points?: string[];
  light_philosophy?: string;
  indoor_outdoor_connection?: string;
}

export interface ColorSwatch {
  name?: string;
  hex?: string;
  application?: string;
}

export interface AccentColor {
  name?: string;
  hex?: string;
}

export interface ColorConcept {
  primary_palette?: ColorSwatch[];
  accent_colors?: AccentColor[];
  palette_mood?: string;
  color_flow_between_rooms?: string;
}

export interface InteriorConceptData {
  design_concept?: DesignConcept;
  style_direction?: StyleDirection;
  spatial_concept?: SpatialConcept;
  color_concept?: ColorConcept;
  signature_elements?: string[];
  client_lifestyle_alignment?: string;
  // camelCase aliases (backward compat)
  designConcept?: DesignConcept;
  styleDirection?: StyleDirection;
  spatialConcept?: SpatialConcept;
  colorConcept?: ColorConcept;
  signatureElements?: string[];
}

// ── Safe parser ───────────────────────────────────────────────────────────────

/**
 * Parses any unknown value into InteriorConceptData if it looks like interior
 * agent output. Returns null if it is not (legacy plain-string or unknown shape).
 *
 * Handles:
 *  - plain object with interior keys
 *  - JSON string of the above
 *  - partial objects with some keys missing
 *  - camelCase or snake_case keys
 */
export function parseInteriorConceptOutput(raw: unknown): InteriorConceptData | null {
  if (raw == null) return null;

  // JSON string → parse first
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        return parseInteriorConceptOutput(JSON.parse(trimmed));
      } catch {
        return null; // Not JSON — treat as legacy string
      }
    }
    return null;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;

  // Detect interior agent format (snake_case or camelCase)
  const hasInteriorKeys =
    "design_concept" in obj || "style_direction" in obj ||
    "color_concept"  in obj || "spatial_concept"  in obj ||
    "designConcept"  in obj || "styleDirection"   in obj ||
    "colorConcept"   in obj || "spatialConcept"   in obj;

  if (!hasInteriorKeys) return null;

  // Normalise to snake_case — prefer snake_case if both present
  return {
    design_concept: (obj["design_concept"] as DesignConcept | undefined)
      ?? (obj["designConcept"] as DesignConcept | undefined),
    style_direction: (obj["style_direction"] as StyleDirection | undefined)
      ?? (obj["styleDirection"] as StyleDirection | undefined),
    spatial_concept: (obj["spatial_concept"] as SpatialConcept | undefined)
      ?? (obj["spatialConcept"] as SpatialConcept | undefined),
    color_concept: (obj["color_concept"] as ColorConcept | undefined)
      ?? (obj["colorConcept"] as ColorConcept | undefined),
    signature_elements: (obj["signature_elements"] as string[] | undefined)
      ?? (obj["signatureElements"] as string[] | undefined),
    client_lifestyle_alignment: obj["client_lifestyle_alignment"] as string | undefined,
  };
}

// ── Interior Color Palette ────────────────────────────────────────────────────

function InteriorColorPalette({ cc }: { cc: ColorConcept }) {
  const palette = Array.isArray(cc.primary_palette) ? cc.primary_palette : [];
  const accents = Array.isArray(cc.accent_colors)   ? cc.accent_colors  : [];

  return (
    <div className="space-y-3">
      {cc.palette_mood && (
        <p className="text-xs text-foreground/80 italic leading-relaxed">
          &ldquo;{cc.palette_mood}&rdquo;
        </p>
      )}

      {palette.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Primary Palette
          </p>
          {/* Swatch row */}
          <div className="flex flex-wrap gap-2">
            {palette.map((swatch, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className="size-8 rounded-md border border-white/10 shadow-sm"
                  style={{ backgroundColor: swatch.hex ?? "#888888" }}
                  title={[swatch.name, swatch.application].filter(Boolean).join(" — ")}
                />
                {swatch.name && (
                  <span className="text-[9px] font-mono text-muted-foreground text-center max-w-[52px] leading-tight truncate">
                    {swatch.name}
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* Application labels */}
          {palette.some((s) => s.application) && (
            <div className="grid grid-cols-1 gap-1">
              {palette
                .filter((s) => s.application)
                .map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div
                      className="size-3 rounded-sm shrink-0 border border-white/10"
                      style={{ backgroundColor: s.hex ?? "#888888" }}
                    />
                    <span className="text-[10px] text-foreground/80 leading-tight">
                      {s.name && <span className="font-medium">{s.name}</span>}
                      {s.name && s.application && <span className="text-muted-foreground"> — </span>}
                      {s.application && (
                        <span className="text-muted-foreground">{s.application}</span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {accents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Accent Colors
          </p>
          <div className="flex flex-wrap gap-2">
            {accents.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-muted/30 rounded px-2 py-1"
              >
                <div
                  className="size-2.5 rounded-sm shrink-0 border border-white/10"
                  style={{ backgroundColor: a.hex ?? "#888888" }}
                />
                <span className="text-[10px] font-mono">
                  {a.name ?? a.hex ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cc.color_flow_between_rooms && (
        <p className="text-[10px] text-foreground/70 leading-relaxed">
          <span className="font-semibold text-muted-foreground">Color flow: </span>
          {cc.color_flow_between_rooms}
        </p>
      )}
    </div>
  );
}

// ── Style Direction ───────────────────────────────────────────────────────────

function InteriorStyleDirection({ sd }: { sd: StyleDirection }) {
  const rows: { label: string; value: string | undefined }[] = [
    { label: "Primary Style", value: sd.primary_style },
    { label: "Style Blend", value: sd.style_blend },
    { label: "Local Cultural Integration", value: sd.local_cultural_integration },
    { label: "Contemporary vs Traditional", value: sd.contemporary_vs_traditional_balance },
  ];

  const visible = rows.filter((r) => r.value);
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2">
      {visible.map(({ label, value }) => (
        <div
          key={label}
          className="bg-muted/20 border border-border/30 rounded-lg px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
            {label}
          </p>
          <p className="text-xs text-foreground/90 leading-relaxed">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Spatial Concept ───────────────────────────────────────────────────────────

function InteriorSpatialConcept({ sc }: { sc: SpatialConcept }) {
  const focalPoints = Array.isArray(sc.focal_points)
    ? sc.focal_points.filter(Boolean)
    : [];

  const textRows: { label: string; value: string | undefined }[] = [
    { label: "Overall Flow", value: sc.overall_flow },
    { label: "Lighting Philosophy", value: sc.light_philosophy },
    { label: "Indoor–Outdoor Connection", value: sc.indoor_outdoor_connection },
  ];

  const visibleTextRows = textRows.filter((r) => r.value);
  const hasContent = visibleTextRows.length > 0 || focalPoints.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-2">
      {visibleTextRows.map(({ label, value }) => (
        <div
          key={label}
          className="bg-muted/20 border border-border/30 rounded-lg px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
            {label}
          </p>
          <p className="text-xs text-foreground/90 leading-relaxed">{value}</p>
        </div>
      ))}

      {focalPoints.length > 0 && (
        <div className="bg-muted/20 border border-border/30 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Focal Points
          </p>
          <ul className="space-y-0.5">
            {focalPoints.map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                <span className="text-teal-400 mt-0.5 shrink-0">•</span>
                <span>{pt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Signature Elements ────────────────────────────────────────────────────────

function InteriorSignatureElements({ elements }: { elements: string[] }) {
  if (elements.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {elements.map((el, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-medium text-teal-300"
        >
          {el}
        </span>
      ))}
    </div>
  );
}

// ── Concept Image Hero ────────────────────────────────────────────────────────

interface ConceptImageHeroProps {
  imageUrl?: string | null;
  isGenerating?: boolean;
  hasFailed?: boolean;
}

function ConceptImageHero({ imageUrl, isGenerating, hasFailed }: ConceptImageHeroProps) {
  const [imgError, setImgError] = useState(false);

  if (imageUrl && !imgError) {
    return (
      <div className="relative rounded-lg overflow-hidden aspect-video bg-muted/20">
        <img
          src={imageUrl}
          alt="Interior concept visual"
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="rounded-lg aspect-video bg-muted/20 border border-border/30 flex flex-col items-center justify-center gap-2">
        <div className="size-7 border-2 border-teal-400/40 border-t-teal-400 rounded-full animate-spin" />
        <span className="text-[11px] font-mono text-muted-foreground">
          Generating visual concept…
        </span>
      </div>
    );
  }

  if (hasFailed || imgError) {
    return (
      <div className="rounded-lg aspect-video bg-red-500/5 border border-red-500/20 flex flex-col items-center justify-center gap-1">
        <span className="text-[11px] font-mono text-red-400">
          Gagal memuat visual konsep
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          Teks konsep tersedia di bawah
        </span>
      </div>
    );
  }

  return null;
}

// ── Main exported component ───────────────────────────────────────────────────

export interface InteriorConceptOutputProps {
  /** Raw step output from the Design Concept step */
  output: unknown;
  /** URL of the first completed concept image, if available */
  conceptImageUrl?: string | null;
  /** True when any asset for this project is in generating/pending state */
  isGeneratingImage?: boolean;
  /** True when all assets have failed and no image URL is available */
  imageGenerationFailed?: boolean;
}

export function InteriorConceptOutput({
  output,
  conceptImageUrl,
  isGeneratingImage,
  imageGenerationFailed,
}: InteriorConceptOutputProps) {
  const [debugOpen, setDebugOpen] = useState(false);

  const data = parseInteriorConceptOutput(output);

  // ── Fallback: not an interior concept format ──────────────────────────────
  if (!data) {
    if (output == null) return null;

    // Legacy: plain string
    if (typeof output === "string" && output.trim()) {
      return (
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
          {output}
        </p>
      );
    }

    if (typeof output === "object" && !Array.isArray(output)) {
      const obj = output as Record<string, unknown>;
      if (Object.keys(obj).length === 0) return null;

      // Legacy object (e.g. { visualConcept: "...", concept: "..." }) —
      // render key-value pairs without JSON.stringify for any value
      return (
        <div className="space-y-2">
          {Object.entries(obj).map(([key, val]) => {
            if (val == null) return null;
            const label = key
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());

            if (typeof val === "string") {
              return (
                <div key={key}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                    {label}
                  </p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{val}</p>
                </div>
              );
            }

            if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
              return (
                <div key={key}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                    {label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(val as string[]).map((item, i) => (
                      <span
                        key={i}
                        className="inline-flex rounded border border-border/50 bg-muted/20 px-2 py-0.5 text-[11px]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              );
            }

            // For other types (number, boolean) — safe String()
            return (
              <div key={key}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                  {label}
                </p>
                <p className="text-xs text-foreground/70 leading-relaxed">
                  {String(val)}
                </p>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  }

  // ── Rich interior concept layout ──────────────────────────────────────────

  const dc = data.design_concept;
  const sd = data.style_direction;
  const sc = data.spatial_concept;
  const cc = data.color_concept;
  const se = Array.isArray(data.signature_elements) ? data.signature_elements.filter(Boolean) : [];
  const cla = data.client_lifestyle_alignment;

  const showImageHero = conceptImageUrl || isGeneratingImage || imageGenerationFailed;

  return (
    <div className="space-y-4">
      {/* ── Hero: concept image ─────────────────────────────────────────── */}
      {showImageHero && (
        <ConceptImageHero
          imageUrl={conceptImageUrl}
          isGenerating={isGeneratingImage}
          hasFailed={imageGenerationFailed}
        />
      )}

      {/* ── No image placeholder ────────────────────────────────────────── */}
      {!showImageHero && (
        <div className="rounded-lg bg-muted/10 border border-border/20 px-4 py-3 text-[11px] font-mono text-muted-foreground">
          Visual konsep belum dibuat — klik &ldquo;Generate Images&rdquo; untuk memulai pipeline.
        </div>
      )}

      {/* ── Design Concept: hero text ────────────────────────────────────── */}
      {dc && (
        <div className="space-y-2">
          {dc.title && (
            <h5 className="font-semibold text-sm text-foreground leading-snug">
              {dc.title}
            </h5>
          )}
          {dc.narrative && (
            <p className="text-xs text-foreground/80 leading-relaxed">{dc.narrative}</p>
          )}
          {dc.emotional_intent && (
            <p className="text-[11px] text-teal-300/80 italic">
              &ldquo;{dc.emotional_intent}&rdquo;
            </p>
          )}
          {dc.design_philosophy && (
            <div className="border-l-2 border-teal-500/40 pl-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                Design Philosophy
              </p>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {dc.design_philosophy}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Client lifestyle alignment ───────────────────────────────────── */}
      {cla && (
        <div className="bg-muted/20 border border-border/30 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
            Client Lifestyle Alignment
          </p>
          <p className="text-xs text-foreground/80 leading-relaxed">{cla}</p>
        </div>
      )}

      {/* ── Color Concept ────────────────────────────────────────────────── */}
      {cc &&
        (Array.isArray(cc.primary_palette) && cc.primary_palette.length > 0
          || Array.isArray(cc.accent_colors) && cc.accent_colors.length > 0
          || cc.palette_mood) && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <Palette className="size-3" /> Color Concept
          </p>
          <InteriorColorPalette cc={cc} />
        </div>
      )}

      {/* ── Style Direction ──────────────────────────────────────────────── */}
      {sd &&
        (sd.primary_style || sd.style_blend || sd.local_cultural_integration ||
          sd.contemporary_vs_traditional_balance) && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Style Direction
          </p>
          <InteriorStyleDirection sd={sd} />
        </div>
      )}

      {/* ── Spatial Concept ──────────────────────────────────────────────── */}
      {sc &&
        (sc.overall_flow || sc.light_philosophy || sc.indoor_outdoor_connection ||
          (Array.isArray(sc.focal_points) && sc.focal_points.length > 0)) && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Spatial Concept
          </p>
          <InteriorSpatialConcept sc={sc} />
        </div>
      )}

      {/* ── Signature Elements ───────────────────────────────────────────── */}
      {se.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Signature Elements
          </p>
          <InteriorSignatureElements elements={se} />
        </div>
      )}

      {/* ── Debug: collapsible raw JSON ──────────────────────────────────── */}
      <div className="border-t border-border/20 pt-2">
        <button
          onClick={() => setDebugOpen((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {debugOpen ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
          Raw JSON
        </button>
        {debugOpen && (
          <pre className="mt-2 text-[10px] font-mono text-foreground/60 whitespace-pre-wrap bg-muted/20 rounded p-2 max-h-48 overflow-y-auto">
            {JSON.stringify(output, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
