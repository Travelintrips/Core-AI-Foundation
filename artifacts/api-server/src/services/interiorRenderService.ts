/**
 * WP-09 — Interior Design rendering orchestration.
 *
 * The approved concept snapshot is the only source allowed into a render.
 * Sessions, assets, jobs, storage, and cost records all reuse the platform
 * primitives that already back the preview/final image pipeline.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiJobsTable,
  creativeAiAssetsTable,
  creativeRenderSessionsTable,
  db,
} from "@workspace/db";
import { enqueue } from "./queueManagerService.js";
import { recordCost } from "./costService.js";
import { generatePhotorealisticInteriorImage } from "./imagePreviewService.js";
import { getUniversalRenderer } from "./universal-renderer/index.js";
import { logAudit } from "./aiAuditService.js";
import { idConceptDraftsTable } from "../domains/interior-design/schema.js";

const MAX_VARIANTS = 4;
const MAX_SNAPSHOT_BYTES = 1_000_000;
const ACTIVE_SESSION_STATUSES = new Set(["planning", "final_generating", "quality_check"]);

export type ApprovedInteriorSnapshot = {
  spacePlan: unknown;
  materials: unknown;
  furniture: unknown;
  lighting: unknown;
  visualConcept: string;
  approvedAt: string;
  approvedBy: string;
};

export type InteriorSceneSpec = {
  version: 1;
  snapshotHash: string;
  canvas: { width: 1200; height: 800 };
  room: {
    spacePlan: unknown;
    materials: unknown;
    furniture: unknown;
    lighting: unknown;
  };
  visualConcept: string;
};

type RenderMetadata = {
  approvedSnapshotHash: string;
  sceneSpecHash: string;
  sceneSpec: InteriorSceneSpec;
  variantCount: number;
  jobIds: number[];
  lastError?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashApprovedSnapshot(snapshot: ApprovedInteriorSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

export function buildInteriorSceneSpec(
  snapshot: ApprovedInteriorSnapshot,
  snapshotHash = hashApprovedSnapshot(snapshot),
): InteriorSceneSpec {
  return {
    version: 1,
    snapshotHash,
    canvas: { width: 1200, height: 800 },
    room: {
      spacePlan: canonicalize(snapshot.spacePlan),
      materials: canonicalize(snapshot.materials),
      furniture: canonicalize(snapshot.furniture),
      lighting: canonicalize(snapshot.lighting),
    },
    visualConcept: snapshot.visualConcept,
  };
}

function sceneSpecToSvg(scene: InteriorSceneSpec, variantIndex: number): string {
  const accent = ["#2F6B5F", "#A86E45", "#5A6D8A", "#806A42"][variantIndex % 4]!;
  const safeConcept = scene.visualConcept.replace(/[<&"]/g, "");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">`,
    `<rect width="1200" height="800" fill="#F6F2EA"/>`,
    `<rect x="60" y="60" width="1080" height="680" rx="12" fill="#FBFAF7" stroke="${accent}" stroke-width="8"/>`,
    `<rect x="110" y="110" width="430" height="230" fill="#E7DED0" stroke="#54483D" stroke-width="3"/>`,
    `<rect x="600" y="110" width="480" height="230" fill="#D8E2DE" stroke="#54483D" stroke-width="3"/>`,
    `<rect x="110" y="410" width="970" height="230" fill="#EEE8DE" stroke="#54483D" stroke-width="3"/>`,
    `<circle cx="${260 + (variantIndex * 70)}" cy="525" r="74" fill="${accent}" opacity=".82"/>`,
    `<rect x="730" y="455" width="210" height="94" rx="12" fill="${accent}" opacity=".72"/>`,
    `<text x="110" y="700" font-family="Arial,sans-serif" font-size="24" fill="#54483D">Approved interior scene ${variantIndex + 1}</text>`,
    `<text x="110" y="732" font-family="Arial,sans-serif" font-size="16" fill="#74695C">${safeConcept.slice(0, 110)}</text>`,
    `</svg>`,
  ].join("");
}

function promptForScene(scene: InteriorSceneSpec, variantIndex: number): string {
  return [
    "Photorealistic interior design visualization, editorial architectural photography.",
    `Variation ${variantIndex + 1}.`,
    `Approved visual concept: ${scene.visualConcept}`,
    "Honor the approved space plan, materials, furniture, and lighting exactly.",
    `Space plan: ${stableStringify(scene.room.spacePlan).slice(0, 1800)}`,
    `Materials: ${stableStringify(scene.room.materials).slice(0, 1800)}`,
    `Furniture: ${stableStringify(scene.room.furniture).slice(0, 1800)}`,
    `Lighting: ${stableStringify(scene.room.lighting).slice(0, 1400)}`,
    "No people, no logos, no watermarks, no readable text, no extra rooms.",
  ].join("\n");
}

export async function getApprovedInteriorSnapshot(
  projectUuid: string,
): Promise<{ snapshot: ApprovedInteriorSnapshot; hash: string; sceneSpec: InteriorSceneSpec }> {
  const [draft] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);

  if (!draft) {
    throw Object.assign(new Error("Interior concept draft not found"), { status: 404 });
  }
  if (draft.reviewState !== "approved_for_rendering") {
    throw Object.assign(new Error("Concept must be approved_for_rendering before rendering"), { status: 409 });
  }

  const snapshot: ApprovedInteriorSnapshot = {
    spacePlan: draft.approvedSpacePlan,
    materials: draft.approvedMaterials,
    furniture: draft.approvedFurniture,
    lighting: draft.approvedLighting,
    visualConcept: draft.approvedVisualConcept ?? "",
    approvedAt: draft.approvedAt?.toISOString() ?? "",
    approvedBy: draft.approvedBy ?? "",
  };
  const serialized = stableStringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw Object.assign(new Error("Approved concept snapshot exceeds render limits"), { status: 422 });
  }
  if (!snapshot.approvedAt || !snapshot.approvedBy) {
    throw Object.assign(new Error("Approved concept snapshot is incomplete"), { status: 409 });
  }

  const hash = hashApprovedSnapshot(snapshot);
  return { snapshot, hash, sceneSpec: buildInteriorSceneSpec(snapshot, hash) };
}

function metadataForSession(value: unknown): RenderMetadata | null {
  const metadata = asRecord(value);
  if (typeof metadata.approvedSnapshotHash !== "string") return null;
  return {
    approvedSnapshotHash: metadata.approvedSnapshotHash,
    sceneSpecHash: typeof metadata.sceneSpecHash === "string" ? metadata.sceneSpecHash : "",
    sceneSpec: metadata.sceneSpec as InteriorSceneSpec,
    variantCount: Number(metadata.variantCount ?? 1),
    jobIds: Array.isArray(metadata.jobIds) ? metadata.jobIds.filter((id): id is number => Number.isInteger(id)) : [],
    ...(typeof metadata.lastError === "string" ? { lastError: metadata.lastError } : {}),
  };
}

async function getLatestSession(projectUuid: string) {
  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.projectId, projectUuid))
    .orderBy(desc(creativeRenderSessionsTable.id))
    .limit(1);
  return session ?? null;
}

async function queueVariantJobs(
  projectUuid: string,
  sessionId: number,
  tenantId: string,
  sceneSpec: InteriorSceneSpec,
  snapshotHash: string,
  variantCount: number,
): Promise<number[]> {
  const jobIds: number[] = [];
  for (let variantIndex = 0; variantIndex < variantCount; variantIndex += 1) {
    const job = await enqueue({
      jobType: "interior_render_variant",
      requiredCapability: "universal_render",
      priority: 70,
      maxRetry: 2,
      retryStrategy: "exponential",
      tenantId,
      payloadJson: {
        projectUuid,
        renderSessionId: sessionId,
        variantIndex,
        variantCount,
        snapshotHash,
        sceneSpec,
      },
      estimatedDuration: 120_000,
    });
    jobIds.push(job.id);
  }
  return jobIds;
}

export async function startInteriorRender(input: {
  projectUuid: string;
  tenantId: string;
  variantCount?: number;
}) {
  const variantCount = input.variantCount ?? 2;
  if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > MAX_VARIANTS) {
    throw Object.assign(new Error(`variantCount must be an integer between 1 and ${MAX_VARIANTS}`), { status: 400 });
  }

  const approved = await getApprovedInteriorSnapshot(input.projectUuid);
  const existing = await getLatestSession(input.projectUuid);
  const existingMeta = existing ? metadataForSession(existing.metadata) : null;
  if (
    existing &&
    existingMeta?.approvedSnapshotHash === approved.hash &&
    (ACTIVE_SESSION_STATUSES.has(existing.sessionStatus) || existing.sessionStatus === "completed")
  ) {
    return { session: await getInteriorRenderStatus(input.projectUuid), idempotent: true };
  }

  const [session] = await db
    .insert(creativeRenderSessionsTable)
    .values({
      projectId: input.projectUuid,
      sessionStatus: "final_generating",
      packageTier: "enterprise",
      previewCount: 0,
      requestedFinalCount: variantCount,
      metadata: {
        approvedSnapshotHash: approved.hash,
        sceneSpecHash: createHash("sha256").update(stableStringify(approved.sceneSpec)).digest("hex"),
        sceneSpec: approved.sceneSpec,
        variantCount,
        jobIds: [],
        sourceImmutable: true,
      },
    })
    .returning();
  if (!session) throw new Error("Could not create render session");

  try {
    const jobIds = await queueVariantJobs(
      input.projectUuid,
      session.id,
      input.tenantId,
      approved.sceneSpec,
      approved.hash,
      variantCount,
    );
    await db
      .update(creativeRenderSessionsTable)
      .set({
        metadata: {
          approvedSnapshotHash: approved.hash,
          sceneSpecHash: createHash("sha256").update(stableStringify(approved.sceneSpec)).digest("hex"),
          sceneSpec: approved.sceneSpec,
          variantCount,
          jobIds,
          sourceImmutable: true,
        },
        updatedAt: new Date(),
      })
      .where(eq(creativeRenderSessionsTable.id, session.id));
  } catch (error) {
    await db
      .update(creativeRenderSessionsTable)
      .set({
        sessionStatus: "failed",
        metadata: { ...asRecord(session.metadata), lastError: error instanceof Error ? error.message : String(error) },
        updatedAt: new Date(),
      })
      .where(eq(creativeRenderSessionsTable.id, session.id));
    throw error;
  }

  await logAudit("interior-render", "render_started", input.projectUuid, "creative_render_session", "success", {
    sessionId: session.id,
    approvedSnapshotHash: approved.hash,
    variantCount,
  });
  return { session: await getInteriorRenderStatus(input.projectUuid), idempotent: false };
}

export async function executeInteriorRenderVariant(job: {
  id: number;
  payloadJson: unknown;
}) {
  const payload = asRecord(job.payloadJson);
  const projectUuid = typeof payload.projectUuid === "string" ? payload.projectUuid : "";
  const sessionId = Number(payload.renderSessionId);
  const variantIndex = Number(payload.variantIndex);
  const snapshotHash = typeof payload.snapshotHash === "string" ? payload.snapshotHash : "";
  const sceneSpec = payload.sceneSpec as InteriorSceneSpec | undefined;
  if (!projectUuid || !Number.isInteger(sessionId) || !Number.isInteger(variantIndex) || !sceneSpec || !snapshotHash) {
    throw new Error("interior_render_variant payload is invalid");
  }

  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(and(eq(creativeRenderSessionsTable.id, sessionId), eq(creativeRenderSessionsTable.projectId, projectUuid)))
    .limit(1);
  if (!session) throw new Error("Render session is not owned by project");
  const metadata = metadataForSession(session.metadata);
  if (!metadata || metadata.approvedSnapshotHash !== snapshotHash || metadata.sceneSpecHash === "") {
    throw new Error("Render payload does not match the immutable approved snapshot");
  }

  const prompt = promptForScene(sceneSpec, variantIndex);
  const startMs = Date.now();
  try {
    const universal = await getUniversalRenderer().render({
      requestId: `interior-${sessionId}-${snapshotHash}-v${variantIndex}`,
      source: {
        kind: "svg",
        svgContent: sceneSpecToSvg(sceneSpec, variantIndex),
        canvasWidth: sceneSpec.canvas.width,
        canvasHeight: sceneSpec.canvas.height,
      },
      formats: ["svg", "composition"],
      storagePrefix: `interior-renders/${projectUuid}/${sessionId}/scene-${variantIndex}`,
      packageName: `interior-scene-${sessionId}-${variantIndex}`,
      metadata: { title: "Approved interior scene", creator: "AI Platform" },
      tenantId: typeof payload._tenantId === "string" ? payload._tenantId : undefined,
    });
    const image = await generatePhotorealisticInteriorImage({
      projectUuid,
      sessionId,
      variantIndex,
      prompt,
      negativePrompt: "people, logos, watermark, text, extra rooms, distorted furniture",
    });
    const imageCost = 0.025;
    const assetMetadata = {
      approvedSnapshotHash: snapshotHash,
      sceneSpecHash: metadata.sceneSpecHash,
      variantIndex,
      universalArtifacts: universal.artifacts,
      sourceImmutable: true,
    };
    const [asset] = await db
      .insert(creativeAiAssetsTable)
      .values({
        projectId: projectUuid,
        provider: "replicate",
        model: image.model,
        assetType: "interior_render",
        prompt,
        negativePrompt: "people, logos, watermark, text, extra rooms, distorted furniture",
        aspectRatio: "16:9",
        imageUrl: image.imageUrl,
        storagePath: image.storagePath,
        thumbnailUrl: image.imageUrl,
        status: "completed",
        cost: imageCost.toFixed(6),
        latencyMs: Date.now() - startMs,
        metadata: assetMetadata,
        renderStage: "final",
        renderSessionId: sessionId,
        conceptIndex: variantIndex,
      })
      .returning({ id: creativeAiAssetsTable.id, imageUrl: creativeAiAssetsTable.imageUrl, storagePath: creativeAiAssetsTable.storagePath });

    await recordCost({
      projectId: projectUuid,
      agentSlug: "interior-renderer",
      provider: "replicate",
      model: image.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: image.latencyMs,
      status: "success",
    });
    await finalizeInteriorSession(sessionId, projectUuid, snapshotHash);
    return {
      imageUrl: asset?.imageUrl ?? image.imageUrl,
      storagePath: asset?.storagePath ?? image.storagePath,
      assetId: asset?.id,
      requestId: universal.requestId,
      artifacts: universal.artifacts,
      durationMs: Date.now() - startMs,
    };
  } catch (error) {
    await recordCost({
      projectId: projectUuid,
      agentSlug: "interior-renderer",
      provider: "replicate",
      model: "black-forest-labs/flux-dev",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startMs,
      status: "failed",
    }).catch(() => undefined);
    await db
      .update(creativeRenderSessionsTable)
      .set({
        sessionStatus: "failed",
        metadata: { ...asRecord(session.metadata), lastError: error instanceof Error ? error.message : String(error) },
        updatedAt: new Date(),
      })
      .where(eq(creativeRenderSessionsTable.id, sessionId));
    throw error;
  }
}

async function finalizeInteriorSession(sessionId: number, projectUuid: string, snapshotHash: string) {
  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, sessionId))
    .limit(1);
  if (!session) return;
  const metadata = metadataForSession(session.metadata);
  if (!metadata || metadata.approvedSnapshotHash !== snapshotHash) return;
  const assets = await db
    .select({ id: creativeAiAssetsTable.id })
    .from(creativeAiAssetsTable)
    .where(and(
      eq(creativeAiAssetsTable.projectId, projectUuid),
      eq(creativeAiAssetsTable.renderSessionId, sessionId),
      eq(creativeAiAssetsTable.renderStage, "final"),
      eq(creativeAiAssetsTable.status, "completed"),
    ));
  if (assets.length < metadata.variantCount) return;
  await db
    .update(creativeRenderSessionsTable)
    .set({
      sessionStatus: "completed",
      finalCostUsd: (assets.length * 0.025).toFixed(6),
      totalCostUsd: (assets.length * 0.025).toFixed(6),
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, sessionId));
}

export async function getInteriorRenderStatus(projectUuid: string) {
  const session = await getLatestSession(projectUuid);
  if (!session) return null;
  const metadata = metadataForSession(session.metadata);
  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(and(
      eq(creativeAiAssetsTable.projectId, projectUuid),
      eq(creativeAiAssetsTable.renderSessionId, session.id),
      eq(creativeAiAssetsTable.renderStage, "final"),
    ))
    .orderBy(creativeAiAssetsTable.conceptIndex);
  const jobIds = metadata?.jobIds ?? [];
  const jobs = jobIds.length
    ? await db.select().from(aiJobsTable).where(inArray(aiJobsTable.id, jobIds))
    : [];
  const completed = assets.filter((asset) => asset.status === "completed").length;
  return {
    sessionId: session.id,
    status: session.sessionStatus,
    progress: metadata?.variantCount ? Math.min(100, Math.round((completed / metadata.variantCount) * 100)) : 0,
    variantCount: metadata?.variantCount ?? session.requestedFinalCount,
    approvedSnapshotHash: metadata?.approvedSnapshotHash ?? null,
    sourceImmutable: true,
    error: metadata?.lastError ?? null,
    assets: assets.map((asset) => ({
      id: asset.id,
      variantIndex: asset.conceptIndex,
      status: asset.status,
      imageUrl: asset.imageUrl,
      storagePath: asset.storagePath,
      qcScore: asset.qcScore,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      retryCount: job.retryCount,
      errorMessage: job.errorMessage,
    })),
  };
}

export async function retryInteriorRender(input: {
  projectUuid: string;
  tenantId: string;
}) {
  const current = await getInteriorRenderStatus(input.projectUuid);
  if (!current) throw Object.assign(new Error("Render session not found"), { status: 404 });
  if (current.status !== "failed") {
    return { session: current, idempotent: true };
  }
  const approved = await getApprovedInteriorSnapshot(input.projectUuid);
  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, current.sessionId))
    .limit(1);
  if (!session) throw Object.assign(new Error("Render session not found"), { status: 404 });
  const metadata = metadataForSession(session.metadata);
  if (!metadata || metadata.approvedSnapshotHash !== approved.hash) {
    return startInteriorRender({ ...input, variantCount: current.variantCount });
  }
  const jobIds = await queueVariantJobs(
    input.projectUuid,
    session.id,
    input.tenantId,
    approved.sceneSpec,
    approved.hash,
    current.variantCount,
  );
  await db
    .update(creativeRenderSessionsTable)
    .set({
      sessionStatus: "final_generating",
      metadata: { ...asRecord(session.metadata), jobIds, lastError: undefined },
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, session.id));
  return { session: await getInteriorRenderStatus(input.projectUuid), idempotent: false };
}