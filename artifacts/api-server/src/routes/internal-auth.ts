/**
 * internal-auth.ts — login / logout / me / change-password for the
 * Internal AI Portal.
 *
 *   POST /internal/auth/login             (public — exempted from adminAuth)
 *   POST /internal/auth/logout            (requireAuth)
 *   GET  /internal/auth/me                (requireAuth)
 *   POST /internal/auth/change-password   (requireAuth)
 */
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, internalUsersTable, toSafeInternalUser, type InternalRole, type InternalUser } from "@workspace/db";
import { hashPassword, verifyPassword, isPasswordStrongEnough } from "../services/passwordService.js";
import {
  issueSessionToken,
  issueMagicLoginToken,
  verifyMagicLoginToken,
  getInternalUserById,
  issuePasswordResetToken,
  verifyPasswordResetToken,
  getInternalUserByEmail,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from "../services/internalAuthService.js";
import { requireAuth, requireInternalRole } from "../middleware/internalAuth.js";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { logAudit } from "../services/aiAuditService.js";
import {
  getEmailTransportDiagnostic,
  sendEmail,
  verifyEmailTransport,
} from "../services/emailService.js";

const router = Router();

function clientIp(req: import("express").Request): string | undefined {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined;
}

const TRUSTED_PORTAL_HOSTS = new Set([
  "aicore.cstlogistic.co.id",
  "aicoding.travelintrips.co.id",
]);

function publicPortalBaseUrl(req: import("express").Request): string {
  const forwardedHost = typeof req.headers["x-forwarded-host"] === "string"
    ? req.headers["x-forwarded-host"].split(",")[0]?.trim()
    : "";
  const rawHost = forwardedHost || req.get("host") || "";
  const hostname = rawHost.replace(/:\d+$/, "").toLowerCase();
  if (process.env["NODE_ENV"] === "production" && TRUSTED_PORTAL_HOSTS.has(hostname)) {
    return `https://${hostname}`;
  }
  return (process.env["PUBLIC_APP_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
}

function setSessionCookie(res: import("express").Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

const MANAGEABLE_INTERNAL_ROLES: InternalRole[] = ["admin", "manager", "internal_staff"];

function isManageableInternalRole(value: unknown): value is InternalRole {
  return typeof value === "string" && MANAGEABLE_INTERNAL_ROLES.includes(value as InternalRole);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendMagicLoginEmailForUser(
  req: import("express").Request,
  user: InternalUser,
): Promise<{ ok: boolean; error?: string }> {
  const smtp = await verifyEmailTransport();
  if (!smtp.ok) return { ok: false, error: smtp.error ?? "smtp_unavailable" };

  const token = issueMagicLoginToken(user.id);
  const baseUrl = publicPortalBaseUrl(req);
  const magicUrl = `${baseUrl}/api/internal/auth/magic-login?token=${encodeURIComponent(token)}`;
  const sent = await sendEmail({
    to: user.email,
    subject: "Link login Portal AI Internal",
    html: `<p>Klik link berikut untuk login tanpa password:</p><p><a href="${magicUrl}">Login ke Portal AI</a></p><p>Link berlaku 10 menit.</p>`,
    module: "internal_auth",
    action: "magic_login_email",
    resourceId: String(user.id),
  });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? "send_failed" };
}

router.post("/internal/auth/login", loginLimiter, async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const ip = clientIp(req);

  // Generic error message — never reveal whether the email is registered.
  const GENERIC_ERROR = { error: "Email atau password salah." };

  if (!email || !password) {
    res.status(400).json({ error: "Email dan password wajib diisi." });
    return;
  }

  const user = await getInternalUserByEmail(email);
  if (!user) {
    await logAudit("internal_auth", "login", email, "internal_user", "failure", { reason: "not_found", ip });
    res.status(401).json(GENERIC_ERROR);
    return;
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    await logAudit("internal_auth", "login", String(user.id), "internal_user", "failure", { reason: "bad_password", ip });
    res.status(401).json(GENERIC_ERROR);
    return;
  }

  if (user.status !== "active") {
    await logAudit("internal_auth", "login", String(user.id), "internal_user", "failure", { reason: "suspended", ip });
    res.status(403).json({ error: "Akun ini tidak aktif. Hubungi owner/admin." });
    return;
  }

  await db.update(internalUsersTable).set({ lastLoginAt: new Date() }).where(eq(internalUsersTable.id, user.id));

  const token = issueSessionToken(user.id);
  setSessionCookie(res, token);
  await logAudit("internal_auth", "login", String(user.id), "internal_user", "success", { ip });

  res.json({ user: toSafeInternalUser(user) });
});

router.post("/internal/auth/dev-login", loginLimiter, async (req, res): Promise<void> => {
  if (process.env["NODE_ENV"] === "production" || process.env["LOCAL_DEV_AUTH_ENABLED"] !== "true") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ error: "Email wajib diisi." });
    return;
  }

  const user = await getInternalUserByEmail(email);
  if (!user || user.status !== "active" || user.accountType !== "internal") {
    await logAudit("internal_auth", "dev_login", email, "internal_user", "failure", {
      reason: "not_found_or_inactive",
      ip: clientIp(req),
    });
    res.status(401).json({ error: "Akun internal aktif tidak ditemukan." });
    return;
  }

  await db.update(internalUsersTable).set({ lastLoginAt: new Date() }).where(eq(internalUsersTable.id, user.id));
  setSessionCookie(res, issueSessionToken(user.id));
  await logAudit("internal_auth", "dev_login", String(user.id), "internal_user", "success", {
    ip: clientIp(req),
    localOnly: true,
  });
  res.json({ user: toSafeInternalUser(user) });
});

