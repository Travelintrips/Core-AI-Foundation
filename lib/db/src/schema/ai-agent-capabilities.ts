import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiAgentsTable } from "./ai-agents";

export const aiAgentCapabilitiesTable = appSchema.table("ai_agent_capabilities", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => aiAgentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAgentCapabilitySchema = createInsertSchema(aiAgentCapabilitiesTable).omit({ id: true, createdAt: true });
export type InsertAiAgentCapability = z.infer<typeof insertAiAgentCapabilitySchema>;
export type AiAgentCapability = typeof aiAgentCapabilitiesTable.$inferSelect;
