import { appSchema } from "./_pg-schema";
import { serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiToolsTable = appSchema.table("ai_tools", {
  id: serial("id").primaryKey(),
  toolCode: text("tool_code").notNull().unique(),
  toolName: text("tool_name").notNull(),
  category: text("category"),           // ai_model | storage | communication | analytics
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiToolSchema = createInsertSchema(aiToolsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiTool = z.infer<typeof insertAiToolSchema>;
export type AiTool = typeof aiToolsTable.$inferSelect;
