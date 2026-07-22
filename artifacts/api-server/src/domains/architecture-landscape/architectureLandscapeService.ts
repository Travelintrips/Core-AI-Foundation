/**
 * architectureLandscapeService.ts — Team 29: Architecture & Landscape Design Plugin
 *
 * Business logic for architecture & landscape projects, workflow advancement,
 * artifact registration, and component contribution.
 *
 * KEY INVARIANTS:
 *   1. export_ready status MUST NOT be set unless all 12 workflow steps are complete.
 *   2. Artifact labels must pass honesty check before insertion.
 *   3. No BIM, GIS, CAD, structural calculation, or engineering engine is called.
 *   4. No hard-coded AI provider, model, tenant, service type, or domain.
 *   5. All outputs labelled "preview" for non-validated documents.
 */

import { randomUUID } from "crypto";
import { eq, desc, and, isNull, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  architectureLandscapeProjectsTable,
  architectureLandscapeArtifactsTable,
  architectureLandscapeComponentsTable,
  ARCHITECTURE_PROJECT_STATUSES,
  ARCHITECTURE_WORKFLOW_STEPS,
  type ArchitectureProjectStatus,
  type ArchitectureWorkflowStep,
  type ArchitectureLandscapeProject,
  type ArchitectureLandscapeArtifact,
  type ArchitectureLandscapeComponent,
  type OverlayMetadata,
  type ConstraintsJson,
  type SiteContextJson,
  type ArchitectureBriefJson,
} from "./schema.js";
import {
  validateBrief,
  validateSiteConstraints,
  checkArtifactHonesty,
  isValidArtifactType,
  isValidWorkflowStep,
  workflowStepIndex,
  nextWorkflowStep,
  type BriefInput,
  type SiteConstraintsInput,
} from "./validators.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status transition guard
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<
  ArchitectureProjectStatus,
  ArchitectureProjectStatus[]
> = {
  draft:                        ["brief_submitted", "cancelled"],
  brief_submitted:              ["site_context", "cancelled"],
  site_context:                 ["constraints", "cancelled"],
  constraints:                  ["research", "cancelled"],
  research:                     ["concept", "cancelled"],
  concept:                      ["program_zoning", "cancelled"],
  program_zoning:               ["spatial_direction", "cancelled"],
  spatial_direction:            ["material_landscape_direction", "cancelled"],
  material_landscape_direction: ["visualization", "cancelled"],
  visualization:                ["documentation", "cancelled"],
  documentation:                ["review", "cancelled"],
  review:                       ["export_ready", "cancelled"],
  export_ready:                 ["completed"],
  completed:                    [],
  cancelled:                    [],
};

export function isTransitionAllowed(
  from: ArchitectureProjectStatus,
  to: ArchitectureProjectStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Project CRUD
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  projectType: string;
  clientName: string;
  clientEmail: string;
  projectTitle: string;
  tenantId?: string | null;
  serviceRequestId?: number | null;
  siteLocation?: string | null;
  siteAreaM2?: string | null;
  builtAreaM2?: string | null;
  climate?: string | null;
  userDescription?: string | null;
  programJson?: string[];
  constraintsJson?: ConstraintsJson;
  regulationReferences?: string[];
  stylePreference?: string | null;
  materialPreferences?: string[];
  landscapeRequirements?: string | null;
  sustainabilityGoals?: string | null;
  accessibilityRequirements?: string | null;
  siteContextJson?: SiteContextJson;
  additionalNotes?: string | null;
}

export interface CreateProjectResult {
  ok: boolean;
  project?: ArchitectureLandscapeProject;
  errors?: Array<{ field: string; code: string; message: string }>;
  warnings?: Array<{ field: string; code: string; message: string }>;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  // Validate brief
  const briefInput: BriefInput = {
    projectType: input.projectType,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    projectTitle: input.projectTitle,
    siteLocation: input.siteLocation ?? undefined,
    siteAreaM2: input.siteAreaM2 ?? undefined,
    builtAreaM2: input.builtAreaM2 ?? undefined,
    climate: input.climate ?? undefined,
    userDescription: input.userDescription ?? undefined,
    program: input.programJson,
    landscapeRequirements: input.landscapeRequirements ?? undefined,
    sustainabilityGoals: input.sustainabilityGoals ?? undefined,
    accessibilityRequirements: input.accessibilityRequirements ?? undefined,
  };

