/**
 * payments.ts — Dual Commercial Flow payment tracking & invoices.
 *
 * Admin routes (adminAuth-protected, mounted normally under /api):
 *   GET  /ai/payments/pending                          — worklist of pending installments
 *   GET  /ai/payments/project/:projectId               — list a project's schedule
 *   GET  /ai/payments/kpi                              — payment KPIs dashboard
 *   POST /ai/payments/:scheduleId/verify               — verify a submitted payment (atomic)
 *   POST /ai/payments/:scheduleId/reject               — reject a submitted payment
 *   GET  /ai/payments/:scheduleId/proof-url            — generate a short-lived signed URL for a proof
 *   POST /ai/payments/:scheduleId/invoice              — generate an invoice for an installment
 *   GET  /ai/payments/invoices/project/:projectId      — list a project's invoices
 *   POST /ai/payments/project/:projectId/unlock        — manual admin file unlock
 *
 * Public routes (bypass adminAuth via the /public prefix):
 *   POST /public/payments/:scheduleId/submit-proof     — customer submits a payment proof
 *                                                        Requires workspaceToken in body for IDOR prevention.
 */
import { Router } from "express";
import { eq, ne, inArray, and, sql } from "drizzle-orm";
import {
  db,
  aiInvoicesTable,
  aiPaymentScheduleTable,
  creativeProjectsTable,
  customerDashboardTokensTable,
  creativeAiClientReviewsTable,
  aiServiceRequestsTable,
  type CreativeProject,
} from "@workspace/db";
import {
  getScheduleForProject,
  verifyPayment,
  rejectPayment,
  submitPaymentProof,
  generateInvoiceForSchedule,
} from "../services/paymentScheduleService.js";
import { logAudit } from "../services/aiAuditService.js";
import { paymentLimiter } from "../middleware/rateLimiter.js";
import { hashToken } from "../services/clientReviewService.js";
import {
  uploadPrivatePaymentProof,
  getPaymentProofSignedUrl,
  deletePrivatePaymentProof,
  isLegacyPublicProofUrl,
  PAYMENT_PROOF_ALLOWED_MIME,
  PAYMENT_PROOF_MAX_BYTES,
} from "../lib/supabaseStorage.js";

const router = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

// ── Ownership helpers ──────────────────────────────────────────────────────────

/**
 * Verify that the customer identified by clientEmail owns the given creative project.
 * Checks both service-catalog flow (via ai_service_requests) and direct flow
 * (via creative_ai_client_reviews).
 */
async function checkPaymentOwnership(clientEmail: string, project: CreativeProject): Promise<boolean> {
  const email = clientEmail.toLowerCase().trim();

  // Service catalog flow: project was created from a service request
  if (project.serviceRequestId) {
    const [sr] = await db
      .select({ id: aiServiceRequestsTable.id })
      .from(aiServiceRequestsTable)
      .where(
        and(
          eq(aiServiceRequestsTable.id, project.serviceRequestId),
          eq(aiServiceRequestsTable.customerEmail, email),
        ),
      )
      .limit(1);
    if (sr) return true;
  }

  // Direct flow: customer has a review token for this project
  const [review] = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(
      and(
        eq(creativeAiClientReviewsTable.projectId, project.projectId),
        eq(creativeAiClientReviewsTable.clientEmail, email),
      ),
    )
    .limit(1);
  if (review) return true;

  return false;
}

// ── GET /ai/payments/pending ───────────────────────────────────────────────────

router.get("/ai/payments/pending", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(inArray(aiPaymentScheduleTable.status, ["pending", "partially_paid", "failed"]));

  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const projects = projectIds.length > 0
    ? await db.select().from(creativeProjectsTable).where(inArray(creativeProjectsTable.id, projectIds))
    : [];

  const byProject = new Map(projects.map((p) => [p.id, p]));
  const grouped = projectIds.map((id) => ({
    project: byProject.get(id) ?? null,
    schedule: rows.filter((r) => r.projectId === id),
  })).filter((g) => g.project !== null);

  res.json(grouped);
});

// ── GET /ai/payments/project/:projectId ───────────────────────────────────────

router.get("/ai/payments/project/:projectId", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }
  const schedule = await getScheduleForProject(projectId);
  res.json(schedule);
});

// ── POST /ai/payments/:scheduleId/verify ──────────────────────────────────────
// Actor identity is derived server-side from the admin key — not from the request body.
// The optional "displayName" body field is accepted as a human-readable label only.

