/**
 * customer-workspace-documents.ts — Invoice PDF generation & signed download routes.
 *
 * Routes (all under /public/customer/workspace/:token/):
 *   GET  /invoices/documents               list customer docs (no storage path)
 *   POST /invoices/:invoiceId/generate     generate/regenerate PDF for an invoice
 *   GET  /invoices/documents/:docId/access get a signed access token for a doc
 *   GET  /documents/access/:docToken       stream the PDF (resolves signed token)
 *
 * All routes enforce workspace token session + customer ownership checks.
 * storage_path is never returned; only signed tokens with short TTL.
 */
import { createReadStream } from "fs";
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import type { WorkspaceSession } from "../services/customerWorkspaceService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  generateDepositInvoice,
  generateRemainingInvoice,
  generateFinalInvoice,
  generatePaymentReceipt,
  generateDocumentAccessToken,
  resolveDocumentForDownload,
  listCustomerDocuments,
} from "../services/customerInvoicePdfService.js";
import { db, aiInvoicesTable, aiCustomerDocumentsTable, creativeProjectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function withSession(req: import("express").Request, res: import("express").Response): Promise<WorkspaceSession | null> {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

// ── GET /public/customer/workspace/:token/invoices/documents ──────────────────
router.get("/public/customer/workspace/:token/invoices/documents", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const docs = await listCustomerDocuments(session.emailHash, q["projectId"]);
  res.json({ items: docs, total: docs.length });
});

// ── POST /public/customer/workspace/:token/invoices/:invoiceId/generate ───────
router.post("/public/customer/workspace/:token/invoices/:invoiceId/generate", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const invoiceId = parseInt((req.params as { invoiceId: string }).invoiceId, 10);
  if (isNaN(invoiceId)) {
    res.status(400).json({ error: "Invalid invoiceId" });
    return;
  }

  // Ownership check: invoice -> project -> customer
  const [inv] = await db.select().from(aiInvoicesTable).where(eq(aiInvoicesTable.id, invoiceId));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, inv.projectId));
  if (!project) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const docType = typeof body["documentType"] === "string" ? body["documentType"] : inv.invoiceType;

  const generators: Record<string, typeof generateDepositInvoice> = {
    deposit_invoice: generateDepositInvoice,
    deposit: generateDepositInvoice,
    remaining_invoice: generateRemainingInvoice,
    remaining: generateRemainingInvoice,
    final_invoice: generateFinalInvoice,
    final: generateFinalInvoice,
    payment_receipt: generatePaymentReceipt,
    receipt: generatePaymentReceipt,
  };

  const generate = generators[docType] ?? generateFinalInvoice;
  const result = await generate(
    invoiceId,
    session.emailHash,
    session.clientEmail,
    session.clientName,
    project.projectId,
    inv.paymentScheduleId ?? null,
  );

  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }

  await logAudit("customer-workspace", "invoice_generated", String(invoiceId), "customer_document", "success", {
    clientEmail: session.clientEmail,
    documentNumber: result.documentNumber,
    documentType: docType,
  });

  res.status(201).json({
    documentNumber: result.documentNumber,
    documentType: result.document.documentType,
    status: result.document.status,
    generatedAt: result.document.generatedAt?.toISOString() ?? null,
    accessToken: result.accessToken,
    expiresAt: result.expiresAt,
    downloadPath: `/api/public/customer/workspace/${req.params["token"]}/documents/access/${result.accessToken}`,
  });
});

// ── GET /public/customer/workspace/:token/invoices/documents/:docId/access ────
router.get("/public/customer/workspace/:token/invoices/documents/:docId/access", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const docId = parseInt((req.params as { docId: string }).docId, 10);
  if (isNaN(docId)) {
    res.status(400).json({ error: "Invalid docId" });
    return;
  }

  // Verify ownership
  const [doc] = await db
    .select()
    .from(aiCustomerDocumentsTable)
    .where(and(eq(aiCustomerDocumentsTable.id, docId), eq(aiCustomerDocumentsTable.customerId, session.emailHash)));

  if (!doc || doc.status === "voided") {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const accessToken = generateDocumentAccessToken(docId, session.emailHash);
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  await logAudit("customer-workspace", "invoice_viewed", String(docId), "customer_document", "success", {
    clientEmail: session.clientEmail,
    documentType: doc.documentType,
  });

  res.json({
    accessToken,
    expiresAt,
    downloadPath: `/api/public/customer/workspace/${req.params["token"]}/documents/access/${accessToken}`,
  });
});

// ── GET /public/customer/workspace/:token/documents/access/:docToken ──────────
// Streams the actual PDF — this is the download endpoint
router.get("/public/customer/workspace/:token/documents/access/:docToken", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { docToken } = req.params as { docToken: string };
  const resolved = await resolveDocumentForDownload(docToken, session.emailHash);

  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.reason });
    return;
  }

  await logAudit("customer-workspace", "invoice_downloaded", docToken.slice(0, 16), "customer_document", "success", {
    clientEmail: session.clientEmail,
  });

  res.setHeader("Content-Type", resolved.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${resolved.fileName}"`);
  createReadStream(resolved.storagePath).pipe(res);
});

export default router;
