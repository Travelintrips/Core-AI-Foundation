/**
 * graphicDesignService.ts — Graphic Design Domain (Team 15)
 *
 * Orchestration service — port interface to Team 7–14 engines.
 * Does NOT implement any renderer, template engine, or asset library.
 * All generation is delegated via job dispatch (Team 14).
 *
 * Responsibilities:
 *   1. Validate brief readiness before dispatch
 *   2. Resolve blueprint → job type → dispatch
 *   3. Score QC on job result
 *   4. Build and persist deliverable manifest
 *   5. Enforce package policy (revisions, source access, SLA)
 */

import type { GraphicDesignServiceCode, GdPackageTier, GdQcResult, GdDeliverableManifest } from "./types.js";
import { scoreGraphicDesignBrief, assertGdBriefReady, extractPackageTier } from "./briefSchema.js";
import { getGdBlueprint, getGdPrintSpec } from "./blueprintMapping.js";
import { getGdComponents, checkComponentReadiness } from "./componentMapping.js";
import { scoreGraphicDesignOutput, type GdGenerationReport } from "./qcRules.js";
import { buildGdManifest } from "./deliverableManifest.js";
import { resolveGdPolicy, assertRevisionAllowed, computeSlaDueDate, isHumanQcRequired } from "./packagePolicy.js";

// ── Port interface stubs (Team 7–14) ──────────────────────────────────────────
//
// In production these are invoked via the shared job engine / Team 14 dispatch.
// They are declared as typed function shapes so tests can inject fakes.

export interface GdPorts {
  /** Team 14: Dispatch a job and return the job ID. */
  dispatchJob(payload: {
    jobType: string;
    tenantId: string;
    requestId: number;
    briefContext: Record<string, unknown>;
    priority: number;
  }): Promise<{ jobId: number }>;

  /** Team 14: Retrieve a completed job result. */
  getJobResult(jobId: number): Promise<{
    status: "completed" | "failed" | "processing";
    resultMetadata?: Record<string, unknown>;
    errorMessage?: string;
  }>;

  /** Team 7: Fetch brand DNA for tenant. */
  getBrandDna(tenantId: string): Promise<{
    found: boolean;
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    logoStoragePath?: string;
  }>;

  /** Team 8: Resolve asset library for tenant (logo, photos). */
  resolveAssetLibrary(tenantId: string): Promise<{
    hasLogo: boolean;
    logoStoragePath?: string;
  }>;

  /** Team 12: Build ZIP from manifest and return storage path. */
  buildZip(manifest: GdDeliverableManifest): Promise<{ storagePath: string }>;
}

// ── Service inputs/outputs ────────────────────────────────────────────────────

export interface GdDispatchInput {
  gdRequestId: number;
  serviceRequestId: number;
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
  tenantId: string;
  briefJson: Record<string, unknown>;
}

export interface GdDispatchResult {
  jobId: number;
  jobType: string;
  slaDueDate: Date;
  componentWarnings: string[];
  briefReadiness: ReturnType<typeof scoreGraphicDesignBrief>;
}

export interface GdQcInput {
  gdRequestId: number;
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
  tenantId: string;
  generationReport: GdGenerationReport;
}

export interface GdDeliverInput {
  gdRequestId: number;
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
  tenantId: string;
  producedFiles: Array<{
    fileName: string;
    storagePath?: string;
    fileSizeBytes?: number;
    checksumSha256?: string;
    widthPx?: number;
    heightPx?: number;
  }>;
  qcResult: GdQcResult;
}

// ── Service class ─────────────────────────────────────────────────────────────

export class GraphicDesignService {
  constructor(private readonly ports: GdPorts) {}