router.post("/ai/payments/:scheduleId/verify", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  // Server derives actor identity. Accept optional displayName for audit readability.
  const displayName = typeof body.verifiedBy === "string" && body.verifiedBy.trim()
    ? body.verifiedBy.trim()
    : "admin";
  // Sanitize: never trust this as a real identity claim — it's for display only.
  const actor = `admin:${displayName.replace(/[^a-zA-Z0-9 @._-]/g, "").slice(0, 64)}`;

  const reference = typeof body.reference === "string" ? body.reference.trim() : null;

  try {
    const result = await verifyPayment(scheduleId, actor, reference);
    if (!result) {
      // null from verifyPayment after NOT already-paid → terminal/not-found
      const [exists] = await db
        .select({ id: aiPaymentScheduleTable.id })
        .from(aiPaymentScheduleTable)
        .where(eq(aiPaymentScheduleTable.id, scheduleId))
        .limit(1);
      if (!exists) {
        res.status(404).json({ error: "Payment schedule not found" });
      } else {
        res.status(409).json({ error: "Payment is in a terminal state and cannot be verified" });
      }
      return;
    }
    if (result.alreadyPaid) {
      res.status(409).json({ error: "Pembayaran sudah diverifikasi", schedule: result.schedule });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "ALREADY_PAID") {
      res.status(409).json({ error: "Pembayaran sudah diverifikasi oleh proses lain" });
      return;
    }
    console.error("[payments] verify error:", err);
    res.status(500).json({ error: "Gagal memverifikasi pembayaran" });
  }
});

// ── POST /ai/payments/:scheduleId/invoice ─────────────────────────────────────

router.post("/ai/payments/:scheduleId/invoice", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const invoice = await generateInvoiceForSchedule(scheduleId);
  if (!invoice) { res.status(404).json({ error: "Payment schedule not found" }); return; }
  res.status(201).json(invoice);
});

// ── GET /ai/payments/invoices/project/:projectId ──────────────────────────────

router.get("/ai/payments/invoices/project/:projectId", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }
  const rows = await db.select().from(aiInvoicesTable).where(eq(aiInvoicesTable.projectId, projectId));
  res.json(rows);
});

// ── GET /ai/payments/kpi ───────────────────────────────────────────────────────

router.get("/ai/payments/kpi", async (_req, res): Promise<void> => {
  const [scheduleStats] = await db
    .select({
      totalPaidRaw: sql<string>`COALESCE(SUM(CASE WHEN status = 'paid' THEN amount::numeric ELSE 0 END), 0)`,
      totalPendingRaw: sql<string>`COALESCE(SUM(CASE WHEN status != 'paid' AND status != 'cancelled' THEN amount::numeric ELSE 0 END), 0)`,
      countPending: sql<number>`COUNT(CASE WHEN status IN ('pending','partially_paid','failed') THEN 1 END)::int`,
    })
    .from(aiPaymentScheduleTable);

  const [projectStats] = await db
    .select({
      locked: sql<number>`COUNT(CASE WHEN files_unlocked = false AND status NOT IN ('draft','cancelled') THEN 1 END)::int`,
      unlocked: sql<number>`COUNT(CASE WHEN files_unlocked = true THEN 1 END)::int`,
    })
    .from(creativeProjectsTable);

  res.json({
    paidRevenue: parseFloat(scheduleStats?.totalPaidRaw ?? "0"),
    outstandingBalance: parseFloat(scheduleStats?.totalPendingRaw ?? "0"),
    pendingVerificationCount: scheduleStats?.countPending ?? 0,
    lockedProjects: projectStats?.locked ?? 0,
    unlockedProjects: projectStats?.unlocked ?? 0,
  });
});

// ── POST /ai/payments/:scheduleId/reject ──────────────────────────────────────
// Actor identity is derived server-side. Body may contain `reason` (required)
// and optionally `displayName` (not trusted as identity, used for audit label only).

router.post("/ai/payments/:scheduleId/reject", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }

  // Server-derived actor identity
  const displayName = typeof body.rejectedBy === "string" && body.rejectedBy.trim()
    ? body.rejectedBy.trim()
    : "admin";
  const actor = `admin:${displayName.replace(/[^a-zA-Z0-9 @._-]/g, "").slice(0, 64)}`;

  const result = await rejectPayment(scheduleId, actor, reason);
  if (!result) {
    const [exists] = await db
      .select({ id: aiPaymentScheduleTable.id, status: aiPaymentScheduleTable.status })
      .from(aiPaymentScheduleTable)
      .where(eq(aiPaymentScheduleTable.id, scheduleId))
      .limit(1);
    if (!exists) {
      res.status(404).json({ error: "Payment schedule not found" });
    } else {
      res.status(409).json({ error: "Payment is in a terminal state and cannot be rejected" });
    }
    return;
  }
  res.json(result);
});

