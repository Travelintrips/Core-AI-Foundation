import { db, aiJobsTable } from "@workspace/db";
import { inArray, desc } from "drizzle-orm";
async function main() {
  const jobs = await db.select().from(aiJobsTable).where(inArray(aiJobsTable.jobType, ["archive_asset"])).orderBy(desc(aiJobsTable.id)).limit(6);
  console.log(JSON.stringify(jobs.map(j => ({id:j.id, status:j.status, retryCount:j.retryCount, nextRetryAt:j.nextRetryAt, assetId:(j.payloadJson as any)?.portfolioAssetId, err:j.errorMessage, result: j.resultJson})), null, 2));
  process.exit(0);
}
main();