  /**
   * Step 1 — Validate brief and dispatch the generation job.
   * Throws if brief is incomplete or component readiness fails.
   */
  async dispatch(input: GdDispatchInput): Promise<GdDispatchResult> {
    const { gdRequestId, serviceCode, packageTier, tenantId, briefJson } = input;

    // Brief readiness check (throws if not ready)
    assertGdBriefReady(briefJson, serviceCode);
    const briefReadiness = scoreGraphicDesignBrief(briefJson, serviceCode);

    // Resolve blueprint
    const blueprint = getGdBlueprint(serviceCode);
    const policy = resolveGdPolicy(packageTier, serviceCode);

    // Component readiness — non-brief sources
    const [brandDna, assetLib] = await Promise.all([
      policy.brandDnaEnabled
        ? this.ports.getBrandDna(tenantId)
        : Promise.resolve({ found: false }),
      policy.assetLibraryEnabled
        ? this.ports.resolveAssetLibrary(tenantId)
        : Promise.resolve({ hasLogo: false }),
    ]);

    const unresolvedComponents = checkComponentReadiness(serviceCode, {
      hasLogoAsset: assetLib.hasLogo,
      hasBrandDna: brandDna.found,
      hasAssetLibrary: policy.assetLibraryEnabled,
    });

    const componentWarnings = unresolvedComponents.map(
      (c) => `Required component '${c}' could not be resolved — using AI-generated fallback.`,
    );

    // Build job payload for Team 14
    const jobPayload = {
      jobType: blueprint.jobType,
      tenantId,
      requestId: gdRequestId,
      briefContext: {
        ...briefJson,
        serviceCode,
        packageTier,
        promptTemplate: blueprint.promptTemplate,
        printSpec: getGdPrintSpec(serviceCode),
        brandDna: brandDna.found ? brandDna : null,
        assetLibrary: assetLib.hasLogo ? assetLib : null,
        maxImageGenerationAttempts: policy.maxImageGenerationAttempts,
      },
      priority: policy.dispatchPriority,
    };

    const { jobId } = await this.ports.dispatchJob(jobPayload);

    const slaDueDate = computeSlaDueDate(packageTier, serviceCode, new Date());

    return { jobId, jobType: blueprint.jobType, slaDueDate, componentWarnings, briefReadiness };
  }

  /**
   * Step 2 — Run QC on a completed job result.
   * Returns structured QC result for persistence.
   */
  runQc(input: GdQcInput): GdQcResult {
    return scoreGraphicDesignOutput(
      input.generationReport,
      input.serviceCode,
      input.packageTier,
    );
  }

  /**
   * Step 3 — Build the deliverable manifest and create ZIP via Team 12.
   */
  async buildDeliverable(input: GdDeliverInput): Promise<{
    manifest: GdDeliverableManifest;
    zipStoragePath: string;
  }> {
    const manifest = buildGdManifest({
      gdRequestId: input.gdRequestId,
      serviceCode: input.serviceCode,
      packageTier: input.packageTier,
      tenantId: input.tenantId,
      producedFiles: input.producedFiles,
      qcSummary: {
        score: input.qcResult.qcScore,
        passed: input.qcResult.passed,
        warnings: input.qcResult.warnings,
      },
    });

    const { storagePath: zipStoragePath } = await this.ports.buildZip(manifest);

    return { manifest, zipStoragePath };
  }

  /**
   * Validate a revision request against package policy.
   */
  assertRevision(
    tier: GdPackageTier,
    serviceCode: GraphicDesignServiceCode,
    revisionsUsed: number,
  ): { remainingRevisions: number } {
    const remaining = assertRevisionAllowed(tier, serviceCode, revisionsUsed);
    return { remainingRevisions: remaining };
  }

  /**
   * Check whether this delivery requires human QC sign-off before unlock.
   */
  requiresHumanQc(tier: GdPackageTier, serviceCode: GraphicDesignServiceCode): boolean {
    return isHumanQcRequired(tier, serviceCode);
  }

  /**
   * Get component checklist for a service (for UI display).
   */
  getComponentChecklist(serviceCode: GraphicDesignServiceCode) {
    return getGdComponents(serviceCode);
  }
}
