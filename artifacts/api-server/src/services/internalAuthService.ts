/**
 * internalAuthService.ts — session issuance/verification for the Internal
 * AI Portal.
 *
 * Sessions are a signed JWT (HS256, SESSION_SECRET) carrying only the user
 * id, stored in an httpOnly cookie. The JWT is a locator, not a source of
 * truth: every privileged check re-reads role/status/accountType from
 * internal_users on each request (see middleware/internalAuth.ts) so a
 * revoked or demoted account is denied immediately, not just at next login.
 */
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, internalUsersTable, type InternalUser } from "@workspace/db";

const COOKIE_NAME = "internal_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
const PASSWORD_RESET_TTL_SECONDS = 15 * 60; // 15 minutes

function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET must be set to issue internal sessions");
  }
  return secret;
}

export interface PasswordResetPayload {\n  sub: number;\n  purpose: "password_reset";\n  passwordChangedAt: string | null;\n}\n\nexport interface SessionPayload {
  sub: number; // internal_users.id
}

export function issueSessionToken(userId: number): string {
  return jwt.sign({ sub: userId } satisfies SessionPayload, getSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded !== "object" || decoded === null || typeof (decoded as { sub?: unknown }).sub !== "number") {
      return null;
    }
    return { sub: (decoded as unknown as { sub: number }).sub };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;

/** Always re-fetches from the DB — never trust a cached/decoded role. */
export async function getInternalUserById(id: number): Promise<InternalUser | null> {
  const [row] = await db.select().from(internalUsersTable).where(eq(internalUsersTable.id, id)).limit(1);
  return row ?? null;
}

export async function getInternalUserByEmail(email: string): Promise<InternalUser | null> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db.select().from(internalUsersTable).where(eq(internalUsersTable.email, normalized)).limit(1);
  return row ?? null;
}


export function issuePasswordResetToken(user: InternalUser): string {
  return jwt.sign(
    {
      sub: user.id,
      purpose: "password_reset",
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    } satisfies PasswordResetPayload,
    getSecret(),
    { expiresIn: PASSWORD_RESET_TTL_SECONDS },
  );
}

export async function verifyPasswordResetToken(token: string): Promise<InternalUser | null> {
  try {
    const decoded = jwt.verify(token, getSecret()) as Partial<PasswordResetPayload>;
    if (decoded.purpose !== "password_reset" || typeof decoded.sub !== "number") return null;
    const user = await getInternalUserById(decoded.sub);
    if (!user || user.status !== "active") return null;
    const currentChangedAt = user.passwordChangedAt?.toISOString() ?? null;
    if (decoded.passwordChangedAt !== currentChangedAt) return null;
    return user;
  } catch {
    return null;
  }
}

export function issueMagicLoginToken(userId: number): string {\n  return jwt.sign({ sub: userId, purpose: "magic_login" } satisfies MagicLoginPayload, getSecret(), { expiresIn: "10m" });\n}\n\nexport function verifyMagicLoginToken(token: string): MagicLoginPayload | null {\n  try {\n    const decoded = jwt.verify(token, getSecret()) as Partial<MagicLoginPayload>;\n    if (decoded.purpose !== "magic_login" || typeof decoded.sub !== "number") return null;\n    return { sub: decoded.sub, purpose: "magic_login" };\n  } catch {\n    return null;\n  }\n}\n