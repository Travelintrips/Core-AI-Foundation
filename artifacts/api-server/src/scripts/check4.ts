import { db, aiWorkersTable } from "@workspace/db";
async function main() {
  const workers = await db.select().from(aiWorkersTable);
  console.log(JSON.stringify(workers.map(w => ({id:w.id, name:w.workerName, type:w.workerType, status:w.status, capabilities:w.capabilities, currentJob:w.currentJob, runningJobs:w.runningJobs, maxConcurrentJobs:w.maxConcurrentJobs, leaseExpiresAt:w.leaseExpiresAt})), null, 2));
  process.exit(0);
}
main();
