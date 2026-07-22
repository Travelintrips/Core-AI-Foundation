/**
 * Team 25 — Interior Design Domain Plugin
 * components.ts
 *
 * Component categories and fixture contracts for the interior design plugin.
 *
 * IMPORTANT: Do NOT build a large furniture database here.
 * This file only defines:
 *   - The 7 category contracts (id, label, description, allowed fields)
 *   - A minimal set of fixture examples per category (for tests and docs)
 *
 * Full furniture catalogues are owned by the data layer / vendor integrations.
 */

// ── Component category IDs ────────────────────────────────────────────────────

export const INTERIOR_COMPONENT_CATEGORY_IDS = [
  "seating",
  "table",
  "storage",
  "lighting",
  "decor",
  "fixture",
  "partition",
] as const;

export type InteriorComponentCategoryId =
  (typeof INTERIOR_COMPONENT_CATEGORY_IDS)[number];

// ── Category descriptor ───────────────────────────────────────────────────────

export interface ComponentCategoryDescriptor {
  id: InteriorComponentCategoryId;
  label: string;
  description: string;
  /** Fields expected on every component of this category */
  requiredFields: string[];
  /** Optional enrichment fields */
  optionalFields: string[];
  /** Fixture examples — minimal set for tests and documentation only */
  fixtures: ComponentFixture[];
}

/** A minimal component fixture — not a database record */
export interface ComponentFixture {
  /** Opaque stable ID scoped to this plugin */
  id: string;
  label: string;
  categoryId: InteriorComponentCategoryId;
  /** Typical bounding dimensions in metres */
  typicalDimensionsM: { w: number; d: number; h: number };
  notes?: string;
}

// ── Category definitions ──────────────────────────────────────────────────────

export const INTERIOR_COMPONENT_CATEGORIES: Record<
  InteriorComponentCategoryId,
  ComponentCategoryDescriptor
