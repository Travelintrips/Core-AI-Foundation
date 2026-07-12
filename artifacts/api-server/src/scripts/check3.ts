import { db, aiJobsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

async function main() {
  const jobs = await db.select().from(aiJobsTable).where(inArray(aiJobsTable.jobType, ["archive_asset","optimize_asset","generate_thumbnail"]));
  const relevant = jobs.filter(j => [71,72,73,74,75,76].includes((j.payloadJson as any)?.portfolioAssetId));
  console.log(JSON.stringify(relevant.map(j => ({id:j.id, status:j.status, retryCount:j.retryCount, maxRetry:j.maxRetry, nextRetryAt:j.nextRetryAt, assetId:(j.payloadJson as any)?.portfolioAssetId, err:j.errorMessage})), null, 2));
  process.exit(0);
}
main();
