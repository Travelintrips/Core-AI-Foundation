/**
 * branding-identity/service.ts — Team 27
 *
 * Domain service — ADAPTER pattern, consistent with other domain plugins.
 *
 * Uses an in-memory store (same pattern as graphic-design/service.ts).
 * All execution is gated through the workflow state machine.
 * Agent calls go through the injected BrandingAgentAdapter — never direct.
 *
 * IMPORTANT: No direct AI provider, model, or DB calls from this module.
 */

import { randomUUID } from "crypto";
import type { BrandingBrief, BrandingStatus, BrandingStage, BrandingArtifactType, ArtifactRegistration } from "./schema.js";
import {
  createWorkflowState,
  advanceStage,
  getWorkflowProgress,
  type WorkflowState,
  type WorkflowProgress,
} from "./workflow.js";
import { canExport, getStageArtifacts } from "./manifest.js";
import type { BrandingAgentAdapter } from "./agentAdapter.js";

// ── Stored types ──────────────────────────────────────────────────────────────

export interface StoredBrief {
  id:          string;
  brief:       BrandingBrief;
  workflow:    WorkflowState;
  artifacts:   RegisteredArtifact[];
  createdAt:   string;
  updatedAt:   string;
}

export interface RegisteredArtifact extends ArtifactRegistration {
  id:          string;
  briefId:     string;
  registeredAt: string;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface CreateBriefResult {
  id:       string;
  workflow: WorkflowState;
  brief:    BrandingBrief;
}

export interface ListBriefsResult {
  items:      BriefSummary[];
  total:      number;
  page:       number;
  pageSize:   number;
}

export interface BriefSummary {
  id:           string;
  companyName:  string;
  currentStage: BrandingStage;
  status:       BrandingStatus;
  artifactCount: number;
  createdAt:    string;
  updatedAt:    string;
}

export interface AdvanceStageResult {
  workflow:  WorkflowState;
  progress:  WorkflowProgress;
  stageArtifacts: ReturnType<typeof getStageArtifacts>;
}

export interface GuidelineExport {
  briefId:         string;
  companyName:     string;
  exportedAt:      string;
  canExport:       boolean;
  missingArtifacts: BrandingArtifactType[];
  artifacts:       RegisteredArtifact[];
  workflow:        WorkflowState;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const briefs = new Map<string, StoredBrief>();

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createBrief(
  data: BrandingBrief,
): CreateBriefResult {
  const id       = randomUUID();
  const now      = new Date().toISOString();
  const workflow = createWorkflowState(id);

  const record: StoredBrief = {
    id,
    brief:     data,
    workflow,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  briefs.set(id, record);

  return { id, workflow, brief: data };
}

export function getBrief(id: string): StoredBrief {
  const record = briefs.get(id);
  if (!record) {
    const err = Object.assign(new Error(`Brief not found: ${id}`), { status: 404 });
    throw err;
  }
  return record;
}

export interface ListOptions {
  status?:   BrandingStatus;
  stage?:    BrandingStage;
  page?:     number;
  pageSize?: number;
}

export function listBriefs(opts: ListOptions = {}): ListBriefsResult {
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  let items = [...briefs.values()];
  if (opts.status) items = items.filter((b) => b.workflow.status === opts.status);
  if (opts.stage)  items = items.filter((b) => b.workflow.currentStage === opts.stage);

  const total = items.length;
  const slice = items.slice((page - 1) * pageSize, page * pageSize);

  const summaries: BriefSummary[] = slice.map((b) => ({
    id:           b.id,
    companyName:  b.brief.companyName,
    currentStage: b.workflow.currentStage,
    status:       b.workflow.status,
    artifactCount: b.artifacts.length,
    createdAt:    b.createdAt,
    updatedAt:    b.updatedAt,
  }));

  return { items: summaries, total, page, pageSize };
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export function advanceBriefStage(
  id:          string,
  targetStage: BrandingStage,
  note?:       string,
): AdvanceStageResult {
  const record = getBrief(id);
  const result = advanceStage(record.workflow, targetStage, note);
  if (!result.ok) {
    const err = Object.assign(new Error(result.error), { status: 400 });
    throw err;
  }

  record.workflow = result.state;
  record.updatedAt = new Date().toISOString();
  briefs.set(id, record);

  return {
    workflow:       result.state,
    progress:       getWorkflowProgress(result.state),
    stageArtifacts: getStageArtifacts(targetStage),
  };
}

export function getBriefWorkflow(id: string): {
  workflow:  WorkflowState;
  progress:  WorkflowProgress;
} {
  const record = getBrief(id);
  return {
    workflow: record.workflow,
    progress: getWorkflowProgress(record.workflow),
  };
}

// ── Artifact registry ─────────────────────────────────────────────────────────

export function registerArtifact(
  briefId: string,
  data:    ArtifactRegistration,
): RegisteredArtifact {
  const record = getBrief(briefId);

  const artifact: RegisteredArtifact = {
    ...data,
    id:           randomUUID(),
    briefId,
    registeredAt: new Date().toISOString(),
  };

  record.artifacts.push(artifact);
  record.updatedAt = new Date().toISOString();
  briefs.set(briefId, record);

  return artifact;
}

export function listArtifacts(briefId: string): RegisteredArtifact[] {
  const record = getBrief(briefId);
  return record.artifacts;
}

// ── Guideline export ──────────────────────────────────────────────────────────

export function exportGuideline(briefId: string): GuidelineExport {
  const record = getBrief(briefId);
  const registeredTypes = record.artifacts.map((a) => a.artifactType);
  const exportCheck     = canExport(registeredTypes);

  return {
    briefId,
    companyName:      record.brief.companyName,
    exportedAt:       new Date().toISOString(),
    canExport:        exportCheck.canExport,
    missingArtifacts: exportCheck.missing,
    artifacts:        record.artifacts,
    workflow:         record.workflow,
  };
}

// ── AI-assisted stage execution ───────────────────────────────────────────────

/**
 * Run the Creative Director agent to extract a structured brief from a
 * free-text prompt and optionally store it.
 *
 * The adapter is injected so tests can use the mock.
 */
export async function runCreativeBriefExtraction(
  userPrompt: string,
  adapter:    BrandingAgentAdapter,
): Promise<Awaited<ReturnType<BrandingAgentAdapter["extractCreativeBrief"]>>> {
  return adapter.extractCreativeBrief(userPrompt);
}

/**
 * Run the Brand Strategy agent for a stored brief.
 * Results are NOT auto-registered — the caller decides whether to persist.
 */
export async function runBrandStrategyForBrief(
  briefId: string,
  adapter: BrandingAgentAdapter,
): Promise<Awaited<ReturnType<BrandingAgentAdapter["runBrandStrategy"]>>> {
  const record = getBrief(briefId);

  // Build a minimal CreativeBrief from the stored BrandingBrief
  const creativeBrief = {
    designGoal:             `Build brand identity for ${record.brief.companyName}`,
    communicationObjective: record.brief.positioning,
    targetAudience: {
      primary:         record.brief.targetAudience,
      characteristics: record.brief.brandPersonality,
    },
    coreMessage:      record.brief.valueProposition ?? record.brief.positioning,
    tone:             record.brief.tone,
    desiredEmotion:   record.brief.brandValues,
    visualDirection:  [record.brief.preferredStyle],
    styleKeywords:    record.brief.brandPersonality,
    contentPriority:  record.brief.usageChannels,
    assumptions:      [],
    missingInformation: [],
  };

  // Minimal RequirementAnalysis (plugin-level, not canvas-level)
  const requirementAnalysis = {
    platform:   record.brief.usageChannels.join(", "),
    language:   record.brief.language,
    canvas:     { width: 0, height: 0, unit: "px" as const, orientation: "landscape" as const },
    sections:   [],
    callsToAction:         [],
    requestedVariables:    [],
    requiredContent:       [],
    optionalContent:       [],
    contentConstraints:    [],
    visualConstraints:     record.brief.colorConstraints.map((c) => `color: ${c}`),
    exportFormats:         ["pdf", "svg", "png"],
    explicitRequirements:  [],
    inferredRequirements:  [],
    missingInformation:    [],
    conflicts:             [],
  };

  return adapter.runBrandStrategy({
    creativeBrief,
    requirementAnalysis,
    brandProfile: {
      industry:    record.brief.industry,
      competitors: record.brief.competitors,
      channels:    record.brief.usageChannels,
    },
  });
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Clear all in-memory data (test use only). */
export function _resetStore(): void {
  briefs.clear();
}
