/**
 * resetAdminPassword.ts — force-reset password for an existing internal user.
 * Run: pnpm --filter @workspace/api-server run reset:admin-password
 *
 * Reads from env (Replit Secrets — no defaults, both required):
 *   INITIAL_INTERNAL_ADMIN_EMAIL    (required — must be set explicitly)
 *   INITIAL_INTERNAL_ADMIN_PASSWORD (required — must be set explicitly)
 */
import { db, internalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, isPasswordStrongEnough } from "./services/passwordService.js";

async function main() {
  const email = process.env["INITIAL_INTERNAL_ADMIN_EMAIL"];
  const password = process.env["INITIAL_INTERNAL_ADMIN_PASSWORD"];

  if (!email || email.trim().length === 0) {
    console.error("[resetAdminPassword] INITIAL_INTERNAL_ADMIN_EMAIL is not set — set this in Replit Secrets.");
    process.exit(1);
  }
  if (!password) {
    console.error("[resetAdminPassword] INITIAL_INTERNAL_ADMIN_PASSWORD is not set.");
    process.exit(1);
  }
  if (!isPasswordStrongEnough(password)) {
    console.error("[resetAdminPassword] Password too weak (needs >= 10 characters).");
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const passwordHash = await hashPassword(password);
  const [updated] = await db
    .update(internalUsersTable)
    .set({ passwordHash, mustChangePassword: false, status: "active" })
    .where(eq(internalUsersTable.email, normalizedEmail))
    .returning({ id: internalUsersTable.id, email: internalUsersTable.email, role: internalUsersTable.role });

  if (!updated) {
    console.error(`[resetAdminPassword] No user found with email ${normalizedEmail}.`);
    process.exit(1);
  }

  console.log(`[resetAdminPassword] Password reset for ${updated.email} (id=${updated.id}, role=${updated.role}). Login should work now.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[resetAdminPassword] Failed:", err);
  process.exit(1);
});
