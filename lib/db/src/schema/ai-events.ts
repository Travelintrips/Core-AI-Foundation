import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * ai_events — Phase 5.5 AI Event Bus
 * Persistent event store for all inter-module events.
 */
export const aiEventsTable = pgTable("ai_events", {
  id:            serial("id").primaryKey(),
  eventId:       text("event_id").notNull().unique(),         // UUID, globally unique
  eventType:     text("event_type").notNull(),               // e.g. "job.completed"
  sourceModule:  text("source_module").notNull(),            // e.g. "job-engine"
  sourceId:      text("source_id"),                          // resource id that emitted
  correlationId: text("correlation_id").notNull(),           // traces a business flow
  causationId:   text("causation_id"),                       // event that caused this one
  payloadJson:   jsonb("payload_json").notNull().default({}),
  metadataJson:  jsonb("metadata_json").notNull().default({}),
  status:        text("status").notNull().default("pending"),
  // pending | published | processing | processed | failed | ignored
  publishedAt:   timestamp("published_at",  { withTimezone: true }),
  processedAt:   timestamp("processed_at",  { withTimezone: true }),
  createdAt:     timestamp("created_at",    { withTimezone: true }).notNull().defaultNow(),
});

export type AiEvent       = typeof aiEventsTable.$inferSelect;
export type InsertAiEvent = typeof aiEventsTable.$inferInsert;
