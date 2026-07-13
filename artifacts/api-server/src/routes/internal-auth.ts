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
  getInternalUserByEmail,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from "../services/internalAuthService.js";
import { requireAuth } from "../middleware/internalAuth.js";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { logAudit } from "../services/aiAuditService.js";

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
