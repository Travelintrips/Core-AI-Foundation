/**
 * tagNormalization.ts — Tag normalization & deduplication (Team 06)
 *
 * Rules:
 * - All tags → lowercase, trimmed, spaces→underscores
 * - Synonyms collapsed to canonical form
 * - Max 20 tags per asset after normalization
 * - Hierarchical: if "fashion_motif" and "motif" both present, keep "fashion_motif"
 */

// ── Synonym map (variant → canonical) ────────────────────────────────────────

const SYNONYM_MAP: Record<string, string> = {
  // Photo / image
  "photograph": "photo",
  "fotografí": "photo",
  "foto": "photo",
  "image": "photo",
  "gambar": "photo",
  "picture": "photo",

  // Graphic
  "graphics": "graphic",
  "grafis": "graphic",
  "design": "graphic",
  "artwork": "graphic",
  "kreasi": "graphic",
  "visual": "graphic",

  // Illustration
  "illustrations": "illustration",
  "illustrasi": "illustration",
  "ilustrasi": "illustration",
  "drawing": "illustration",
  "sketsa": "illustration",

  // Document
  "documents": "document",
  "file": "document",
  "dokumen": "document",
  "report": "document",
  "laporan": "document",
  "pdf": "document",

  // Logo / icon
  "logos": "logo",
  "logotype": "logo",
  "brand_mark": "logo",
  "brandmark": "logo",
  "icons": "icon",
  "favicon": "icon",

  // Interior / furniture
  "interior": "interior_material",
  "interior_design": "interior_material",
  "material": "interior_material",
  "texture": "interior_material",
  "furniture": "furniture_image",
  "furnitur": "furniture_image",
  "sofa": "furniture_image",
  "mebel": "furniture_image",
  "chair": "furniture_image",
  "table": "furniture_image",
  "kursi": "furniture_image",
  "meja": "furniture_image",

  // Fashion / garment
  "fashion": "fashion_motif",
  "motif": "fashion_motif",
  "pattern": "fashion_motif",
  "batik": "fashion_motif",
  "tenun": "fashion_motif",
  "textile": "fashion_motif",
  "textil": "fashion_motif",
  "garment": "garment_mockup",
  "baju": "garment_mockup",
  "pakaian": "garment_mockup",
  "mockup": "garment_mockup",
  "clothing": "garment_mockup",
  "apparel": "garment_mockup",

  // Packaging
  "package": "packaging_asset",
  "packaging": "packaging_asset",
  "kemasan": "packaging_asset",
  "box": "packaging_asset",
  "label": "packaging_asset",
  "wrapper": "packaging_asset",

  // Quality / state
  "high_quality": "hq",
  "high_res": "hq",
  "highres": "hq",
  "hires": "hq",
  "low_quality": "lq",
  "low_res": "lq",
  "transparent_bg": "transparent",
  "no_background": "transparent",
  "nobg": "transparent",

  // Colors (Indonesian)
  "merah": "red",
  "biru": "blue",
  "hijau": "green",
  "kuning": "yellow",
  "putih": "white",
  "hitam": "black",
  "abu": "grey",
  "abu_abu": "grey",
  "orange": "orange",
  "ungu": "purple",
};

// ── Hierarchy: if both parent + child tag exist, keep child only ──────────────

const HIERARCHY: Array<{ parent: string; children: string[] }> = [
  { parent: "photo",   children: ["portrait_photo", "product_photo", "aerial_photo", "event_photo"] },
  { parent: "graphic", children: ["infographic", "banner_graphic", "social_graphic"] },
  { parent: "fashion_motif", children: ["batik", "tenun", "ikat", "print_motif"] },
  { parent: "packaging_asset", children: ["box_packaging", "label_packaging", "pouch_packaging"] },
  { parent: "furniture_image", children: ["sofa_image", "chair_image", "table_image", "cabinet_image"] },
];

// ── Core normalization ────────────────────────────────────────────────────────

export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

export function normalizeTags(rawTags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTags) {
    const norm = normalizeTag(raw);
    if (!norm) continue;
    const canonical = SYNONYM_MAP[norm] ?? norm;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }

  // Apply hierarchy: if parent AND a more-specific child both exist, drop parent
  const set = new Set(result);
  for (const { parent, children } of HIERARCHY) {
    const hasChild = children.some((c) => set.has(c));
    if (hasChild && set.has(parent)) {
      set.delete(parent);
    }
  }

  return [...set].slice(0, 20);
}

// ── Tag scoring (relevance weight for knowledge tags) ─────────────────────────

export function scoreTag(tag: string, assetFileName: string, mimeType: string | null): number {
  const nameHit = assetFileName.toLowerCase().includes(tag.replace(/_/g, " ")) ? 0.3 : 0;
  const mimeHit = mimeType?.includes(tag.split("_")[0] ?? "") ? 0.2 : 0;
  return Math.min(1, 0.5 + nameHit + mimeHit);
}

// ── Extract tags from filename ────────────────────────────────────────────────

export function extractTagsFromFileName(fileName: string): string[] {
  const withoutExt = fileName.replace(/\.[a-z]{2,5}$/i, "");
  const words = withoutExt.split(/[-_\s.]+/).filter((w) => w.length >= 3);
  return normalizeTags(words);
}
