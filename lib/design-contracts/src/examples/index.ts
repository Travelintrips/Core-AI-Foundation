/**
 * examples/index.ts — Minimal canonical JSON examples for each major domain.
 *
 * PURPOSE: These objects demonstrate how Team 02–40 should populate the core
 * contracts for their domain WITHOUT adding domain-specific fields to the
 * core schema. Domain detail lives in `extensions` or in plugin-owned schemas.
 *
 * These are DOCUMENTATION ARTIFACTS, not production data.
 * They must remain valid against the current schema (tested in contracts.test.ts).
 *
 * Domains:
 *   Original (V1): Fashion, Interior, Packaging, Branding
 *   Added (Rev 1):  Furniture, Architecture, Landscape, Industrial Product, Jewelry
 */

import type {
  DesignProjectContext,
  DesignArtifactContract,
  DesignPluginManifest,
  DesignStageDefinition,
  GenericDesignEvent,
  ArtifactRelationship,
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

// ═══════════════════════════════════════════════════════════════════════════════
// ORIGINAL DOMAINS (V1) — Fashion, Interior, Packaging, Branding
// ═══════════════════════════════════════════════════════════════════════════════

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
  stability: "stable",
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
  dependencies: [
    { pluginId: "export-renderer", minimumVersion: "1.0.0", optional: false, reason: "Required for PDF/PPTX export of production specs" },
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
  stability: "stable",
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
  dependencies: [],
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
  stability: "stable",
  supportedServices: ["PACKAGING_DESIGN"],
  briefSchemaRef: "@workspace/plugins-packaging/brief-schema",
  workflowRef: "@workspace/plugins-packaging/workflow",
  capabilities: [
    { capabilityId: "packaging:generate_dieline", requiresAi: true, producesDeliverable: true },
    { capabilityId: "packaging:render_mockup", requiresAi: true, producesDeliverable: true },
    { capabilityId: "packaging:export_print_spec", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [],
  dependencies: [],
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
  stability: "stable",
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
  dependencies: [],
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

// ═══════════════════════════════════════════════════════════════════════════════
// NEW DOMAINS (Revision 1) — Furniture, Architecture, Landscape,
//                            Industrial Product, Jewelry
// ═══════════════════════════════════════════════════════════════════════════════

// ── FURNITURE example ─────────────────────────────────────────────────────────

export const FURNITURE_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "55555555-5555-5555-5555-555555555555",
  tenantId: "tenant_kayu_studio",
  serviceType: "FURNITURE_DESIGN",
  domainPluginId: "furniture",
  locale: "id-ID",
  status: "draft",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_kayu_studio" },
  correlationId: "e5f6a7b8-c9d0-1234-efab-345678901234",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Kayu Studio",
    primaryColors: ["#8B5E3C", "#F0EAD6"],
    brandTags: ["sustainable-wood", "artisan", "contemporary"],
  },
  extensions: {
    furnitureCategory: "seating",
    primaryMaterial: "teak",
    productionMethod: "CNC+handcraft",
    targetMarket: "hospitality",
  },
};

export const FURNITURE_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "furniture",
  displayName: "Furniture Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "stable",
  supportedServices: ["FURNITURE_DESIGN", "FURNITURE_CUSTOM"],
  briefSchemaRef: "@workspace/plugins-furniture/brief-schema",
  workflowRef: "@workspace/plugins-furniture/workflow",
  capabilities: [
    { capabilityId: "furniture:generate_concept_sketch", requiresAi: true, producesDeliverable: true },
    { capabilityId: "furniture:render_3d_model", requiresAi: true, producesDeliverable: true },
    { capabilityId: "furniture:export_cnc_spec", requiresAi: false, producesDeliverable: true },
    { capabilityId: "furniture:generate_bom", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "furniture_ar_preview_enabled", defaultEnabled: false, description: "Enables AR placement preview" },
  ],
  dependencies: [
    { pluginId: "material", minimumVersion: "1.0.0", optional: false, reason: "Material library for wood species and finishes" },
  ],
};

// ── ARCHITECTURE example ──────────────────────────────────────────────────────

export const ARCHITECTURE_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "66666666-6666-6666-6666-666666666666",
  tenantId: "tenant_archi_collective",
  serviceType: "ARCHITECTURE_DESIGN",
  domainPluginId: "architecture",
  locale: "en-US",
  status: "brief_submitted",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_archi_collective" },
  correlationId: "f6a7b8c9-d0e1-2345-fabc-456789012345",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Archi Collective",
    primaryColors: ["#2D3748", "#E2E8F0"],
    brandTags: ["tropical-modernism", "passive-design", "biophilic"],
  },
  extensions: {
    buildingType: "residential",
    plotAreaSqm: 500,
    floors: 2,
    greenBuildingTarget: "GREENSHIP-SILVER",
    climateZone: "tropical-humid",
  },
};

