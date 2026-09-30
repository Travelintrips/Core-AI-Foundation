import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  aiCodingPlannerAuthorityTable,
  db,
  withTransientDatabaseRetry,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";

const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 300;
const DEFAULT_LEASE_SECONDS = 180;

export class PlannerAuthorityError extends Error {
  constructor(public readonly code: "AUTHORITY_HELD" | "STALE_FENCE" | "LEASE_EXPIRED" | "NOT_HOLDER") {
    super(code);
    this.name = "PlannerAuthorityError";
  }
}

function boundedSeconds(value?: number) {
  return Math.max(MIN_LEASE_SECONDS, Math.min(MAX_LEASE_SECONDS, value ?? DEFAULT_LEASE_SECONDS));
}

export async function acquirePlannerAuthority(input: {
  scope?: string;
  holderId: string;
  holderType: "chatgpt" | "fallback";
  leaseSeconds?: number;
  metadata?: Record<string, unknown>;
}) {
  const scope = input.scope ?? "global";
  return withTransientDatabaseRetry(() => db.transaction(async (tx) => {
    const now = new Date();
    const [current] = await tx.select().from(aiCodingPlannerAuthorityTable)
      .where(eq(aiCodingPlannerAuthorityTable.scope, scope)).for("update");
    if (current && current.leaseExpiresAt.getTime() > now.getTime()) {
      if (current.holderId !== input.holderId) {
        throw new PlannerAuthorityError("AUTHORITY_HELD");
      }

      // Re-acquiring an active lease for the same holder must be idempotent.
      // Rotating the token/generation here self-fences an in-flight planner
      // when duplicate/retried requests arrive for the same task.
      const leaseExpiresAt = new Date(
        now.getTime() + boundedSeconds(input.leaseSeconds) * 1000,
      );
      const state = input.holderType === "chatgpt" ? "PRIMARY_ACTIVE" : "FALLBACK_ACTIVE";
      const [renewed] = await tx
        .update(aiCodingPlannerAuthorityTable)
        .set({
          holderType: input.holderType,
          state,
          leaseExpiresAt,
          lastHeartbeatAt: now,
          metadataJson: input.metadata ?? current.metadataJson ?? {},
          updatedAt: now,
        })
        .where(eq(aiCodingPlannerAuthorityTable.scope, scope))
        .returning();
      if (!renewed) throw new Error("Failed to renew existing planner authority");
      return renewed;
    }

    const generation = (current?.fencingGeneration ?? 0) + 1;
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + boundedSeconds(input.leaseSeconds) * 1000);
    const state = input.holderType === "chatgpt" ? "PRIMARY_ACTIVE" : "FALLBACK_ACTIVE";
    const values = { scope, holderId: input.holderId, holderType: input.holderType, leaseToken,
      fencingGeneration: generation, state, leaseExpiresAt, lastHeartbeatAt: now,
      metadataJson: input.metadata ?? {}, updatedAt: now };
    const [row] = await tx.insert(aiCodingPlannerAuthorityTable).values(values)
      .onConflictDoUpdate({ target: aiCodingPlannerAuthorityTable.scope, set: values }).returning();
    if (!row) throw new Error("Failed to acquire planner authority");
    publishSafe({ eventType: "coding.planner.authority.acquired", sourceModule: "coding-planner-authority",
      sourceId: scope, correlationId: leaseToken, payload: { holderId: input.holderId, holderType: input.holderType, generation, state } });
    return row;
  }), { attempts: 4, baseDelayMs: 200 });
}

export async function renewPlannerAuthority(input: {
  scope?: string; holderId: string; leaseToken: string; fencingGeneration: number; leaseSeconds?: number;
}) {
  const scope = input.scope ?? "global";
  return withTransientDatabaseRetry(() => db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.select().from(aiCodingPlannerAuthorityTable)
      .where(eq(aiCodingPlannerAuthorityTable.scope, scope)).for("update");
    if (!row || row.holderId !== input.holderId || row.leaseToken !== input.leaseToken) throw new PlannerAuthorityError("NOT_HOLDER");
    if (row.fencingGeneration !== input.fencingGeneration) throw new PlannerAuthorityError("STALE_FENCE");
    if (row.leaseExpiresAt.getTime() <= now.getTime()) throw new PlannerAuthorityError("LEASE_EXPIRED");
    const leaseExpiresAt = new Date(now.getTime() + boundedSeconds(input.leaseSeconds) * 1000);
    const [updated] = await tx.update(aiCodingPlannerAuthorityTable).set({ leaseExpiresAt, lastHeartbeatAt: now, updatedAt: now })
      .where(eq(aiCodingPlannerAuthorityTable.scope, scope)).returning();
    return updated!;
  }), { attempts: 4, baseDelayMs: 200 });
}

export async function assertPlannerAuthority(input: {
  scope?: string; holderId: string; leaseToken: string; fencingGeneration: number;
}) {
  const scope = input.scope ?? "global";
  const [row] = await withTransientDatabaseRetry(() => db
    .select()
    .from(aiCodingPlannerAuthorityTable)
    .where(eq(aiCodingPlannerAuthorityTable.scope, scope))
    .limit(1),
  { attempts: 3, baseDelayMs: 150 });
  if (!row || row.holderId !== input.holderId || row.leaseToken !== input.leaseToken) throw new PlannerAuthorityError("NOT_HOLDER");
  if (row.fencingGeneration !== input.fencingGeneration) throw new PlannerAuthorityError("STALE_FENCE");
  if (row.leaseExpiresAt.getTime() <= Date.now()) throw new PlannerAuthorityError("LEASE_EXPIRED");
  return row;
}


export async function releasePlannerAuthority(input: {
  scope?: string;
  holderId: string;
  leaseToken: string;
  fencingGeneration: number;
}): Promise<void> {
  const scope = input.scope ?? "global";
  await withTransientDatabaseRetry(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(aiCodingPlannerAuthorityTable)
      .where(eq(aiCodingPlannerAuthorityTable.scope, scope)).for("update");

    // Release is idempotent: if a prior attempt committed but its connection
    // failed before acknowledging the commit, the retry sees no row and is
    // already in the desired state.
    if (!row) return;
    if (row.holderId !== input.holderId || row.leaseToken !== input.leaseToken) {
      throw new PlannerAuthorityError("NOT_HOLDER");
    }
    if (row.fencingGeneration !== input.fencingGeneration) {
      throw new PlannerAuthorityError("STALE_FENCE");
    }
    await tx.delete(aiCodingPlannerAuthorityTable)
      .where(eq(aiCodingPlannerAuthorityTable.scope, scope));
  }), { attempts: 4, baseDelayMs: 200 });
}

export async function getPlannerAuthority(scope = "global") {
  const [row] = await withTransientDatabaseRetry(() => db
    .select()
    .from(aiCodingPlannerAuthorityTable)
    .where(eq(aiCodingPlannerAuthorityTable.scope, scope))
    .limit(1),
  { attempts: 3, baseDelayMs: 150 });
  if (!row) return { scope, state: "UNCLAIMED" as const };
  return { ...row, state: row.leaseExpiresAt.getTime() > Date.now() ? row.state : "PRIMARY_LOST" };
}
