/**
 * DEV-only recovery lease CAS repository. This code is NOT exposed as a route.
 * Lease ownership is NOT authority to dispatch or create a command.
 * All mutation operations are default OFF, and require a durable issued-child
 * relationship. Atomic PostgreSQL predicates defend against stale owners.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[1-9][0-9]{0,18}$/;
const deny = (reason: string) => ({
  ok: false as const, reason, mayCreateCommand: false as const,
  mayDispatchWorker: false as const, mayCloseJob: false as const,
});
type Subject = { reservationId: string; workerId: string };
type LeaseToken = Subject & { fencingToken: string };
const safe = (x: Subject) =>
  uuid.test(x.reservationId) && typeof x.workerId === "string" &&
  x.workerId.length <= 128 && x.workerId.trim().length > 0 &&
  x.workerId === x.workerId.trim();
const mutationsEnabled = () =>
  process.env["APP_ENV"] === "development" &&
  process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"] === "true";

export function validateGpt02LeaseRequest(
  input: Subject & { fencingToken?: string; ttlSeconds?: number },
) {
  if (!safe(input)) return "INVALID_LEASE_SUBJECT";
  if (input.fencingToken !== undefined && !token.test(input.fencingToken))
    return "INVALID_FENCING_TOKEN";
  if (input.ttlSeconds !== undefined && (
    !Number.isSafeInteger(input.ttlSeconds) ||
    input.ttlSeconds < 5 || input.ttlSeconds > 120
  )) return "INVALID_LEASE_TTL";
  return null;
}

const leaseResult = (row: Record<string, unknown>, action: string) => ({
  ok: true as const, action,
  fencingToken: String(row["fencing_token"]),
  leaseExpiresAt: row["lease_expires_at"],
  mayCreateCommand: false as const,
  mayDispatchWorker: false as const,
  mayCloseJob: false as const,
});

export async function acquireGpt02DevRecoveryLease(input: Subject & { ttlSeconds: number }) {
  if (!mutationsEnabled()) return deny("LEASE_MUTATIONS_DISABLED");
  const invalid = validateGpt02LeaseRequest(input);
  if (invalid) return deny(invalid);
  return db.transaction(async tx => {
    // Lock the durable lineage. An unissued candidate is NOT leaseable.
    const binding = await tx.execute(sql`
      SELECT l.reservation_id
      FROM ai_platform.gpt02_dev_recovery_command_links l
      JOIN ai_platform.gpt02_dev_recovery_reservations r ON r.id=l.reservation_id
      JOIN ai_platform.ai_coding_bridge_commands c ON c.id=l.child_command_id
      WHERE l.reservation_id=${input.reservationId}::uuid
        AND r.candidate_command_id=l.child_command_id
        AND r.parent_command_id=l.parent_command_id
        AND c.status='RECEIVED'
      FOR UPDATE OF l
    `);
    if (!binding.rows?.[0]) return deny("ISSUED_CHILD_LINEAGE_NOT_VERIFIED");
    await tx.execute(sql`
      INSERT INTO ai_platform.gpt02_dev_recovery_leases (reservation_id)
      VALUES (${input.reservationId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    const claim = await tx.execute(sql`
      UPDATE ai_platform.gpt02_dev_recovery_leases
      SET fencing_token=fencing_token+1,
          lease_owner=${input.workerId},
          lease_expires_at=clock_timestamp()+make_interval(secs => ${input.ttlSeconds}),
          updated_at=clock_timestamp()
      WHERE reservation_id=${input.reservationId}::uuid
        AND (lease_owner IS NULL OR lease_expires_at<=clock_timestamp())
      RETURNING fencing_token::text AS fencing_token, lease_expires_at
    `);
    if (!claim.rows?.[0]) return deny("LEASE_ALREADY_OWNED");
    return leaseResult(claim.rows[0], "ACQUIRED");
  });
}

export async function heartbeatGpt02DevRecoveryLease(input: LeaseToken & { ttlSeconds: number }) {
  if (!mutationsEnabled()) return deny("LEASE_MUTATIONS_DISABLED");
  const invalid = validateGpt02LeaseRequest(input);
  if (invalid) return deny(invalid);
  const result = await db.execute(sql`
    UPDATE ai_platform.gpt02_dev_recovery_leases
    SET lease_expires_at=clock_timestamp()+make_interval(secs => ${input.ttlSeconds}),
        updated_at=clock_timestamp()
    WHERE reservation_id=${input.reservationId}::uuid
      AND lease_owner=${input.workerId}
      AND fencing_token=${input.fencingToken}::bigint
      AND lease_expires_at>clock_timestamp()
    RETURNING fencing_token::text AS fencing_token, lease_expires_at
  `);
  if (!result.rows?.[0]) return deny("FENCING_TOKEN_STALE_OR_LEASE_EXPIRED");
  return leaseResult(result.rows[0], "HEARTBEAT");
}

export async function releaseGpt02DevRecoveryLease(input: LeaseToken) {
  if (!mutationsEnabled()) return deny("LEASE_MUTATIONS_DISABLED");
  const invalid = validateGpt02LeaseRequest(input);
  if (invalid) return deny(invalid);
  const released = await db.execute(sql`
    UPDATE ai_platform.gpt02_dev_recovery_leases
    SET lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
    WHERE reservation_id=${input.reservationId}::uuid
      AND lease_owner=${input.workerId}
      AND fencing_token=${input.fencingToken}::bigint
      AND lease_expires_at>clock_timestamp()
    RETURNING fencing_token::text AS fencing_token, lease_expires_at
  `);
  if (released.rows?.[0]) return leaseResult(released.rows[0], "RELEASED");
  // A released row no longer carries the previous worker identity.
  // Do not report a retry as successful without a durable owner receipt:
  // otherwise an unrelated worker with the same token could claim success.
  // The final issuer release protocol must persist signed release provenance.
  return deny("FENCING_TOKEN_STALE_OR_LEASE_EXPIRED");
}
