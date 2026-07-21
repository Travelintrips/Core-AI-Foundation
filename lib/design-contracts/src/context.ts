/**
 * context.ts — DesignProjectContext
 *
 * Wraps the canonical RequestContext additively. This package does NOT import
 * from api-server or @workspace/db. Instead it defines the minimal actor
 * interface needed by the design workflow layer. Any object that satisfies
 * DesignActorRef (including a real RequestContext) can be passed here — no
 * second authentication model is created.
 *
 * Core rules:
 *   - tenantId MUST be set for all tenant-owned operations.
 *   - domainPluginId identifies which plugin controls the workflow; it is NOT
 *     a domain-specific field baked into the core contract.
 *   - The extensions map is the only place for domain-specific data.
 *   - No field here may reference Fashion, Interior, Packaging, or any domain.
 */

import { z } from "zod";

// ── Actor reference (structural subset of RequestContext) ─────────────────────
// Using an interface (not importing RequestContext) keeps this package free of
// api-server dependencies while remaining structurally compatible via TS duck-typing.

export const DESIGN_ACTOR_TYPES = [
  "customer",
  "tenant_admin",
  "platform_admin",
  "system",
  "worker",
  "scheduler",
] as const;

export type DesignActorType = (typeof DESIGN_ACTOR_TYPES)[number];

export const DesignActorRefSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(DESIGN_ACTOR_TYPES),
  tenantId: z.string().nullable(),
  isPlatformAdmin: z.boolean().optional().default(false),
});

export type DesignActorRef = z.infer<typeof DesignActorRefSchema>;

// ── Lifecycle status ──────────────────────────────────────────────────────────

export const DESIGN_PROJECT_STATUSES = [
  "draft",
  "brief_submitted",
  "in_progress",
  "awaiting_review",
  "revision_requested",
  "approved",
  "completed",
  "cancelled",
  "failed",
] as const;

export type DesignProjectStatus = (typeof DESIGN_PROJECT_STATUSES)[number];

// ── Brand context (optional, domain-agnostic) ─────────────────────────────────

export const DesignBrandContextSchema = z.object({
  brandName: z.string().min(1).max(200),
  /** Primary colours as CSS hex strings. */
  primaryColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(10).optional(),
  /** Brand font family names (display label only, no URL). */
  fontFamilies: z.array(z.string().max(100)).max(5).optional(),
  /** Tone/personality tags — no domain restriction. */
  brandTags: z.array(z.string().max(50)).max(20).optional(),
  /** Storage reference to brand guideline document (opaque URL). */
  guidelinesRef: z.string().url().optional(),
});

export type DesignBrandContext = z.infer<typeof DesignBrandContextSchema>;

// ── DesignProjectContext ──────────────────────────────────────────────────────

export const DesignProjectContextSchema = z.object({
  /** Stable UUID for this project. */
  projectId: z.string().uuid(),
  /** Tenant that owns this project. Never null for tenant-owned operations. */
  tenantId: z.string().min(1),
  /**
   * Service type code from the platform service catalogue.
   * Examples: "FASHION", "INTERIOR", "PACKAGING", "BRANDING", "GRAPHIC_DESIGN".
   * This is an opaque identifier — the core contract does not parse it.
   */
  serviceType: z.string().min(1).max(100),
  /**
   * Identifies the plugin that controls the workflow for this project.
   * Resolved by the plugin registry — not interpreted by the core engine.
   */
  domainPluginId: z.string().min(1).max(100),
  /** BCP-47 locale tag (e.g. "en-US", "id-ID"). */
  locale: z.string().min(2).max(10).default("en-US"),
  /** Current lifecycle position. */
  status: z.enum(DESIGN_PROJECT_STATUSES),
  /** Authenticated actor initiating or owning this context. */
  actor: DesignActorRefSchema,
  /** Trace / distributed-tracing correlation ID. */
  correlationId: z.string().uuid(),
  /** Contract version this context was created with. */
  contractVersion: z.number().int().positive(),
  /** Optional brand context. Domain-agnostic; populated by the brief wizard. */
  brandContext: DesignBrandContextSchema.optional(),
  /**
   * Escape hatch for plugin-specific context fields.
   * Plugins MUST NOT require the core engine to read these; they are opaque
   * to the core layer and passed through untouched.
   */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type DesignProjectContext = z.infer<typeof DesignProjectContextSchema>;
