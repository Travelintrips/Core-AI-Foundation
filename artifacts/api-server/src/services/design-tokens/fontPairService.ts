// Team 10 — Font Pair & Typography Role Service

import { db } from "@workspace/db";
import { eq, and, sql, ilike } from "drizzle-orm";
import slugify from "slugify";
import { dtFontPairsTable, dtTypographyRolesTable } from "./schema.js";
import {
  validateTypographyHierarchy,
  paletteSignature,
} from "./colorUtils.js";
import type {
  FontPairRow,
  TypographyRoleRow,
  CreateFontPairInput,
  UpsertTypographyRoleInput,
  FontCategory,
  FontMood,
  Industry,
} from "./types.js";

function makeSlug(name: string): string {
  return slugify(name, { lower: true, strict: true });
}

function fontSignature(displayFont: string, bodyFont: string): string {
  return [displayFont, bodyFont]
    .map((f) => f.toLowerCase().replace(/\s+/g, ""))
    .sort()
    .join("|");
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listFontPairs(filters?: {
  category?: FontCategory;
  mood?: FontMood;
  industry?: Industry;
  search?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<FontPairRow[]> {
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  let query = db.select().from(dtFontPairsTable).$dynamic();

  if (filters?.activeOnly !== false) {
    query = query.where(eq(dtFontPairsTable.active, true));
  }
  if (filters?.category) {
    query = query.where(eq(dtFontPairsTable.category, filters.category));
  }
  if (filters?.search) {
    query = query.where(
      ilike(dtFontPairsTable.name, `%${filters.search}%`)
    );
  }
  if (filters?.mood) {
    query = query.where(
      sql`${dtFontPairsTable.mood} @> ${JSON.stringify([filters.mood])}::jsonb`
    );
  }
  if (filters?.industry) {
    query = query.where(
      sql`${dtFontPairsTable.industries} @> ${JSON.stringify([filters.industry])}::jsonb`
    );
  }

  const rows = await query.limit(limit).offset(offset);
  return rows as unknown as FontPairRow[];
}

export async function getFontPair(id: number): Promise<FontPairRow | null> {
  const [row] = await db
    .select()
    .from(dtFontPairsTable)
    .where(eq(dtFontPairsTable.id, id))
    .limit(1);
  return (row as unknown as FontPairRow) ?? null;
}

export async function getFontPairBySlug(slug: string): Promise<FontPairRow | null> {
  const [row] = await db
    .select()
    .from(dtFontPairsTable)
    .where(eq(dtFontPairsTable.slug, slug))
    .limit(1);
  return (row as unknown as FontPairRow) ?? null;
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

export async function findDuplicateFontPair(
  displayFont: string,
  bodyFont: string,
  excludeId?: number
): Promise<FontPairRow | null> {
  const sig = fontSignature(displayFont, bodyFont);

  // Pull all active pairs and check by signature (small table — acceptable)
  const rows = await db
    .select()
    .from(dtFontPairsTable)
    .where(eq(dtFontPairsTable.active, true));

  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const r = row as unknown as FontPairRow;
    if (fontSignature(r.displayFont, r.bodyFont) === sig) return r;
  }
  return null;
}

// ── Create / Update ───────────────────────────────────────────────────────────

export async function createFontPair(
  input: CreateFontPairInput
): Promise<FontPairRow> {
  const duplicate = await findDuplicateFontPair(input.displayFont, input.bodyFont);
  if (duplicate) {
    throw Object.assign(new Error("Duplicate font pair already exists"), {
      code: "DUPLICATE",
      existingId: duplicate.id,
    });
  }

  const slug = makeSlug(input.name);
  const [row] = await db
    .insert(dtFontPairsTable)
    .values({
      name: input.name,
      slug,
      displayFont: input.displayFont,
      bodyFont: input.bodyFont,
      accentFont: input.accentFont ?? null,
      category: input.category,
      mood: input.mood,
      industries: input.industries,
      displayFontWeight: input.displayFontWeight ?? "700",
      bodyFontWeight: input.bodyFontWeight ?? "400",
      license: input.license ?? "open",
      pairingRationale: input.pairingRationale ?? null,
      sampleHeading: input.sampleHeading ?? "The quick brown fox",
      sampleBody: input.sampleBody ?? "Typography is the art of arranging type to make written language legible.",
      googleFontsUrl: input.googleFontsUrl ?? null,
    })
    .returning();
  return row as unknown as FontPairRow;
}

export async function updateFontPair(
  id: number,
  patch: Partial<CreateFontPairInput>
): Promise<FontPairRow> {
  if (patch.displayFont || patch.bodyFont) {
    const current = await getFontPair(id);
    if (!current) throw new Error("Font pair not found");
    const dup = await findDuplicateFontPair(
      patch.displayFont ?? current.displayFont,
      patch.bodyFont ?? current.bodyFont,
      id
    );
    if (dup) {
      throw Object.assign(new Error("Duplicate font pair already exists"), {
        code: "DUPLICATE",
        existingId: dup.id,
      });
    }
  }

  const [row] = await db
    .update(dtFontPairsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(dtFontPairsTable.id, id))
    .returning();
  if (!row) throw new Error("Font pair not found");
  return row as unknown as FontPairRow;
}

export async function deactivateFontPair(id: number): Promise<void> {
  const result = await db
    .update(dtFontPairsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(dtFontPairsTable.id, id))
    .returning({ id: dtFontPairsTable.id });
  if (!result.length) throw new Error("Font pair not found");
}

// ── Typography Roles ──────────────────────────────────────────────────────────

export async function getTypographyRoles(
  pairId: number
): Promise<TypographyRoleRow[]> {
  const rows = await db
    .select()
    .from(dtTypographyRolesTable)
    .where(eq(dtTypographyRolesTable.pairId, pairId));
  return rows as unknown as TypographyRoleRow[];
}

export async function upsertTypographyRoles(
  pairId: number,
  roles: UpsertTypographyRoleInput[]
): Promise<{ errors: string[]; roles: TypographyRoleRow[] }> {
  // Validate hierarchy
  const hierarchyErrors = validateTypographyHierarchy(
    roles.map((r) => ({ role: r.role, fontSize: r.fontSize }))
  );
  if (hierarchyErrors.length > 0) {
    return {
      errors: hierarchyErrors.map((e) => e.message),
      roles: [],
    };
  }

  // Verify pair exists
  const pair = await getFontPair(pairId);
  if (!pair) throw new Error("Font pair not found");

  const inserted: TypographyRoleRow[] = [];
  for (const role of roles) {
    const [row] = await db
      .insert(dtTypographyRolesTable)
      .values({
        pairId,
        role: role.role,
        fontFamily: role.fontFamily,
        fontSize: String(role.fontSize),
        fontWeight: role.fontWeight,
        lineHeight: String(role.lineHeight),
        letterSpacing: String(role.letterSpacing),
        textTransform: role.textTransform ?? null,
      })
      .onConflictDoUpdate({
        target: [dtTypographyRolesTable.pairId, dtTypographyRolesTable.role],
        set: {
          fontFamily: role.fontFamily,
          fontSize: String(role.fontSize),
          fontWeight: role.fontWeight,
          lineHeight: String(role.lineHeight),
          letterSpacing: String(role.letterSpacing),
          textTransform: role.textTransform ?? null,
        },
      })
      .returning();
    inserted.push(row as unknown as TypographyRoleRow);
  }

  return { errors: [], roles: inserted };
}

export async function deleteTypographyRole(
  pairId: number,
  role: string
): Promise<void> {
  await db
    .delete(dtTypographyRolesTable)
    .where(
      and(
        eq(dtTypographyRolesTable.pairId, pairId),
        eq(dtTypographyRolesTable.role, role)
      )
    );
}

// ── Full Pair with Roles ───────────────────────────────────────────────────────

export async function getFontPairWithRoles(
  id: number
): Promise<(FontPairRow & { typographyRoles: TypographyRoleRow[] }) | null> {
  const pair = await getFontPair(id);
  if (!pair) return null;
  const typographyRoles = await getTypographyRoles(id);
  return { ...pair, typographyRoles };
}
