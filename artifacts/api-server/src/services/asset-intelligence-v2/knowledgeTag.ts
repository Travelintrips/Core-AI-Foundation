/**
 * knowledgeTag.ts — Knowledge tag taxonomy per asset type (Team 06)
 *
 * Provides a curated, hierarchical tag vocabulary for each of the 10
 * supported asset types. These are NOT free-form tags — they're structured
 * knowledge descriptors used for cross-asset search and recommendation.
 */

import { type AssetTypeV2, type KnowledgeTag } from "./types.js";

// ── Taxonomy ──────────────────────────────────────────────────────────────────

const KNOWLEDGE_TAG_TAXONOMY: KnowledgeTag[] = [
  // ── Graphic ──
  { tag: "infographic",         normalizedTag: "infographic",         category: "content_type",  subcategory: "graphic",           assetTypes: ["graphic"],                                          weight: 0.9 },
  { tag: "banner",              normalizedTag: "banner",              category: "content_type",  subcategory: "graphic",           assetTypes: ["graphic", "photo"],                                 weight: 0.8 },
  { tag: "social_media_post",   normalizedTag: "social_media_post",   category: "usage",         subcategory: "digital",           assetTypes: ["graphic", "photo", "illustration"],                 weight: 0.85 },
  { tag: "poster",              normalizedTag: "poster",              category: "content_type",  subcategory: "graphic",           assetTypes: ["graphic", "illustration"],                          weight: 0.8 },
  { tag: "flyer",               normalizedTag: "flyer",               category: "content_type",  subcategory: "graphic",           assetTypes: ["graphic"],                                          weight: 0.75 },
  { tag: "logo_variant",        normalizedTag: "logo_variant",        category: "brand",         subcategory: "identity",          assetTypes: ["graphic", "svg"],                                   weight: 0.95 },
  { tag: "icon_set",            normalizedTag: "icon_set",            category: "content_type",  subcategory: "graphic",           assetTypes: ["graphic", "svg"],                                   weight: 0.85 },
  { tag: "chart",               normalizedTag: "chart",               category: "content_type",  subcategory: "data_viz",          assetTypes: ["graphic"],                                          weight: 0.8 },

  // ── Photo ──
  { tag: "portrait",            normalizedTag: "portrait",            category: "shot_type",     subcategory: "photo",             assetTypes: ["photo"],                                            weight: 0.9 },
  { tag: "product_shot",        normalizedTag: "product_shot",        category: "shot_type",     subcategory: "photo",             assetTypes: ["photo"],                                            weight: 0.95 },
  { tag: "lifestyle",           normalizedTag: "lifestyle",           category: "shot_type",     subcategory: "photo",             assetTypes: ["photo"],                                            weight: 0.85 },
  { tag: "aerial",              normalizedTag: "aerial",              category: "shot_type",     subcategory: "photo",             assetTypes: ["photo"],                                            weight: 0.8 },
  { tag: "event_coverage",      normalizedTag: "event_coverage",      category: "shot_type",     subcategory: "photo",             assetTypes: ["photo"],                                            weight: 0.8 },
  { tag: "team_photo",          normalizedTag: "team_photo",          category: "subject",       subcategory: "people",            assetTypes: ["photo"],                                            weight: 0.85 },
  { tag: "facility_photo",      normalizedTag: "facility_photo",      category: "subject",       subcategory: "place",             assetTypes: ["photo"],                                            weight: 0.8 },
  { tag: "before_after",        normalizedTag: "before_after",        category: "content_type",  subcategory: "comparison",        assetTypes: ["photo"],                                            weight: 0.75 },

  // ── Illustration ──
  { tag: "character_design",    normalizedTag: "character_design",    category: "style",         subcategory: "illustration",      assetTypes: ["illustration"],                                     weight: 0.9 },
  { tag: "flat_design",         normalizedTag: "flat_design",         category: "style",         subcategory: "illustration",      assetTypes: ["illustration", "graphic"],                          weight: 0.85 },
  { tag: "isometric",           normalizedTag: "isometric",           category: "style",         subcategory: "illustration",      assetTypes: ["illustration", "graphic"],                          weight: 0.85 },
  { tag: "hand_drawn",          normalizedTag: "hand_drawn",          category: "style",         subcategory: "illustration",      assetTypes: ["illustration"],                                     weight: 0.8 },
  { tag: "vector_art",          normalizedTag: "vector_art",          category: "format",        subcategory: "illustration",      assetTypes: ["illustration", "svg"],                              weight: 0.9 },
  { tag: "mascot",              normalizedTag: "mascot",              category: "subject",       subcategory: "brand",             assetTypes: ["illustration", "graphic"],                          weight: 0.9 },

  // ── SVG ──
  { tag: "scalable_vector",     normalizedTag: "scalable_vector",     category: "format",        subcategory: "svg",               assetTypes: ["svg"],                                              weight: 0.95 },
  { tag: "animated_svg",        normalizedTag: "animated_svg",        category: "format",        subcategory: "svg",               assetTypes: ["svg"],                                              weight: 0.85 },
  { tag: "ui_icon",             normalizedTag: "ui_icon",             category: "usage",         subcategory: "digital",           assetTypes: ["svg", "graphic"],                                   weight: 0.9 },
  { tag: "decorative_element",  normalizedTag: "decorative_element",  category: "usage",         subcategory: "design",            assetTypes: ["svg", "graphic"],                                   weight: 0.75 },

  // ── Document ──
  { tag: "company_profile",     normalizedTag: "company_profile",     category: "doc_type",      subcategory: "corporate",         assetTypes: ["document"],                                         weight: 0.95 },
  { tag: "product_catalog",     normalizedTag: "product_catalog",     category: "doc_type",      subcategory: "commercial",        assetTypes: ["document"],                                         weight: 0.9 },
  { tag: "proposal",            normalizedTag: "proposal",            category: "doc_type",      subcategory: "commercial",        assetTypes: ["document"],                                         weight: 0.85 },
  { tag: "presentation",        normalizedTag: "presentation",        category: "doc_type",      subcategory: "corporate",         assetTypes: ["document"],                                         weight: 0.85 },
  { tag: "certificate",         normalizedTag: "certificate",         category: "doc_type",      subcategory: "credential",        assetTypes: ["document"],                                         weight: 0.9 },
  { tag: "brand_guidelines",    normalizedTag: "brand_guidelines",    category: "doc_type",      subcategory: "brand",             assetTypes: ["document"],                                         weight: 0.95 },

  // ── Interior Material ──
  { tag: "fabric_texture",      normalizedTag: "fabric_texture",      category: "material_type", subcategory: "textile",           assetTypes: ["interior_material", "fashion_motif"],               weight: 0.9 },
  { tag: "wood_texture",        normalizedTag: "wood_texture",        category: "material_type", subcategory: "natural",           assetTypes: ["interior_material", "furniture_image"],             weight: 0.9 },
  { tag: "stone_texture",       normalizedTag: "stone_texture",       category: "material_type", subcategory: "natural",           assetTypes: ["interior_material"],                               weight: 0.85 },
  { tag: "tile_pattern",        normalizedTag: "tile_pattern",        category: "material_type", subcategory: "ceramic",           assetTypes: ["interior_material"],                               weight: 0.85 },
  { tag: "wallpaper",           normalizedTag: "wallpaper",           category: "application",   subcategory: "wall_finish",       assetTypes: ["interior_material"],                               weight: 0.8 },
  { tag: "paint_swatch",        normalizedTag: "paint_swatch",        category: "material_type", subcategory: "color",             assetTypes: ["interior_material"],                               weight: 0.85 },
  { tag: "flooring",            normalizedTag: "flooring",            category: "application",   subcategory: "floor_finish",      assetTypes: ["interior_material"],                               weight: 0.85 },

  // ── Furniture Image ──
  { tag: "residential_furniture", normalizedTag: "residential_furniture", category: "segment", subcategory: "furniture",         assetTypes: ["furniture_image"],                                   weight: 0.9 },
  { tag: "commercial_furniture",  normalizedTag: "commercial_furniture",  category: "segment", subcategory: "furniture",         assetTypes: ["furniture_image"],                                   weight: 0.9 },
  { tag: "outdoor_furniture",     normalizedTag: "outdoor_furniture",     category: "segment", subcategory: "furniture",         assetTypes: ["furniture_image"],                                   weight: 0.85 },
  { tag: "lifestyle_staging",     normalizedTag: "lifestyle_staging",     category: "style",   subcategory: "furniture",         assetTypes: ["furniture_image", "interior_material"],              weight: 0.85 },
  { tag: "product_render",        normalizedTag: "product_render",        category: "format",  subcategory: "3d",                assetTypes: ["furniture_image"],                                   weight: 0.9 },
  { tag: "cutout_product",        normalizedTag: "cutout_product",        category: "format",  subcategory: "photo",             assetTypes: ["furniture_image", "photo"],                          weight: 0.85 },

  // ── Fashion Motif ──
  { tag: "batik_motif",           normalizedTag: "batik_motif",           category: "motif_type", subcategory: "indonesian",      assetTypes: ["fashion_motif"],                                    weight: 0.95 },
  { tag: "tenun_motif",           normalizedTag: "tenun_motif",           category: "motif_type", subcategory: "indonesian",      assetTypes: ["fashion_motif"],                                    weight: 0.95 },
  { tag: "floral_pattern",        normalizedTag: "floral_pattern",        category: "motif_type", subcategory: "nature",          assetTypes: ["fashion_motif", "interior_material"],               weight: 0.85 },
  { tag: "geometric_pattern",     normalizedTag: "geometric_pattern",     category: "motif_type", subcategory: "abstract",        assetTypes: ["fashion_motif", "interior_material", "graphic"],    weight: 0.85 },
  { tag: "ethnic_print",          normalizedTag: "ethnic_print",          category: "motif_type", subcategory: "cultural",        assetTypes: ["fashion_motif"],                                    weight: 0.9 },
  { tag: "repeat_pattern",        normalizedTag: "repeat_pattern",        category: "structure",  subcategory: "layout",          assetTypes: ["fashion_motif", "interior_material"],               weight: 0.8 },
  { tag: "seamless_tile",         normalizedTag: "seamless_tile",         category: "structure",  subcategory: "layout",          assetTypes: ["fashion_motif", "interior_material"],               weight: 0.85 },

  // ── Garment Mockup ──
  { tag: "t_shirt_mockup",        normalizedTag: "t_shirt_mockup",        category: "garment_type", subcategory: "tops",          assetTypes: ["garment_mockup"],                                   weight: 0.95 },
  { tag: "hoodie_mockup",         normalizedTag: "hoodie_mockup",         category: "garment_type", subcategory: "tops",          assetTypes: ["garment_mockup"],                                   weight: 0.9 },
  { tag: "polo_mockup",           normalizedTag: "polo_mockup",           category: "garment_type", subcategory: "tops",          assetTypes: ["garment_mockup"],                                   weight: 0.9 },
  { tag: "uniform_mockup",        normalizedTag: "uniform_mockup",        category: "garment_type", subcategory: "workwear",      assetTypes: ["garment_mockup"],                                   weight: 0.95 },
  { tag: "flatlay",               normalizedTag: "flatlay",               category: "shot_type",    subcategory: "mockup",        assetTypes: ["garment_mockup", "packaging_asset"],                weight: 0.85 },
  { tag: "ghost_mannequin",       normalizedTag: "ghost_mannequin",       category: "shot_type",    subcategory: "mockup",        assetTypes: ["garment_mockup"],                                   weight: 0.85 },
  { tag: "on_model",              normalizedTag: "on_model",              category: "shot_type",    subcategory: "mockup",        assetTypes: ["garment_mockup"],                                   weight: 0.8 },

  // ── Packaging Asset ──
  { tag: "box_mockup",            normalizedTag: "box_mockup",            category: "packaging_type", subcategory: "rigid",       assetTypes: ["packaging_asset"],                                  weight: 0.95 },
  { tag: "pouch_mockup",          normalizedTag: "pouch_mockup",          category: "packaging_type", subcategory: "flexible",    assetTypes: ["packaging_asset"],                                  weight: 0.9 },
  { tag: "bottle_mockup",         normalizedTag: "bottle_mockup",         category: "packaging_type", subcategory: "rigid",       assetTypes: ["packaging_asset"],                                  weight: 0.9 },
  { tag: "label_design",          normalizedTag: "label_design",          category: "packaging_type", subcategory: "label",       assetTypes: ["packaging_asset"],                                  weight: 0.9 },
  { tag: "dieline",               normalizedTag: "dieline",               category: "packaging_type", subcategory: "technical",   assetTypes: ["packaging_asset"],                                  weight: 0.95 },
  { tag: "shelf_ready",           normalizedTag: "shelf_ready",           category: "usage",          subcategory: "retail",      assetTypes: ["packaging_asset"],                                  weight: 0.85 },
  { tag: "eco_packaging",         normalizedTag: "eco_packaging",         category: "attribute",      subcategory: "sustainability", assetTypes: ["packaging_asset"],                              weight: 0.8 },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getKnowledgeTagsForAssetType(assetType: AssetTypeV2): KnowledgeTag[] {
  return KNOWLEDGE_TAG_TAXONOMY.filter((kt) => kt.assetTypes.includes(assetType));
}

export function inferAssetTypeFromTags(tags: string[], mimeType: string | null, fileName: string): AssetTypeV2 {
  const lower = (tags.join(" ") + " " + fileName).toLowerCase();
  const mime  = (mimeType ?? "").toLowerCase();

  // Vector check first (unambiguous)
  if (mime.includes("svg") || fileName.toLowerCase().endsWith(".svg")) return "svg";

  // Domain-specific keywords take priority over file-format fallbacks
  if (lower.includes("batik") || lower.includes("tenun") || lower.includes("motif") || lower.includes("pattern") || lower.includes("fabric")) return "fashion_motif";
  if (lower.includes("mockup") || lower.includes("garment") || lower.includes("t_shirt") || lower.includes("hoodie") || lower.includes("uniform")) return "garment_mockup";
  if (lower.includes("packaging") || lower.includes("kemasan") || lower.includes("dieline") || lower.includes("pouch_mockup") || lower.includes("box_mockup")) return "packaging_asset";
  if (lower.includes("furniture") || lower.includes("sofa") || lower.includes("chair") || lower.includes("kursi") || lower.includes("meja")) return "furniture_image";
  if (lower.includes("interior") || lower.includes("wallpaper") || lower.includes("flooring") || lower.includes("tile_pattern") || lower.includes("paint_swatch")) return "interior_material";
  if (lower.includes("texture") || lower.includes("material_type")) return "interior_material";
  if (lower.includes("illustration") || lower.includes("ilustrasi") || lower.includes("vector_art") || lower.includes("drawing")) return "illustration";
  if (lower.includes("infographic") || lower.includes("banner") || lower.includes("flyer") || lower.includes("poster") || lower.includes("icon_set")) return "graphic";

  // Format fallbacks (after domain keywords)
  if (mime.includes("pdf") || lower.includes("document") || lower.includes("company_profile") || lower.includes("catalog") || lower.includes("proposal")) return "document";
  if (fileName.toLowerCase().match(/\.(pdf|docx?|pptx?|xlsx?)$/)) return "document";

  // Default: photo
  return "photo";
}

export function matchKnowledgeTags(
  existingTags: string[],
  assetType: AssetTypeV2,
  fileName: string,
): string[] {
  const vocabulary = getKnowledgeTagsForAssetType(assetType);
  const tagText = (existingTags.join(" ") + " " + fileName).toLowerCase();

  const matched: string[] = [];
  for (const kt of vocabulary) {
    const patterns = [kt.normalizedTag, kt.tag, ...kt.tag.split("_")];
    const hits = patterns.filter((p) => p.length >= 3 && tagText.includes(p));
    if (hits.length > 0) matched.push(kt.normalizedTag);
  }
  return [...new Set(matched)].slice(0, 10);
}
