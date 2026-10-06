import { and, eq } from "drizzle-orm";
import { creativeAiAssetsTable, db } from "@workspace/db";
import { generatePhotorealisticInteriorImage } from "../../services/imagePreviewService.js";
import {
  compressImageToWebpForStorage,
  getSupabaseProjectUrl,
} from "../../lib/supabaseStorage.js";

const PUBLIC_PROJECT_PREFIX = "public-interior-";
const DEFAULT_VARIANTS = 2;
const MAX_VARIANTS = 4;

export function publicInteriorProjectAssetKey(projectId: number): string {
  return `${PUBLIC_PROJECT_PREFIX}${projectId}`;
}

type PublicRenderProject = {
  id: number;
  title: string;
  roomType: string;
  accessToken: string;
};

type PublicRenderAsset = {
  id: number;
  variantIndex: number | null;
  status: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type EdgeStorageResult = {
  publicUrl: string;
  path: string;
  originalBytes: number;
  storedBytes: number;
};

async function persistPublicInteriorRenderViaEdge(input: {
  project: PublicRenderProject;
  variantIndex: number;
  providerUrl: string;
}): Promise<EdgeStorageResult> {
  if (!input.project.accessToken) {
    throw new Error("Interior project access token is unavailable for storage authorization");
  }

  const supabaseUrl = getSupabaseProjectUrl();
  if (!supabaseUrl) {
    throw new Error("Supabase project URL is unavailable for Edge Storage fallback");
  }

  const raw = await fetch(input.providerUrl, {
    redirect: "follow",
    headers: {
      Accept: "image/webp,image/avif,image/png,image/jpeg,image/*,*/*;q=0.8",
    },
  });
  if (!raw.ok) {
    throw new Error(`Provider image download failed with HTTP ${raw.status}`);
  }

  const source = Buffer.from(await raw.arrayBuffer());
  const prepared = await compressImageToWebpForStorage(source);
  if (prepared.storedBytes === 0) {
    throw new Error("Provider image download returned an empty body");
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/interior-render-storage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "image/webp",
        "x-interior-project-id": String(input.project.id),
        "x-interior-access-token": input.project.accessToken,
        "x-interior-variant-index": String(input.variantIndex),
      },
      body: prepared.buffer,
      signal: AbortSignal.timeout(30_000),
    },
  );

  const payload = await response.json().catch(() => null) as {
    publicUrl?: unknown;
    path?: unknown;
    storedBytes?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok) {
    throw new Error(
      `Interior Storage Edge upload failed (${response.status}): ${String(payload?.error ?? "unknown")}`,
    );
  }

  if (typeof payload?.publicUrl !== "string" || typeof payload?.path !== "string") {
    throw new Error("Interior Storage Edge response is missing the permanent asset URL");
  }

  return {
    publicUrl: payload.publicUrl,
    path: payload.path,
    originalBytes: prepared.originalBytes,
    storedBytes:
      typeof payload.storedBytes === "number"
        ? payload.storedBytes
        : prepared.storedBytes,
  };
}

function buildPrompt(input: {
  project: PublicRenderProject;
  brief: unknown;
  output: unknown;
  variantIndex: number;
}): string {
  const brief = asRecord(input.brief);
  const output = asRecord(input.output);
  return [
    "Photorealistic interior design visualization, editorial architectural photography.",
    `Project: ${input.project.title}`,
    `Room type: ${input.project.roomType}`,
    `Variation: ${input.variantIndex + 1}`,
    `Style: ${String(brief["style"] ?? "")}`,
    `Room: ${String(brief["roomLengthM"] ?? "")}m x ${String(brief["roomWidthM"] ?? "")}m, ceiling ${String(brief["ceilingHeightM"] ?? "")}m`,
    `Visual concept: ${String(output["visualConcept"] ?? "")}`,
    `Space plan: ${JSON.stringify(output["spacePlan"] ?? {}).slice(0, 1800)}`,
    `Furniture: ${JSON.stringify(output["furniturePlacement"] ?? {}).slice(0, 1800)}`,
    `Materials: ${JSON.stringify(output["materialRecommendations"] ?? {}).slice(0, 1800)}`,
    `Lighting: ${JSON.stringify(output["lightingRecommendations"] ?? {}).slice(0, 1400)}`,
    "Keep the design faithful to the supplied room geometry and design concept.",
    "No people, logos, watermark, readable text, extra rooms, or distorted furniture.",
  ].join("\n");
}

