/**
 * layoutEngineService — V4.6 Layout Engine
 *
 * Manages the global layout registry: CRUD, category affinity,
 * structure spec validation, and layout preview generation.
 */

import { eq, and, ilike, sql } from "drizzle-orm";
import { db, aiTemplateLayoutsTable } from "@workspace/db";
import type { AiTemplateLayout, InsertAiTemplateLayout } from "@workspace/db";

// ── Category → recommended layout types ──────────────────────────────────────
export const CATEGORY_LAYOUT_MAP: Record<string, string[]> = {
  "Company Profile":  ["cover-focus", "magazine", "two-column"],
  "Proposal":         ["single-column", "two-column"],
  "Pitch Deck":       ["single-column", "cover-focus", "grid"],
  "Brochure":         ["tri-fold", "magazine", "grid"],
  "Catalog":          ["grid", "magazine", "two-column"],
  "Flyer":            ["single-column", "grid"],
  "Banner":           ["banner-landscape", "banner-portrait"],
  "Presentation":     ["single-column", "cover-focus"],
  "Website":          ["grid", "magazine", "two-column"],
  "Landing Page":     ["single-column", "two-column"],
  "Whitepaper":       ["single-column", "two-column"],
  "Case Study":       ["single-column", "two-column"],
  "Annual Report":    ["magazine", "two-column", "grid"],
};

// ── List / Filter ─────────────────────────────────────────────────────────────