router.get("/internal/auth/email-diagnostics", async (_req, res): Promise<void> => {
  const diagnostic = await getEmailTransportDiagnostic();
  res.status(diagnostic.ok ? 200 : 503).json(diagnostic);
});

router.post("/internal/auth/request-magic-link", loginLimiter, async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const generic = { ok: true, message: "Jika akun aktif terdaftar, link login akan dikirim ke email." };
  if (!email) { res.status(400).json({ error: "Email wajib diisi." }); return; }

  // Check SMTP before looking up the account so an outage is reported
  // consistently and does not disclose whether a particular email exists.
  const smtp = await verifyEmailTransport();
  if (!smtp.ok) {
    await logAudit("internal_auth", "magic_login_email", "smtp", "email", "failure", {
      reason: "smtp_unavailable",
      error: smtp.error,
      ip: clientIp(req),
    });
    res.status(503).json({
      ok: false,
      error: "Layanan email sedang bermasalah. Silakan coba lagi beberapa saat lagi.",
    });
    return;
  }

  const user = await getInternalUserByEmail(email);
  if (!user || user.status !== "active") { res.json(generic); return; }

  const token = issueMagicLoginToken(user.id);
  const baseUrl = publicPortalBaseUrl(req);
  const magicUrl = `${baseUrl}/api/internal/auth/magic-login?token=${encodeURIComponent(token)}`;
  const sent = await sendEmail({
    to: user.email,
    subject: "Link login Portal AI Internal",
    html: `<p>Klik link berikut untuk login tanpa password:</p><p><a href="${magicUrl}">Login ke Portal AI</a></p><p>Link berlaku 10 menit.</p>`,
    module: "internal_auth", action: "magic_login_email", resourceId: String(user.id),
  });

  if (!sent.ok) {
    res.status(503).json({
      ok: false,
      error: "Layanan email sedang bermasalah. Silakan coba lagi beberapa saat lagi.",
    });
    return;
  }

  res.json(generic);
});

router.get("/internal/auth/magic-login", loginLimiter, async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const payload = token ? verifyMagicLoginToken(token) : null;
  const user = payload ? await getInternalUserById(payload.sub) : null;
  if (!user || user.status !== "active") { res.status(401).send("Link login tidak valid atau sudah kedaluwarsa."); return; }
  await db.update(internalUsersTable).set({ lastLoginAt: new Date() }).where(eq(internalUsersTable.id, user.id));
  setSessionCookie(res, issueSessionToken(user.id));
  await logAudit("internal_auth", "magic_login", String(user.id), "internal_user", "success", { ip: clientIp(req) });
  res.redirect("/");
});

