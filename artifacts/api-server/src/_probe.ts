import { db, creativeProjectsTable, creativeProjectStepsTable } from "@workspace/db";
import { buildProjectRuntimeSnapshot } from "./services/runtimeRosterService.js";

const projects = await db.select({ id: creativeProjectsTable.id, projectId: creativeProjectsTable.projectId, status: creativeProjectsTable.status }).from(creativeProjectsTable).limit(10);
console.log("projects:", JSON.stringify(projects));

const steps = await db.select().from(creativeProjectStepsTable).limit(20);
console.log("steps sample:", JSON.stringify(steps.slice(0,3)));
console.log("step count:", steps.length);

if (projects.length > 0) {
  for (const p of projects) {
    const snap = await buildProjectRuntimeSnapshot(p.id);
    if (snap.workers.length > 0) {
      console.log(`--- project ${p.id} (${p.projectId}) runtime ---`);
      console.log(JSON.stringify(snap, null, 2));
      break;
    }
  }
}
process.exit(0);
