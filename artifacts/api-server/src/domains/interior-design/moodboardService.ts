import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import {
  MOODBOARD_MAX_ITEMS,
  MOODBOARD_MAX_SECTIONS,
  moodboardResultSchema,
  type MoodboardFurnitureItem,
  type MoodboardImageItem,
  type MoodboardMaterialItem,
  type MoodboardResult,
  type MoodboardSection,
} from "./moodboardSchemas.js";

const ALGORITHM_VERSION = "wp08.v1";

type JsonRecord = Record<string, unknown>;
type ProjectRow = {
  project_id: string;
  title: string;
  style_preference: string | null;
  color_preference: string | null;
  notes: string | null;
  result: unknown;
};
type DraftRow = {
  project_uuid: string;
  review_state: string;
  materials_draft: unknown;
  furniture_draft: unknown;
  lighting_draft: unknown;
  space_plan_draft: unknown;
  approved_materials: unknown;
  approved_furniture: unknown;
  approved_lighting: unknown;
  approved_space_plan: unknown;
};
type MaterialRow = {
  id: number;
  material_code: string;
  name: string;
  category: string;
  color: string | null;
  finish: string | null;
  texture: string | null;
  thumbnail_url: string | null;
};
type FurnitureRow = {
  id: string;
  code: string;
  name: string;
  furniture_type: string | null;
  style: string | null;
  primary_materials: string[];
  colors: string[];
  thumbnail_url: string | null;
};
type ImageRow = {
  id: number;
  item_type: string;
  item_id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  image_alt: string | null;
  image_source: string | null;
};
type AssetRow = {
  id: number;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  ai_explanation: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, max);
}

