import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, numeric, boolean, date, index } from "drizzle-orm/pg-core";

/**
 * ai_provider_pricing — live pricing table for AI models.
 * Allows cost estimates to be updated without touching source code.
 * Prices are per 1 million tokens in USD.
 */
export const aiProviderPricingTable = appSchema.table(
  "ai_provider_pricing",
  {
    id: serial("id").primaryKey(),

    provider: text("provider").notNull(),   // e.g. "openai"
    model:    text("model").notNull(),      // e.g. "gpt-4o"

    // ── Prices per 1 million tokens (USD) ───────────────────────────────
    inputPricePer1m:    numeric("input_price_per_1m",    { precision: 12, scale: 6 }).notNull().default("2.50"),
    outputPricePer1m:   numeric("output_price_per_1m",   { precision: 12, scale: 6 }).notNull().default("10.00"),
    cachedInputPrice:   numeric("cached_input_price",    { precision: 12, scale: 6 }),  // cached/prompt-cache discount
    reasoningPrice:     numeric("reasoning_price",       { precision: 12, scale: 6 }),  // for o-series reasoning tokens

    currency: text("currency").notNull().default("USD"),

    effectiveDate: date("effective_date"),
    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_provider_pricing_provider_model_idx").on(t.provider, t.model),
    index("ai_provider_pricing_active_idx").on(t.active),
  ],
);

export type AiProviderPricing = typeof aiProviderPricingTable.$inferSelect;
export type InsertAiProviderPricing = typeof aiProviderPricingTable.$inferInsert;
