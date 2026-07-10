/**
 * serviceRequestConversionService — transactional, idempotent conversion of an
 * approved-and-gate-cleared service request into an active creative project.
 *
 * convertServiceRequestToProject() is the single entry point. It:
 *   1. Verifies quotation.status === 'approved' AND gate is verified/waived.
 *   2. Short-circuits (idempotency) if the request already has a createdProjectId.
 *   3. In one DB transaction: updates the service request status + createdProjectId,
 *      then enqueues the creative workflow via runCreativeBriefWorkflow().
 *   4. Publishes lifecycle events via publishSafe().
 *
 * checkAndMaybeConvert() is a convenience function called from both the quotation
 * approval handler and the gate verify/waive handlers — whichever event happens
 * second triggers the actual conversion.
 */

import { eq } from "drizzle-orm";
import {
  db,
  aiCommercialGatesTable,
  creativeProjectQuotationsTable,
  aiServiceRequestsTable,
  creativeProjectsTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { runCreativeBriefWorkflow } from "./creativeWorkflowRunner.js";
import {
  getGateForQuotation,
  gateIsCleared,
} from "./commercialGateService.js";

// ── convertServiceRequestToProject ───────────────────────────────────────────

export interface ConversionResult {
  alreadyConverted: boolean;
  createdProjectId: string | null;
  skipped?: string; // reason when preconditions not met
}

export async function convertServiceRequestToProject(
  serviceRequestId: number,
): Promise<ConversionResult> {
  // Load the service request
  const [request] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, serviceRequestId))
    .limit(1);

  if (!request) {
    throw new Error(`Service request ${serviceRequestId} not found`);
  }

  // Idempotency: already converted
  if (request.createdProjectId) {
    return { alreadyConverted: true, createdProjectId: request.createdProjectId };
  }

  // We need a quotation linked to this request. Look it up via service_request_id
  // on the gate, or fall back to looking for a quotation whose project matches.
  const [gate] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.serviceRequestId, serviceRequestId))
    .limit(1);

  if (!gate) {
    return { alreadyConverted: false, createdProjectId: null, skipped: "no_gate" };
  }

  if (!gateIsCleared(gate)) {
    return { alreadyConverted: false, createdProjectId: null, skipped: "gate_not_cleared" };
  }

  // Load the quotation
  const [quotation] = await db
    .select()
    .from(creativeProjectQuotationsTable)
    .where(eq(creativeProjectQuotationsTable.id, gate.quotationId))
    .limit(1);

  if (!quotation) {
    return { alreadyConverted: false, createdProjectId: null, skipped: "quotation_not_found" };
  }

  if (quotation.status !== "approved") {
    return { alreadyConverted: false, createdProjectId: null, skipped: "quotation_not_approved" };
  }

  // Load the creative project by projectId stored on the quotation
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, quotation.projectId))
    .limit(1);

  if (!project) {
    return { alreadyConverted: false, createdProjectId: null, skipped: "project_not_found" };
  }

  // All preconditions met — perform the conversion in a transaction
  const projectId = project.projectId;

  await db.transaction(async (tx) => {
    // Update service request: mark as converted, store the project id
    await tx
      .update(aiServiceRequestsTable)
      .set({
        status: "converted_to_project",
        createdProjectId: projectId,
        updatedAt: new Date(),
      })
      .where(eq(aiServiceRequestsTable.id, serviceRequestId));
  });

  // Audit events — outside the transaction so audit failures don't roll back
  await logAudit(
    "conversion",
    "service_request_converted",
    String(serviceRequestId),
    "ai_service_request",
    "success",
    { projectId, quotationId: quotation.id, gateId: gate.id, gateStatus: gate.status },
  );

  // Publish lifecycle events
  publishSafe({
    eventType: "service_request.approved",
    sourceModule: "conversion",
    sourceId: String(serviceRequestId),
    payload: { serviceRequestId, quotationId: quotation.id, projectId },
  });

  publishSafe({
    eventType: gate.status === "waived" ? "commercial_gate.waived" : "commercial_gate.verified",
    sourceModule: "conversion",
    sourceId: String(gate.id),
    payload: { gateId: gate.id, quotationId: quotation.id, serviceRequestId },
  });

  publishSafe({
    eventType: "service_request.converted",
    sourceModule: "conversion",
    sourceId: String(serviceRequestId),
    payload: { serviceRequestId, projectId, quotationId: quotation.id },
  });

  publishSafe({
    eventType: "project.created",
    sourceModule: "conversion",
    sourceId: projectId,
    payload: { projectId, serviceRequestId, quotationId: quotation.id },
  });

  // Enqueue AI generation workflow (only if project is still pending)
  if (project.status === "pending") {
    runCreativeBriefWorkflow(project.id).catch(async (err) => {
      console.error(`[conversion] Workflow failed for project ${projectId}:`, err);
      await db
        .update(creativeProjectsTable)
        .set({ status: "failed" })
        .where(eq(creativeProjectsTable.id, project.id));
      await logAudit(
        "conversion",
        "workflow_error",
        projectId,
        "creative_project",
        "failure",
        { error: String(err) },
      );
    });
  }

  return { alreadyConverted: false, createdProjectId: projectId };
}

// ── checkAndMaybeConvert ──────────────────────────────────────────────────────

/**
 * Called from both the quotation-approval handler and the gate verify/waive
 * handlers. Resolves the service request from the gate's serviceRequestId,
 * then delegates to convertServiceRequestToProject. Safe to call multiple
 * times — idempotent via convertServiceRequestToProject.
 */
export async function checkAndMaybeConvert(quotationId: number): Promise<ConversionResult | null> {
  // Find the gate for this quotation
  const gate = await getGateForQuotation(quotationId);
  if (!gate || gate.serviceRequestId == null) return null;

  return convertServiceRequestToProject(gate.serviceRequestId);
}
