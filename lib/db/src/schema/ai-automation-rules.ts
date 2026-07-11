import { appSchema } from "./_pg-schema";
import { serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const aiAutomationRulesTable = appSchema.table("ai_automation_rules", {
  id:              serial("id").primaryKey(),
  ruleCode:        text("rule_code").notNull().unique(),
  ruleName:        text("rule_name").notNull(),
  description:     text("description"),
  triggerEvent:    text("trigger_event").notNull(),
  // event type pattern that activates this rule, e.g. "portfolio.viewed"
  conditionsJson:  jsonb("conditions_json").notNull().$type<Record<string, unknown>>(),
  // e.g. { "viewCount": { "gte": 3 }, "hasCheckout": { "eq": false } }
  actionType:      text("action_type").notNull(),
  // recommend_coupon | send_reminder | vip_promotion | upgrade_commission | recalculate_health | resegment
  actionConfigJson: jsonb("action_config_json").$type<Record<string, unknown>>(),
  priority:        integer("priority").notNull().default(50),
  isEnabled:       boolean("is_enabled").notNull().default(true),
  executionCount:  integer("execution_count").notNull().default(0),
  lastExecutedAt:  timestamp("last_executed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAutomationExecutionsTable = appSchema.table("ai_automation_executions", {
  id:              serial("id").primaryKey(),
  ruleId:          integer("rule_id").notNull().references(() => aiAutomationRulesTable.id, { onDelete: "cascade" }),
  triggerEventId:  text("trigger_event_id"),
  triggerEventType: text("trigger_event_type"),
  customerProfileId: integer("customer_profile_id"),
  status:          text("status").notNull().default("success"),
  // success | failed | skipped
  resultJson:      jsonb("result_json").$type<Record<string, unknown>>(),
  executedAt:      timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiAutomationRule = typeof aiAutomationRulesTable.$inferSelect;
export type InsertAiAutomationRule = typeof aiAutomationRulesTable.$inferInsert;
export type AiAutomationExecution = typeof aiAutomationExecutionsTable.$inferSelect;
