/**
 * examples/index.ts — Minimal canonical JSON examples for each major domain.
 *
 * PURPOSE: These objects demonstrate how Team 02–40 should populate the core
 * contracts for their domain WITHOUT adding domain-specific fields to the
 * core schema. Domain detail lives in `extensions` or in plugin-owned schemas.
 *
 * These are DOCUMENTATION ARTIFACTS, not production data.
 * They must remain valid against the current schema (tested in contracts.test.ts).
 */

import type {
  DesignProjectContext,
  DesignArtifactContract,
  DesignPluginManifest,
  DesignStageDefinition,
  GenericDesignEvent,
} from "../index.js";
import { DESIGN_CONTRACT_VERSION } from "../version.js";

// ── Shared actor (used across all examples) ────────────────────────────────────

const EXAMPLE_ACTOR = {
  actorId: "usr_example_tenant_admin",
  actorType: "tenant_admin" as const,
  tenantId: "tenant_acme_studio",
  isPlatformAdmin: false,
};

const EXAMPLE_CORRELATION = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ── FASHION example ───────────────────────────────────────────────────────────

export const FASHION_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "11111111-1111-1111-1111-111111111111",
  tenantId: "tenant_acme_studio",
  serviceType: "FASHION_DESIGN",        // opaque service code
  domainPluginId: "fashion",            // plugin handles the workflow
  locale: "id-ID",
  status: "in_progress",
  actor: EXAMPLE_ACTOR,
  correlationId: EXAMPLE_CORRELATION,
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Nusantara Couture",
    primaryColors: ["#8B1A1A", "#D4AF37"],
    brandTags: ["batik-inspired", "sustainable", "luxury"],
  },
  // Domain-specific fields live here — the core engine does NOT read them.
  extensions: {
    fashionSeason: "SS-2026",
    targetGender: "womenswear",
    collectionTheme: "Heritage Reborn",
  },
};

export const FASHION_STAGE_MOODBOARD: DesignStageDefinition = {
  stageId: "fashion:moodboard",
  title: "Moodboard",
  category: "moodboard",
  dependencies: ["fashion:brief"],
  requiredCapabilities: ["fashion:generate_moodboard"],
  supportedArtifactTypes: ["image"],
  completionPolicy: "any_artifact",
  optional: false,
  repeatable: true,
  displayOrder: 2,
};

export const FASHION_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "fashion",
  displayName: "Fashion Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  supportedServices: ["FASHION_DESIGN", "FASHION_LOOKBOOK"],
  briefSchemaRef: "@workspace/plugins-fashion/brief-schema",
  workflowRef: "@workspace/plugins-fashion/workflow",
  capabilities: [
    { capabilityId: "fashion:generate_moodboard", requiresAi: true, producesDeliverable: true },
    { capabilityId: "fashion:render_technical_drawing", requiresAi: true, producesDeliverable: true },
    { capabilityId: "fashion:export_production_spec", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "fashion_3d_view_enabled", defaultEnabled: false, description: "Enables 3D garment visualization" },
  ],
};

// ── INTERIOR example ──────────────────────────────────────────────────────────

export const INTERIOR_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "22222222-2222-2222-2222-222222222222",
  tenantId: "tenant_ruang_studio",
  serviceType: "INTERIOR_DESIGN",
  domainPluginId: "interior",
  locale: "id-ID",
  status: "brief_submitted",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_ruang_studio" },
  correlationId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Ruang Studio",
    primaryColors: ["#F5F0EB", "#2C3E50"],
    brandTags: ["minimalist", "tropical-modern"],
  },
  extensions: {
    projectScope: "residential",
    roomCount: 3,
    stylePreference: "tropical-minimalist",
  },
};

export const INTERIOR_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "interior",
  displayName: "Interior Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  supportedServices: ["INTERIOR_DESIGN", "INTERIOR_COMMERCIAL"],
  briefSchemaRef: "@workspace/plugins-interior/brief-schema",
  workflowRef: "@workspace/plugins-interior/workflow",
  capabilities: [
    { capabilityId: "interior:generate_moodboard", requiresAi: true, producesDeliverable: true },
    { capabilityId: "interior:render_space_plan", requiresAi: true, producesDeliverable: true },
    { capabilityId: "interior:generate_boq", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "interior_3d_view_enabled", defaultEnabled: false },
  ],
};

// ── PACKAGING example ─────────────────────────────────────────────────────────

