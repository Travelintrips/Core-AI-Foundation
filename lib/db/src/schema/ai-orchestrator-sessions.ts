import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiOrchestratorSessionsTable = appSchema.table("ai_orchestrator_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  agentId: text("agent_id"),
  totalTokens: integer("total_tokens").notNull().default(0),
  totalRequests: integer("total_requests").notNull().default(0),
  lastModelUsed: text("last_model_used"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiOrchestratorSessionSchema = createInsertSchema(aiOrchestratorSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiOrchestratorSession = z.infer<typeof insertAiOrchestratorSessionSchema>;
export type AiOrchestratorSession = typeof aiOrchestratorSessionsTable.$inferSelect;