  const validation = validateBrief(briefInput);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }

  const projectRef = `arch-${randomUUID()}`;

  const [project] = await db
    .insert(architectureLandscapeProjectsTable)
    .values({
      projectRef,
      tenantId: input.tenantId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
      projectType: input.projectType,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      projectTitle: input.projectTitle,
      siteLocation: input.siteLocation ?? null,
      siteAreaM2: input.siteAreaM2 ?? null,
      builtAreaM2: input.builtAreaM2 ?? null,
      climate: input.climate ?? null,
      userDescription: input.userDescription ?? null,
      programJson: input.programJson ?? [],
      constraintsJson: input.constraintsJson ?? {},
      regulationReferences: input.regulationReferences ?? [],
      stylePreference: input.stylePreference ?? null,
      materialPreferences: input.materialPreferences ?? [],
      landscapeRequirements: input.landscapeRequirements ?? null,
      sustainabilityGoals: input.sustainabilityGoals ?? null,
      accessibilityRequirements: input.accessibilityRequirements ?? null,
      siteContextJson: input.siteContextJson ?? {},
      briefJson: briefInput as ArchitectureBriefJson,
      hasLandscapeComponent: !!(
        input.landscapeRequirements || (input.programJson ?? []).some(
          (p) => p.toLowerCase().includes("landscape") || p.toLowerCase().includes("garden"),
        )
      ),
      hasSustainabilityRequirements: !!(input.sustainabilityGoals),
      hasAccessibilityRequirements: !!(input.accessibilityRequirements),
      additionalNotes: input.additionalNotes ?? null,
      currentStep: "brief",
      currentStepIndex: 0,
      status: "draft",
    })
    .returning();

  return { ok: true, project, warnings: validation.warnings };
}