router.post("/internal/auth/request-password-reset", loginLimiter, async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const generic = { ok: true, message: "Jika akun terdaftar, tautan reset akan dikirim ke email tersebut." };
  if (!email) {
    res.status(400).json({ error: "Email wajib diisi." });
    return;
  }

  // Match magic-link behavior: never report a successful recovery request while
  // the SMTP transport is unavailable. The check happens before account lookup
  // so the response still does not reveal whether an email is registered.
  const smtp = await verifyEmailTransport();
  if (!smtp.ok) {
    await logAudit("internal_auth", "password_reset_email", "smtp", "email", "failure", {
      reason: "smtp_unavailable",
      error: smtp.error,
      ip: clientIp(req),
    });
    res.status(503).json({
      ok: false,
      error: "Layanan email sedang bermasalah. Silakan coba lagi beberapa saat lagi.",
    });
    return;
  }

  const user = await getInternalUserByEmail(email);
  if (!user || user.status !== "active") {
    await logAudit("internal_auth", "password_reset_request", email, "internal_user", "failure", { reason: "not_found_or_inactive", ip: clientIp(req) });
    res.json(generic);
    return;
  }

  const token = issuePasswordResetToken(user);
  const baseUrl = publicPortalBaseUrl(req);
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendEmail({
    to: user.email,
    subject: "Reset kata sandi Portal AI Internal",
    html: `<p>Permintaan reset kata sandi diterima.</p><p><a href="${resetUrl}">Reset kata sandi</a></p><p>Tautan berlaku 15 menit dan hanya dapat digunakan sampai kata sandi berhasil diubah.</p>`,
    module: "internal_auth",
    action: "password_reset_email",
    resourceId: String(user.id),
  });
  await logAudit("internal_auth", "password_reset_request", String(user.id), "internal_user", sent.ok ? "success" : "failure", { ip: clientIp(req), emailSent: sent.ok });
  if (!sent.ok) {
    res.status(503).json({
      ok: false,
      error: "Layanan email sedang bermasalah. Silakan coba lagi beberapa saat lagi.",
    });
    return;
  }
  res.json(generic);
});

router.post("/internal/auth/reset-password", loginLimiter, async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!token || !isPasswordStrongEnough(newPassword)) {
    res.status(400).json({ error: "Tautan tidak valid atau password baru minimal 10 karakter." });
    return;
  }

  const user = await verifyPasswordResetToken(token);
  if (!user) {
    res.status(400).json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa." });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db.update(internalUsersTable)
    .set({ passwordHash: newHash, mustChangePassword: false, passwordChangedAt: new Date(), status: "active" })
    .where(eq(internalUsersTable.id, user.id));
  await logAudit("internal_auth", "password_reset", String(user.id), "internal_user", "success", { ip: clientIp(req) });
  res.json({ ok: true });
});

router.post("/internal/auth/logout", requireAuth, async (req, res): Promise<void> => {
  await logAudit("internal_auth", "logout", String(req.internalUser!.id), "internal_user", "success");
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/internal/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json({ user: toSafeInternalUser(req.internalUser!) });
});

router.get(
  "/internal/auth/users",
  requireAuth,
  requireInternalRole("owner", "admin"),
  async (_req, res): Promise<void> => {
    const users = await db.select().from(internalUsersTable).orderBy(internalUsersTable.email);
    res.json({ users: users.map(toSafeInternalUser) });
  },
);

router.post(
  "/internal/auth/users",
  requireAuth,
  requireInternalRole("owner", "admin"),
  async (req, res): Promise<void> => {
    const actor = req.internalUser!;
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const requestedRole = req.body?.role ?? "internal_staff";
    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: "Email tidak valid." });
      return;
    }
    if (!isManageableInternalRole(requestedRole)) {
      res.status(400).json({ error: "Role tidak valid." });
      return;
    }
    if (requestedRole === "admin" && actor.role !== "owner") {
      res.status(403).json({ error: "Hanya owner yang dapat membuat admin." });
      return;
    }

    const existing = await getInternalUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "Email sudah terdaftar.", user: toSafeInternalUser(existing) });
      return;
    }

    const passwordHash = await hashPassword(randomBytes(48).toString("base64url"));
    const [created] = await db
      .insert(internalUsersTable)
      .values({
        email,
        passwordHash,
        role: requestedRole,
        accountType: "internal",
        status: "active",
        mustChangePassword: false,
      })
      .returning();

    if (!created) {
      res.status(500).json({ error: "Gagal membuat akun internal." });
      return;
    }

    const invite = await sendMagicLoginEmailForUser(req, created);
    await logAudit("internal_auth", "create_internal_user", String(created.id), "internal_user", "success", {
      actorUserId: actor.id,
      actorEmail: actor.email,
      createdEmail: created.email,
      role: created.role,
      inviteSent: invite.ok,
      ip: clientIp(req),
    });

    res.status(201).json({
      user: toSafeInternalUser(created),
      inviteSent: invite.ok,
      inviteError: invite.ok ? undefined : invite.error,
    });
  },
);

