// Team 10 — Color Palette & Semantic Color Role Service

import { db } from "@workspace/db";
import { eq, sql, ilike } from "drizzle-orm";
import { dtColorPalettesTable, dtSemanticColorRolesTable } from "./schema.js";
import {
  checkContrast,
  hexToHsl,
  hexToRgb,
  hexToCmyk,
  formatCmyk,
  isPrintSafe,
  toPrintSafeHex,
  paletteSignature,
  normalizeHex,
} from "./colorUtils.js";
import type {
  ColorPaletteRow,
  SemanticColorRoleRow,
  CreateColorPaletteInput,
  UpsertSemanticRoleInput,
  WcagLevel,
  FontMood,
  Industry,
  PaletteStyle,
} from "./types.js";

// P0: no external slugify dependency — local implementation avoids touching pnpm-lock.yaml
function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function deriveWcagLevel(roles: UpsertSemanticRoleInput[]): WcagLevel {
  if (roles.length === 0) return "fail";
  // Check text roles against background
  const textRoles = roles.filter((r) =>
    ["textPrimary", "textSecondary"].includes(r.role)
  );
  const bgRole = roles.find((r) => r.role === "background");
  if (!textRoles.length || !bgRole) return "fail";

  let lowestLevel: WcagLevel = "AAA";
  for (const t of textRoles) {
    const { ratio } = checkContrast(t.hexColor, bgRole.hexColor);
    const level: WcagLevel = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "fail";
    if (level === "fail") return "fail";
    if (level === "AA" && lowestLevel === "AAA") lowestLevel = "AA";
  }
  return lowestLevel;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listColorPalettes(filters?: {
  style?: PaletteStyle;
  mood?: FontMood;
  industry?: Industry;
  accessible?: boolean;
  printSafe?: boolean;
  wcagLevel?: WcagLevel;
  search?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ColorPaletteRow[]> {
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  let query = db.select().from(dtColorPalettesTable).$dynamic();

  if (filters?.activeOnly !== false) {
    query = query.where(eq(dtColorPalettesTable.active, true));
  }
  if (filters?.style) {
    query = query.where(eq(dtColorPalettesTable.style, filters.style));
  }
  if (filters?.accessible === true) {
    query = query.where(eq(dtColorPalettesTable.accessible, true));
  }
  if (filters?.printSafe === true) {
    query = query.where(eq(dtColorPalettesTable.printSafe, true));
  }
  if (filters?.wcagLevel) {
    query = query.where(eq(dtColorPalettesTable.wcagLevel, filters.wcagLevel));
  }
  if (filters?.search) {
    query = query.where(ilike(dtColorPalettesTable.name, `%${filters.search}%`));
  }
  if (filters?.mood) {
    query = query.where(
      sql`${dtColorPalettesTable.mood} @> ${JSON.stringify([filters.mood])}::jsonb`
    );
  }
  if (filters?.industry) {
    query = query.where(
      sql`${dtColorPalettesTable.industries} @> ${JSON.stringify([filters.industry])}::jsonb`
    );
  }

  const rows = await query.limit(limit).offset(offset);
  return rows as unknown as ColorPaletteRow[];
}

export async function getColorPalette(id: number): Promise<ColorPaletteRow | null> {
  const [row] = await db
    .select()
    .from(dtColorPalettesTable)
    .where(eq(dtColorPalettesTable.id, id))
    .limit(1);
  return (row as unknown as ColorPaletteRow) ?? null;
}

export async function getColorPaletteBySlug(
  slug: string
): Promise<ColorPaletteRow | null> {
  const [row] = await db
    .select()
    .from(dtColorPalettesTable)
    .where(eq(dtColorPalettesTable.slug, slug))
    .limit(1);
  return (row as unknown as ColorPaletteRow) ?? null;
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

export async function findDuplicatePalette(
  colors: string[],
  excludeId?: number
): Promise<ColorPaletteRow | null> {
  const sig = paletteSignature(colors);
  const rows = await db
    .select()
    .from(dtColorPalettesTable)
    .where(eq(dtColorPalettesTable.active, true));

  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const r = row as unknown as ColorPaletteRow;
    if (paletteSignature(r.colors) === sig) return r;
  }
  return null;
}

// ── Create / Update ───────────────────────────────────────────────────────────

export async function createColorPalette(
  input: CreateColorPaletteInput
): Promise<ColorPaletteRow> {
  const duplicate = await findDuplicatePalette(input.colors);
  if (duplicate) {
    throw Object.assign(new Error("Duplicate palette with same colours already exists"), {
      code: "DUPLICATE",
      existingId: duplicate.id,
    });
  }

  const normalised = input.colors.map(normalizeHex);
  const slug = makeSlug(input.name);

  const [row] = await db
    .insert(dtColorPalettesTable)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      style: input.style,
      mood: input.mood,
      industries: input.industries,
      colors: normalised,
      printSafe: normalised.every(isPrintSafe),
      accessible: false, // updated after semantic roles are set
      wcagLevel: "fail",
      tags: input.tags ?? [],
    })
    .returning();
  return row as unknown as ColorPaletteRow;
}

export async function updateColorPalette(
  id: number,
  patch: Partial<CreateColorPaletteInput>
): Promise<ColorPaletteRow> {
  if (patch.colors) {
    const dup = await findDuplicatePalette(patch.colors, id);
    if (dup) {
      throw Object.assign(new Error("Duplicate palette with same colours already exists"), {
        code: "DUPLICATE",
        existingId: dup.id,
      });
    }
    patch.colors = patch.colors.map(normalizeHex);
  }

  const [row] = await db
    .update(dtColorPalettesTable)
    .set({
      ...patch,
      ...(patch.colors ? { printSafe: patch.colors.every(isPrintSafe) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(dtColorPalettesTable.id, id))
    .returning();
  if (!row) throw new Error("Color palette not found");
  return row as unknown as ColorPaletteRow;
}

export async function deactivateColorPalette(id: number): Promise<void> {
  const result = await db
    .update(dtColorPalettesTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(dtColorPalettesTable.id, id))
    .returning({ id: dtColorPalettesTable.id });
  if (!result.length) throw new Error("Color palette not found");
}

// ── Semantic Color Roles ──────────────────────────────────────────────────────

export async function getSemanticRoles(
  paletteId: number
): Promise<SemanticColorRoleRow[]> {
  const rows = await db
    .select()
    .from(dtSemanticColorRolesTable)
    .where(eq(dtSemanticColorRolesTable.paletteId, paletteId));
  return rows as unknown as SemanticColorRoleRow[];
}

export async function upsertSemanticRoles(
  paletteId: number,
  roles: UpsertSemanticRoleInput[]
): Promise<{ roles: SemanticColorRoleRow[]; wcagLevel: WcagLevel; accessible: boolean }> {
  const palette = await getColorPalette(paletteId);
  if (!palette) throw new Error("Color palette not found");

  const inserted: SemanticColorRoleRow[] = [];

  for (const role of roles) {
    const hex = normalizeHex(role.hexColor);
    const { r, g, b } = hexToRgb(hex);
    const hslColor = hexToHsl(hex);
    const rgbColor = `rgb(${r}, ${g}, ${b})`;
    const cmyk = hexToCmyk(hex);
    const cmykColor = formatCmyk(cmyk);
    const printSafeHex = toPrintSafeHex(hex);

    const contrastOnWhite = checkContrast(hex, "#ffffff");
    const contrastOnBlack = checkContrast(hex, "#000000");

    const [row] = await db
      .insert(dtSemanticColorRolesTable)
      .values({
        paletteId,
        role: role.role,
        hexColor: hex,
        hslColor,
        rgbColor,
        cmykColor,
        printSafeHex,
        contrastOnWhite: String(contrastOnWhite.ratio),
        contrastOnBlack: String(contrastOnBlack.ratio),
        wcagAAOnWhite: contrastOnWhite.wcagAA,
        wcagAAOnBlack: contrastOnBlack.wcagAA,
        wcagAAAOnWhite: contrastOnWhite.wcagAAA,
        wcagAAAOnBlack: contrastOnBlack.wcagAAA,
      })
      .onConflictDoUpdate({
        target: [dtSemanticColorRolesTable.paletteId, dtSemanticColorRolesTable.role],
        set: {
          hexColor: hex,
          hslColor,
          rgbColor,
          cmykColor,
          printSafeHex,
          contrastOnWhite: String(contrastOnWhite.ratio),
          contrastOnBlack: String(contrastOnBlack.ratio),
          wcagAAOnWhite: contrastOnWhite.wcagAA,
          wcagAAOnBlack: contrastOnBlack.wcagAA,
          wcagAAAOnWhite: contrastOnWhite.wcagAAA,
          wcagAAAOnBlack: contrastOnBlack.wcagAAA,
        },
      })
      .returning();
    inserted.push(row as unknown as SemanticColorRoleRow);
  }

  // Recompute palette-level accessibility flags
  const wcagLevel = deriveWcagLevel(roles);
  const accessible = wcagLevel !== "fail";
  await db
    .update(dtColorPalettesTable)
    .set({ wcagLevel, accessible, updatedAt: new Date() })
    .where(eq(dtColorPalettesTable.id, paletteId));

  return { roles: inserted, wcagLevel, accessible };
}

// ── Full Palette with Roles ───────────────────────────────────────────────────

export async function getColorPaletteWithRoles(
  id: number
): Promise<(ColorPaletteRow & { semanticRoles: SemanticColorRoleRow[] }) | null> {
  const palette = await getColorPalette(id);
  if (!palette) return null;
  const semanticRoles = await getSemanticRoles(id);
  return { ...palette, semanticRoles };
}