export async function getPublicInteriorRenderAssets(projectId: number): Promise<PublicRenderAsset[]> {
  return db
    .select({
      id: creativeAiAssetsTable.id,
      variantIndex: creativeAiAssetsTable.conceptIndex,
      status: creativeAiAssetsTable.status,
      imageUrl: creativeAiAssetsTable.imageUrl,
      thumbnailUrl: creativeAiAssetsTable.thumbnailUrl,
      aspectRatio: creativeAiAssetsTable.aspectRatio,
    })
    .from(creativeAiAssetsTable)
    .where(and(
      eq(creativeAiAssetsTable.projectId, publicInteriorProjectAssetKey(projectId)),
      eq(creativeAiAssetsTable.assetType, "interior_render"),
      eq(creativeAiAssetsTable.renderStage, "final"),
    ))
    .orderBy(creativeAiAssetsTable.conceptIndex);
}

export async function generatePublicInteriorRenders(input: {
  project: PublicRenderProject;
  brief: unknown;
  output: unknown;
  variantCount?: number;
}): Promise<PublicRenderAsset[]> {
  const variantCount = Math.min(MAX_VARIANTS, Math.max(1, input.variantCount ?? DEFAULT_VARIANTS));
  const projectKey = publicInteriorProjectAssetKey(input.project.id);
  const existing = await getPublicInteriorRenderAssets(input.project.id);

  for (let variantIndex = 0; variantIndex < variantCount; variantIndex += 1) {
    const previous = existing.find((asset) => asset.variantIndex === variantIndex);
    if (previous?.status === "completed" && previous.imageUrl) continue;

    const prompt = buildPrompt({ ...input, variantIndex });
    let assetId = previous?.id;

    if (assetId) {
      await db
        .update(creativeAiAssetsTable)
        .set({ status: "generating" })
        .where(eq(creativeAiAssetsTable.id, assetId));
    } else {
      const [created] = await db
        .insert(creativeAiAssetsTable)
        .values({
          projectId: projectKey,
          provider: "replicate",
          model: "black-forest-labs/flux-dev",
          assetType: "interior_render",
          prompt,
          negativePrompt: "people, logos, watermark, text, extra rooms, distorted furniture",
          aspectRatio: "16:9",
          status: "generating",
          renderStage: "final",
          conceptIndex: variantIndex,
          metadata: {
            source: "public_interior_design",
            publicInteriorProjectId: input.project.id,
          },
        })
        .returning({ id: creativeAiAssetsTable.id });
      assetId = created?.id;
    }

    if (!assetId) continue;

    try {
      const image = await generatePhotorealisticInteriorImage({
        projectUuid: projectKey,
        sessionId: input.project.id,
        variantIndex,
        prompt,
        negativePrompt: "people, logos, watermark, text, extra rooms, distorted furniture",
        aspectRatio: "16:9",
      });

      let finalImageUrl = image.imageUrl;
      let finalStoragePath = image.storagePath;
      let qcNotes: string | null = null;
      let completionMetadata: Record<string, unknown> = {
        source: "public_interior_design",
        publicInteriorProjectId: input.project.id,
        compressionGate: "webp-quality-78",
        storagePersistence: image.storagePath ? "supabase-direct" : "provider-fallback",
      };

      if (!image.storagePath) {
        try {
          const edgeStored = await persistPublicInteriorRenderViaEdge({
            project: input.project,
            variantIndex,
            providerUrl: image.imageUrl,
          });
          finalImageUrl = edgeStored.publicUrl;
          finalStoragePath = edgeStored.path;
          completionMetadata = {
            ...completionMetadata,
            storagePersistence: "supabase-edge",
            originalBytes: edgeStored.originalBytes,
            storedBytes: edgeStored.storedBytes,
            savingsBytes: Math.max(0, edgeStored.originalBytes - edgeStored.storedBytes),
          };
        } catch (edgeError) {
          const directMessage = image.persistenceError ?? "direct storage unavailable";
          const edgeMessage = edgeError instanceof Error ? edgeError.message : String(edgeError);
          qcNotes = `Permanent storage fallback: direct=${directMessage}; edge=${edgeMessage}`.slice(0, 1000);
        }
      }

      await db
        .update(creativeAiAssetsTable)
        .set({
          status: "completed",
          imageUrl: finalImageUrl,
          thumbnailUrl: finalImageUrl,
          storagePath: finalStoragePath,
          model: image.model,
          latencyMs: image.latencyMs,
          qcNotes,
          metadata: completionMetadata,
        })
        .where(eq(creativeAiAssetsTable.id, assetId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(creativeAiAssetsTable)
        .set({
          status: "failed",
          qcNotes: message.slice(0, 1000),
        })
        .where(eq(creativeAiAssetsTable.id, assetId));
    }
  }

  return getPublicInteriorRenderAssets(input.project.id);
}
