/**
 * packaging-design/plugin/manifest.ts — Team 26
 *
 * Master manifest for the Packaging Design Domain Plugin.
 *
 * Combines workflow, artifact types, overlay definitions, material profiles,
 * export presets, and compliance profiles into a single self-describing
 * metadata record.
 *
 * This manifest is:
 *   1. Returned by GET /ai/packaging-design-plugin/manifest
 *   2. Read by Team 39 (Integration) to wire routes and register the plugin
 *   3. Version-checked by the compatibility guard
 *
 * PURE module — no DB calls, no side effects.
 */

import { PACKAGING_WORKFLOW, WORKFLOW_STEP_IDS } from "./workflow.js";
import { listArtifactTypes, PACKAGING_ARTIFACT_TYPE_IDS } from "./artifacts.js";
import { listOverlayDefinitions, OVERLAY_TYPE_IDS } from "./overlays.js";
import { listSubstrates, SUBSTRATE_IDS } from "./material.js";
import { listExportPresets, EXPORT_PRESET_IDS } from "./export.js";
import { listComplianceProfiles } from "./compliance.js";
import { PACKAGING_SERVICE_TYPES } from "../schema.js";

// ── Plugin identity ───────────────────────────────────────────────────────────

export const PLUGIN_ID      = "packaging-design" as const;
export const PLUGIN_VERSION = "1.0.0" as const;
export const PLUGIN_TEAM    = "26" as const;

/**
 * Minimum api-server version required to load this plugin.
 * Prevents loading against an incompatible core.
 */
export const MIN_CORE_VERSION = "0.0.0" as const;

// ── Manifest type ─────────────────────────────────────────────────────────────

