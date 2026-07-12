import { db, aiEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
async function main() {
  const events = await db.select().from(aiEventsTable).where(undefined as any).orderBy(desc(aiEventsTable.id)).limit(10);
  console.log(JSON.stringify(events.map(e => ({id:e.id, eventType:e.eventType, sourceId:e.sourceId, payload:e.payloadJson})), null, 2));
  process.exit(0);
}
main();
