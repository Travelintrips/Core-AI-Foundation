/**
 * serviceRequestConversionService — transactional, idempotent conversion of an
 * approved-and-gate-cleared service request into an active creative project.
 *
 * convertServiceRequestToProject() is the single entry point. It:
 *   1. Verifies quotation.status === 'approved' AND gate is verified/waived.
 *   2. Short-circuits (idempotency) if the request already has a createdProjectId.
 *   3. Updates the service request status + createdProjectId via an atomic CAS
 *      update, and creates the linked creative_project in "waiting_payment".
 *      It never enqueues AI production itself — that only happens later, from
 *      paymentScheduleService.verifyPayment() once a real payment/deposit is
 *      confirmed by an admin. Clearing the commercial gate here only means
 *      the commercial terms were approved, not that money changed hands.
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
          // P0 payment gate: never start AI production straight off a cleared
          // commercial gate — the gate only confirms commercial terms, not that
          // money has actually been received. Production is enqueued later,
          // exclusively from paymentScheduleService.verifyPayment() once an
          // admin verifies a real installment.
          status: "waiting_payment",
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
  //
  // MANDATORY: a project without a payment schedule cannot be paid, so the
  // conversion must fail loudly rather than silently succeed. We audit the
  // failure and re-throw so the caller gets a proper error response and the
  // service request is NOT marked converted_to_project.
  await generateScheduleForProject({
    projectId: project.id,
    paymentPolicy: project.paymentPolicy as PaymentPolicy,
    depositPercentage: project.depositPercentage,
    totalAmount: quotationTotal,
    currency: quotationCurrency,
  }).catch(async (err) => {
    await logAudit(
      "conversion",
      "schedule_generation_failed",
      String(project.id),
      "creative_project",
      "error",
      {
        error: err instanceof Error ? err.message : String(err),
        projectId: project.id,
        paymentPolicy: project.paymentPolicy,
        totalAmount: quotationTotal,
        currency: quotationCurrency,
      },
    ).catch(() => {}); // audit failure must never mask the original error
    throw err; // surface loudly — conversion must not succeed without a payment schedule
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

  // P0 payment gate: conversion NEVER enqueues AI production directly, even
  // for a brand-new project. Clearing the commercial gate only means the
  // quotation/terms are approved — it says nothing about payment having been
  // received. The project was created (or already exists) in "waiting_payment"
  // and stays there until paymentScheduleService.verifyPayment() confirms a
  // real installment and enqueues runCreativeBriefWorkflow() itself. Do not
  // reintroduce a workflow trigger here.

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