export const PACKAGING_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "33333333-3333-3333-3333-333333333333",
  tenantId: "tenant_kemasan_pro",
  serviceType: "PACKAGING_DESIGN",
  domainPluginId: "packaging",
  locale: "en-US",
  status: "draft",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_kemasan_pro" },
  correlationId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "EcoWrap",
    primaryColors: ["#4CAF50", "#FFFFFF"],
    brandTags: ["eco-friendly", "sustainable", "fmcg"],
  },
  extensions: {
    packagingSubtype: "box",
    productCategory: "food",
    sustainabilityRequired: true,
  },
};

export const PACKAGING_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "packaging",
  displayName: "Packaging Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  supportedServices: ["PACKAGING_DESIGN"],
  briefSchemaRef: "@workspace/plugins-packaging/brief-schema",
  workflowRef: "@workspace/plugins-packaging/workflow",
  capabilities: [
    { capabilityId: "packaging:generate_dieline", requiresAi: true, producesDeliverable: true },
    { capabilityId: "packaging:render_mockup", requiresAi: true, producesDeliverable: true },
    { capabilityId: "packaging:export_print_spec", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [],
};

// ── BRANDING example ──────────────────────────────────────────────────────────

export const BRANDING_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "44444444-4444-4444-4444-444444444444",
  tenantId: "tenant_brand_forge",
  serviceType: "BRANDING",
  domainPluginId: "branding",
  locale: "en-US",
  status: "in_progress",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_brand_forge" },
  correlationId: "d4e5f6a7-b8c9-0123-defa-234567890123",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Luminary",
    primaryColors: ["#1A1A2E", "#E94560"],
    brandTags: ["tech", "premium", "b2b"],
  },
  extensions: {
    brandMaturity: "startup",
    deliverableScope: ["logo", "brand_system", "guidelines"],
  },
};

export const BRANDING_ARTIFACT_LOGO: DesignArtifactContract = {
  artifactId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  artifactType: "vector",
  projectId: "44444444-4444-4444-4444-444444444444",
  stageId: "branding:logo_concept",
  version: 1,
  status: "ready",
  storageRef: {
    bucket: "design-artifacts",
    key: "tenant_brand_forge/44444444/logo-v1.svg",
    provider: "supabase",
    mimeType: "image/svg+xml",
    sizeBytes: 24576,
  },
  metadata: {
    label: "Luminary Logo — Primary Mark",
    qualityScore: 88,
  },
  provenance: {
    jobId: "job_abc123",
    capabilityId: "branding:generate_logo",
    actorId: "usr_example_tenant_admin",
    requestedAt: "2026-07-21T10:00:00.000Z",
    completedAt: "2026-07-21T10:02:30.000Z",
    modelRef: "image-gen-v2",
    promptDigest: "sha256:abcdef1234567890",
  },
  generationSource: "ai_agent",
  reviewStatus: "under_review",
  contractVersion: DESIGN_CONTRACT_VERSION,
  createdAt: "2026-07-21T10:02:30.000Z",
  updatedAt: "2026-07-21T10:05:00.000Z",
};

export const BRANDING_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "branding",
  displayName: "Branding Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  supportedServices: ["BRANDING", "BRAND_REFRESH"],
  briefSchemaRef: "@workspace/plugins-branding/brief-schema",
  workflowRef: "@workspace/plugins-branding/workflow",
  capabilities: [
    { capabilityId: "branding:generate_strategy", requiresAi: true, producesDeliverable: false },
    { capabilityId: "branding:generate_logo", requiresAi: true, producesDeliverable: true },
    { capabilityId: "branding:export_brand_guidelines", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "branding_ai_strategy_enabled", defaultEnabled: true },
  ],
};

// ── Example event ─────────────────────────────────────────────────────────────

export const EXAMPLE_STAGE_STARTED_EVENT: GenericDesignEvent = {
  eventId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  eventType: "STAGE_STARTED",
  occurredAt: "2026-07-21T10:00:00.000Z",
  projectId: "44444444-4444-4444-4444-444444444444",
  tenantId: "tenant_brand_forge",
  actor: { actorId: "usr_example_tenant_admin", actorType: "tenant_admin" },
  correlationId: "d4e5f6a7-b8c9-0123-defa-234567890123",
  causationId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  contractVersion: DESIGN_CONTRACT_VERSION,
  payloadVersion: 1,
  payload: {
    stageId: "branding:logo_concept",
    triggeredBy: "SUBMIT_BRIEF",
  },
};
