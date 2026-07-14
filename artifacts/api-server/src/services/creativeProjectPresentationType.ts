/**
 * creativeProjectPresentationType.ts — Phase 4 Presentation Engine
 *
 * Resolves whether a `creative_projects` row is a presentation-producing
 * project (e.g. Pitch Deck PPTX) vs. a document- or image-producing one.
 * Mirrors creativeProjectDocumentType.ts's resolution pattern, but is kept
 * as a separate module/table so document and presentation projects never
 * collide — a project can be a document OR a presentation, never both.
 */

import { eq } from "drizzle-orm";
import { db, aiServiceRequestsTable, aiServicesTable, type CreativeProject } from "@workspace/db";
import type { CreativePresentationType } from "./presentation/presentationTypes.js";

/**
 * Maps a catalog `serviceCode` to the presentation type its export worker
 * should handle. Add new entries here as more presentation types get built —
 * each entry must have a matching definition registered in
 * creativePresentationWorkerService.ts.
 */
export const SERVICE_CODE_TO_PRESENTATION_TYPE: Readonly<Record<string, CreativePresentationType>> = {
  "pitch-deck": "pitch_deck",
};

/**
 * Resolve the presentation type for a creative project, or `null` if this
 * project does not produce a presentation.
 */
export async function resolveProjectPresentationType(
  project: Pick<CreativeProject, "sourceType" | "serviceRequestId">,
): Promise<CreativePresentationType | null> {
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

  return SERVICE_CODE_TO_PRESENTATION_TYPE[service.serviceCode] ?? null;
}
