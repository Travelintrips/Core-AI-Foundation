/**
 * internal-auth.ts — login / logout / me / change-password for the
 * Internal AI Portal.
 *
 *   POST /internal/auth/login             (public — exempted from adminAuth)
 *   POST /internal/auth/logout            (requireAuth)
 *   GET  /internal/auth/me                (requireAuth)
 *   POST /internal/auth/change-password   (requireAuth)
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, internalUsersTable, toSafeInternalUser } from "@workspace/db";
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
import { requireAuth } from "../middleware/internalAuth.js";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { logAudit } from "../services/aiAuditService.js";
import { sendEmail } from "../services/emailService.js";

const router = Router();

function clientIp(req: import("express").Request): string | undefined {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined;
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

router.post("/internal/auth/request-magic-link", loginLimiter, async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const generic = { ok: true, message: "Jika akun aktif terdaftar, link login akan dikirim ke email." };
  if (!email) { res.status(400).json({ error: "Email wajib diisi." }); return; }
  const user = await getInternalUserByEmail(email);
  if (!user || user.status !== "active") { res.json(generic); return; }
  const token = issueMagicLoginToken(user.id);
  const baseUrl = (process.env["PUBLIC_APP_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
  const magicUrl = `${baseUrl}/api/internal/auth/magic-login?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Link login Portal AI Internal",
    html: `<p>Klik link berikut untuk login tanpa password:</p><p><a href="${magicUrl}">Login ke Portal AI</a></p><p>Link berlaku 10 menit.</p>`,
    module: "internal_auth", action: "magic_login_email", resourceId: String(user.id),
  });
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

  const user = await getInternalUserByEmail(email);
  if (!user || user.status !== "active") {
    await logAudit("internal_auth", "password_reset_request", email, "internal_user", "failure", { reason: "not_found_or_inactive", ip: clientIp(req) });
    res.json(generic);
    return;
  }

  const token = issuePasswordResetToken(user);
  const baseUrl = (process.env["PUBLIC_APP_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
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
