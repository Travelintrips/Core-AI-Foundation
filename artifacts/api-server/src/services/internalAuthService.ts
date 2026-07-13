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

function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET must be set to issue internal sessions");
  }
  return secret;
}

export interface SessionPayload {
  sub: number; // internal_users.id
}

export function issueSessionToken(userId: number): string {
  return jwt.sign({ sub: userId } satisfies SessionPayload, getSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as SessionPayload;
    if (typeof decoded.sub !== "number") return null;
    return decoded;
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
