import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const aiCustomerSegmentsTable = appSchema.table("ai_customer_segments", {
  id:                  serial("id").primaryKey(),
  customerProfileId:   integer("customer_profile_id").notNull().unique(),
  segment:             text("segment").notNull().default("new"),
  // e.g.: new | returning | vip | enterprise | inactive | lost | high_potential | high_value | at_risk
  previousSegment:     text("previous_segment"),
  segmentScore:        integer("segment_score").notNull().default(0),
  segmentReason:       text("segment_reason"),
  metadataJson:        jsonb("metadata_json").$type<Record<string, unknown>>(),
  calculatedAt:        timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiCustomerSegment = typeof aiCustomerSegmentsTable.$inferSelect;
export type InsertAiCustomerSegment = typeof aiCustomerSegmentsTable.$inferInsert;