export interface PackagingPluginManifest {
  pluginId:          string;
  pluginTeam:        string;
  version:           string;
  minCoreVersion:    string;
  domain:            string;
  description:       string;
  /** Packaging service types this plugin handles. */
  supportedServices: readonly string[];
  workflow: {
    stepCount:    number;
    stepIds:      readonly string[];
    initialStep:  string;
    terminalStep: string;
    approvalGates: string[];
  };
  artifactTypes: {
    count:    number;
    ids:      readonly string[];
    deliverableIds: string[];
  };
  overlays: {
    count:       number;
    ids:         readonly string[];
    mandatory:   string[];
    structural:  string[];
  };
  material: {
    substrateCount: number;
    substrateIds:   readonly string[];
  };
  exportPresets: {
    count: number;
    ids:   readonly string[];
  };
  compliance: {
    profileCount: number;
    profileIds:   string[];
  };
  /** API routes registered by this plugin (informational). */
  routes: Array<{
    method: "GET" | "POST";
    path:   string;
    auth:   "admin" | "none";
    description: string;
  }>;
  integrationNotes: string[];
  createdAt: string;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildPluginManifest(): PackagingPluginManifest {
  const artifactTypes    = listArtifactTypes();
  const overlayDefs      = listOverlayDefinitions();
  const exportPresets    = listExportPresets();
  const complianceProfs  = listComplianceProfiles();
  const workflow         = PACKAGING_WORKFLOW;

  return {
    pluginId:       PLUGIN_ID,
    pluginTeam:     PLUGIN_TEAM,
    version:        PLUGIN_VERSION,
    minCoreVersion: MIN_CORE_VERSION,
    domain:         "packaging-design",
    description:
      "Packaging Design Domain Plugin — declares the 12-step design workflow, " +
      "8 artifact types, 7 overlay zone definitions (renderer boundary metadata), " +
      "material substrate registry, 6 export presets, and compliance profiles for " +
      "Indonesian food, cosmetic, and general retail packaging. " +
      "This plugin does NOT draw dielines or provide a CAD engine.",
    supportedServices: PACKAGING_SERVICE_TYPES,

    workflow: {
      stepCount:    workflow.steps.length,
      stepIds:      WORKFLOW_STEP_IDS,
      initialStep:  workflow.initialStep,
      terminalStep: workflow.terminalStep,
      approvalGates: workflow.steps
        .filter((s) => s.hasApprovalGate)
        .map((s) => s.id),
    },

    artifactTypes: {
      count:          artifactTypes.length,
      ids:            PACKAGING_ARTIFACT_TYPE_IDS,
      deliverableIds: artifactTypes.filter((t) => t.isDeliverable).map((t) => t.id),
    },

    overlays: {
      count:      overlayDefs.length,
      ids:        OVERLAY_TYPE_IDS,
      mandatory:  overlayDefs.filter((o) => o.mandatory).map((o) => o.id),
      structural: overlayDefs.filter((o) => o.isStructural).map((o) => o.id),
    },

    material: {
      substrateCount: listSubstrates().length,
      substrateIds:   SUBSTRATE_IDS,
    },

    exportPresets: {
      count: exportPresets.length,
      ids:   EXPORT_PRESET_IDS,
    },

    compliance: {
      profileCount: complianceProfs.length,
      profileIds:   complianceProfs.map((p) => p.profileId),
    },

    routes: [
      {
        method: "GET", path: "/ai/packaging-design-plugin/manifest",
        auth: "admin",
        description: "Full plugin manifest (all metadata combined).",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/workflow",
        auth: "admin",
        description: "12-step workflow definition with transitions.",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/artifact-types",
        auth: "admin",
        description: "All 8 artifact type definitions.",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/overlays",
        auth: "admin",
        description: "All 7 overlay zone definitions.",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/material-spec",
        auth: "admin",
        description: "Substrate registry and material contribution builder.",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/export-presets",
        auth: "admin",
        description: "All 6 export preset definitions.",
      },
      {
        method: "GET", path: "/ai/packaging-design-plugin/compliance-profiles",
        auth: "admin",
        description: "Compliance profiles keyed by packaging type.",
      },
      {
        method: "POST", path: "/ai/packaging-design-plugin/brief/validate",
        auth: "none",
        description: "Validate a raw brief payload against the Zod brief schema.",
      },
      {
        method: "POST", path: "/ai/packaging-design-plugin/compliance/build-sheet",
        auth: "admin",
        description: "Generate an initial compliance sheet for a given packaging type.",
      },
    ],

    integrationNotes: [
      "This plugin is additive — it does not modify Team 19's packaging_design_orders table.",
      "Overlay zone IDs match the overlay zone codes used in Team 19's prepress validation engine.",
      "Export preset IDs may be stored in briefJson.exportPreset on a packaging_design_orders record.",
      "Compliance sheet metadata may be stored as packagingDesignOrder.briefJson.complianceSheet.",
      "The brief schema's linkedOrderId field allows associating a plugin brief with a Team 19 order.",
      "No new DB tables are introduced by this plugin — all data is code-level metadata.",
      "Route prefix: /ai/packaging-design-plugin/* (admin) and /ai/packaging-design-plugin/brief/validate (public).",
    ],

    createdAt: new Date().toISOString(),
  };
}

// ── Compatibility guard ───────────────────────────────────────────────────────

/**
 * assertVersionCompatible
 *
 * Throws if the running core version is below the plugin's minimum requirement.
 * Pass `coreVersion` from the api-server's package.json version field.
 */
export function assertVersionCompatible(coreVersion: string): void {
  // Trivial semver comparison — "0.0.0" always passes.
  if (MIN_CORE_VERSION === "0.0.0") return;

  const parse = (v: string) => v.split(".").map(Number) as [number, number, number];
  const [minMaj, minMin, minPatch] = parse(MIN_CORE_VERSION);
  const [coreMaj, coreMin, corePatch] = parse(coreVersion);

  const compatible =
    coreMaj > minMaj ||
    (coreMaj === minMaj && coreMin > minMin) ||
    (coreMaj === minMaj && coreMin === minMin && corePatch >= minPatch);

  if (!compatible) {
    throw new Error(
      `Packaging design plugin ${PLUGIN_VERSION} requires core >= ${MIN_CORE_VERSION}, ` +
      `but running core is ${coreVersion}.`,
    );
  }
}
