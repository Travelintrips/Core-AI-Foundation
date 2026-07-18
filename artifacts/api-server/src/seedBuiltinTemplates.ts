/**
 * seedBuiltinTemplates.ts — Migrate all hardcoded builtin templates → Supabase.
 * Idempotent: uses onConflictDoUpdate on template_code.
 * Run: pnpm --filter @workspace/api-server run seed:builtin-templates
 */

import { db, pool } from "@workspace/db";
import { aiTemplatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { BUILTIN_TEMPLATES } from "./data/design-templates.js";

async function run() {
  // 1. Ensure canvas columns exist
  console.log("Ensuring canvas columns exist…");
  await pool.query(`
    ALTER TABLE ai_platform.ai_templates
      ADD COLUMN IF NOT EXISTS canvas_state   jsonb,
      ADD COLUMN IF NOT EXISTS canvas_width   integer,
      ADD COLUMN IF NOT EXISTS canvas_height  integer,
      ADD COLUMN IF NOT EXISTS tags           jsonb;
  `);

  console.log(`Seeding ${BUILTIN_TEMPLATES.length} builtin templates into Supabase…`);

  for (const t of BUILTIN_TEMPLATES) {
    const primary = t.canvasState.background;
    const accent =
      t.canvasState.elements.find(
        (e) =>
          e.fill &&
          e.fill !== primary &&
          e.fill !== "#FFFFFF" &&
          e.fill !== "#FAFAFA" &&
          e.fill !== "#F5F0E8" &&
          !e.fill.startsWith("rgba"),
      )?.fill ?? "#7C6EFA";

    await db
      .insert(aiTemplatesTable)
      .values({
        templateCode: t.templateCode,
        name: t.name,
        description: t.description,
        category: t.category,
        style: t.style,
        industry: t.industry ?? undefined,
        colorTheme: {
          primary,
          secondary: accent,
          accent: "#7C6EFA",
          background: primary,
          text: "#FFFFFF",
        },
        editable: true,
        isPremium: false,
        version: "1.0",
        status: "published",
        featured: BUILTIN_TEMPLATES.indexOf(t) < 3,
        sortOrder: BUILTIN_TEMPLATES.indexOf(t) + 1,
        views: 0,
        selections: 0,
        previewsGenerated: 0,
        conversions: 0,
        // @ts-ignore — canvas columns added via DDL
        canvasState: t.canvasState,
        canvasWidth: t.canvasWidth,
        canvasHeight: t.canvasHeight,
        tags: t.tags,
      } as typeof aiTemplatesTable.$inferInsert)
      .onConflictDoUpdate({
        target: aiTemplatesTable.templateCode,
        set: {
          name: t.name,
          description: t.description,
          category: t.category,
          style: t.style,
          industry: t.industry ?? null,
          colorTheme: {
            primary,
            secondary: accent,
            accent: "#7C6EFA",
            background: primary,
            text: "#FFFFFF",
          },
          status: "published",
          updatedAt: new Date(),
          // @ts-ignore
          canvasState: t.canvasState,
          canvasWidth: t.canvasWidth,
          canvasHeight: t.canvasHeight,
          tags: t.tags,
        },
      });

    console.log(`  ✓ ${t.templateCode} — ${t.name}`);
  }

  // 2. Check final count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiTemplatesTable);

  console.log(`\n✅ Done. Total templates in Supabase: ${count}`);
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
