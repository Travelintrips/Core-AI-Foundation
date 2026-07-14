/**
 * seedInternalAdmin.ts — idempotent provisioning of the first internal
 * (owner) account for the Internal AI Portal.
 *
 * Run: pnpm --filter @workspace/api-server run seed:internal-admin
 *
 * Reads credentials ONLY from environment variables (Replit Secrets):
 *   INITIAL_INTERNAL_ADMIN_EMAIL     (defaults to abing2267@gmail.com)
 *   INITIAL_INTERNAL_ADMIN_PASSWORD  (required, no default / no hardcoding)
 *
 * Safety:
 *  - If a user with this email already exists, does nothing (no reset,
 *    no duplicate) — matches the "idempotent, don't overwrite" requirement.
 *  - Never logs the password value.
 */
import { db, internalUsersTable } from "@workspace/db";
import { hashPassword, isPasswordStrongEnough } from "./services/passwordService.js";
import { getInternalUserByEmail } from "./services/internalAuthService.js";
import { logAudit } from "./services/aiAuditService.js";

async function main() {
  const email = (process.env["INITIAL_INTERNAL_ADMIN_EMAIL"] ?? "abing2267@gmail.com").trim().toLowerCase();
  const password = process.env["INITIAL_INTERNAL_ADMIN_PASSWORD"];

  if (!password) {
    console.error("[seedInternalAdmin] INITIAL_INTERNAL_ADMIN_PASSWORD is not set — refusing to create an account without one.");
    process.exit(1);
  }
  if (!isPasswordStrongEnough(password)) {
    console.error("[seedInternalAdmin] INITIAL_INTERNAL_ADMIN_PASSWORD is too weak (needs >= 10 characters) — refusing.");
    process.exit(1);
  }

  const existing = await getInternalUserByEmail(email);
  if (existing) {
    console.log(`[seedInternalAdmin] ${email} already exists (id=${existing.id}, role=${existing.role}) — no changes made.`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(internalUsersTable)
    .values({
      email,
      passwordHash,
      role: "owner",
      accountType: "internal",
      status: "active",
      mustChangePassword: true,
    })
    .returning();

  await logAudit("internal_auth", "provision_admin", String(created.id), "internal_user", "success", { email });
  console.log(`[seedInternalAdmin] Created initial owner account for ${email} (id=${created.id}). must_change_password=true.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedInternalAdmin] Failed:", err);
  process.exit(1);
});
