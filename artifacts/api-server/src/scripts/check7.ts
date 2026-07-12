import { db, aiJobsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
async function main() {
  const jobs = await db.select().from(aiJobsTable).where(inArray(aiJobsTable.id, [92,93,85]));
  for (const j of jobs) {
    console.log(j.id, JSON.stringify(j.jobType), 'len='+j.jobType.length, 'requiredCapability=', JSON.stringify(j.requiredCapability));
  }
  process.exit(0);
}
main();
