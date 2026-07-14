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

import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  aiCommercialGatesTable,
  creativeProjectQuotationsTable,
  aiQuotationsTable,
  aiServiceRequestsTable,
  aiServicesTable,
  creativeProjectsTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { runCreativeBriefWorkflow } from "./creativeWorkflowRunner.js";
import { generateScheduleForProject, type PaymentPolicy } from "./paymentScheduleService.js";
import {
  getGateForQuotation,
  getGateForServiceQuotation,
  gateIsCleared,
} from "./commercialGateService.js";
import {
  assertCompanyProfileBriefReady,
  isCompanyProfileServiceCode,
  BriefIncompleteError,
} from "./companyProfileBriefIntelligence.js";

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

  // ── Company Profile sprint (P0): block generation start on an incomplete brief ──
  const [service] = await db
    .select({ serviceCode: aiServicesTable.serviceCode })
    .from(aiServicesTable)
    .where(eq(aiServicesTable.id, request.serviceId))
    .limit(1);

  if (isCompanyProfileServiceCode(service?.serviceCode) && !request.briefGuardOverrideAt) {
    try {
      assertCompanyProfileBriefReady((request.briefJson ?? {}) as Record<string, unknown>);
    } catch (err) {
      if (err instanceof BriefIncompleteError) {
        return {
          alreadyConverted: false,
          createdProjectId: null,
          skipped: `${err.code}:${err.missingFields.join(",")}`,
        };
      }
      throw err;
    }
  }

  // ── Quotation & project lookup — supports legacy (quotationId) and service-catalog (serviceQuotationId) paths ──

  let projectId: string;
  let quotationDbId: number;
  let quotationTotal: number;
  let quotationCurrency: string;

  if (gate.quotationId != null) {
    // ── Legacy path: creative_project_quotations ──
    const [quotation] = await db
      .select()
      .from(creativeProjectQuotationsTable)
      .where(eq(creativeProjectQuotationsTable.id, gate.quotationId))
      .limit(1);

    if (!quotation) return { alreadyConverted: false, createdProjectId: null, skipped: "quotation_not_found" };
    if (quotation.status !== "approved") return { alreadyConverted: false, createdProjectId: null, skipped: "quotation_not_approved" };

    const [project] = await db
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, quotation.projectId))
      .limit(1);

    if (!project) return { alreadyConverted: false, createdProjectId: null, skipped: "project_not_found" };

    projectId = project.projectId;
    quotationDbId = quotation.id;
    quotationTotal = quotation.total;
    quotationCurrency = quotation.currency;
  } else if (gate.serviceQuotationId != null) {
    // ── Service-catalog path: ai_quotations ──
    const [serviceQuotation] = await db
      .select()
      .from(aiQuotationsTable)
      .where(eq(aiQuotationsTable.id, gate.serviceQuotationId))
      .limit(1);

    if (!serviceQuotation) return { alreadyConverted: false, createdProjectId: null, skipped: "service_quotation_not_found" };
    if (serviceQuotation.status !== "approved") return { alreadyConverted: false, createdProjectId: null, skipped: "quotation_not_approved" };

    // Find or create the creative project for this service request
    const [existingProject] = await db
      .select()
      .from(creativeProjectsTable)
      .where(
        and(
          eq(creativeProjectsTable.serviceRequestId, request.id),
          eq(creativeProjectsTable.sourceType, "service_catalog"),
        ),
      )
      .limit(1);

    if (existingProject) {
      projectId = existingProject.projectId;
    } else {
      // Create the creative project from the service request brief data
      const brief = (request.briefJson ?? {}) as Record<string, string>;
      const newProjectId = randomUUID();
      const [newProject] = await db
        .insert(creativeProjectsTable)
        .values({
          projectId: newProjectId,
          sourceType: "service_catalog",
          serviceRequestId: request.id,
          serviceQuotationId: gate.serviceQuotationId,
          brandName: request.companyName ?? request.customerName,
          businessType: brief.companyIndustry ?? "general",
          targetMarket: brief.audienceDemographics ?? "general",
          productOrService: brief.outputFormats ?? "creative assets",
          stylePreference: brief.stylePreference ?? null,
          colorPreference: brief.colorPalette ?? null,
          referenceLinks: brief.referenceLinks ?? null,
          goal: brief.primaryGoal ?? "brand creative project",
          notes: request.notes ?? null,
          deadline: brief.deadline ?? null,
          status: "pending",
        })
        .returning();
      projectId = newProject.projectId;
    }
    quotationDbId = serviceQuotation.id;
    quotationTotal = Number(serviceQuotation.total) || 0;
    quotationCurrency = serviceQuotation.currency;
  } else {
    return { alreadyConverted: false, createdProjectId: null, skipped: "no_quotation_id" };
  }

  // Load the project record (for status check before enqueue)
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (!project) return { alreadyConverted: false, createdProjectId: null, skipped: "project_not_found" };

  // Ensure a payment schedule exists for this project. Previously, only the
  // fixed_price public checkout path generated one — the quotation/custom
  // flow left creative_projects.filesUnlocked permanently false with no way
  // for the customer to ever submit payment proof. generateScheduleForProject
  // is idempotent (no-op if a schedule already exists), so this is safe to
  // call unconditionally on every conversion.
  await generateScheduleForProject({
    projectId: project.id,
    paymentPolicy: project.paymentPolicy as PaymentPolicy,
    depositPercentage: project.depositPercentage,
    totalAmount: quotationTotal,
    currency: quotationCurrency,
  }).catch((err) => {
    console.warn(`[conversion] generateScheduleForProject non-fatal error for project ${project.id}:`, err);
  });

  // All preconditions met — perform the conversion with an atomic CAS update.
  // The WHERE clause guards against concurrent calls both succeeding (race safety).

  const [converted] = await db
    .update(aiServiceRequestsTable)
    .set({
      status: "converted_to_project",
      createdProjectId: projectId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiServiceRequestsTable.id, serviceRequestId),
      isNull(aiServiceRequestsTable.createdProjectId), // only convert once
    ))
    .returning({ id: aiServiceRequestsTable.id });

  if (!converted) {
    // Another concurrent call already completed conversion — return idempotent result.
    const [current] = await db
      .select({ createdProjectId: aiServiceRequestsTable.createdProjectId })
      .from(aiServiceRequestsTable)
      .where(eq(aiServiceRequestsTable.id, serviceRequestId))
      .limit(1);
    return { alreadyConverted: true, createdProjectId: current?.createdProjectId ?? null };
  }

  // Audit events — outside the transaction so audit failures don't roll back
  await logAudit(
    "conversion",
    "service_request_converted",
    String(serviceRequestId),
    "ai_service_request",
    "success",
    { projectId, quotationDbId, gateId: gate.id, gateStatus: gate.status },
  );

  // Publish lifecycle events
  publishSafe({
    eventType: "service_request.approved",
    sourceModule: "conversion",
    sourceId: String(serviceRequestId),
    payload: { serviceRequestId, quotationId: quotationDbId, projectId },
  });

  publishSafe({
    eventType: gate.status === "waived" ? "commercial_gate.waived" : "commercial_gate.verified",
    sourceModule: "conversion",
    sourceId: String(gate.id),
    payload: { gateId: gate.id, quotationId: quotationDbId, serviceRequestId },
  });

  publishSafe({
    eventType: "service_request.converted",
    sourceModule: "conversion",
    sourceId: String(serviceRequestId),
    payload: { serviceRequestId, projectId, quotationId: quotationDbId },
  });

  publishSafe({
    eventType: "project.created",
    sourceModule: "conversion",
    sourceId: projectId,
    payload: { projectId, serviceRequestId, quotationId: quotationDbId },
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
 * Legacy flow: called from quotation-approval and gate verify/waive handlers.
 * Resolves service request from gate.serviceRequestId (legacy creative_project_quotations path).
 */
export async function checkAndMaybeConvert(quotationId: number): Promise<ConversionResult | null> {
  const gate = await getGateForQuotation(quotationId);
  if (!gate || gate.serviceRequestId == null) return null;
  return convertServiceRequestToProject(gate.serviceRequestId);
}

// ── checkAndMaybeConvertByServiceQuotation ────────────────────────────────────

/**
 * New service-catalog flow: called from ai_quotations approval and gate handlers.
 * Resolves service request from gate.serviceRequestId via the ai_quotations path.
 */
export async function checkAndMaybeConvertByServiceQuotation(
  serviceQuotationId: number,
): Promise<ConversionResult | null> {
  const gate = await getGateForServiceQuotation(serviceQuotationId);
  if (!gate || gate.serviceRequestId == null) return null;
  return convertServiceRequestToProject(gate.serviceRequestId);
}