router.patch(
  "/internal/auth/users/:id",
  requireAuth,
  requireInternalRole("owner", "admin"),
  async (req, res): Promise<void> => {
    const actor = req.internalUser!;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "User ID tidak valid." });
      return;
    }

    const target = await getInternalUserById(id);
    if (!target) {
      res.status(404).json({ error: "Akun tidak ditemukan." });
      return;
    }
    if (target.role === "owner") {
      res.status(403).json({ error: "Akun owner tidak dapat diubah dari User Management." });
      return;
    }
    if (target.role === "admin" && actor.role !== "owner") {
      res.status(403).json({ error: "Hanya owner yang dapat mengubah akun admin." });
      return;
    }

    const nextRole = req.body?.role;
    const nextStatus = req.body?.status;
    if (nextRole !== undefined && !isManageableInternalRole(nextRole)) {
      res.status(400).json({ error: "Role tidak valid." });
      return;
    }
    if (nextRole === "admin" && actor.role !== "owner") {
      res.status(403).json({ error: "Hanya owner yang dapat menetapkan role admin." });
      return;
    }
    if (nextStatus !== undefined && nextStatus !== "active" && nextStatus !== "suspended") {
      res.status(400).json({ error: "Status harus active atau suspended." });
      return;
    }
    if (actor.id === target.id && nextStatus === "suspended") {
      res.status(400).json({ error: "Anda tidak dapat menonaktifkan akun sendiri." });
      return;
    }

    const patch: { role?: InternalRole; status?: string; updatedAt?: Date } = { updatedAt: new Date() };
    if (nextRole !== undefined) patch.role = nextRole;
    if (nextStatus !== undefined) patch.status = nextStatus;

    const [updated] = await db
      .update(internalUsersTable)
      .set(patch)
      .where(eq(internalUsersTable.id, id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Gagal memperbarui akun." });
      return;
    }

    await logAudit("internal_auth", "update_internal_user", String(updated.id), "internal_user", "success", {
      actorUserId: actor.id,
      actorEmail: actor.email,
      previousRole: target.role,
      nextRole: updated.role,
      previousStatus: target.status,
      nextStatus: updated.status,
      ip: clientIp(req),
    });
    res.json({ user: toSafeInternalUser(updated) });
  },
);

router.post(
  "/internal/auth/users/:id/send-magic-link",
  requireAuth,
  requireInternalRole("owner", "admin"),
  async (req, res): Promise<void> => {
    const actor = req.internalUser!;
    const id = Number.parseInt(String(req.params.id), 10);
    const user = Number.isInteger(id) && id > 0 ? await getInternalUserById(id) : null;
    if (!user) {
      res.status(404).json({ error: "Akun tidak ditemukan." });
      return;
    }
    if (user.status !== "active") {
      res.status(400).json({ error: "Akun harus aktif sebelum link login dikirim." });
      return;
    }

    const sent = await sendMagicLoginEmailForUser(req, user);
    await logAudit("internal_auth", "admin_send_magic_login", String(user.id), "internal_user", sent.ok ? "success" : "failure", {
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetEmail: user.email,
      ip: clientIp(req),
      error: sent.error,
    });
    if (!sent.ok) {
      res.status(503).json({ error: "Gagal mengirim link login. Periksa konfigurasi SMTP." });
      return;
    }
    res.json({ ok: true });
  },
);

router.post("/internal/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const user = req.internalUser!;
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  const validCurrent = await verifyPassword(currentPassword, user.passwordHash);
  if (!validCurrent) {
    await logAudit("internal_auth", "change_password", String(user.id), "internal_user", "failure", { reason: "bad_current_password" });
    res.status(401).json({ error: "Password saat ini salah." });
    return;
  }
  if (!isPasswordStrongEnough(newPassword)) {
    res.status(400).json({ error: "Password baru minimal 10 karakter." });
    return;
  }

  const newHash = await hashPassword(newPassword);
  const [updated] = await db
    .update(internalUsersTable)
    .set({ passwordHash: newHash, mustChangePassword: false, passwordChangedAt: new Date() })
    .where(eq(internalUsersTable.id, user.id))
    .returning();

  await logAudit("internal_auth", "change_password", String(user.id), "internal_user", "success");
  res.json({ user: toSafeInternalUser(updated) });
});

export default router;