export const ARCHITECTURE_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "architecture",
  displayName: "Architecture Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "preview",
  supportedServices: ["ARCHITECTURE_DESIGN", "ARCHITECTURE_CONCEPT"],
  briefSchemaRef: "@workspace/plugins-architecture/brief-schema",
  workflowRef: "@workspace/plugins-architecture/workflow",
  capabilities: [
    { capabilityId: "architecture:generate_site_analysis", requiresAi: true, producesDeliverable: true },
    { capabilityId: "architecture:generate_floor_plan", requiresAi: true, producesDeliverable: true },
    { capabilityId: "architecture:render_facade", requiresAi: true, producesDeliverable: true },
    { capabilityId: "architecture:export_cad_drawing", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "architecture_bim_export_enabled", defaultEnabled: false, description: "Enables BIM/IFC export" },
  ],
  dependencies: [],
};

// ── LANDSCAPE example ─────────────────────────────────────────────────────────

export const LANDSCAPE_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "77777777-7777-7777-7777-777777777777",
  tenantId: "tenant_hijau_design",
  serviceType: "LANDSCAPE_DESIGN",
  domainPluginId: "landscape",
  locale: "id-ID",
  status: "draft",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_hijau_design" },
  correlationId: "a7b8c9d0-e1f2-3456-abcd-567890123456",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Hijau Design Studio",
    primaryColors: ["#2D6A4F", "#B7E4C7"],
    brandTags: ["native-plants", "edible-garden", "biophilic"],
  },
  extensions: {
    siteType: "residential-garden",
    plotAreaSqm: 200,
    climateAdaptationRequired: true,
    nativePlantFocused: true,
  },
};

export const LANDSCAPE_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "landscape",
  displayName: "Landscape Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "experimental",
  supportedServices: ["LANDSCAPE_DESIGN", "LANDSCAPE_MASTERPLAN"],
  briefSchemaRef: "@workspace/plugins-landscape/brief-schema",
  workflowRef: "@workspace/plugins-landscape/workflow",
  capabilities: [
    { capabilityId: "landscape:generate_planting_plan", requiresAi: true, producesDeliverable: true },
    { capabilityId: "landscape:render_3d_view", requiresAi: true, producesDeliverable: true },
    { capabilityId: "landscape:generate_plant_schedule", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "landscape_seasonal_simulation_enabled", defaultEnabled: false },
  ],
  dependencies: [],
};

// ── INDUSTRIAL PRODUCT example ────────────────────────────────────────────────

export const INDUSTRIAL_PRODUCT_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "88888888-8888-8888-8888-888888888888",
  tenantId: "tenant_produk_inovasi",
  serviceType: "INDUSTRIAL_PRODUCT_DESIGN",
  domainPluginId: "industrial-product",
  locale: "en-US",
  status: "in_progress",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_produk_inovasi" },
  correlationId: "b8c9d0e1-f2a3-4567-bcde-678901234567",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Produk Inovasi",
    primaryColors: ["#1B4F72", "#F0F3F4"],
    brandTags: ["ergonomic", "mass-production", "consumer-electronics"],
  },
  extensions: {
    productCategory: "consumer-electronics",
    manufacturingProcess: "injection-molding",
    targetAnnualVolume: 50000,
    regulatoryMark: ["CE", "FCC"],
  },
};