export interface LayoutFilter {
  category?: string;
  layoutType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listLayouts(filter: LayoutFilter = {}) {
  const { category, layoutType, search, limit = 50, offset = 0 } = filter;

  const conditions: ReturnType<typeof eq>[] = [];
  if (category) conditions.push(eq(aiTemplateLayoutsTable.category, category));
  if (layoutType) conditions.push(eq(aiTemplateLayoutsTable.layoutType, layoutType));
  if (search) {
    conditions.push(
      ilike(aiTemplateLayoutsTable.name, `%${search}%`) as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, [{ count }]] = await Promise.all([
    db.select().from(aiTemplateLayoutsTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(aiTemplateLayoutsTable).where(where),
  ]);

  return { items, total: count ?? 0 };
}

export async function getLayout(id: number): Promise<AiTemplateLayout | null> {
  const [row] = await db.select().from(aiTemplateLayoutsTable).where(eq(aiTemplateLayoutsTable.id, id)).limit(1);
  return row ?? null;
}

export async function getLayoutByKey(key: string): Promise<AiTemplateLayout | null> {
  const [row] = await db.select().from(aiTemplateLayoutsTable).where(eq(aiTemplateLayoutsTable.layoutKey, key)).limit(1);
  return row ?? null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createLayout(data: InsertAiTemplateLayout): Promise<AiTemplateLayout> {
  const [row] = await db.insert(aiTemplateLayoutsTable).values(data).returning();
  return row;
}

export async function updateLayout(id: number, data: Partial<InsertAiTemplateLayout>): Promise<AiTemplateLayout | null> {
  const [row] = await db
    .update(aiTemplateLayoutsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiTemplateLayoutsTable.id, id))
    .returning();
  return row ?? null;
}

export async function deleteLayout(id: number): Promise<void> {
  await db.delete(aiTemplateLayoutsTable).where(eq(aiTemplateLayoutsTable.id, id));
}

// ── Recommendation ────────────────────────────────────────────────────────────

export function getRecommendedLayouts(category: string): string[] {
  return CATEGORY_LAYOUT_MAP[category] ?? ["single-column", "two-column"];
}

// ── Seed Default Layouts ──────────────────────────────────────────────────────

export const DEFAULT_LAYOUTS: InsertAiTemplateLayout[] = [
  {
    layoutKey: "LAYOUT-SINGLE-COL",
    name: "Single Column",
    description: "Clean, linear reading flow. Best for reports, proposals, and whitepapers.",
    category: "General",
    layoutType: "single-column",
    structureJson: {
      sections: [
        { id: "cover", label: "Cover Page", order: 1 },
        { id: "toc", label: "Table of Contents", order: 2 },
        { id: "content", label: "Main Content", order: 3 },
        { id: "appendix", label: "Appendix", order: 4 },
      ],
      columns: 1, gutter: "2rem",
    },
    minSlots: 2, maxSlots: 50,
  },
  {
    layoutKey: "LAYOUT-TWO-COL",
    name: "Two Column",
    description: "Sidebar + main content. Great for company profiles and case studies.",
    category: "General",
    layoutType: "two-column",
    structureJson: {
      sections: [
        { id: "cover", label: "Cover Page", order: 1 },
        { id: "sidebar", label: "Sidebar", order: 2, width: "30%" },
        { id: "main", label: "Main Content", order: 3, width: "70%" },
        { id: "footer", label: "Footer Band", order: 4 },
      ],
      columns: 2, gutter: "1.5rem",
    },
    minSlots: 3, maxSlots: 30,
  },
  {
    layoutKey: "LAYOUT-COVER-FOCUS",
    name: "Cover Focus",
    description: "Impactful full-page cover with structured inner pages. Ideal for pitch decks and company profiles.",
    category: "Company Profile",
    layoutType: "cover-focus",
    structureJson: {
      sections: [
        { id: "cover", label: "Hero Cover", order: 1, span: 2 },
        { id: "about", label: "About Us", order: 2 },
        { id: "services", label: "Services / Products", order: 3 },
        { id: "team", label: "Team", order: 4 },
        { id: "contact", label: "Contact", order: 5 },
      ],
      columns: 1, gutter: "0",
    },
    minSlots: 4, maxSlots: 20,
  },
  {
    layoutKey: "LAYOUT-MAGAZINE",
    name: "Magazine",
    description: "Dynamic multi-zone layout with visual hierarchy. Perfect for catalogs and annual reports.",
    category: "Catalog",
    layoutType: "magazine",
    structureJson: {
      sections: [
        { id: "hero-banner", label: "Hero Banner", order: 1, span: 3 },
        { id: "feature-left", label: "Feature Left", order: 2 },
        { id: "feature-center", label: "Feature Center", order: 3 },
        { id: "feature-right", label: "Feature Right", order: 4 },
        { id: "content-grid", label: "Content Grid", order: 5 },
        { id: "pull-quote", label: "Pull Quote", order: 6, span: 2 },
      ],
      columns: 3, gutter: "1rem",
    },
    minSlots: 4, maxSlots: 40,
  },
  {
    layoutKey: "LAYOUT-GRID",
    name: "Grid",
    description: "Modular card-based grid. Ideal for product catalogs, portfolios, and websites.",
    category: "Catalog",
    layoutType: "grid",
    structureJson: {
      sections: [
        { id: "header", label: "Page Header", order: 1, span: 3 },
        { id: "item-1", label: "Grid Item", order: 2 },
        { id: "item-2", label: "Grid Item", order: 3 },
        { id: "item-3", label: "Grid Item", order: 4 },
      ],
      columns: 3, gutter: "1.5rem",
    },
    minSlots: 3, maxSlots: 60,
  },
  {
    layoutKey: "LAYOUT-TRI-FOLD",
    name: "Tri-Fold Brochure",
    description: "Classic tri-fold structure for print brochures.",
    category: "Brochure",
    layoutType: "tri-fold",
    structureJson: {
      sections: [
        { id: "panel-front", label: "Front Panel (Cover)", order: 1 },
        { id: "panel-inner-left", label: "Inner Left", order: 2 },
        { id: "panel-inner-center", label: "Inner Center", order: 3 },
        { id: "panel-inner-right", label: "Inner Right", order: 4 },
        { id: "panel-back", label: "Back Panel", order: 5 },
      ],
      columns: 3, gutter: "0",
    },
    minSlots: 3, maxSlots: 6,
  },
  {
    layoutKey: "LAYOUT-BANNER-LAND",
    name: "Landscape Banner",
    description: "Wide-format banner layout. For horizontal display ads and event banners.",
    category: "Banner",
    layoutType: "banner-landscape",
    structureJson: {
      sections: [
        { id: "logo-zone", label: "Logo Zone", order: 1, width: "20%" },
        { id: "headline", label: "Headline", order: 2, width: "60%" },
        { id: "cta-zone", label: "CTA Zone", order: 3, width: "20%" },
      ],
      columns: 3, gutter: "0",
    },
    minSlots: 1, maxSlots: 3,
  },
  {
    layoutKey: "LAYOUT-BANNER-PORT",
    name: "Portrait Banner",
    description: "Vertical banner for social media, roll-up banners, and displays.",
    category: "Banner",
    layoutType: "banner-portrait",
    structureJson: {
      sections: [
        { id: "brand-zone", label: "Brand / Logo", order: 1 },
        { id: "headline", label: "Headline", order: 2 },
        { id: "sub-message", label: "Sub-Message", order: 3 },
        { id: "cta", label: "CTA / Contact", order: 4 },
      ],
      columns: 1, gutter: "0",
    },
    minSlots: 2, maxSlots: 5,
  },
];

export async function seedDefaultLayouts(): Promise<void> {
  for (const layout of DEFAULT_LAYOUTS) {
    const existing = await getLayoutByKey(layout.layoutKey);
    if (!existing) {
      await createLayout(layout);
    }
  }
}
