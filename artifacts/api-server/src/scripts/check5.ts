import { db, aiJobsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
async function main() {
  const jobs = await db.select().from(aiJobsTable).where(inArray(aiJobsTable.id, [83,84,85,88,90,91]));
  console.log(JSON.stringify(jobs.map(j => ({id:j.id, status:j.status, result:j.resultJson, error:j.errorMessage, completedAt:j.completedAt})), null, 2));
  process.exit(0);
}
main();
