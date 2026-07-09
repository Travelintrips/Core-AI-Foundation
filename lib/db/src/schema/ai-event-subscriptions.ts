import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * ai_event_subscriptions — Phase 5.5 AI Event Bus
 * Route events to handler functions when eventType matches.
 */
export const aiEventSubscriptionsTable = pgTable("ai_event_subscriptions", {
  id:                 serial("id").primaryKey(),
  subscriptionName:   text("subscription_name").notNull().unique(),
  eventType:          text("event_type").notNull(),           // exact match or "*" wildcard
  targetType:         text("target_type"),                    // e.g. "job", "project"
  targetId:           text("target_id"),                      // optional scoping
  handlerType:        text("handler_type").notNull(),
  // create_job | audit_log | notification_hook | update_project_status | call_webhook
  handlerConfigJson:  jsonb("handler_config_json").notNull().default({}),
  status:             text("status").notNull().default("active"),
  // active | paused | disabled
  retryPolicy:        jsonb("retry_policy").notNull().default({}),
  createdAt:          timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at",  { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiEventSubscription       = typeof aiEventSubscriptionsTable.$inferSelect;
export type InsertAiEventSubscription = typeof aiEventSubscriptionsTable.$inferInsert;
