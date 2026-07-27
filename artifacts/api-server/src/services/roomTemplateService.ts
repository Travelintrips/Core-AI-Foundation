/**
 * WP-01 — Room Template Library Service
 *
 * CRUD for room_templates, plus read-only catalog for room_types, room_styles,
 * room_themes, and layout_constraint_sets.
 *
 * Design rules:
 * - status transitions: draft → published (publish), published → archived (archive),
 *   archived → draft (restore)
 * - slug uniqueness is enforced at the DB level (UNIQUE index on slug)
 * - tenantId=null means platform-wide template visible to all
 * - Audit log is written for every mutation
 */

import { eq, and, isNull, or, desc, asc, sql, ilike, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  roomTemplatesTable,
  roomTypesTable,
  roomStylesTable,
  roomThemesTable,
  layoutConstraintSetsTable,
  type RoomTemplate,
  type InsertRoomTemplate,
  type RoomType,
  type RoomStyle,
  type RoomTheme,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeSlug(name: string): string {
  return `${slugify(name)}-${randomUUID().slice(0, 8)}`;
}

export class RoomTemplateServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "RoomTemplateServiceError";
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

// ── Room Templates ────────────────────────────────────────────────────────────

export interface ListRoomTemplatesOptions {
  roomTypeId?: string;
  status?: string;
  search?: string;
  sortBy?: "name" | "created_at" | "updated_at" | "status";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listRoomTemplates(opts: ListRoomTemplatesOptions = {}): Promise<{
  data: RoomTemplate[];
  pagination: PaginationMeta;
}> {
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const offset   = (page - 1) * pageSize;

  const conditions: ReturnType<typeof eq>[] = [];

  if (opts.roomTypeId) conditions.push(eq(roomTemplatesTable.roomTypeId, opts.roomTypeId));
  if (opts.status)     conditions.push(eq(roomTemplatesTable.status, opts.status));
  if (opts.search) {
    conditions.push(
      sql`(${roomTemplatesTable.name} ILIKE ${`%${opts.search}%`} OR ${roomTemplatesTable.description} ILIKE ${`%${opts.search}%`})`
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol = (() => {
    switch (opts.sortBy) {
      case "name":       return roomTemplatesTable.name;
      case "status":     return roomTemplatesTable.status;
      case "created_at": return roomTemplatesTable.createdAt;
      default:           return roomTemplatesTable.updatedAt;
    }
  })();
  const order = opts.sortDir === "asc" ? asc(orderCol) : desc(orderCol);

  const [rows, countRow] = await Promise.all([
    db.select().from(roomTemplatesTable)
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(roomTemplatesTable)
      .where(where),
  ]);

  const total = countRow[0]?.count ?? 0;
  return {
    data: rows,
    pagination: { total, page, pageSize, hasNext: offset + rows.length < total },
  };
}

export async function getRoomTemplate(id: string): Promise<RoomTemplate | null> {
  const [row] = await db
    .select()
    .from(roomTemplatesTable)
    .where(eq(roomTemplatesTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function getRoomTemplateBySlug(slug: string): Promise<RoomTemplate | null> {
  const [row] = await db
    .select()
    .from(roomTemplatesTable)
    .where(eq(roomTemplatesTable.slug, slug))
    .limit(1);
  return row ?? null;
}

export interface CreateRoomTemplateInput {
  name: string;
  slug?: string;
  description?: string;
  roomTypeId: string;
  styleId?: string | null;
  dimensions?: { widthCm: number; depthCm: number; heightCm: number };
  fixedElements?: unknown[];
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  tags?: string[];
  tenantId?: string | null;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export async function createRoomTemplate(input: CreateRoomTemplateInput): Promise<RoomTemplate> {
  const slug = input.slug ?? makeSlug(input.name);

  // Verify room type exists
  const [roomType] = await db
    .select({ id: roomTypesTable.id })
    .from(roomTypesTable)
    .where(eq(roomTypesTable.id, input.roomTypeId))
    .limit(1);
  if (!roomType) {
    throw new RoomTemplateServiceError("Room type not found", "ROOM_TYPE_NOT_FOUND", 400);
  }

  // Verify style exists if provided
  if (input.styleId) {
    const [style] = await db
      .select({ id: roomStylesTable.id })
      .from(roomStylesTable)
      .where(eq(roomStylesTable.id, input.styleId))
      .limit(1);
    if (!style) {
      throw new RoomTemplateServiceError("Room style not found", "ROOM_STYLE_NOT_FOUND", 400);
    }
  }

  const [template] = await db
    .insert(roomTemplatesTable)
    .values({
      name:            input.name,
      slug,
      description:     input.description ?? null,
      roomTypeId:      input.roomTypeId,
      styleId:         input.styleId ?? null,
      dimensions:      input.dimensions ?? { widthCm: 400, depthCm: 500, heightCm: 270 },
      fixedElements:   input.fixedElements ?? [],
      previewImageUrl: input.previewImageUrl ?? null,
      thumbnailUrl:    input.thumbnailUrl ?? null,
      tags:            input.tags ?? [],
      tenantId:        input.tenantId ?? null,
      createdBy:       input.createdBy ?? "admin",
      metadata:        input.metadata ?? {},
      status:          "draft",
      version:         1,
    } satisfies InsertRoomTemplate)
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_created",
    resourceType: "room_template",
    resourceId: template!.id,
    status: "success",
    details: { name: input.name, slug },
  });

  return template!;
}

export interface UpdateRoomTemplateInput {
  name?: string;
  description?: string | null;
  styleId?: string | null;
  dimensions?: { widthCm: number; depthCm: number; heightCm: number };
  fixedElements?: unknown[];
  previewImageUrl?: string | null;
  thumbnailUrl?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export async function updateRoomTemplate(id: string, input: UpdateRoomTemplateInput): Promise<RoomTemplate> {
  const existing = await getRoomTemplate(id);
  if (!existing) {
    throw new RoomTemplateServiceError("Room template not found", "NOT_FOUND", 404);
  }
  if (existing.status === "archived") {
    throw new RoomTemplateServiceError("Cannot edit an archived template. Restore it first.", "TEMPLATE_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(roomTemplatesTable)
    .set({
      ...(input.name           !== undefined && { name: input.name }),
      ...(input.description    !== undefined && { description: input.description }),
      ...(input.styleId        !== undefined && { styleId: input.styleId }),
      ...(input.dimensions     !== undefined && { dimensions: input.dimensions }),
      ...(input.fixedElements  !== undefined && { fixedElements: input.fixedElements }),
      ...(input.previewImageUrl !== undefined && { previewImageUrl: input.previewImageUrl }),
      ...(input.thumbnailUrl   !== undefined && { thumbnailUrl: input.thumbnailUrl }),
      ...(input.tags           !== undefined && { tags: input.tags }),
      ...(input.metadata       !== undefined && { metadata: input.metadata }),
      updatedAt: new Date(),
    })
    .where(eq(roomTemplatesTable.id, id))
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_updated",
    resourceType: "room_template",
    resourceId: id,
    status: "success",
  });

  return updated!;
}

export async function publishRoomTemplate(id: string): Promise<RoomTemplate> {
  const existing = await getRoomTemplate(id);
  if (!existing) {
    throw new RoomTemplateServiceError("Room template not found", "NOT_FOUND", 404);
  }
  if (existing.status !== "draft") {
    throw new RoomTemplateServiceError(
      `Cannot publish: template is '${existing.status}'. Only draft templates can be published.`,
      "INVALID_STATUS_TRANSITION",
      409,
    );
  }

  const [updated] = await db
    .update(roomTemplatesTable)
    .set({ status: "published", version: existing.version + 1, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(roomTemplatesTable.id, id))
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_published",
    resourceType: "room_template",
    resourceId: id,
    status: "success",
    details: { version: updated!.version },
  });

  return updated!;
}

export async function archiveRoomTemplate(id: string): Promise<RoomTemplate> {
  const existing = await getRoomTemplate(id);
  if (!existing) {
    throw new RoomTemplateServiceError("Room template not found", "NOT_FOUND", 404);
  }
  if (existing.status === "archived") {
    throw new RoomTemplateServiceError("Template is already archived.", "ALREADY_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(roomTemplatesTable)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(roomTemplatesTable.id, id))
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_archived",
    resourceType: "room_template",
    resourceId: id,
    status: "success",
  });

  return updated!;
}

export async function restoreRoomTemplate(id: string): Promise<RoomTemplate> {
  const existing = await getRoomTemplate(id);
  if (!existing) {
    throw new RoomTemplateServiceError("Room template not found", "NOT_FOUND", 404);
  }
  if (existing.status !== "archived") {
    throw new RoomTemplateServiceError("Template is not archived.", "NOT_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(roomTemplatesTable)
    .set({ status: "draft", archivedAt: null, updatedAt: new Date() })
    .where(eq(roomTemplatesTable.id, id))
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_restored",
    resourceType: "room_template",
    resourceId: id,
    status: "success",
  });

  return updated!;
}

export async function duplicateRoomTemplate(id: string, createdBy = "admin"): Promise<RoomTemplate> {
  const source = await getRoomTemplate(id);
  if (!source) {
    throw new RoomTemplateServiceError("Room template not found", "NOT_FOUND", 404);
  }

  const [copy] = await db
    .insert(roomTemplatesTable)
    .values({
      name:            `${source.name} (Copy)`,
      slug:            makeSlug(`${source.name}-copy`),
      description:     source.description,
      roomTypeId:      source.roomTypeId,
      styleId:         source.styleId,
      dimensions:      source.dimensions,
      fixedElements:   source.fixedElements,
      previewImageUrl: source.previewImageUrl,
      thumbnailUrl:    source.thumbnailUrl,
      tags:            source.tags,
      tenantId:        source.tenantId,
      createdBy,
      metadata:        source.metadata,
      status:          "draft",
      version:         1,
    } satisfies InsertRoomTemplate)
    .returning();

  await logAudit({
    module: "room-template-library",
    action: "room_template_duplicated",
    resourceType: "room_template",
    resourceId: copy!.id,
    status: "success",
    details: { sourceId: id },
  });

  return copy!;
}

// ── Room Types (read-only catalog) ────────────────────────────────────────────

export async function listRoomTypes(): Promise<RoomType[]> {
  return db.select().from(roomTypesTable).orderBy(asc(roomTypesTable.displayOrder), asc(roomTypesTable.label));
}

export async function getRoomType(id: string): Promise<RoomType | null> {
  const [row] = await db.select().from(roomTypesTable).where(eq(roomTypesTable.id, id)).limit(1);
  return row ?? null;
}

// ── Room Styles (read-only catalog for customer) ──────────────────────────────

export interface ListRoomStylesOptions {
  status?: string;
}

export async function listRoomStyles(opts: ListRoomStylesOptions = {}): Promise<RoomStyle[]> {
  const conditions = [];
  if (opts.status) conditions.push(eq(roomStylesTable.status, opts.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(roomStylesTable).where(where).orderBy(asc(roomStylesTable.displayOrder), asc(roomStylesTable.name));
}

// ── Room Themes (read-only catalog for customer) ──────────────────────────────

export async function listRoomThemes(): Promise<RoomTheme[]> {
  return db.select().from(roomThemesTable).orderBy(asc(roomThemesTable.displayOrder), asc(roomThemesTable.name));
}

// ── Seed ──────────────────────────────────────────────────────────────────────

export async function seedRoomCatalog(): Promise<{ roomTypes: number; roomStyles: number; roomThemes: number; templates: number }> {
  // ── Room Types (8) ──
  const roomTypeSeeds = [
    { code: "living_room",  label: "Living Room",    labelId: "Ruang Tamu",    icon: "🛋️",  displayOrder: 1 },
    { code: "bedroom",      label: "Bedroom",         labelId: "Kamar Tidur",   icon: "🛏️",  displayOrder: 2 },
    { code: "dining_room",  label: "Dining Room",     labelId: "Ruang Makan",   icon: "🍽️",  displayOrder: 3 },
    { code: "kitchen",      label: "Kitchen",         labelId: "Dapur",         icon: "🍳",  displayOrder: 4 },
    { code: "home_office",  label: "Home Office",     labelId: "Ruang Kerja",   icon: "💼",  displayOrder: 5 },
    { code: "bathroom",     label: "Bathroom",        labelId: "Kamar Mandi",   icon: "🚿",  displayOrder: 6 },
    { code: "terrace",      label: "Terrace / Balcony", labelId: "Teras / Balkon", icon: "🌿", displayOrder: 7 },
    { code: "garage",       label: "Garage / Carport", labelId: "Garasi",       icon: "🚗",  displayOrder: 8 },
  ];

  let roomTypesCount = 0;
  for (const rt of roomTypeSeeds) {
    const result = await db
      .insert(roomTypesTable)
      .values({ ...rt, metadata: {} })
      .onConflictDoNothing({ target: roomTypesTable.code })
      .returning({ id: roomTypesTable.id });
    if (result.length > 0) roomTypesCount++;
  }

  // ── Room Styles (20) ──
  const roomStyleSeeds = [
    { name: "Minimalist Modern",       nameId: "Modern Minimalis",     slug: "minimalist-modern",       furnitureEra: "contemporary",  status: "active", displayOrder: 1 },
    { name: "Scandinavian",            nameId: "Skandinavia",          slug: "scandinavian",            furnitureEra: "mid-century",   status: "active", displayOrder: 2 },
    { name: "Industrial",              nameId: "Industrial",           slug: "industrial",              furnitureEra: "vintage",       status: "active", displayOrder: 3 },
    { name: "Japandi",                 nameId: "Japandi",              slug: "japandi",                 furnitureEra: "contemporary",  status: "active", displayOrder: 4 },
    { name: "Traditional Javanese",    nameId: "Tradisional Jawa",     slug: "traditional-javanese",    furnitureEra: "antique",       status: "active", displayOrder: 5 },
    { name: "Balinese",                nameId: "Bali",                 slug: "balinese",                furnitureEra: "antique",       status: "active", displayOrder: 6 },
    { name: "Tropical Contemporary",   nameId: "Tropis Kontemporer",   slug: "tropical-contemporary",   furnitureEra: "contemporary",  status: "active", displayOrder: 7 },
    { name: "Mid-Century Modern",      nameId: "Mid-Century Modern",   slug: "mid-century-modern",      furnitureEra: "mid-century",   status: "active", displayOrder: 8 },
    { name: "Art Deco",                nameId: "Art Deco",             slug: "art-deco",                furnitureEra: "vintage",       status: "active", displayOrder: 9 },
    { name: "Bohemian",                nameId: "Bohemian",             slug: "bohemian",                furnitureEra: "eclectic",      status: "active", displayOrder: 10 },
    { name: "Mediterranean",           nameId: "Mediterania",          slug: "mediterranean",           furnitureEra: "classic",       status: "active", displayOrder: 11 },
    { name: "Modern Classic",          nameId: "Klasik Modern",        slug: "modern-classic",          furnitureEra: "contemporary",  status: "active", displayOrder: 12 },
    { name: "Rustic",                  nameId: "Rustic",               slug: "rustic",                  furnitureEra: "vintage",       status: "active", displayOrder: 13 },
    { name: "Coastal",                 nameId: "Pesisir / Coastal",    slug: "coastal",                 furnitureEra: "contemporary",  status: "active", displayOrder: 14 },
    { name: "Wabi-Sabi",               nameId: "Wabi-Sabi",            slug: "wabi-sabi",               furnitureEra: "contemporary",  status: "active", displayOrder: 15 },
    { name: "Natural Minimalist",      nameId: "Minimalis Natural",    slug: "natural-minimalist",      furnitureEra: "contemporary",  status: "active", displayOrder: 16 },
    { name: "Eclectic",                nameId: "Eklektik",             slug: "eclectic",                furnitureEra: "eclectic",      status: "active", displayOrder: 17 },
    { name: "Transitional",            nameId: "Transisional",         slug: "transitional",            furnitureEra: "contemporary",  status: "active", displayOrder: 18 },
    { name: "French Country",          nameId: "French Country",       slug: "french-country",          furnitureEra: "classic",       status: "draft",  displayOrder: 19 },
    { name: "Urban Industrial Loft",   nameId: "Loft Industrial Urban", slug: "urban-industrial-loft",  furnitureEra: "contemporary",  status: "draft",  displayOrder: 20 },
  ];

  let stylesCount = 0;
  for (const s of roomStyleSeeds) {
    const result = await db
      .insert(roomStylesTable)
      .values({ ...s, palette: {}, materialFinishPrefs: [], textureRules: [] })
      .onConflictDoNothing({ target: roomStylesTable.slug })
      .returning({ id: roomStylesTable.id });
    if (result.length > 0) stylesCount++;
  }

  // ── Room Themes (15) ──
  const roomThemeSeeds = [
    { name: "Serene Sanctuary",       nameId: "Surga Ketenangan",       slug: "serene-sanctuary",       status: "published", displayOrder: 1 },
    { name: "Family Warmth",          nameId: "Kehangatan Keluarga",    slug: "family-warmth",          status: "published", displayOrder: 2 },
    { name: "Creative Space",         nameId: "Ruang Kreatif",          slug: "creative-space",         status: "published", displayOrder: 3 },
    { name: "Executive Suite",        nameId: "Suite Eksekutif",        slug: "executive-suite",        status: "published", displayOrder: 4 },
    { name: "Nature Retreat",         nameId: "Retreat Alam",           slug: "nature-retreat",         status: "published", displayOrder: 5 },
    { name: "Cultural Heritage",      nameId: "Warisan Budaya",         slug: "cultural-heritage",      status: "published", displayOrder: 6 },
    { name: "Contemporary Urban",     nameId: "Urban Kontemporer",      slug: "contemporary-urban",     status: "published", displayOrder: 7 },
    { name: "Coastal Escape",         nameId: "Pelarian Pesisir",       slug: "coastal-escape",         status: "published", displayOrder: 8 },
    { name: "Artisan Craft",          nameId: "Kerajinan Artisan",      slug: "artisan-craft",          status: "published", displayOrder: 9 },
    { name: "Smart Living",           nameId: "Hunian Cerdas",          slug: "smart-living",           status: "published", displayOrder: 10 },
    { name: "Romantic Evenings",      nameId: "Malam Romantis",         slug: "romantic-evenings",      status: "published", displayOrder: 11 },
    { name: "Children's Wonder",      nameId: "Dunia Anak",             slug: "childrens-wonder",       status: "published", displayOrder: 12 },
    { name: "Wellness Haven",         nameId: "Surga Kesehatan",        slug: "wellness-haven",         status: "published", displayOrder: 13 },
    { name: "Entertainment Hub",      nameId: "Pusat Hiburan",          slug: "entertainment-hub",      status: "draft",     displayOrder: 14 },
    { name: "Study & Focus",          nameId: "Belajar & Fokus",        slug: "study-and-focus",        status: "draft",     displayOrder: 15 },
  ];

  let themesCount = 0;
  for (const t of roomThemeSeeds) {
    const result = await db
      .insert(roomThemesTable)
      .values({ ...t, styleIds: [], decorationSetIds: [], lightingPresetIds: [] })
      .onConflictDoNothing({ target: roomThemesTable.slug })
      .returning({ id: roomThemesTable.id });
    if (result.length > 0) themesCount++;
  }

  // ── Starter Room Templates (10) ──
  // We need room_type IDs — look them up
  const types = await db.select().from(roomTypesTable);
  const typeMap = Object.fromEntries(types.map(t => [t.code, t.id]));

  const styles = await db.select({ id: roomStylesTable.id, slug: roomStylesTable.slug }).from(roomStylesTable);
  const styleMap = Object.fromEntries(styles.map(s => [s.slug, s.id]));

  const templateSeeds = [
    {
      name: "Modern Living Room — Standard",
      slug: "modern-living-room-standard",
      description: "A clean, contemporary living room template suitable for mid-size urban apartments.",
      roomTypeCode: "living_room",
      styleSlug: "minimalist-modern",
      dimensions: { widthCm: 450, depthCm: 600, heightCm: 270 },
      tags: ["apartment", "urban", "contemporary"],
      status: "published" as const,
    },
    {
      name: "Japandi Master Bedroom",
      slug: "japandi-master-bedroom",
      description: "A serene Japandi-inspired master bedroom with clean lines and natural textures.",
      roomTypeCode: "bedroom",
      styleSlug: "japandi",
      dimensions: { widthCm: 400, depthCm: 500, heightCm: 260 },
      tags: ["bedroom", "zen", "minimalist"],
      status: "published" as const,
    },
    {
      name: "Scandinavian Home Office",
      slug: "scandinavian-home-office",
      description: "A functional and aesthetic work-from-home space with Scandinavian influence.",
      roomTypeCode: "home_office",
      styleSlug: "scandinavian",
      dimensions: { widthCm: 300, depthCm: 350, heightCm: 270 },
      tags: ["wfh", "productive", "bright"],
      status: "published" as const,
    },
    {
      name: "Tropical Contemporary Living Room",
      slug: "tropical-contemporary-living-room",
      description: "Lush, tropical-modern living space for Indonesian climate and lifestyle.",
      roomTypeCode: "living_room",
      styleSlug: "tropical-contemporary",
      dimensions: { widthCm: 500, depthCm: 700, heightCm: 300 },
      tags: ["tropical", "open", "villa"],
      status: "published" as const,
    },
    {
      name: "Balinese Bedroom Sanctuary",
      slug: "balinese-bedroom-sanctuary",
      description: "A Balinese-inspired bedroom for hotels and luxury residences.",
      roomTypeCode: "bedroom",
      styleSlug: "balinese",
      dimensions: { widthCm: 500, depthCm: 600, heightCm: 320 },
      tags: ["hotel", "luxury", "bali"],
      status: "published" as const,
    },
    {
      name: "Industrial Dining Room",
      slug: "industrial-dining-room",
      description: "A bold, industrial-style dining room with exposed materials.",
      roomTypeCode: "dining_room",
      styleSlug: "industrial",
      dimensions: { widthCm: 400, depthCm: 450, heightCm: 300 },
      tags: ["dining", "bold", "urban"],
      status: "published" as const,
    },
    {
      name: "Modern Classic Kitchen",
      slug: "modern-classic-kitchen",
      description: "A timeless modern classic kitchen with functional island layout.",
      roomTypeCode: "kitchen",
      styleSlug: "modern-classic",
      dimensions: { widthCm: 350, depthCm: 400, heightCm: 270 },
      tags: ["kitchen", "island", "classic"],
      status: "published" as const,
    },
    {
      name: "Bohemian Creative Studio",
      slug: "bohemian-creative-studio",
      description: "A free-spirited creative studio with eclectic furniture and art.",
      roomTypeCode: "home_office",
      styleSlug: "bohemian",
      dimensions: { widthCm: 350, depthCm: 400, heightCm: 280 },
      tags: ["creative", "art", "eclectic"],
      status: "published" as const,
    },
    {
      name: "Coastal Terrace Lounge",
      slug: "coastal-terrace-lounge",
      description: "An airy coastal terrace lounge perfect for sea-view properties.",
      roomTypeCode: "terrace",
      styleSlug: "coastal",
      dimensions: { widthCm: 600, depthCm: 300, heightCm: 280 },
      tags: ["outdoor", "seaside", "relaxing"],
      status: "draft" as const,
    },
    {
      name: "Wabi-Sabi Minimalist Bedroom",
      slug: "wabi-sabi-minimalist-bedroom",
      description: "An imperfectly perfect bedroom with natural materials and earthy tones.",
      roomTypeCode: "bedroom",
      styleSlug: "wabi-sabi",
      dimensions: { widthCm: 380, depthCm: 460, heightCm: 260 },
      tags: ["bedroom", "natural", "earthy"],
      status: "draft" as const,
    },
  ];

  let templatesCount = 0;
  for (const t of templateSeeds) {
    const roomTypeId = typeMap[t.roomTypeCode];
    if (!roomTypeId) continue;
    const styleId = styleMap[t.styleSlug] ?? null;

    const result = await db
      .insert(roomTemplatesTable)
      .values({
        name:          t.name,
        slug:          t.slug,
        description:   t.description,
        roomTypeId,
        styleId,
        dimensions:    t.dimensions,
        fixedElements: [],
        tags:          t.tags,
        status:        t.status,
        createdBy:     "seed",
        metadata:      {},
        publishedAt:   t.status === "published" ? new Date() : null,
      } satisfies InsertRoomTemplate)
      .onConflictDoNothing({ target: roomTemplatesTable.slug })
      .returning({ id: roomTemplatesTable.id });
    if (result.length > 0) templatesCount++;
  }

  return { roomTypes: roomTypesCount, roomStyles: stylesCount, roomThemes: themesCount, templates: templatesCount };
}
