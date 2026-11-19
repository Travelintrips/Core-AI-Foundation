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
// Two independent, explicit DEV gates. An accidentally enabled lease flag
// must never activate mutations while the recovery reservation gate is OFF.
// No lease grants dispatch authority even if all flags are explicitly true.
const mutationsEnabled = () =>
  process.env["APP_ENV"] === "development" &&
  process.env["NODE_ENV"] === "development" &&
  process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"] === "true" &&
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
  return db.transaction(async tx => {
    // Atomic CAS release and durable provenance. A failed receipt insert rolls
    // back the lease UPDATE: no ACK without an owner-bound committed receipt.
    const released = await tx.execute(sql`
      UPDATE ai_platform.gpt02_dev_recovery_leases
      SET lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
      WHERE reservation_id=${input.reservationId}::uuid
        AND lease_owner=${input.workerId}
        AND fencing_token=${input.fencingToken}::bigint
        AND lease_expires_at>clock_timestamp()
      RETURNING fencing_token::text AS fencing_token, lease_expires_at
    `);
    if (released.rows?.[0]) {
      const receipt = await tx.execute(sql`
        INSERT INTO ai_platform.gpt02_dev_recovery_lease_releases
          (reservation_id,fencing_token,lease_owner)
        VALUES (${input.reservationId}::uuid,${input.fencingToken}::bigint,${input.workerId})
        RETURNING fencing_token::text AS fencing_token
      `);
      if (!receipt.rows?.[0]) {
        throw new Error("GPT02_RELEASE_RECEIPT_NOT_DURABLE");
      }
      return leaseResult(released.rows[0], "RELEASED");
    }
    // Exact, previously committed receipt AND the original token still
    // unowned is necessary for an idempotent response. If the lease was
    // taken over by another worker, even a real old receipt is not a
    // current-lease acknowledgement.
    const previous = await tx.execute(sql`
      SELECT lr.fencing_token::text AS fencing_token,
             l.lease_expires_at
      FROM ai_platform.gpt02_dev_recovery_lease_releases lr
      JOIN ai_platform.gpt02_dev_recovery_leases l
        ON l.reservation_id=lr.reservation_id
       AND l.fencing_token=lr.fencing_token
      WHERE lr.reservation_id=${input.reservationId}::uuid
        AND lr.fencing_token=${input.fencingToken}::bigint
        AND lr.lease_owner=${input.workerId}
        AND l.lease_owner IS NULL AND l.lease_expires_at IS NULL
      FOR UPDATE OF l
    `);
    if (previous.rows?.[0]) return leaseResult(previous.rows[0], "ALREADY_RELEASED");
    return deny("FENCING_TOKEN_STALE_OR_LEASE_EXPIRED");
  });
}
