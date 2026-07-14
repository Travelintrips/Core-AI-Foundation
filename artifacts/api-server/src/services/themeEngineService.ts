/**
 * themeEngineService — V4.6 Theme Engine
 *
 * Manages the global theme registry: CRUD, category/industry affinity,
 * token application, and theme preview generation.
 * All themes are reusable across the full Template Ecosystem.
 */

import { eq, and, ilike, sql } from "drizzle-orm";
import { db, aiTemplateThemesTable } from "@workspace/db";
import type { AiTemplateTheme, InsertAiTemplateTheme } from "@workspace/db";

// ── V4.6 Categories (canonical list) ─────────────────────────────────────────
export const TEMPLATE_CATEGORIES = [
  "Company Profile",
  "Proposal",
  "Pitch Deck",
  "Brochure",
  "Catalog",
  "Flyer",
  "Banner",
  "Presentation",
  "Website",
  "Landing Page",
  "Whitepaper",
  "Case Study",
  "Annual Report",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// ── List / Filter ─────────────────────────────────────────────────────────────

export interface ThemeFilter {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listThemes(filter: ThemeFilter = {}) {
  const { category, search, limit = 50, offset = 0 } = filter;

  const conditions: ReturnType<typeof eq>[] = [];
  if (category) conditions.push(eq(aiTemplateThemesTable.category, category));
  if (search) {
    conditions.push(
      ilike(aiTemplateThemesTable.name, `%${search}%`) as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, [{ count }]] = await Promise.all([
    db.select().from(aiTemplateThemesTable).where(where).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(aiTemplateThemesTable).where(where),
  ]);

  return { items, total: count ?? 0 };
}

export async function getTheme(id: number): Promise<AiTemplateTheme | null> {
  const [row] = await db.select().from(aiTemplateThemesTable).where(eq(aiTemplateThemesTable.id, id)).limit(1);
  return row ?? null;
}

export async function getThemeByKey(key: string): Promise<AiTemplateTheme | null> {
  const [row] = await db.select().from(aiTemplateThemesTable).where(eq(aiTemplateThemesTable.themeKey, key)).limit(1);
  return row ?? null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createTheme(data: InsertAiTemplateTheme): Promise<AiTemplateTheme> {
  const [row] = await db.insert(aiTemplateThemesTable).values(data).returning();
  return row;
}

export async function updateTheme(id: number, data: Partial<InsertAiTemplateTheme>): Promise<AiTemplateTheme | null> {
  const [row] = await db
    .update(aiTemplateThemesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiTemplateThemesTable.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTheme(id: number): Promise<void> {
  await db.delete(aiTemplateThemesTable).where(eq(aiTemplateThemesTable.id, id));
}

// ── Token Application ─────────────────────────────────────────────────────────

export interface AppliedTheme {
  themeKey: string;
  name: string;
  cssVariables: Record<string, string>;
  previewColors: string[];
}

export function applyThemeTokens(theme: AiTemplateTheme): AppliedTheme {
  const raw = theme.tokensJson as Record<string, unknown>;
  // Support both V4.3 flat format {primaryColor} and V4.6 nested {colors:{primary}}
  const nestedColors = raw.colors as Record<string, string> | undefined;
  const flatColors: Record<string, string> = nestedColors ?? {
    primary: (raw.primaryColor as string) ?? "#1a2f5a",
    secondary: (raw.secondaryColor as string) ?? "#2d4a8a",
    accent: (raw.accentColor as string) ?? "#c9a84c",
    background: (raw.backgroundColor as string) ?? "#ffffff",
    text: (raw.textColor as string) ?? "#1a1a2e",
  };
  const nestedTypo = raw.typography as Record<string, string> | undefined;
  const flatTypo = nestedTypo ?? { heading: "Inter", body: "Inter", headingWeight: "600" };
  const tokens = { ...raw, colors: flatColors, typography: flatTypo } as {
    colors: { primary: string; secondary: string; accent: string; background: string; text: string; surface?: string };
    typography: { heading: string; body: string; accent?: string; headingWeight?: string };
    spacing?: string;
    borderRadius?: string;
    shadows?: string;
  };

  const cssVariables: Record<string, string> = {
    "--color-primary": tokens.colors.primary,
    "--color-secondary": tokens.colors.secondary,
    "--color-accent": tokens.colors.accent,
    "--color-background": tokens.colors.background,
    "--color-text": tokens.colors.text,
    "--color-surface": tokens.colors.surface ?? "#ffffff",
    "--font-heading": tokens.typography.heading,
    "--font-body": tokens.typography.body,
    "--font-accent": tokens.typography.accent ?? tokens.typography.body,
    "--font-weight-heading": tokens.typography.headingWeight ?? "700",
    "--spacing-mode": tokens.spacing ?? "normal",
    "--border-radius": tokens.borderRadius ?? "medium",
    "--shadow-style": tokens.shadows ?? "soft",
  };

  return {
    themeKey: theme.themeKey,
    name: theme.name,
    cssVariables,
    previewColors: [
      tokens.colors.primary,
      tokens.colors.secondary,
      tokens.colors.accent,
      tokens.colors.background,
      tokens.colors.text,
    ],
  };
}

// ── Seed Default Themes ───────────────────────────────────────────────────────

export const DEFAULT_THEMES: InsertAiTemplateTheme[] = [
  {
    themeKey: "THEME-CORPORATE-NAVY",
    name: "Corporate Navy",
    description: "Professional dark navy with gold accents. Ideal for formal corporate documents.",
    category: null,
    tokensJson: {
      colors: { primary: "#1a2f5a", secondary: "#2d4a8a", accent: "#c9a84c", background: "#ffffff", text: "#1a1a2e", surface: "#f5f7fa" },
      typography: { heading: "Playfair Display", body: "Source Sans Pro", headingWeight: "700" },
      spacing: "relaxed", borderRadius: "small", shadows: "medium",
    },
  },
  {
    themeKey: "THEME-MODERN-SLATE",
    name: "Modern Slate",
    description: "Clean slate grey with vibrant blue. Suits tech and consulting firms.",
    category: null,
    tokensJson: {
      colors: { primary: "#334155", secondary: "#475569", accent: "#3b82f6", background: "#ffffff", text: "#0f172a", surface: "#f8fafc" },
      typography: { heading: "Inter", body: "Inter", headingWeight: "600" },
      spacing: "normal", borderRadius: "medium", shadows: "soft",
    },
  },
  {
    themeKey: "THEME-ELEGANT-FOREST",
    name: "Elegant Forest",
    description: "Deep forest green with warm amber. Perfect for sustainability and premium brands.",
    category: null,
    tokensJson: {
      colors: { primary: "#14532d", secondary: "#166534", accent: "#d97706", background: "#fafafa", text: "#1c1917", surface: "#f0fdf4" },
      typography: { heading: "Cormorant Garamond", body: "Lato", headingWeight: "600" },
      spacing: "relaxed", borderRadius: "small", shadows: "soft",
    },
  },
  {
    themeKey: "THEME-BOLD-CRIMSON",
    name: "Bold Crimson",
    description: "Striking crimson red with dark charcoal. High-impact for pitches and sales.",
    category: null,
    tokensJson: {
      colors: { primary: "#dc2626", secondary: "#b91c1c", accent: "#fbbf24", background: "#ffffff", text: "#111827", surface: "#fff5f5" },
      typography: { heading: "Montserrat", body: "Open Sans", headingWeight: "700" },
      spacing: "compact", borderRadius: "large", shadows: "strong",
    },
  },
  {
    themeKey: "THEME-MINIMAL-LINEN",
    name: "Minimal Linen",
    description: "Ultra-clean warm white with charcoal text. Ideal for whitepapers and annual reports.",
    category: null,
    tokensJson: {
      colors: { primary: "#374151", secondary: "#6b7280", accent: "#059669", background: "#faf9f7", text: "#111827", surface: "#ffffff" },
      typography: { heading: "Libre Baskerville", body: "Merriweather", headingWeight: "700" },
      spacing: "relaxed", borderRadius: "none", shadows: "none",
    },
  },
  {
    themeKey: "THEME-VIBRANT-CORAL",
    name: "Vibrant Coral",
    description: "Energetic coral and teal combination. Great for brochures, flyers, and landing pages.",
    category: null,
    tokensJson: {
      colors: { primary: "#f97316", secondary: "#ea580c", accent: "#0d9488", background: "#ffffff", text: "#1c1917", surface: "#fff7ed" },
      typography: { heading: "Raleway", body: "Nunito", headingWeight: "800" },
      spacing: "normal", borderRadius: "large", shadows: "medium",
    },
  },
  {
    themeKey: "THEME-TECH-MIDNIGHT",
    name: "Tech Midnight",
    description: "Dark mode-inspired deep background with electric blue. For tech and SaaS brands.",
    category: null,
    tokensJson: {
      colors: { primary: "#6366f1", secondary: "#4f46e5", accent: "#22d3ee", background: "#0f172a", text: "#f1f5f9", surface: "#1e293b" },
      typography: { heading: "Space Grotesk", body: "IBM Plex Sans", headingWeight: "700" },
      spacing: "normal", borderRadius: "medium", shadows: "strong",
    },
  },
  {
    themeKey: "THEME-CLASSIC-GOLD",
    name: "Classic Gold",
    description: "Timeless ivory with rich gold accents. Premium feel for luxury and finance.",
    category: null,
    tokensJson: {
      colors: { primary: "#92400e", secondary: "#78350f", accent: "#d4a017", background: "#fffbeb", text: "#1c1917", surface: "#fef3c7" },
      typography: { heading: "EB Garamond", body: "Crimson Pro", headingWeight: "700" },
      spacing: "relaxed", borderRadius: "none", shadows: "soft",
    },
  },
];

export async function seedDefaultThemes(): Promise<void> {
  for (const theme of DEFAULT_THEMES) {
    const existing = await getThemeByKey(theme.themeKey);
    if (!existing) {
      await createTheme(theme);
    }
  }
}
