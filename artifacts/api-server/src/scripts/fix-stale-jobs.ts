/**
 * fix-stale-jobs.ts
 *
 * 1. Marks all retrying archive/optimize/thumbnail jobs whose payloads are
 *    missing required fields as `failed` so they stop cycling.
 * 2. Resets every `generated` or `archive_failed` asset that has a sourceUrl
 *    back to archiveStatus=pending and republishes asset.generated so a fresh
 *    archive_asset job is enqueued with a correct payload.
 */
import { db, aiPortfolioAssetsTable, aiServicePortfoliosTable, aiJobsTable } from "@workspace/db";
import { eq, inArray, isNull, or, and, isNotNull } from "drizzle-orm";
import { publishSafe } from "../services/aiEventBusService.js";
import { sql } from "drizzle-orm";

const LIFECYCLE_JOB_TYPES = ["archive_asset", "optimize_asset", "generate_thumbnail"] as const;

async function main() {
  // ── Step 1: Kill stale retrying jobs with empty/bad payloads ──────────────
  console.log("Step 1: marking bad retrying jobs as failed…");
  const staleJobs = await db
    .select({ id: aiJobsTable.id, jobType: aiJobsTable.jobType, payloadJson: aiJobsTable.payloadJson })
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.status, "retrying"),
        inArray(aiJobsTable.jobType, [...LIFECYCLE_JOB_TYPES]),
      ),
    );

  let killedCount = 0;
  for (const job of staleJobs) {
    const payload = job.payloadJson as Record<string, unknown> | null;
    const isBad =
      !payload ||
      (job.jobType === "archive_asset" && (!payload["portfolioAssetId"] || !payload["sourceUrl"])) ||
      ((job.jobType === "optimize_asset" || job.jobType === "generate_thumbnail") &&
        (!payload["portfolioAssetId"] || !payload["storagePath"]));
    if (isBad) {
      await db
        .update(aiJobsTable)
        .set({ status: "failed", errorMessage: "stale-payload-fix: payload missing required fields" } as Record<string, unknown>)
        .where(eq(aiJobsTable.id, job.id));
      killedCount++;
    }
  }
  console.log(`  killed ${killedCount} stale retrying jobs`);

  // ── Step 2: Reset generated/archive_failed assets and republish ───────────
  console.log("Step 2: republishing asset.generated for all pending assets…");
  const assets = await db
    .select()
    .from(aiPortfolioAssetsTable)
    .where(
      and(
        or(
          eq(aiPortfolioAssetsTable.status, "generated"),
          eq(aiPortfolioAssetsTable.status, "archive_failed"),
        ),
        isNotNull(aiPortfolioAssetsTable.sourceUrl),
      ),
    );

  console.log(`  found ${assets.length} assets to requeue`);

  // Cache portfolio → brandSlug
  const portfolioIds = [...new Set(assets.map((a) => a.portfolioId))];
  const portfolios = await db
    .select({ id: aiServicePortfoliosTable.id, metadataJson: aiServicePortfoliosTable.metadataJson })
    .from(aiServicePortfoliosTable)
    .where(inArray(aiServicePortfoliosTable.id, portfolioIds));
  const slugMap = new Map(
    portfolios.map((p) => [
      p.id,
      (p.metadataJson as Record<string, unknown> | null)?.["brandSlug"] as string | undefined,
    ]),
  );

  let republished = 0;
  let skipped = 0;
  for (const asset of assets) {
    const brandSlug = slugMap.get(asset.portfolioId);
    if (!brandSlug || !asset.sourceUrl) { skipped++; continue; }

    await db
      .update(aiPortfolioAssetsTable)
      .set({ status: "generated", archiveStatus: "pending", archiveError: null } as Record<string, unknown>)
      .where(eq(aiPortfolioAssetsTable.id, asset.id));

    await publishSafe({
      eventType: "asset.generated",
      sourceModule: "fix-stale-jobs",
      sourceId: String(asset.id),
      payload: {
        portfolioAssetId: asset.id,
        sourceUrl: asset.sourceUrl,
        brandSlug,
        role: asset.assetRole,
        portfolioId: asset.portfolioId,
      },
    });
    republished++;
  }
  console.log(`  republished=${republished} skipped=${skipped}`);
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