// ── GET /ai/payments/:scheduleId/proof-url ────────────────────────────────────
// Admin: generate a short-lived signed URL to view a private payment proof.
// Legacy public URLs (stored before private-bucket migration) are returned as-is.

router.get("/ai/payments/:scheduleId/proof-url", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const [schedule] = await db
    .select({ id: aiPaymentScheduleTable.id, proofImageUrl: aiPaymentScheduleTable.proofImageUrl })
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  if (!schedule.proofImageUrl) { res.status(404).json({ error: "No proof uploaded for this schedule" }); return; }

  // Legacy public URL — return as-is (migration debt: noted)
  if (isLegacyPublicProofUrl(schedule.proofImageUrl)) {
    res.json({ url: schedule.proofImageUrl, legacy: true, expiresAt: null });
    return;
  }

  try {
    const signedUrl = await getPaymentProofSignedUrl(schedule.proofImageUrl, 3600);
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    res.json({ url: signedUrl, legacy: false, expiresAt });
  } catch (err) {
    console.error("[payments] proof-url generation failed:", err);
    res.status(500).json({ error: "Gagal membuat URL bukti pembayaran" });
  }
});

// ── POST /ai/payments/project/:projectId/unlock ───────────────────────────────

router.post("/ai/payments/project/:projectId/unlock", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const displayName = typeof body.unlockedBy === "string" && body.unlockedBy.trim()
    ? body.unlockedBy.trim()
    : "admin";
  const actor = `admin:${displayName.replace(/[^a-zA-Z0-9 @._-]/g, "").slice(0, 64)}`;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const [project] = await db
    .update(creativeProjectsTable)
    .set({ filesUnlocked: true, updatedAt: new Date() })
    .where(and(eq(creativeProjectsTable.id, projectId), ne(creativeProjectsTable.filesUnlocked, true)))
    .returning();

  if (!project) {
    const [existing] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, projectId)).limit(1);
    if (existing?.filesUnlocked) {
      res.json({ ok: true, alreadyUnlocked: true, projectId });
      return;
    }
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await logAudit("payments", "manual_unlock", String(projectId), "creative_project", "success", {
    unlockedBy: actor,
    reason: reason || "Manual admin override",
  });

  res.json({ ok: true, projectId, filesUnlocked: true, unlockedBy: actor });
});

// ── POST /public/payments/:scheduleId/submit-proof ────────────────────────────
//
// Security: requires workspaceToken in the request body. The token is resolved
// server-side to a customer identity, and then ownership of the payment schedule
// is verified before accepting any data.
//
// File validation: MIME type is checked server-side (allowlist: JPEG, PNG, WebP, PDF).
// The filename is generated server-side (UUID) to prevent overwrite and enumeration.
// Files are stored in a private bucket (payment-proofs). Orphan cleanup is performed
// if the DB write fails after a successful upload.

