import { appSchema } from "./_pg-schema";
import { serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_tool_packages — Phase 8 AI Tool Registry / Connector Framework
 *
 * A tool package represents a connector to an external system (OpenAI,
 * WhatsApp, S3, ...). Distinct from the lightweight `ai_tools` table used
 * for workforce tool permissions — this is the marketplace catalog + the
 * connector framework's config surface (auth, health, rate limits).
 */
export const aiToolPackagesTable = appSchema.table("ai_tool_packages", {
  id: serial("id").primaryKey(),

  toolCode: text("tool_code").notNull().unique(),
  toolName: text("tool_name").notNull(),
  provider: text("provider"),
  version: text("version").notNull().default("1.0.0"),
  category: text("category"), // ai_model | storage | communication | analytics | database | devops
  apiType: text("api_type"), // rest | graphql | grpc | sdk | smtp | webhook
  authenticationType: text("authentication_type"), // api_key | oauth2 | basic | none

  status: text("status").notNull().default("published"),
  // draft | published | deprecated

  configurationSchema: jsonb("configuration_schema").notNull().default({}),

  // Connector framework surface
  healthStatus: text("health_status").notNull().default("unknown"),
  // unknown | healthy | degraded | down
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  rateLimitPerMinute: text("rate_limit_per_minute"),
  retryPolicy: text("retry_policy").notNull().default("exponential"),
  // immediate | exponential | manual
  capabilities: jsonb("capabilities").notNull().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiToolPackageSchema = createInsertSchema(aiToolPackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiToolPackage = z.infer<typeof insertAiToolPackageSchema>;
export type AiToolPackage = typeof aiToolPackagesTable.$inferSelect;
