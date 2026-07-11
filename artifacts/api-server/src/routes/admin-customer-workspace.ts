/**
 * admin-customer-workspace.ts — Admin visibility into the Customer Workspace.
 *
 * Admin (adminAuth-protected) read access to a customer's workspace by email,
 * plus an audit-logged "view as customer" impersonation link generator and
 * workspace-wide analytics KPIs. Read-only aggregation on top of existing
 * data — does not modify any existing module.
 */
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import {
  resolveCustomerByEmail,
  getWorkspaceSummary,
  listWorkspaceProjectsFiltered,
  listWorkspaceDownloads,
  listWorkspaceInvoices,
  listBrandKits,
  listWorkspaceActivity,
  computeWorkspaceAnalytics,
} from "../services/customerWorkspaceService.js";
import { generateReviewToken } from "../services/clientReviewService.js";
import { db, customerDashboardTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function resolveOr404(req: import("express").Request, res: import("express").Response) {
  const { email } = req.params as { email: string };
  const session = await resolveCustomerByEmail(decodeURIComponent(email));
  if (!session) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return session;
}

// ── GET /ai/customer-workspace/:email ──────────────────────────────────────────
router.get("/ai/customer-workspace/:email", async (req, res): Promise<void> => {
  const session = await resolveOr404(req, res);
  if (!session) return;
  const [summary, projects] = await Promise.all([
    getWorkspaceSummary(req, session),
    listWorkspaceProjectsFiltered(req, session.clientEmail, {}),
  ]);
  await logAudit("admin", "view_customer_workspace", session.emailHash, "customer_workspace", "success", {
    adminActor: (req.headers["x-admin-key"] ? "admin" : "unknown"),
    clientEmail: session.clientEmail,
  });
  res.json({ session, summary, projects });
});

// ── GET /ai/customer-workspace/:email/downloads ───────────────────────────────
router.get("/ai/customer-workspace/:email/downloads", async (req, res): Promise<void> => {
  const session = await resolveOr404(req, res);
  if (!session) return;
  const items = await listWorkspaceDownloads(req, session.clientEmail, {});
  res.json({ items, total: items.length });
});

// ── GET /ai/customer-workspace/:email/invoices ────────────────────────────────
router.get("/ai/customer-workspace/:email/invoices", async (req, res): Promise<void> => {
  const session = await resolveOr404(req, res);
  if (!session) return;
  const items = await listWorkspaceInvoices(req, session.clientEmail, {});
  res.json({ items, total: items.length });
});

// ── GET /ai/customer-workspace/:email/assets ──────────────────────────────────
router.get("/ai/customer-workspace/:email/assets", async (req, res): Promise<void> => {
  const session = await resolveOr404(req, res);
  if (!session) return;
  const items = await listBrandKits(req, session.clientEmail);
  res.json({ items, total: items.length });
});

// ── GET /ai/customer-workspace/:email/activity ────────────────────────────────
router.get("/ai/customer-workspace/:email/activity", async (req, res): Promise<void> => {
  const session = await resolveOr404(req, res);
  if (!session) return;
  const items = await listWorkspaceActivity(req, session.clientEmail);
  res.json({ items, total: items.length });
});

// ── POST /ai/customer-workspace/impersonate ───────────────────────────────────
// Issues a fresh dashboard token for the given customer so support staff can
// open their workspace, and writes an audit log entry for the action.
router.post("/ai/customer-workspace/impersonate", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const clientEmail = typeof body["clientEmail"] === "string" ? body["clientEmail"].trim() : "";
  if (!clientEmail) {
    res.status(400).json({ error: "clientEmail is required" });
    return;
  }

  const session = await resolveCustomerByEmail(clientEmail);
  if (!session) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const { plaintext, hash } = generateReviewToken();
  const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // short-lived: 1 hour, admin-issued

  await db
    .update(customerDashboardTokensTable)
    .set({ tokenHash: hash, expiresAt })
    .where(eq(customerDashboardTokensTable.emailHash, session.emailHash));

  await logAudit("admin", "impersonate_customer", session.emailHash, "customer_workspace", "success", {
    clientEmail: session.clientEmail,
    note: "Admin-issued 1-hour workspace link (view-as-customer)",
  });

  res.status(201).json({
    dashboardToken: plaintext,
    workspacePath: `/workspace/${plaintext}`,
    expiresAt: expiresAt.toISOString(),
    clientEmail: session.clientEmail,
    clientName: session.clientName,
  });
});

// ── GET /ai/customer-workspace-analytics ──────────────────────────────────────
router.get("/ai/customer-workspace-analytics", async (_req, res): Promise<void> => {
  const analytics = await computeWorkspaceAnalytics();
  res.json(analytics);
});

export default router;