function draftItems(value: unknown): JsonRecord[] {
  const record = asRecord(value);
  const items = Array.isArray(record["items"]) ? record["items"] : Array.isArray(value) ? value : [];
  return items.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function canonicalItemId(item: JsonRecord, index: number, prefix: string): string {
  return (
    asString(item["libraryMaterialId"]) ??
    asString(item["materialCode"]) ??
    asString(item["code"]) ??
    asString(item["productCode"]) ??
    asString(item["libraryFurnitureId"]) ??
    asString(item["furnitureCode"]) ??
    asString(item["code"]) ??
    asString(item["id"]) ??
    `${prefix}-${index + 1}`
  ).slice(0, 160);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonRecord)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function styleMoodWords(style: string): string[] {
  const words: Record<string, string[]> = {
    modern: ["clean", "precise", "refined", "functional"],
    minimalist: ["calm", "quiet", "uncluttered", "intentional"],
    scandinavian: ["light", "natural", "warm", "cosy"],
    industrial: ["raw", "textural", "urban", "bold"],
    japandi: ["tranquil", "natural", "balanced", "mindful"],
    rustic: ["earthy", "organic", "grounded", "authentic"],
    traditional: ["timeless", "elegant", "warm", "symmetrical"],
  };
  return words[style.toLowerCase()] ?? ["considered", "balanced", "functional", "refined"];
}

function paletteFromBrief(style: string, colorPreference: string | null): { colors: string[]; source: "brief" | "style_default" } {
  const colors = unique((colorPreference ?? "").split(/[,;|]/g)).slice(0, 8);
  if (colors.length > 0) return { colors, source: "brief" };
  const defaults: Record<string, string[]> = {
    scandinavian: ["#F5F1E8", "#E3D7C6", "#B8A58C", "#6F7A70"],
    industrial: ["#242424", "#57534E", "#A8A29E", "#C47F52"],
    japandi: ["#EEE7DC", "#D1C4B4", "#9C958B", "#4E514C"],
    minimalist: ["#FAFAF9", "#E7E5E4", "#A8A29E", "#44403C"],
    rustic: ["#EFE5D2", "#B68B63", "#6B4F3A", "#4A4036"],
  };
  return { colors: defaults[style.toLowerCase()] ?? ["#F5F5F0", "#E8E0D5", "#C4B5A0", "#3D3530"], source: "style_default" };
}

function urlOrNull(value: unknown): string | null {
  const candidate = asString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractExistingMoodboard(result: unknown, projectUuid: string): MoodboardResult | null {
  const moodboard = asRecord(result)["moodboard"];
  const record = asRecord(moodboard);
  const legacyCompatible = {
    ...record,
    moodboardId: record["moodboardId"] ?? `moodboard-${projectUuid}`,
    style: record["style"] ?? asRecord(record["palette"])["style"] ?? "balanced",
    colorPalette: record["colorPalette"] ?? asRecord(record["palette"])["colors"] ?? [],
    referenceImages: record["referenceImages"] ?? record["images"] ?? [],
    status: record["status"] ?? "ready",
  };
  const parsed = moodboardResultSchema.safeParse(legacyCompatible);
  return parsed.success ? parsed.data : null;
}

async function readProject(projectUuid: string): Promise<ProjectRow | null> {
  const result = await pool.query<ProjectRow>(
    `SELECT project_id, title, style_preference, color_preference, notes, result
       FROM ai_platform.creative_projects
      WHERE project_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [projectUuid],
  );
  return result.rows[0] ?? null;
}

async function readDraft(projectUuid: string): Promise<DraftRow | null> {
  const result = await pool.query<DraftRow>(
    `SELECT project_uuid, review_state, materials_draft, furniture_draft,
            lighting_draft, space_plan_draft, approved_materials,
            approved_furniture, approved_lighting, approved_space_plan
       FROM ai_platform.id_concept_drafts
      WHERE project_uuid = $1
      LIMIT 1`,
    [projectUuid],
  );
  return result.rows[0] ?? null;
}

async function readCanonicalMaterials(ids: string[]): Promise<MaterialRow[]> {
  if (ids.length === 0) return [];
  const result = await pool.query<MaterialRow>(
    `SELECT id, material_code, name, category, color, finish, texture, thumbnail_url
       FROM ai_platform.materials
      WHERE status = 'active'
        AND (material_code = ANY($1::text[]) OR id::text = ANY($1::text[]))
      ORDER BY material_code ASC, id ASC
      LIMIT $2`,
    [ids, MOODBOARD_MAX_ITEMS],
  );
  return result.rows;
}

async function readCanonicalFurniture(ids: string[]): Promise<FurnitureRow[]> {
  if (ids.length === 0) return [];
  const result = await pool.query<FurnitureRow>(
    `SELECT id, code, name, furniture_type, style, primary_materials, colors, thumbnail_url
       FROM ai_platform.furniture_items
      WHERE status = 'published' AND deleted_at IS NULL
        AND (id::text = ANY($1::text[]) OR code = ANY($1::text[]))
      ORDER BY code ASC, id ASC
      LIMIT $2`,
    [ids, MOODBOARD_MAX_ITEMS],
  );
  return result.rows;
}

async function readImages(projectUuid: string): Promise<ImageRow[]> {
  const result = await pool.query<ImageRow>(
    `SELECT id, item_type, item_id, image_url, thumbnail_url, image_alt, image_source
       FROM ai_platform.id_interior_asset_images
      WHERE project_uuid = $1
        AND COALESCE(image_url, thumbnail_url) IS NOT NULL
      ORDER BY item_type ASC, item_id ASC, id ASC
      LIMIT $2`,
    [projectUuid, MOODBOARD_MAX_ITEMS],
  );
  return result.rows;
}

async function readCreativeAssets(projectUuid: string): Promise<AssetRow[]> {
  const result = await pool.query<AssetRow>(
    `SELECT id, image_url, thumbnail_url, category, ai_explanation
       FROM ai_platform.creative_ai_assets
      WHERE project_id = $1
        AND status IN ('completed', 'approved')
        AND COALESCE(image_url, thumbnail_url) IS NOT NULL
      ORDER BY id ASC
      LIMIT $2`,
    [projectUuid, MOODBOARD_MAX_ITEMS],
  );
  return result.rows;
}

function makeSections(
  materials: MoodboardMaterialItem[],
  furniture: MoodboardFurnitureItem[],
  images: MoodboardImageItem[],
  style: string,
): MoodboardSection[] {
  const sections: MoodboardSection[] = [
    {
      id: "palette",
      title: "Palette & Direction",
      description: `A ${style} direction anchored by the selected palette and tactile references.`,
      itemIds: [],
      imageIds: images.filter((image) => image.role === "concept").map((image) => image.id),
    },
    {
      id: "materials",
      title: "Materials & Texture",
      description: "Canonical material references for the finish and texture language.",
      itemIds: materials.map((item) => item.id),
      imageIds: images.filter((image) => image.role === "material").map((image) => image.id),
    },
    {
      id: "furniture",
      title: "Furniture & Objects",
      description: "Furniture references selected from the canonical library without changing placement.",
      itemIds: furniture.map((item) => item.id),
      imageIds: images.filter((image) => image.role === "furniture").map((image) => image.id),
    },
    {
      id: "lighting",
      title: "Lighting & Atmosphere",
      description: "Lighting and atmosphere references from the approved concept.",
      itemIds: [],
      imageIds: images.filter((image) => image.role === "lighting" || image.role === "space_plan").map((image) => image.id),
    },
  ];
  return sections.slice(0, MOODBOARD_MAX_SECTIONS);
}

export async function getMoodboard(projectUuid: string): Promise<MoodboardResult | null> {
  const project = await readProject(projectUuid);
  if (!project) {
    throw Object.assign(new Error("Creative project not found"), { status: 404, code: "PROJECT_NOT_FOUND" });
  }
  return extractExistingMoodboard(project.result, projectUuid);
}

export async function generateMoodboard(
  projectUuid: string,
  options: { force?: boolean } = {},
): Promise<{ moodboard: MoodboardResult; reused: boolean }> {
  const project = await readProject(projectUuid);
  if (!project) {
    throw Object.assign(new Error("Creative project not found"), { status: 404, code: "PROJECT_NOT_FOUND" });
  }

  const existing = extractExistingMoodboard(project.result, projectUuid);
  if (existing && !options.force) return { moodboard: existing, reused: true };

  const draft = await readDraft(projectUuid);
  // Approved snapshots are immutable and must remain the source for a
  // moodboard after approval. Before approval, use the editable draft.
  const snapshot = draft?.review_state === "approved_for_rendering";
  const materialDraftItems = draftItems(snapshot ? draft?.approved_materials : draft?.materials_draft);
  const furnitureDraftItems = draftItems(snapshot ? draft?.approved_furniture : draft?.furniture_draft);
  const lightingDraftItems = draftItems(snapshot ? draft?.approved_lighting : draft?.lighting_draft);
  const spacePlanItems = draftItems(snapshot ? draft?.approved_space_plan : draft?.space_plan_draft);
  const materialIds = unique(materialDraftItems.map((item, index) => canonicalItemId(item, index, "material"))).slice(0, MOODBOARD_MAX_ITEMS);
  const furnitureIds = unique(furnitureDraftItems.map((item, index) => canonicalItemId(item, index, "furniture"))).slice(0, MOODBOARD_MAX_ITEMS);
  const [canonicalMaterials, canonicalFurniture, images, creativeAssets] = await Promise.all([
    readCanonicalMaterials(materialIds),
    readCanonicalFurniture(furnitureIds),
    readImages(projectUuid),
    readCreativeAssets(projectUuid),
  ]);

  const materialByKey = new Map(canonicalMaterials.flatMap((row) => [[row.material_code, row], [String(row.id), row]]));
  const furnitureByKey = new Map(canonicalFurniture.flatMap((row) => [[row.code, row], [row.id, row]]));
  const warnings: string[] = [];

  const materials: MoodboardMaterialItem[] = materialDraftItems.slice(0, MOODBOARD_MAX_ITEMS).map((item, index) => {
    const id = canonicalItemId(item, index, "material");
    const canonical = materialByKey.get(id);
    if (!canonical) warnings.push(`Material reference "${id}" is not available in the active canonical library.`);
    return {
      id,
      name: canonical?.name ?? asString(item["name"]) ?? asString(item["materialType"]) ?? `Material ${index + 1}`,
      category: canonical?.category ?? asString(item["category"]),
      color: canonical?.color ?? asString(item["color"]),
      finish: canonical?.finish ?? asString(item["finish"]),
      texture: canonical?.texture ?? asString(item["texture"]),
      thumbnailUrl: urlOrNull(canonical?.thumbnail_url ?? item["thumbnailUrl"]),
      source: canonical ? "material_library" : "concept_draft",
    };
  }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);

  const furniture: MoodboardFurnitureItem[] = furnitureDraftItems.slice(0, MOODBOARD_MAX_ITEMS).map((item, index) => {
    const id = canonicalItemId(item, index, "furniture");
    const canonical = furnitureByKey.get(id);
    if (!canonical) warnings.push(`Furniture reference "${id}" is not available in the published canonical library.`);
    return {
      id,
      name: canonical?.name ?? asString(item["item"]) ?? asString(item["name"]) ?? `Furniture ${index + 1}`,
      type: canonical?.furniture_type ?? asString(item["type"]) ?? asString(item["furnitureType"]),
      style: canonical?.style ?? asString(item["style"]),
      materials: canonical?.primary_materials ?? asStringArray(item["materials"]),
      colors: canonical?.colors ?? asStringArray(item["colors"]),
      thumbnailUrl: urlOrNull(canonical?.thumbnail_url ?? item["thumbnailUrl"]),
      source: canonical ? "furniture_library" : "concept_draft",
    };
  }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);

  const moodboardImages: MoodboardImageItem[] = images.flatMap((row): MoodboardImageItem[] => {
    const url = urlOrNull(row.image_url ?? row.thumbnail_url);
    if (!url) return [];
    const role = (["material", "furniture", "lighting", "space_plan"].includes(row.item_type) ? row.item_type : "concept") as MoodboardImageItem["role"];
    return [{
      id: `interior-image-${row.id}`,
      role,
      url,
      thumbnailUrl: urlOrNull(row.thumbnail_url),
      alt: row.image_alt ?? `${role} reference`,
      source: row.image_source ?? "interior-assets",
      sourceItemId: row.item_id,
    }];
  });
  for (const asset of creativeAssets) {
    const url = urlOrNull(asset.image_url ?? asset.thumbnail_url);
    if (!url) continue;
    moodboardImages.push({
      id: `creative-asset-${asset.id}`,
      role: "concept",
      url,
      thumbnailUrl: urlOrNull(asset.thumbnail_url),
      alt: asset.ai_explanation ?? "Creative concept reference",
      source: "creative-ai-assets",
      sourceItemId: null,
    });
  }
  const cappedImages = moodboardImages
    .filter((image, index, items) => items.findIndex((candidate) => candidate.url === image.url) === index)
    .slice(0, MOODBOARD_MAX_ITEMS);
  const truncated = materialDraftItems.length > MOODBOARD_MAX_ITEMS ||
    furnitureDraftItems.length > MOODBOARD_MAX_ITEMS ||
    moodboardImages.length > MOODBOARD_MAX_ITEMS ||
    spacePlanItems.length > MOODBOARD_MAX_SECTIONS;
  if (truncated) warnings.push("Some references were capped to keep the moodboard responsive.");
  if (!draft) warnings.push("No editable concept draft was found; the moodboard uses project-level brief data only.");
  if (lightingDraftItems.length === 0) warnings.push("No lighting references were found in the concept draft.");
  if (materials.length === 0) warnings.push("No material references were found in the concept draft.");
  if (furniture.length === 0) warnings.push("No furniture references were found in the concept draft.");

  const style = asString(project.style_preference) ?? "balanced";
  const palette = paletteFromBrief(style, project.color_preference);
  const moodboardId = `moodboard-${projectUuid}`;
  const sourcePayload = {
    project: { title: project.title, style: project.style_preference, colors: project.color_preference, notes: project.notes },
    draft,
    materials,
    furniture,
    images: cappedImages,
  };
  const moodboard: MoodboardResult = {
    schemaVersion: "wp08.v1",
    moodboardId,
    projectUuid,
    title: project.title,
    roomType: "interior",
    style,
    colorPalette: palette.colors,
    palette: {
      colors: palette.colors,
      moodWords: styleMoodWords(style),
      style,
      source: palette.source,
    },
    materials,
    furniture,
    images: cappedImages,
    referenceImages: cappedImages,
    sections: makeSections(materials, furniture, cappedImages, style),
    warnings: unique(warnings).slice(0, 40),
    status: "ready",
    metadata: {
      algorithmVersion: ALGORITHM_VERSION,
      sourceFingerprint: fingerprint(sourcePayload),
      resourceCounts: {
        materials: materials.length,
        furniture: furniture.length,
        images: cappedImages.length,
        sections: 4,
      },
      truncated,
    },
  };
  const parsed = moodboardResultSchema.parse(moodboard);

  await pool.query(
    `UPDATE ai_platform.creative_projects
        SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{moodboard}', $2::jsonb, true),
            updated_at = NOW()
      WHERE project_id = $1 AND deleted_at IS NULL`,
    [projectUuid, JSON.stringify(parsed)],
  );
  return { moodboard: parsed, reused: false };
}