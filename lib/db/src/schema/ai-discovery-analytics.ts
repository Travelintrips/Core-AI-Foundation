/**
 * V4.2I — Discovery Analytics Schema
 *
 * Tables for privacy-safe, versioned event tracking across the goal discovery,
 * collection, search, and conversion funnel surfaces.
 *
 * All tables live in the ai_platform schema (enforced by appSchema wrapper).
 * Raw events are retained for 90 days; daily aggregates are permanent.
 * No PII is stored here — anonymous session IDs only.
 */

import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── 1. Raw discovery events ───────────────────────────────────────────────────

export const aiDiscoveryEventsTable = appSchema.table(
  "ai_discovery_events",
  {
    id: serial("id").primaryKey(),

    // Deduplication / idempotency
    eventId: text("event_id").notNull(), // client-generated UUID

    // Taxonomy
    eventName: text("event_name").notNull(),
    eventVersion: integer("event_version").notNull().default(1),

    // Time
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),

    // Identity (no PII)
    sessionId: text("session_id").notNull(),
    anonymousUserId: text("anonymous_user_id"),
    customerId: integer("customer_id"), // set server-side only if authenticated

    // Scope
    tenantId: text("tenant_id"),
    environment: text("environment").notNull().default("production"), // server-set

    // Attribution
    source: text("source"), // enum enforced in service layer
    pagePath: text("page_path"),
    referrerType: text("referrer_type"),

    // Entity identifiers (approved, no PII)
    goalSlug: text("goal_slug"),
    serviceCode: text("service_code"),
    collectionSlug: text("collection_slug"),
    categoryCode: text("category_code"),
    requestId: text("request_id"),
    quoteId: text("quote_id"),
    orderId: text("order_id"),
    experimentKey: text("experiment_key"),

    // Constrained metadata (validated in service layer)
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),

    // Dedup
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    duplicateOf: text("duplicate_of"), // eventId of the original
  },
  (t) => ({
    eventIdIdx: uniqueIndex("ai_discovery_events_event_id_idx").on(t.eventId),
    eventNameIdx: index("ai_discovery_events_event_name_idx").on(t.eventName),
    occurredAtIdx: index("ai_discovery_events_occurred_at_idx").on(t.occurredAt),
    sessionIdx: index("ai_discovery_events_session_idx").on(t.sessionId),
    goalSlugIdx: index("ai_discovery_events_goal_slug_idx").on(t.goalSlug),
    serviceCodeIdx: index("ai_discovery_events_service_code_idx").on(t.serviceCode),
    collectionSlugIdx: index("ai_discovery_events_collection_slug_idx").on(t.collectionSlug),
    tenantIdx: index("ai_discovery_events_tenant_idx").on(t.tenantId),
    envIdx: index("ai_discovery_events_env_idx").on(t.environment),
  }),
);

export const insertDiscoveryEventSchema = createInsertSchema(aiDiscoveryEventsTable).omit({
  id: true,
  receivedAt: true,
  isDuplicate: true,
  duplicateOf: true,
  environment: true, // server-set
  customerId: true, // server-set
});
export const selectDiscoveryEventSchema = createSelectSchema(aiDiscoveryEventsTable);
export type InsertDiscoveryEvent = z.infer<typeof insertDiscoveryEventSchema>;
export type DiscoveryEvent = typeof aiDiscoveryEventsTable.$inferSelect;

// ── 2. Dedup window (short TTL) ───────────────────────────────────────────────
// Tracks recently seen eventIds so retries don't double-count.

export const aiDiscoveryEventDedupTable = appSchema.table(
  "ai_discovery_event_dedup",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 24 h
  },
  (t) => ({
    eventIdIdx: uniqueIndex("ai_disc_dedup_event_id_idx").on(t.eventId),
    expiresAtIdx: index("ai_disc_dedup_expires_at_idx").on(t.expiresAt),
  }),
);

export type DiscoveryEventDedup = typeof aiDiscoveryEventDedupTable.$inferSelect;

// ── 3. Daily aggregate metrics ─────────────────────────────────────────────────

export const aiDiscoveryDailyMetricsTable = appSchema.table(
  "ai_discovery_daily_metrics",
  {
    id: serial("id").primaryKey(),
    metricDate: text("metric_date").notNull(), // ISO date YYYY-MM-DD
    eventName: text("event_name").notNull(),
    goalSlug: text("goal_slug"),
    serviceCode: text("service_code"),
    collectionSlug: text("collection_slug"),
    source: text("source"),
    tenantId: text("tenant_id"),
    environment: text("environment").notNull().default("production"),
    eventCount: integer("event_count").notNull().default(0),
    uniqueSessions: integer("unique_sessions").notNull().default(0),
    uniqueUsers: integer("unique_users").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateEventIdx: index("ai_disc_daily_date_event_idx").on(t.metricDate, t.eventName),
    goalIdx: index("ai_disc_daily_goal_idx").on(t.goalSlug),
    envIdx: index("ai_disc_daily_env_idx").on(t.environment),
  }),
);

export type DiscoveryDailyMetric = typeof aiDiscoveryDailyMetricsTable.$inferSelect;

// ── 4. Funnel step metrics ─────────────────────────────────────────────────────

export const aiDiscoveryFunnelMetricsTable = appSchema.table(
  "ai_discovery_funnel_metrics",
  {
    id: serial("id").primaryKey(),
    metricDate: text("metric_date").notNull(),
    funnelName: text("funnel_name").notNull(), // e.g. "goal_discovery", "collection"
    stepName: text("step_name").notNull(), // e.g. "marketplace_viewed"
    stepOrder: integer("step_order").notNull(),
    sessionCount: integer("session_count").notNull().default(0),
    conversionRate: numeric("conversion_rate", { precision: 6, scale: 3 }),
    dropOffRate: numeric("drop_off_rate", { precision: 6, scale: 3 }),
    environment: text("environment").notNull().default("production"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("ai_disc_funnel_date_idx").on(t.metricDate),
    funnelIdx: index("ai_disc_funnel_name_idx").on(t.funnelName),
  }),
);

export type DiscoveryFunnelMetric = typeof aiDiscoveryFunnelMetricsTable.$inferSelect;

// ── 5. Feature flags ──────────────────────────────────────────────────────────

export const aiFeatureFlagsTable = appSchema.table(
  "ai_feature_flags",
  {
    id: serial("id").primaryKey(),
    flagKey: text("flag_key").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(false),
    environment: text("environment").notNull().default("production"),
    rolloutPercent: integer("rollout_percent").notNull().default(0), // 0–100
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({
    flagKeyEnvIdx: uniqueIndex("ai_feature_flags_key_env_idx").on(t.flagKey, t.environment),
    enabledIdx: index("ai_feature_flags_enabled_idx").on(t.enabled),
  }),
);

export const insertFeatureFlagSchema = createInsertSchema(aiFeatureFlagsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof aiFeatureFlagsTable.$inferSelect;
