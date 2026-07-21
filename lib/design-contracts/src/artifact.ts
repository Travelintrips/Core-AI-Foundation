/**
 * artifact.ts — DesignArtifactContract
 *
 * A design artifact is any piece of output produced at a workflow stage:
 * an image, a PDF, a vector file, a structured JSON specification, etc.
 *
 * Provenance and generation source fields are always required so the audit
 * trail is complete. Review status is tracked on the artifact itself so the
 * core engine can gate stage transitions without reading domain tables.
 */

import { z } from "zod";
import { type DesignArtifactType, DESIGN_ARTIFACT_TYPES } from "./stage.js";

export type { DesignArtifactType };

// ── Artifact status ───────────────────────────────────────────────────────────

export const ARTIFACT_STATUSES = [
  "pending",
  "generating",
  "ready",
  "failed",
  "superseded",
  "archived",
] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

// ── Review status ─────────────────────────────────────────────────────────────

export const ARTIFACT_REVIEW_STATUSES = [
  "not_submitted",
  "under_review",
  "approved",
  "rejected",
  "revision_requested",
] as const;

export type ArtifactReviewStatus = (typeof ARTIFACT_REVIEW_STATUSES)[number];

// ── Generation source ─────────────────────────────────────────────────────────

export const GENERATION_SOURCES = [
  "ai_agent",
  "ai_model_direct",
  "human_upload",
  "template_render",
  "rule_engine",
  "external_api",
  "plugin_defined",
] as const;

export type GenerationSource = (typeof GENERATION_SOURCES)[number];

// ── Storage reference (opaque — no storage provider coupling) ─────────────────

export const StorageRefSchema = z.object({
  /** Provider-agnostic bucket/container identifier. */
  bucket: z.string().min(1).max(200),
  /** Object key / path within the bucket. */
  key: z.string().min(1).max(500),
  /** Storage provider hint (e.g. "supabase", "s3", "gcs"). Opaque to core. */
  provider: z.string().max(50).optional(),
  /** Pre-signed or permanent access URL. Optional — may not always be available. */
  url: z.string().url().optional(),
  /** MIME type of the stored object. */
  mimeType: z.string().max(100).optional(),
  /** Size in bytes. */
  sizeBytes: z.number().int().nonnegative().optional(),
});

export type StorageRef = z.infer<typeof StorageRefSchema>;

// ── Provenance ────────────────────────────────────────────────────────────────

export const ArtifactProvenanceSchema = z.object({
  /** ID of the AI job that produced this artifact, if any. */
  jobId: z.string().nullable().optional(),
  /** ID of the capability that was invoked. */
  capabilityId: z.string().optional(),
  /** Actor who initiated the generation. */
  actorId: z.string().min(1),
  /** ISO-8601 timestamp when generation was requested. */
  requestedAt: z.string().datetime(),
  /** ISO-8601 timestamp when generation completed. */
  completedAt: z.string().datetime().optional(),
  /** Model identifier used, if AI-generated (opaque — no provider coupling). */
  modelRef: z.string().max(200).optional(),
  /** Prompt hash or digest for reproducibility (no raw prompt stored). */
  promptDigest: z.string().max(64).optional(),
});

export type ArtifactProvenance = z.infer<typeof ArtifactProvenanceSchema>;

// ── Structured metadata (domain-agnostic) ─────────────────────────────────────

export const ArtifactMetadataSchema = z.object({
  /** Display label for the artifact. */
  label: z.string().max(200).optional(),
  /** Width in pixels (for image artifacts). */
  widthPx: z.number().int().positive().optional(),
  /** Height in pixels (for image artifacts). */
  heightPx: z.number().int().positive().optional(),
  /** Page count (for document artifacts). */
  pageCount: z.number().int().positive().optional(),
  /** Duration in seconds (for video/audio artifacts). */
  durationSeconds: z.number().positive().optional(),
  /** Quality score 0–100 produced by the QC agent. */
  qualityScore: z.number().min(0).max(100).optional(),
  /** Plugin-defined extra metadata. Opaque to the core engine. */
  pluginMeta: z.record(z.string(), z.unknown()).optional(),
});

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

// ── DesignArtifactContract ────────────────────────────────────────────────────

export const DesignArtifactContractSchema = z.object({
  /** Stable UUID for this artifact. */
  artifactId: z.string().uuid(),
  /** The broad output category. */
  artifactType: z.enum(DESIGN_ARTIFACT_TYPES),
  /** Project this artifact belongs to. */
  projectId: z.string().uuid(),
  /** Stage within which this artifact was produced. */
  stageId: z.string().min(1).max(150),
  /**
   * Monotonically increasing version within (projectId, stageId, artifactType).
   * Starts at 1. Superseded artifacts retain their version for audit.
   */
  version: z.number().int().positive(),
  /** Lifecycle status of this artifact. */
  status: z.enum(ARTIFACT_STATUSES),
  /** Where the artifact binary/content is stored. */
  storageRef: StorageRefSchema,
  /** Domain-agnostic structured metadata. */
  metadata: ArtifactMetadataSchema.optional(),
  /** Full audit-grade provenance chain. */
  provenance: ArtifactProvenanceSchema,
  /** How this artifact was created. */
  generationSource: z.enum(GENERATION_SOURCES),
  /** Client review status for this artifact version. */
  reviewStatus: z.enum(ARTIFACT_REVIEW_STATUSES).default("not_submitted"),
  /** Contract version this artifact was serialized with. */
  contractVersion: z.number().int().positive(),
  /** ISO-8601 creation timestamp. */
  createdAt: z.string().datetime(),
  /** ISO-8601 last-update timestamp. */
  updatedAt: z.string().datetime(),
});

export type DesignArtifactContract = z.infer<typeof DesignArtifactContractSchema>;