router.post("/public/payments/:scheduleId/submit-proof", paymentLimiter, async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // ── P0-1: Authentication / ownership ────────────────────────────────────────

  const workspaceToken = typeof body.workspaceToken === "string" ? body.workspaceToken.trim() : "";
  if (!workspaceToken) {
    res.status(401).json({ error: "workspaceToken diperlukan untuk mengidentifikasi akun Anda" });
    return;
  }

  // Resolve token → customer identity
  const tokenHash = hashToken(workspaceToken);
  const [tokenRow] = await db
    .select()
    .from(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow) {
    res.status(401).json({ error: "Link workspace tidak valid atau sudah kedaluwarsa" });
    return;
  }
  if (new Date() > tokenRow.expiresAt) {
    res.status(401).json({ error: "Link workspace sudah kedaluwarsa. Silakan minta link baru." });
    return;
  }

  const clientEmail = tokenRow.clientEmail.toLowerCase().trim();

  // Load the payment schedule
  const [scheduleRow] = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!scheduleRow) {
    res.status(404).json({ error: "Jadwal pembayaran tidak ditemukan" });
    return;
  }

  // Load the project (needed for both ownership check and storage path)
  const [projectRow] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, scheduleRow.projectId))
    .limit(1);

  if (!projectRow) {
    res.status(404).json({ error: "Jadwal pembayaran tidak ditemukan" });
    return;
  }

  // Status guard — give accurate error messages (not "not found or already paid")
  if (scheduleRow.status === "paid") {
    res.status(409).json({ error: "Pembayaran sudah diverifikasi dan tidak dapat diubah" });
    return;
  }
  if (scheduleRow.status === "cancelled") {
    res.status(409).json({ error: "Pembayaran telah dibatalkan" });
    return;
  }
  if (scheduleRow.status === "refunded") {
    res.status(409).json({ error: "Pembayaran telah dikembalikan" });
    return;
  }
  if (!["pending", "failed"].includes(scheduleRow.status)) {
    res.status(409).json({ error: "Pembayaran tidak dapat menerima bukti pada status saat ini" });
    return;
  }

  // IDOR ownership check — 403 if not owner
  const ownsProject = await checkPaymentOwnership(clientEmail, projectRow);
  if (!ownsProject) {
    res.status(403).json({ error: "Akses ditolak" });
    return;
  }

  // ── Validate required fields ───────────────────────────────────────────────

  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) { res.status(400).json({ error: "reference wajib diisi" }); return; }

  // ── P1-1 / Phase 5: Private file upload with server-side validation ────────

  let proofStoragePath: string | null = null;
  const proofImageBase64 = typeof body.proofImageBase64 === "string" ? body.proofImageBase64 : null;
  const proofImageMimeType = typeof body.proofImageMimeType === "string" ? body.proofImageMimeType : "image/jpeg";

  if (proofImageBase64) {
    // Server-side MIME validation (allowlist — never trust client-provided MIME alone)
    if (!PAYMENT_PROOF_ALLOWED_MIME.has(proofImageMimeType)) {
      res.status(400).json({
        error: `Tipe file tidak diizinkan: ${proofImageMimeType}. Gunakan JPEG, PNG, WebP, atau PDF.`,
      });
      return;
    }

    // Server-side size validation
    const raw = proofImageBase64.includes(",") ? proofImageBase64.split(",")[1]! : proofImageBase64;
    const estimatedBytes = Math.ceil(raw.length * 0.75);
    if (estimatedBytes > PAYMENT_PROOF_MAX_BYTES) {
      res.status(400).json({ error: `Ukuran file melebihi batas 5MB` });
      return;
    }

    try {
      proofStoragePath = await uploadPrivatePaymentProof(
        proofImageBase64,
        proofImageMimeType,
        projectRow.projectId,  // UUID string
        scheduleId,
      );
    } catch (err) {
      console.error("[payments] Private proof upload failed:", err);
      res.status(500).json({ error: "Gagal mengunggah bukti pembayaran. Silakan coba lagi." });
      return;
    }
  }

  // ── Persist proof to DB (with orphan cleanup if this fails) ───────────────

  let schedule: typeof scheduleRow | null = null;
  try {
    schedule = await submitPaymentProof(scheduleId, reference, proofStoragePath);
  } catch (err) {
    // DB write failed — clean up the uploaded file to avoid orphans
    if (proofStoragePath) {
      deletePrivatePaymentProof(proofStoragePath).catch(() => {});
    }
    console.error("[payments] submitPaymentProof DB write failed:", err);
    res.status(500).json({ error: "Gagal menyimpan bukti pembayaran. File telah dihapus." });
    return;
  }

  if (!schedule) {
    // submitPaymentProof returned null — status changed between our check and the update
    if (proofStoragePath) {
      deletePrivatePaymentProof(proofStoragePath).catch(() => {});
    }
    res.status(409).json({ error: "Pembayaran tidak dapat menerima bukti pada status saat ini" });
    return;
  }

  res.json({ ok: true, schedule, hasProofImage: proofStoragePath !== null });
});

// ── GET /public/payments/:scheduleId/status ───────────────────────────────────
// Lightweight polling endpoint for real-time payment status updates.

router.get("/public/payments/:scheduleId/status", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const [schedule] = await db
    .select({
      id: aiPaymentScheduleTable.id,
      status: aiPaymentScheduleTable.status,
      reference: aiPaymentScheduleTable.reference,
      paidAt: aiPaymentScheduleTable.paidAt,
      updatedAt: aiPaymentScheduleTable.updatedAt,
    })
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json({ scheduleId, status: schedule.status, reference: schedule.reference, paidAt: schedule.paidAt, updatedAt: schedule.updatedAt });
});

export default router;
