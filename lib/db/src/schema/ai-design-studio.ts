import {
  bigserial,
  bigint,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { appSchema } from "./_pg-schema.js";

/**
 * V4.5 AI Design Studio — design projects and version history.
 * Canvas state stored as JSONB (element tree).
 *
 * Team 36 (Design Security): added tenant_id column to ai_design_projects
 * for multi-tenant isolation. Versions are scoped through project ownership
 * — no separate tenant_id needed on the versions table.
 */
export const aiDesignProjects = appSchema.table("ai_design_projects", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /** Server-resolved tenant identifier — never taken from client input. */
  tenantId: text("tenant_id").notNull().default("default"),
  name: text("name").notNull(),
  description: text("description"),
  canvasWidth: integer("canvas_width").notNull().default(1920),
  canvasHeight: integer("canvas_height").notNull().default(1080),
  templateId: bigint("template_id", { mode: "number" }),
  brandDnaId: bigint("brand_dna_id", { mode: "number" }),
  currentVersionId: bigint("current_version_id", { mode: "number" }),
  /** draft | active | archived */
  status: text("status").notNull().default("draft"),
  tags: text("tags").array(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const aiDesignVersions = appSchema.table("ai_design_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: bigint("project_id", { mode: "number" }).notNull(),
  versionNumber: integer("version_number").notNull(),
  label: text("label"),
  /** Full canvas state snapshot */
  canvasState: jsonb("canvas_state").notNull(),
  elementCount: integer("element_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AiDesignProject = typeof aiDesignProjects.$inferSelect;
export type NewAiDesignProject = typeof aiDesignProjects.$inferInsert;
export type AiDesignVersion = typeof aiDesignVersions.$inferSelect;
export type NewAiDesignVersion = typeof aiDesignVersions.$inferInsert;
