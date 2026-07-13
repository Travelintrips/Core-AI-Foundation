/**
 * auditFalseCompletions.ts — Phase 1B Production Safety
 *
 * Finds production jobs that were marked `completed` without generating a real
 * deliverable (i.e. stub workers that returned a dispatch message instead of
 * throwing an error).
 *
 * Usage:
 *   pnpm creative:audit-false-completions --dry-run   (default; no DB writes)
 *   pnpm creative:audit-false-completions --apply     (mark invalid jobs failed)
 *
 * The script NEVER deletes data. In --apply mode it only:
 *   1. Sets job status from 'completed' → 'failed'
 *   2. Writes a clear error_message
 *   3. Nulls out completed_at (so the job is not counted as delivered)
 *   4. Writes an audit log entry per changed job
 */

import { eq, inArray, and } from "drizzle-orm";
import { db, aiJobsTable } from "@workspace/db";
import {
  JOB_COMPLETION_REQUIREMENTS,
  isFalseCompletionResult,
} from "../services/jobCompletionGuard.js";
import { logAudit } from "../services/aiAuditService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// All job types that produce a file — these are the only ones that can be
// false-completed via a stub return value.
const FILE_PRODUCING_TYPES = Object.entries(JOB_COMPLETION_REQUIREMENTS)
  .filter(([, req]) => req.requiresAsset)
  .map(([type]) => type);

export { isFalseCompletionResult };

interface AuditRecord {
  id: number;
  jobCode: string;
  jobType: string;
  completedAt: Date | null;
  reason: string;
  resultJson: unknown;
}

// ── Main audit function ───────────────────────────────────────────────────────

export async function findFalseCompletions(): Promise<AuditRecord[]> {
  // Query all completed file-producing jobs
  const rows = await db
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.status, "completed"),
        inArray(aiJobsTable.jobType, FILE_PRODUCING_TYPES),
      ),
    );

  const suspect: AuditRecord[] = [];

  for (const job of rows) {
    if (isFalseCompletionResult(job.resultJson)) {
      const message = typeof (job.resultJson as Record<string, unknown> | null)?.["message"] === "string"
        ? (job.resultJson as Record<string, unknown>)["message"] as string
        : "(no result)";

      suspect.push({
        id: job.id,
        jobCode: job.jobCode ?? `job-${job.id}`,
        jobType: job.jobType,
        completedAt: job.completedAt,
        reason: `Result lacks asset reference. result.message="${message}"`,
        resultJson: job.resultJson,
      });
    }
  }

  return suspect;
}

async function applyCorrections(records: AuditRecord[]): Promise<void> {
  if (records.length === 0) return;

  const ids = records.map((r) => r.id);

  await db
    .update(aiJobsTable)
    .set({
      status: "failed",
      errorMessage:
        "[AUDIT] Job was marked completed without a real deliverable. " +
        "Stub worker returned a dispatch message. Reclassified as failed by audit script.",
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(aiJobsTable.id, ids),
        eq(aiJobsTable.status, "completed"),
      ),
    );

  for (const rec of records) {
    await logAudit(
      "audit-script",
      "false_completion_corrected",
      String(rec.id),
      "ai_job",
      "success",
      {
        jobCode: rec.jobCode,
        jobType: rec.jobType,
        previousCompletedAt: rec.completedAt?.toISOString() ?? null,
        reason: rec.reason,
      },
    );
    console.log(`  ✓ [${rec.id}] ${rec.jobCode} (${rec.jobType}) — reclassified as failed`);
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = !isApply;

  console.log("=".repeat(60));
  console.log("Creative AI — False Completion Audit");
  console.log(`Mode: ${isDryRun ? "DRY-RUN (no writes)" : "APPLY (will update DB)"}`);
  console.log("=".repeat(60));
  console.log(`Scanning for completed file-producing jobs: ${FILE_PRODUCING_TYPES.join(", ")}`);
  console.log();

  const records = await findFalseCompletions();

  if (records.length === 0) {
    console.log("✅ No false completions found. All completed file-producing jobs have valid deliverables.");
    process.exit(0);
  }

  console.log(`⚠️  Found ${records.length} false completion(s):\n`);

  for (const rec of records) {
    console.log(`  [${rec.id}] ${rec.jobCode}`);
    console.log(`    type:        ${rec.jobType}`);
    console.log(`    completedAt: ${rec.completedAt?.toISOString() ?? "null"}`);
    console.log(`    reason:      ${rec.reason}`);
    console.log();
  }

  if (isDryRun) {
    console.log("DRY-RUN complete. No database changes made.");
    console.log("Run with --apply to reclassify these jobs as failed.");
  } else {
    console.log("Applying corrections...");
    await applyCorrections(records);
    console.log(`\n✅ Done. ${records.length} job(s) reclassified as failed.`);
    console.log("Note: associated creative project and service request statuses");
    console.log("must be reviewed manually — this script does not cascade to projects.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Audit script failed:", err);
  process.exit(1);
});