> = {
  // ── 1. Seating ──────────────────────────────────────────────────────────
  seating: {
    id: "seating",
    label: "Seating",
    description:
      "All furniture designed primarily for sitting: sofas, chairs, stools, ottomans, and benches.",
    requiredFields: ["itemId", "itemName", "widthM", "depthM", "heightM"],
    optionalFields: ["upholsteryMaterial", "frameFinish", "armStyle", "legStyle", "placementNote"],
    fixtures: [
      { id: "seat_3seater_sofa",   label: "3-Seater Sofa",        categoryId: "seating",  typicalDimensionsM: { w: 2.2, d: 0.9, h: 0.85 } },
      { id: "seat_2seater_sofa",   label: "2-Seater Sofa",        categoryId: "seating",  typicalDimensionsM: { w: 1.6, d: 0.85, h: 0.82 } },
      { id: "seat_armchair",       label: "Armchair",             categoryId: "seating",  typicalDimensionsM: { w: 0.85, d: 0.85, h: 0.8 } },
      { id: "seat_dining_chair",   label: "Dining Chair",         categoryId: "seating",  typicalDimensionsM: { w: 0.5, d: 0.55, h: 0.9 } },
      { id: "seat_bar_stool",      label: "Bar Stool",            categoryId: "seating",  typicalDimensionsM: { w: 0.4, d: 0.4, h: 1.05 } },
      { id: "seat_ottoman",        label: "Ottoman / Footstool",  categoryId: "seating",  typicalDimensionsM: { w: 0.6, d: 0.6, h: 0.45 } },
      { id: "seat_bench",          label: "Bench",                categoryId: "seating",  typicalDimensionsM: { w: 1.2, d: 0.4, h: 0.45 } },
    ],
  },

  // ── 2. Table ─────────────────────────────────────────────────────────────
  table: {
    id: "table",
    label: "Table",
    description:
      "All table types: dining, coffee, side, console, desk, and island surfaces.",
    requiredFields: ["itemId", "itemName", "widthM", "depthM", "heightM"],
    optionalFields: ["topMaterial", "baseMaterial", "shapeType", "extendable", "placementNote"],
    fixtures: [
      { id: "tbl_dining_4seat",    label: "Dining Table (4-seater)",   categoryId: "table", typicalDimensionsM: { w: 1.4, d: 0.9, h: 0.75 } },
      { id: "tbl_dining_6seat",    label: "Dining Table (6-seater)",   categoryId: "table", typicalDimensionsM: { w: 1.8, d: 0.9, h: 0.75 } },
      { id: "tbl_coffee",          label: "Coffee Table",              categoryId: "table", typicalDimensionsM: { w: 1.2, d: 0.6, h: 0.45 } },
      { id: "tbl_side",            label: "Side / End Table",          categoryId: "table", typicalDimensionsM: { w: 0.5, d: 0.5, h: 0.55 } },
      { id: "tbl_console",         label: "Console / Hall Table",      categoryId: "table", typicalDimensionsM: { w: 1.2, d: 0.35, h: 0.8 } },
      { id: "tbl_desk",            label: "Work Desk",                 categoryId: "table", typicalDimensionsM: { w: 1.4, d: 0.7, h: 0.75 } },
      { id: "tbl_kitchen_island",  label: "Kitchen Island",            categoryId: "table", typicalDimensionsM: { w: 1.5, d: 0.9, h: 0.9 } },
    ],
  },

  // ── 3. Storage ────────────────────────────────────────────────────────────
  storage: {
    id: "storage",
    label: "Storage",
    description:
      "All storage furniture: wardrobes, shelving units, cabinets, sideboards, and TV units.",
    requiredFields: ["itemId", "itemName", "widthM", "depthM", "heightM"],
    optionalFields: ["doorStyle", "internalConfig", "handleFinish", "isBuiltIn", "placementNote"],
    fixtures: [
      { id: "stor_wardrobe_2dr",   label: "Wardrobe (2-door)",         categoryId: "storage", typicalDimensionsM: { w: 1.2, d: 0.6, h: 2.1 } },
      { id: "stor_wardrobe_4dr",   label: "Wardrobe (4-door)",         categoryId: "storage", typicalDimensionsM: { w: 2.0, d: 0.6, h: 2.1 } },
      { id: "stor_bookshelf",      label: "Open Bookshelf",            categoryId: "storage", typicalDimensionsM: { w: 1.0, d: 0.35, h: 2.0 } },
      { id: "stor_sideboard",      label: "Sideboard / Buffet",        categoryId: "storage", typicalDimensionsM: { w: 1.6, d: 0.45, h: 0.75 } },
      { id: "stor_tv_unit",        label: "TV Cabinet / Media Unit",   categoryId: "storage", typicalDimensionsM: { w: 1.8, d: 0.45, h: 0.55 } },
      { id: "stor_kitchen_base",   label: "Kitchen Base Cabinet",      categoryId: "storage", typicalDimensionsM: { w: 0.6, d: 0.6, h: 0.9 } },
      { id: "stor_kitchen_upper",  label: "Kitchen Upper Cabinet",     categoryId: "storage", typicalDimensionsM: { w: 0.6, d: 0.35, h: 0.7 } },
    ],
  },

  // ── 4. Lighting ───────────────────────────────────────────────────────────
  lighting: {
    id: "lighting",
    label: "Lighting",
    description:
      "Standalone and pendant lighting fixtures that appear in the space plan or specification as furniture-scale elements.",
    requiredFields: ["itemId", "itemName", "lightingLayer"],
    optionalFields: ["fixtureType", "colorTemperatureK", "wattage", "isDimmable", "hangHeightM", "placementNote"],
    fixtures: [
      { id: "lgt_pendant_single",  label: "Single Pendant",            categoryId: "lighting", typicalDimensionsM: { w: 0.35, d: 0.35, h: 0.5 }, notes: "Hang above dining tables or kitchen islands" },
      { id: "lgt_floor_lamp",      label: "Floor Lamp",                categoryId: "lighting", typicalDimensionsM: { w: 0.4, d: 0.4, h: 1.6 } },
      { id: "lgt_table_lamp",      label: "Table Lamp",                categoryId: "lighting", typicalDimensionsM: { w: 0.3, d: 0.3, h: 0.55 } },
      { id: "lgt_chandelier",      label: "Chandelier",                categoryId: "lighting", typicalDimensionsM: { w: 0.6, d: 0.6, h: 0.7 }, notes: "Minimum 2.2m ceiling clearance below fitting" },
      { id: "lgt_wall_sconce",     label: "Wall Sconce",               categoryId: "lighting", typicalDimensionsM: { w: 0.2, d: 0.15, h: 0.3 } },
    ],
  },

  // ── 5. Decor ──────────────────────────────────────────────────────────────
  decor: {
    id: "decor",
    label: "Decor",
    description:
      "Decorative accessories and art: rugs, cushions, artwork, plants, vases, mirrors, and sculptural objects.",
    requiredFields: ["itemId", "itemName"],
    optionalFields: ["materialNotes", "sizeDescription", "colorNotes", "placementNote"],
    fixtures: [
      { id: "dec_rug_large",       label: "Area Rug (Large)",          categoryId: "decor",   typicalDimensionsM: { w: 2.4, d: 1.7, h: 0.01 } },
      { id: "dec_rug_medium",      label: "Area Rug (Medium)",         categoryId: "decor",   typicalDimensionsM: { w: 1.6, d: 1.2, h: 0.01 } },
      { id: "dec_mirror_wall",     label: "Decorative Wall Mirror",    categoryId: "decor",   typicalDimensionsM: { w: 0.8, d: 0.05, h: 1.0 } },
      { id: "dec_artwork_large",   label: "Large Artwork / Canvas",    categoryId: "decor",   typicalDimensionsM: { w: 1.0, d: 0.05, h: 0.8 } },
      { id: "dec_indoor_plant",    label: "Indoor Plant (Floor)",      categoryId: "decor",   typicalDimensionsM: { w: 0.5, d: 0.5, h: 1.2 } },
    ],
  },

  // ── 6. Fixture ────────────────────────────────────────────────────────────
  fixture: {
    id: "fixture",
    label: "Fixture",
    description:
      "Fixed or semi-fixed building elements that are part of the interior design scope: bathroom vanities, kitchen appliances, fireplaces, built-in joinery anchors.",
    requiredFields: ["itemId", "itemName"],
    optionalFields: ["isBuiltIn", "requiresTradeInstallation", "dimensionNotes", "finishNotes", "placementNote"],
    fixtures: [
      { id: "fix_bathroom_vanity", label: "Bathroom Vanity (Wall-hung)", categoryId: "fixture", typicalDimensionsM: { w: 0.9, d: 0.46, h: 0.5 } },
      { id: "fix_kitchen_sink",    label: "Kitchen Sink (Undermount)",    categoryId: "fixture", typicalDimensionsM: { w: 0.76, d: 0.46, h: 0.2 } },
      { id: "fix_bathtub_free",    label: "Freestanding Bathtub",         categoryId: "fixture", typicalDimensionsM: { w: 1.7, d: 0.75, h: 0.6 } },
      { id: "fix_fireplace_elec",  label: "Electric Fireplace (Wall)",    categoryId: "fixture", typicalDimensionsM: { w: 1.2, d: 0.15, h: 0.4 } },
      { id: "fix_reception_desk",  label: "Reception / Front Desk",       categoryId: "fixture", typicalDimensionsM: { w: 2.0, d: 0.75, h: 1.1 }, notes: "May require custom millwork" },
    ],
  },

  // ── 7. Partition ─────────────────────────────────────────────────────────
  partition: {
    id: "partition",
    label: "Partition",
    description:
      "Non-structural dividers: room dividers, screens, curtain tracks, glass partitions, and acoustic panels.",
    requiredFields: ["itemId", "itemName", "widthM", "heightM"],
    optionalFields: ["depthM", "materialNotes", "translucency", "isAcoustic", "placementNote"],
    fixtures: [
      { id: "part_bookcase_divider", label: "Open Bookcase Divider",    categoryId: "partition", typicalDimensionsM: { w: 1.2, d: 0.35, h: 2.0 } },
      { id: "part_folding_screen",   label: "Folding Screen (3-panel)", categoryId: "partition", typicalDimensionsM: { w: 1.5, d: 0.05, h: 1.8 } },
      { id: "part_glass_panel",      label: "Fixed Glass Partition",    categoryId: "partition", typicalDimensionsM: { w: 1.2, d: 0.02, h: 2.4 } },
      { id: "part_curtain_track",    label: "Curtain Track Divider",    categoryId: "partition", typicalDimensionsM: { w: 2.0, d: 0.1, h: 2.5 }, notes: "Ceiling-mounted; requires track installation" },
      { id: "part_acoustic_panel",   label: "Acoustic Wall Panel",      categoryId: "partition", typicalDimensionsM: { w: 0.6, d: 0.05, h: 1.2 } },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a flat list of all fixture examples across all categories. */
export function getAllFixtures(): ComponentFixture[] {
  return INTERIOR_COMPONENT_CATEGORY_IDS.flatMap(
    (id) => INTERIOR_COMPONENT_CATEGORIES[id].fixtures,
  );
}

/** Return fixtures for a single category. */
export function getFixturesByCategory(
  categoryId: InteriorComponentCategoryId,
): ComponentFixture[] {
  return INTERIOR_COMPONENT_CATEGORIES[categoryId].fixtures;
}

/** Look up a category descriptor — throws on unknown ID (programming error). */
export function getComponentCategory(
  categoryId: InteriorComponentCategoryId,
): ComponentCategoryDescriptor {
  const c = INTERIOR_COMPONENT_CATEGORIES[categoryId];
  if (!c)
    throw new Error(`[interior-plugin] Unknown component category: ${categoryId}`);
  return c;
}

/** Return all material categories used in the interior design plugin. */
export const INTERIOR_MATERIAL_CATEGORIES = [
  "flooring",
  "wall",
  "ceiling",
  "textile",
  "cladding",
  "glass",
  "metal",
] as const;

export type InteriorMaterialCategoryId =
  (typeof INTERIOR_MATERIAL_CATEGORIES)[number];

export interface MaterialCategoryDescriptor {
  id: InteriorMaterialCategoryId;
  label: string;
  description: string;
  exampleMaterials: string[];
}

export const INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS: Record<
  InteriorMaterialCategoryId,
  MaterialCategoryDescriptor
> = {
  flooring: {
    id: "flooring",
    label: "Flooring",
    description: "Surface materials applied to the floor plane.",
    exampleMaterials: ["porcelain tile", "ceramic tile", "engineered timber", "solid hardwood", "polished concrete", "vinyl plank", "carpet"],
  },
  wall: {
    id: "wall",
    label: "Wall",
    description: "Treatments applied to vertical wall surfaces.",
    exampleMaterials: ["paint", "wallpaper", "timber panelling", "stone cladding", "exposed brick", "plaster", "venetian plaster"],
  },
  ceiling: {
    id: "ceiling",
    label: "Ceiling",
    description: "Treatments applied to the ceiling plane.",
    exampleMaterials: ["painted plasterboard", "timber batten", "exposed concrete", "stretch ceiling", "acoustic tile", "coffered plaster"],
  },
  textile: {
    id: "textile",
    label: "Textile",
    description: "Soft furnishing materials including curtains, rugs, and upholstery.",
    exampleMaterials: ["linen", "velvet", "cotton canvas", "wool", "faux leather", "rattan weave", "jute"],
  },
  cladding: {
    id: "cladding",
    label: "Cladding",
    description: "Applied surface cladding over structural substrates (feature walls, columns).",
    exampleMaterials: ["natural stone veneer", "brick slip", "timber batten", "metal panel", "terrazzo slab"],
  },
  glass: {
    id: "glass",
    label: "Glass",
    description: "Glazing and glass surface applications.",
    exampleMaterials: ["clear float glass", "frosted glass", "tinted glass", "mirrored glass", "fluted glass", "wire glass"],
  },
  metal: {
    id: "metal",
    label: "Metal",
    description: "Metal surfaces and hardware finishes.",
    exampleMaterials: ["brushed brass", "matte black steel", "polished chrome", "aged copper", "stainless steel", "bronze", "powder-coated aluminium"],
  },
};
