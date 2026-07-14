/**
 * creativeProjectImageBatchType.ts — Phase 5 Creative Asset Batch Engine
 *
 * Resolves whether a `creative_projects` row is an image-batch-producing
 * project (Logo Design / Social Media Design / Packaging Design) and which
 * batch type it maps to. Mirrors creativeProjectDocumentType.ts exactly.
 */

import { eq } from "drizzle-orm";
import { db, aiServiceRequestsTable, aiServicesTable, type CreativeProject } from "@workspace/db";
import { findImageBatchDefinitionByServiceCode } from "./image-batch/creativeImageBatchRegistry.js";
import type { ImageBatchType } from "./image-batch/imageBatchTypes.js";

export async function resolveProjectImageBatchType(
  project: Pick<CreativeProject, "sourceType" | "serviceRequestId">,
): Promise<ImageBatchType | null> {
  if (project.sourceType !== "service_catalog" || !project.serviceRequestId) {
    return null;
  }

  const [request] = await db
    .select({ serviceId: aiServiceRequestsTable.serviceId })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, project.serviceRequestId))
    .limit(1);

  if (!request) return null;

  const [service] = await db
    .select({ serviceCode: aiServicesTable.serviceCode })
    .from(aiServicesTable)
    .where(eq(aiServicesTable.id, request.serviceId))
    .limit(1);

  if (!service) return null;

  return findImageBatchDefinitionByServiceCode(service.serviceCode)?.batchType ?? null;
}