export const INDUSTRIAL_PRODUCT_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "industrial-product",
  displayName: "Industrial Product Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "stable",
  supportedServices: ["INDUSTRIAL_PRODUCT_DESIGN"],
  briefSchemaRef: "@workspace/plugins-industrial-product/brief-schema",
  workflowRef: "@workspace/plugins-industrial-product/workflow",
  capabilities: [
    { capabilityId: "industrial-product:generate_concept", requiresAi: true, producesDeliverable: true },
    { capabilityId: "industrial-product:render_product_view", requiresAi: true, producesDeliverable: true },
    { capabilityId: "industrial-product:export_technical_drawing", requiresAi: false, producesDeliverable: true },
    { capabilityId: "industrial-product:generate_dfm_report", requiresAi: true, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "industrial_cfd_simulation_enabled", defaultEnabled: false, description: "Computational fluid dynamics simulation" },
  ],
  dependencies: [
    { pluginId: "export-renderer", minimumVersion: "1.0.0", optional: false, reason: "Technical drawing export" },
    { pluginId: "simulation-engine", minimumVersion: "1.0.0", optional: true, reason: "Stress/thermal simulation" },
  ],
};

// ── JEWELRY example ───────────────────────────────────────────────────────────

export const JEWELRY_PROJECT_CONTEXT: DesignProjectContext = {
  projectId: "99999999-9999-9999-9999-999999999999",
  tenantId: "tenant_perhiasan_artisan",
  serviceType: "JEWELRY_DESIGN",
  domainPluginId: "jewelry",
  locale: "id-ID",
  status: "draft",
  actor: { ...EXAMPLE_ACTOR, tenantId: "tenant_perhiasan_artisan" },
  correlationId: "c9d0e1f2-a3b4-5678-cdef-789012345678",
  contractVersion: DESIGN_CONTRACT_VERSION,
  brandContext: {
    brandName: "Perhiasan Artisan",
    primaryColors: ["#DAA520", "#1C1C1C"],
    brandTags: ["fine-jewelry", "handcrafted", "bespoke"],
  },
  extensions: {
    metalType: "18k-gold",
    gemstones: ["diamond", "ruby"],
    productionMethod: "lost-wax-casting",
    clientTier: "luxury",
  },
};

export const JEWELRY_PLUGIN_MANIFEST: DesignPluginManifest = {
  pluginId: "jewelry",
  displayName: "Jewelry Design Plugin",
  version: "1.0.0",
  compatibleContractVersion: DESIGN_CONTRACT_VERSION,
  stability: "experimental",
  supportedServices: ["JEWELRY_DESIGN", "JEWELRY_BESPOKE"],
  briefSchemaRef: "@workspace/plugins-jewelry/brief-schema",
  workflowRef: "@workspace/plugins-jewelry/workflow",
  capabilities: [
    { capabilityId: "jewelry:generate_sketch", requiresAi: true, producesDeliverable: true },
    { capabilityId: "jewelry:render_photorealistic", requiresAi: true, producesDeliverable: true },
    { capabilityId: "jewelry:export_cad_model", requiresAi: false, producesDeliverable: true },
    { capabilityId: "jewelry:generate_stone_report", requiresAi: false, producesDeliverable: true },
  ],
  featureFlags: [
    { key: "jewelry_vr_try_on_enabled", defaultEnabled: false, description: "Virtual try-on AR feature" },
  ],
  dependencies: [],
};

// ── Example artifact relationship lineage ──────────────────────────────────────
// Demonstrates the design lineage contract: Moodboard → Concept → Technical Drawing

export const EXAMPLE_ARTIFACT_LINEAGE: ArtifactRelationship[] = [
  {
    relationshipId: "ffffffff-ffff-ffff-ffff-000000000001",
    parentArtifactId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // Branding Logo
    childArtifactId:  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // Brand Guidelines
    relationshipType: "presentation_of",
    createdAt: "2026-07-21T10:10:00.000Z",
    metadata: { stageTransition: "logo_concept → brand_guidelines" },
  },
  {
    relationshipId: "ffffffff-ffff-ffff-ffff-000000000002",
    parentArtifactId: "cccccccc-cccc-cccc-cccc-cccccccccccc", // Moodboard
    childArtifactId:  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // Logo
    relationshipType: "derived_from",
    createdAt: "2026-07-21T10:05:00.000Z",
  },
];
