import { db, aiJobsTable } from "@workspace/db";
import { gte, desc } from "drizzle-orm";
async function main() {
  const jobs = await db.select().from(aiJobsTable).where(gte(aiJobsTable.id, 92)).orderBy(desc(aiJobsTable.id));
  console.log(JSON.stringify(jobs.map(j => ({id:j.id, type:j.jobType, status:j.status, assetId:(j.payloadJson as any)?.portfolioAssetId})), null, 2));
  process.exit(0);
}
main();
