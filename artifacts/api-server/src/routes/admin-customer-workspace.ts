/**
 * admin-customer-workspace.ts — Admin visibility into the Customer Workspace.
 *
 * Admin (adminAuth-protected) read access to a customer's workspace by email,
 * plus hardened impersonation (separate token table, mandatory reason, audit events),
 * workspace-wide analytics KPIs, and token rotation for customers.
 */
import { randomBytes } from "crypto";
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
  hashEmail,
} from "../services/customerWorkspaceService.js";
import { hashToken } from "../services/clientReviewService.js";
import {
  db,
  customerDashboardTokensTable,
  aiCustomerImpersonationTokensTable,
} from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";

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
    adminActor: req.headers["x-admin-key"] ? "admin" : "unknown",
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
// Issues a SEPARATE short-lived impersonation token — does NOT overwrite
// the customer's real dashboard token. Requires mandatory reason.
router.post("/ai/customer-workspace/impersonate", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const clientEmail = typeof body["clientEmail"] === "string" ? body["clientEmail"].trim() : "";
  const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";

  if (!clientEmail) {
    res.status(400).json({ error: "clientEmail is required" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason is required — document why you are accessing this customer workspace" });
    return;
  }

  const session = await resolveCustomerByEmail(clientEmail);
  if (!session) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  // Generate a separate impersonation token (plaintext shown once to admin)
  const plaintext = randomBytes(32).toString("hex");
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

  // Clean up any expired impersonation tokens for this customer
  await db
    .delete(aiCustomerImpersonationTokensTable)
    .where(
      and(
        eq(aiCustomerImpersonationTokensTable.emailHash, session.emailHash),
        lt(aiCustomerImpersonationTokensTable.expiresAt, new Date()),
      ),
    );

  await db.insert(aiCustomerImpersonationTokensTable).values({
    emailHash: session.emailHash,
    clientEmail: session.clientEmail,
    tokenHash,
    issuedBy: "admin",
    reason,
    readonly: true,
    expiresAt,
  });

  await logAudit("admin", "customer.impersonation.started", session.emailHash, "customer_workspace", "success", {
    clientEmail: session.clientEmail,
    reason,
    note: "Separate impersonation token issued — customer real token NOT affected",
  });

  res.status(201).json({
    impersonationToken: plaintext,
    workspacePath: `/workspace/${plaintext}`,
    expiresAt: expiresAt.toISOString(),
    clientEmail: session.clientEmail,
    clientName: session.clientName,
    readonly: true,
    warning: "This token grants read-only workspace access. Store securely and do not log.",
  });
});

// ── POST /ai/customer-workspace/impersonate/end ───────────────────────────────
// Admin explicitly ends an impersonation session.
router.post("/ai/customer-workspace/impersonate/end", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const impersonationToken = typeof body["impersonationToken"] === "string" ? body["impersonationToken"].trim() : "";
  if (!impersonationToken) {
    res.status(400).json({ error: "impersonationToken is required" });
    return;
  }

  const tokenHash = hashToken(impersonationToken);
  const [row] = await db
    .select()
    .from(aiCustomerImpersonationTokensTable)
    .where(eq(aiCustomerImpersonationTokensTable.tokenHash, tokenHash));

  if (!row) {
    res.status(404).json({ error: "Impersonation token not found or already ended" });
    return;
  }

  await db
    .update(aiCustomerImpersonationTokensTable)
    .set({ endedAt: new Date() })
    .where(eq(aiCustomerImpersonationTokensTable.id, row.id));

  await logAudit("admin", "customer.impersonation.ended", row.emailHash, "customer_workspace", "success", {
    clientEmail: row.clientEmail,
  });

  res.json({ ok: true, endedAt: new Date().toISOString() });
});

// ── POST /ai/customer-workspace/customers/:customerId/rotate-token ────────────
// Rotate a customer's real dashboard token. Invalidates the old token.
// customerId = email (URL-encoded)
router.post("/ai/customer-workspace/customers/:customerId/rotate-token", async (req, res): Promise<void> => {
  const { customerId } = req.params as { customerId: string };
  const body = req.body as Record<string, unknown>;
  const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";

  const decodedEmail = decodeURIComponent(customerId);
  const session = await resolveCustomerByEmail(decodedEmail);
  if (!session) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  // Generate new token
  const plaintext = randomBytes(32).toString("hex");
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  await db
    .update(customerDashboardTokensTable)
    .set({ tokenHash, expiresAt })
    .where(eq(customerDashboardTokensTable.emailHash, session.emailHash));

  await logAudit("admin", "token_rotated", session.emailHash, "customer_dashboard_token", "success", {
    clientEmail: session.clientEmail,
    reason: reason || "Admin-initiated token rotation",
  });

  res.status(201).json({
    newToken: plaintext,
    workspacePath: `/workspace/${plaintext}`,
    expiresAt: expiresAt.toISOString(),
    auditReference: `token_rotated:${session.emailHash.slice(0, 12)}`,
    warning: "Previous token is now invalid. Share new token securely — shown once only.",
  });
});

// ── GET /ai/customer-workspace-analytics ──────────────────────────────────────
router.get("/ai/customer-workspace-analytics", async (_req, res): Promise<void> => {
  const analytics = await computeWorkspaceAnalytics();
  res.json(analytics);
});

export default router;
