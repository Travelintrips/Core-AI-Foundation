/**
 * internalAuth.ts — session + role guards for the Internal AI Portal.
 *
 * Rules this file enforces (see Task: "internal RBAC portal separation"):
 *   - requireAuth: valid, unexpired session cookie, user still exists.
 *   - requireInternalRole: additionally requires status=active,
 *     accountType=internal, role in INTERNAL_ROLES. Role/status are always
 *     re-read from the database, never trusted from the JWT payload or any
 *     client-supplied header/body/query field.
 *   - requirePasswordChanged: blocks every internal route except
 *     change-password/logout while must_change_password=true.
 * Every check that denies or grants access to a *_categories-visibility=internal
 * resource writes an audit log row (module "internal_auth").
 */
import type { Request, Response, NextFunction } from "express";
import { INTERNAL_ROLES, type InternalRole, type InternalUser } from "@workspace/db";
import { getInternalUserById, verifySessionToken, SESSION_COOKIE_NAME } from "../services/internalAuthService.js";
import { logAudit } from "../services/aiAuditService.js";

declare module "express-serve-static-core" {
  interface Request {
    internalUser?: InternalUser;
  }
}

function clientIp(req: Request): string | undefined {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined;
}

/** Populates req.internalUser if a valid session exists; 401 otherwise. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }
  const user = await getInternalUserById(payload.sub);
  if (!user) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }
  req.internalUser = user;
  next();
}

/**
 * Must run AFTER requireAuth. Confirms (from the DB row just loaded, not
 * from the client) that the account is an active internal account with an
 * allowed role, and logs the access attempt.
 */
export function requireInternalRole(...allowedRoles: InternalRole[]) {
  const roles = allowedRoles.length ? allowedRoles : INTERNAL_ROLES;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.internalUser;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const ok =
      user.status === "active" &&
      user.accountType === "internal" &&
      (INTERNAL_ROLES as readonly string[]).includes(user.role) &&
      roles.includes(user.role as InternalRole);

    await logAudit(
      "internal_auth",
      "access_internal_route",
      req.path,
      "internal_route",
      ok ? "success" : "failure",
      { userId: user.id, email: user.email, role: user.role, status: user.status, ip: clientIp(req) },
    );

    if (!ok) {
      res.status(403).json({ error: "Forbidden: internal role required" });
      return;
    }
    next();
  };
}

/**
 * Blocks access to everything except /internal/auth/change-password and
 * /internal/auth/logout while the account still has must_change_password
 * set. Must run after requireAuth.
 */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  const user = req.internalUser;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const allowedWhilePending = ["/internal/auth/change-password", "/internal/auth/logout", "/internal/auth/me"];
  if (user.mustChangePassword && !allowedWhilePending.includes(req.path)) {
    res.status(403).json({ error: "Password change required", code: "MUST_CHANGE_PASSWORD" });
    return;
  }
  next();
}
