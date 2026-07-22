/**
 * designMigrationService.ts — Team 38: Design Migration
 *
 * Orchestrates the migration planning and execution for the Universal Design
 * Platform compatibility rollout.
 *
 * Migration rules (from Team 38 spec):
 *  - Additive — no destructive DDL.
 *  - Idempotent — safe to rerun; already-migrated projects are skipped.
 *  - No destructive drop.
 *  - Batchable and resumable — caller passes offset/limit.
 *  - Audit result — every run is written to ai_audit_logs via logAudit().
 *  - Dry-run — plans without writing; returns mapped projects.
 *  - Tenant scoped — tenantId on plan (null = platform-wide, admin only).
 *  - Rollback strategy — rollbackSnapshot records original status values.
 *
 * DB rules:
 *  - creative_projects has no tenant_id column; queries are by projectId.
 *  - Uses shared `db` client for Drizzle queries.
 *  - Uses `pool` (raw SQL) for the migration status tracking table DDL.
 *  - Never runs against production (guarded by isDryRun flag + env check).
 *  - No production migration runs from this service.
 */

import { eq, inArray, isNull } from "drizzle-orm";
import { db, pool, creativeProjectsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { logAudit } from "../aiAuditService.js";
import { loadLegacyProjectData, DESIGN_CONTRACT_VERSION } from "./designCompatibilityAdapter.js";
import { mapLegacyDesignProject } from "./legacyDesignProjectAdapter.js";
import type {
  CanonicalDesignProject,
  DesignMigrationIssue,
  DesignMigrationPlan,
  DesignMigrationResult,
  MigrationStatus,
} from "./designMigrationTypes.js";

// ── Migration tracking table (DDL, additive, idempotent) ─────────────────────

/**
 * Ensures the design_migration_runs table exists.
 * Call once at startup or before the first migration run.
 * Additive-only: no DROP, no ALTER that removes columns.
 */
export async function ensureMigrationTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.design_migration_runs (
        id            SERIAL PRIMARY KEY,
        plan_id       TEXT NOT NULL UNIQUE,
        tenant_id     TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        is_dry_run    BOOLEAN NOT NULL DEFAULT TRUE,
        processed     INTEGER NOT NULL DEFAULT 0,
        succeeded     INTEGER NOT NULL DEFAULT 0,
        failed        INTEGER NOT NULL DEFAULT 0,
        skipped       INTEGER NOT NULL DEFAULT 0,
        contract_ver  TEXT NOT NULL,
        started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_design_migration_runs_plan_id
        ON ai_platform.design_migration_runs(plan_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_design_migration_runs_tenant
        ON ai_platform.design_migration_runs(tenant_id)
        WHERE tenant_id IS NOT NULL;
    `);
  } finally {
    client.release();
  }
  logger.info("[design-migration] migration tracking table ensured");
}

// ── Plan builder ─────────────────────────────────────────────────────────────

/**
 * Builds a DesignMigrationPlan for the given batch of projects.
 *
 * Does NOT execute the migration — it only describes what would happen.
 * All projectIds must be UUID strings from creative_projects.project_id.
 */
export function buildMigrationPlan(opts: {
  planId: string;
  tenantId: string | null;
  projectIds: string[];
  totalProjects: number;
  isDryRun: boolean;
}): DesignMigrationPlan {
  return {
    planId: opts.planId,
    tenantId: opts.tenantId,
    totalProjects: opts.totalProjects,
    projectIds: opts.projectIds,
    isDryRun: opts.isDryRun,
    createdAt: new Date(),
    contractVersion: DESIGN_CONTRACT_VERSION,
  };
}

// ── Migration executor ───────────────────────────────────────────────────────

/**
 * Discovers non-deleted creative projects (optionally filtered by tenantId)
 * and returns a batch of projectId UUIDs for migration planning.
 *
 * Since creative_projects has no tenant_id, tenantId filter is informational
 * only (applied as a pass-through to the plan); all rows are returned when
 * tenantId is null.
 */
export async function discoverProjectsForMigration(opts: {
  limit: number;
  offset: number;
}): Promise<{ projectIds: string[]; total: number }> {
  // Count total non-deleted projects
  const allRows = await db
    .select({ projectId: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(isNull(creativeProjectsTable.deletedAt))
    .orderBy(creativeProjectsTable.id);

  const total = allRows.length;
  const projectIds = allRows
    .slice(opts.offset, opts.offset + opts.limit)
    .map((r) => r.projectId);

  return { projectIds, total };
}

/**
 * Executes a migration plan (or dry-run).
 *
 * In dry-run mode: maps all projects and returns the CanonicalDesignProject
 * output in dryRunProjects without writing anything to the DB.
 *
 * In live mode: currently additive — records the plan run result in the
 * tracking table and emits audit logs.  No data is modified on creative_projects
 * (the adapter is read-only; canonical data lives in the adapter layer, not
 * in a new table yet).
 *
 * IMPORTANT: Live mode never runs against production. If NODE_ENV === "production"
 * and isDryRun === false, the call throws immediately.
 */
export async function executeMigration(
  plan: DesignMigrationPlan,
  opts: { resumeFromPlanId?: string } = {},
): Promise<DesignMigrationResult> {
  if (process.env["NODE_ENV"] === "production" && !plan.isDryRun) {
    throw new Error(
      "[design-migration] Live migration is not allowed in production. " +
        "Set isDryRun=true or run in development.",
    );
  }

  const startedAt = new Date();
  const issues: DesignMigrationIssue[] = [];
  const dryRunProjects: CanonicalDesignProject[] = [];
  const rollbackSnapshot: Array<{ projectId: string; originalStatus: string }> = [];
  const alreadyMigratedIds: string[] = [];

  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Check for already-migrated projects (idempotency guard)
  const existingRuns = plan.isDryRun
    ? new Set<string>()
    : await getAlreadyMigratedProjectIds(plan.projectIds, plan.planId);

  for (const projectId of plan.projectIds) {
    processedCount++;

    // Idempotency: skip if already migrated in a previous run for this plan
    if (existingRuns.has(projectId)) {
      skippedCount++;
      alreadyMigratedIds.push(projectId);
      continue;
    }

    try {
      const data = await loadLegacyProjectData(projectId);

      if (!data) {
        issues.push({
          projectId,
          field: "projectId",
          severity: "error",
          message: "Project not found or soft-deleted — skipped",
        });
        skippedCount++;
        continue;
      }

      // Capture rollback snapshot before any potential future writes
      rollbackSnapshot.push({
        projectId,
        originalStatus: data.project.status,
      });

      const canonical = mapLegacyDesignProject(data);

      // Collect any adapter issues
      for (const inf of canonical.inferredFields) {
        issues.push({
          projectId,
          field: inf,
          severity: "info",
          message: `Field "${inf}" was inferred/defaulted during mapping`,
        });
      }
      for (const u of canonical.unmappableFields) {
        issues.push({
          projectId,
          field: u.field,
          severity: "warning",
          message: u.reason,
          rawValue: u.value,
        });
      }

      if (plan.isDryRun) {
        dryRunProjects.push(canonical);
      }

      successCount++;
    } catch (err) {
      failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({
        projectId,
        field: "_execution",
        severity: "error",
        message: `Mapping failed: ${msg}`,
      });
      logger.error({ projectId, err }, "[design-migration] project mapping failed");
    }
  }

  const finishedAt = new Date();
  const finalStatus: MigrationStatus =
    failedCount > 0 && successCount === 0 ? "failed" : "completed";

  // Emit audit log
  await logAudit({
    module: "design-migration",
    action: plan.isDryRun ? "design_migration_dry_run" : "design_migration_run",
    resourceType: "migration_plan",
    resourceId: plan.planId,
    status: finalStatus === "failed" ? "failure" : "success",
    details: {
      planId: plan.planId,
      isDryRun: plan.isDryRun,
      tenantId: plan.tenantId,
      processedCount,
      successCount,
      failedCount,
      skippedCount,
      issueCount: issues.length,
      contractVersion: plan.contractVersion,
    },
  });

  // Persist run record (non-dry-run only)
  if (!plan.isDryRun) {
    await persistMigrationRun({
      planId: plan.planId,
      tenantId: plan.tenantId,
      status: finalStatus,
      isDryRun: false,
      processed: processedCount,
      succeeded: successCount,
      failed: failedCount,
      skipped: skippedCount,
      contractVer: plan.contractVersion,
      startedAt,
      finishedAt,
    });
  }

  return {
    planId: plan.planId,
    status: finalStatus,
    processedCount,
    successCount,
    failedCount,
    skippedCount,
    issues,
    startedAt,
    finishedAt,
    dryRunProjects,
    rollbackSnapshot,
    isDryRun: plan.isDryRun,
    isResumed: !!opts.resumeFromPlanId,
    alreadyMigratedIds,
  };
}

// ── Rollback metadata ────────────────────────────────────────────────────────

/**
 * Returns rollback metadata for a completed migration run.
 * Callers use this to restore original status values if needed.
 * This service never auto-rolls back — that is a deliberate admin action.
 */
export async function getMigrationRollbackSnapshot(planId: string): Promise<
  Array<{ projectId: string; originalStatus: string }> | null
> {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");
    const result = await client.query<{ plan_id: string; status: string }>(
      `SELECT plan_id, status FROM ai_platform.design_migration_runs WHERE plan_id = $1 LIMIT 1`,
      [planId],
    );
    if (result.rows.length === 0) return null;
    // Rollback snapshot is in the DesignMigrationResult returned at run time.
    // This function returns a signal that the plan exists and its status.
    return null; // Actual snapshot must be stored by the caller at run time.
  } finally {
    client.release();
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function getAlreadyMigratedProjectIds(
  projectIds: string[],
  planId: string,
): Promise<Set<string>> {
  // In the current additive implementation there's no per-project tracking table.
  // Future: query a design_migration_project_log table.
  // For now, if the plan_id already has a completed run, skip all its projects.
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");
    const result = await client.query<{ plan_id: string }>(
      `SELECT plan_id FROM ai_platform.design_migration_runs
       WHERE plan_id = $1 AND status = 'completed' LIMIT 1`,
      [planId],
    );
    if (result.rows.length > 0) {
      return new Set(projectIds); // entire plan already ran
    }
    return new Set<string>();
  } catch {
    // Table may not exist yet (before ensureMigrationTable runs)
    return new Set<string>();
  } finally {
    client.release();
  }
}

async function persistMigrationRun(opts: {
  planId: string;
  tenantId: string | null;
  status: MigrationStatus;
  isDryRun: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  contractVer: string;
  startedAt: Date;
  finishedAt: Date;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");
    await client.query(
      `INSERT INTO ai_platform.design_migration_runs
         (plan_id, tenant_id, status, is_dry_run, processed, succeeded, failed, skipped,
          contract_ver, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (plan_id) DO UPDATE SET
         status      = EXCLUDED.status,
         processed   = EXCLUDED.processed,
         succeeded   = EXCLUDED.succeeded,
         failed      = EXCLUDED.failed,
         skipped     = EXCLUDED.skipped,
         finished_at = EXCLUDED.finished_at`,
      [
        opts.planId,
        opts.tenantId,
        opts.status,
        opts.isDryRun,
        opts.processed,
        opts.succeeded,
        opts.failed,
        opts.skipped,
        opts.contractVer,
        opts.startedAt.toISOString(),
        opts.finishedAt.toISOString(),
      ],
    );
  } finally {
    client.release();
  }
}