export async function listProjects(opts: {
  status?: string;
  projectType?: string;
  tenantId?: string;
  clientEmail?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions = [
    isNull(architectureLandscapeProjectsTable.deletedAt),
  ];
  if (opts.status)
    conditions.push(
      eq(architectureLandscapeProjectsTable.status, opts.status),
    );
  if (opts.projectType)
    conditions.push(
      eq(architectureLandscapeProjectsTable.projectType, opts.projectType),
    );
  if (opts.tenantId)
    conditions.push(
      eq(architectureLandscapeProjectsTable.tenantId, opts.tenantId),
    );
  if (opts.clientEmail)
    conditions.push(
      eq(architectureLandscapeProjectsTable.clientEmail, opts.clientEmail),
    );

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const [projects, [totalRow]] = await Promise.all([
    db
      .select()
      .from(architectureLandscapeProjectsTable)
      .where(and(...conditions))
      .orderBy(desc(architectureLandscapeProjectsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(architectureLandscapeProjectsTable)
      .where(and(...conditions)),
  ]);

  return { projects, total: totalRow?.total ?? 0 };
}

export async function getProjectById(
  id: number,
): Promise<ArchitectureLandscapeProject | null> {
  const [project] = await db
    .select()
    .from(architectureLandscapeProjectsTable)
    .where(
      and(
        eq(architectureLandscapeProjectsTable.id, id),
        isNull(architectureLandscapeProjectsTable.deletedAt),
      ),
    );
  return project ?? null;
}

export async function getProjectByRef(
  projectRef: string,
): Promise<ArchitectureLandscapeProject | null> {
  const [project] = await db
    .select()
    .from(architectureLandscapeProjectsTable)
    .where(
      and(
        eq(architectureLandscapeProjectsTable.projectRef, projectRef),
        isNull(architectureLandscapeProjectsTable.deletedAt),
      ),
    );
  return project ?? null;
}

export async function updateProject(
  id: number,
  patch: Partial<
    Omit<ArchitectureLandscapeProject, "id" | "projectRef" | "createdAt">
  >,
): Promise<ArchitectureLandscapeProject | null> {
  const [updated] = await db
    .update(architectureLandscapeProjectsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(architectureLandscapeProjectsTable.id, id),
        isNull(architectureLandscapeProjectsTable.deletedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function softDeleteProject(id: number): Promise<boolean> {
  const result = await db
    .update(architectureLandscapeProjectsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(architectureLandscapeProjectsTable.id, id),
        isNull(architectureLandscapeProjectsTable.deletedAt),
      ),
    )
    .returning({ id: architectureLandscapeProjectsTable.id });
  return result.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow step advancement
// ─────────────────────────────────────────────────────────────────────────────

export interface StepAdvanceResult {
  ok: boolean;
  project?: ArchitectureLandscapeProject;
  error?: string;
}

/**
 * Advances the project to its next workflow step.
 * Maps step → status for the project status field.
 * Terminal status guards apply at export_ready.
 */
export async function advanceWorkflowStep(
  projectId: number,
): Promise<StepAdvanceResult> {
  const project = await getProjectById(projectId);
  if (!project) return { ok: false, error: "Project not found." };

  if (project.status === "completed" || project.status === "cancelled") {
    return {
      ok: false,
      error: `Project is in terminal status '${project.status}' and cannot be advanced.`,
    };
  }

  const currentStep = project.currentStep as ArchitectureWorkflowStep;
  if (!isValidWorkflowStep(currentStep)) {
    return {
      ok: false,
      error: `Unknown current workflow step: '${currentStep}'.`,
    };
  }

  const next = nextWorkflowStep(currentStep);

  // If no next step, we are at "export" — mark export_ready
  if (!next) {
    if (!isTransitionAllowed(project.status as ArchitectureProjectStatus, "export_ready")) {
      return {
        ok: false,
        error: `Cannot advance to export_ready from status '${project.status}'.`,
      };
    }
    const updated = await updateProject(projectId, {
      currentStep: "export",
      currentStepIndex: workflowStepIndex("export"),
      status: "export_ready",
      exportReadyAt: new Date(),
    });
    return { ok: true, project: updated ?? undefined };
  }

  // Map next step to status string
  const nextStatus = stepToStatus(next);
  const currentStatus = project.status as ArchitectureProjectStatus;

  if (!isTransitionAllowed(currentStatus, nextStatus)) {
    return {
      ok: false,
      error: `Transition from '${currentStatus}' to '${nextStatus}' is not allowed.`,
    };
  }

  const updated = await updateProject(projectId, {
    currentStep: next,
    currentStepIndex: workflowStepIndex(next),
    status: nextStatus,
  });

  return { ok: true, project: updated ?? undefined };
}

function stepToStatus(step: ArchitectureWorkflowStep): ArchitectureProjectStatus {
  const map: Record<ArchitectureWorkflowStep, ArchitectureProjectStatus> = {
    brief:                        "brief_submitted",
    site_context:                 "site_context",
    constraints:                  "constraints",
    research:                     "research",
    concept:                      "concept",
    program_zoning:               "program_zoning",
    spatial_direction:            "spatial_direction",
    material_landscape_direction: "material_landscape_direction",
    visualization:                "visualization",
    documentation:                "documentation",
    review:                       "review",
    export:                       "export_ready",
  };
  return map[step];
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact management
// ─────────────────────────────────────────────────────────────────────────────

export interface AddArtifactInput {
  artifactType: string;
  artifactLabel: string;
  isPreview?: boolean;
  metadataJson?: Record<string, unknown>;
  storageUrl?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  workflowStep?: string | null;
  generatedBy?: string;
}

export interface AddArtifactResult {
  ok: boolean;
  artifact?: ArchitectureLandscapeArtifact;
  error?: string;
}

export async function addArtifact(
  projectId: number,
  input: AddArtifactInput,
): Promise<AddArtifactResult> {
  const project = await getProjectById(projectId);
  if (!project) return { ok: false, error: "Project not found." };

  // Validate artifact type
  if (!isValidArtifactType(input.artifactType)) {
    return {
      ok: false,
      error: `Unknown artifact type '${input.artifactType}'.`,
    };
  }

  // Honesty check — must pass before insertion
  const honestyCheck = checkArtifactHonesty(
    input.artifactType,
    input.artifactLabel,
  );
  if (!honestyCheck.honest) {
    return { ok: false, error: honestyCheck.reason ?? "Artifact label failed honesty check." };
  }

  // Build overlay metadata
  const existingArtifacts = await listArtifacts(projectId);
  const artifactTypes = [
    ...new Set([
      ...existingArtifacts.map((a) => a.artifactType),
      input.artifactType,
    ]),
  ];

  const overlayMetadata: OverlayMetadata = {
    projectId,
    projectRef: project.projectRef,
    pluginId: "architecture-landscape-v1",
    overlayVersion: "1.0.0",
    workflowStep: (project.currentStep as ArchitectureWorkflowStep) ?? null,
    artifactTypes: artifactTypes as any,
    siteAreaM2: project.siteAreaM2 ? parseFloat(project.siteAreaM2) : null,
    climateZone: project.climate ?? null,
    projectType: project.projectType ?? null,
    generatedAt: new Date().toISOString(),
  };

  const [artifact] = await db
    .insert(architectureLandscapeArtifactsTable)
    .values({
      projectId,
      artifactType: input.artifactType,
      artifactLabel: input.artifactLabel,
      isPreview: input.isPreview ?? true,
      metadataJson: input.metadataJson ?? {},
      overlayMetadataJson: overlayMetadata,
      storageUrl: input.storageUrl ?? null,
      mimeType: input.mimeType ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      workflowStep: input.workflowStep ?? project.currentStep,
      generatedBy: input.generatedBy ?? "system",
      status: "active",
    })
    .returning();

  return { ok: true, artifact };
}

export async function listArtifacts(
  projectId: number,
): Promise<ArchitectureLandscapeArtifact[]> {
  return db
    .select()
    .from(architectureLandscapeArtifactsTable)
    .where(
      and(
        eq(architectureLandscapeArtifactsTable.projectId, projectId),
        eq(architectureLandscapeArtifactsTable.status, "active"),
      ),
    )
    .orderBy(architectureLandscapeArtifactsTable.createdAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component / material contribution
// ─────────────────────────────────────────────────────────────────────────────

export interface ContributeComponentInput {
  componentCode: string;
  componentName: string;
  category: string;
  subCategory?: string | null;
  description?: string | null;
  climateZones?: string[];
  sustainabilityRating?: string | null;
  locallyAvailable?: boolean;
  metadataJson?: Record<string, unknown>;
}

export async function contributeComponent(
  input: ContributeComponentInput,
): Promise<ArchitectureLandscapeComponent> {
  const [component] = await db
    .insert(architectureLandscapeComponentsTable)
    .values({
      componentCode: input.componentCode,
      componentName: input.componentName,
      category: input.category,
      subCategory: input.subCategory ?? null,
      description: input.description ?? null,
      climateZones: input.climateZones ?? [],
      sustainabilityRating: input.sustainabilityRating ?? null,
      locallyAvailable: input.locallyAvailable ?? true,
      metadataJson: input.metadataJson ?? {},
    })
    .onConflictDoUpdate({
      target: architectureLandscapeComponentsTable.componentCode,
      set: {
        componentName: sql`excluded.component_name`,
        category: sql`excluded.category`,
        subCategory: sql`excluded.sub_category`,
        description: sql`excluded.description`,
        climateZones: sql`excluded.climate_zones`,
        sustainabilityRating: sql`excluded.sustainability_rating`,
        locallyAvailable: sql`excluded.locally_available`,
        metadataJson: sql`excluded.metadata_json`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return component!;
}

export async function listComponents(opts: {
  category?: string;
  climateZone?: string;
  locallyAvailable?: boolean;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = await db
    .select()
    .from(architectureLandscapeComponentsTable)
    .limit(limit)
    .orderBy(
      architectureLandscapeComponentsTable.category,
      architectureLandscapeComponentsTable.componentName,
    );

  let results = rows;
  if (opts.category) {
    results = results.filter((c) => c.category === opts.category);
  }
  if (opts.climateZone) {
    results = results.filter(
      (c) =>
        (c.climateZones as string[]).includes(opts.climateZone!) ||
        (c.climateZones as string[]).length === 0,
    );
  }
  if (opts.locallyAvailable !== undefined) {
    results = results.filter((c) => c.locallyAvailable === opts.locallyAvailable);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay metadata retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns structured overlay metadata for a project.
 * Consumed by cross-team integrations (e.g., canvas editor, event bus).
 */
export async function getOverlayMetadata(
  projectId: number,
): Promise<OverlayMetadata | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const artifacts = await listArtifacts(projectId);

  return {
    projectId,
    projectRef: project.projectRef,
    pluginId: "architecture-landscape-v1",
    overlayVersion: "1.0.0",
    workflowStep: (project.currentStep as ArchitectureWorkflowStep) ?? null,
    artifactTypes: artifacts.map((a) => a.artifactType) as any,
    siteAreaM2: project.siteAreaM2 ? parseFloat(project.siteAreaM2) : null,
    climateZone: project.climate ?? null,
    projectType: project.projectType ?? null,
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin manifest (static, no DB call)
// ─────────────────────────────────────────────────────────────────────────────

export function getPluginManifest() {
  return {
    pluginId: "architecture-landscape-v1",
    version: "1.0.0",
    team: "29",
    domain: "Architecture & Landscape Design",
    workflowSteps: ARCHITECTURE_WORKFLOW_STEPS,
    artifactTypes: [
      "architecture_site_context",
      "architecture_concept",
      "architecture_program",
      "architecture_zoning",
      "architecture_plan_preview",
      "architecture_elevation_preview",
      "architecture_material_board",
      "architecture_visualization",
      "landscape_concept",
      "landscape_zoning",
      "landscape_planting_direction",
      "architecture_presentation",
    ],
    capabilities: {
      hasBimEngine: false,
      hasGisEngine: false,
      hasCadEngine: false,
      hasStructuralCalculation: false,
      hasPermitDocumentGeneration: false,
      hasCertifiedLandscapePlanning: false,
    },
    tables: [
      "ai_platform.architecture_landscape_projects",
      "ai_platform.architecture_landscape_artifacts",
      "ai_platform.architecture_landscape_components",
    ],
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export async function getAnalytics() {
  const [allProjects, recentProjects] = await Promise.all([
    db
      .select({
        status: architectureLandscapeProjectsTable.status,
        projectType: architectureLandscapeProjectsTable.projectType,
        currentStep: architectureLandscapeProjectsTable.currentStep,
        hasLandscapeComponent: architectureLandscapeProjectsTable.hasLandscapeComponent,
      })
      .from(architectureLandscapeProjectsTable)
      .where(isNull(architectureLandscapeProjectsTable.deletedAt)),
    db
      .select()
      .from(architectureLandscapeProjectsTable)
      .where(isNull(architectureLandscapeProjectsTable.deletedAt))
      .orderBy(desc(architectureLandscapeProjectsTable.createdAt))
      .limit(10),
  ]);

  const byStatus: Record<string, number> = {};
  const byProjectType: Record<string, number> = {};
  let withLandscape = 0;
  let exportReadyCount = 0;

  for (const p of allProjects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    byProjectType[p.projectType] = (byProjectType[p.projectType] ?? 0) + 1;
    if (p.hasLandscapeComponent) withLandscape++;
    if (p.status === "export_ready" || p.status === "completed") exportReadyCount++;
  }

  return {
    totalProjects: allProjects.length,
    byStatus,
    byProjectType,
    withLandscape,
    exportReadyCount,
    recentProjects,
  };
}
