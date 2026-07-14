import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiServicePortfoliosTable } from "./ai-service-portfolios";

/**
 * V4.3 — Portfolio Gallery & Live Preview (Team 1)
 *
 * Purely additive companion to the existing Portfolio Generator
 * (`ai-service-portfolios.ts`). Adds only what that module does not already
 * provide: a persistent per-customer "favorite" list for the public
 * Portfolio Gallery. Search, industry showcase, compare, and analytics are
 * computed on the fly from `ai_service_portfolios` and the existing AI
 * Event Bus — no additional tables are needed for those.
 *
 * Never touches: Queue, Dispatcher, Payment, Commercial Layer, Review
 * Engine, Asset Library, Brand Kit, Creative Runtime, Design Studio,
 * Marketplace, or the existing `ai_service_portfolios` / `ai_templates`
 * tables and routes.
 */

// ── Portfolio Favorites ───────────────────────────────────────────────────────
// clientId matches the `emailHash` identity already used by the Customer
// Workspace pattern (see routes/templates.ts `resolveToken`), so favorites
// are additive and require no changes to workspace/session code.

export const aiPortfolioFavoritesTable = appSchema.table("ai_portfolio_favorites", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(), // emailHash from customer workspace session
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => aiServicePortfoliosTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiPortfolioFavoriteSchema = createInsertSchema(aiPortfolioFavoritesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiPortfolioFavorite = z.infer<typeof insertAiPortfolioFavoriteSchema>;
export type AiPortfolioFavorite = typeof aiPortfolioFavoritesTable.$inferSelect;
