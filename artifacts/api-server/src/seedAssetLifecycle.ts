/**
 * Sprint P2.1.1 — seeds the event-bus subscriptions that chain the background
 * asset-archiving pipeline. Purely declarative: no new orchestration code,
 * 100% reuse of the existing generic `create_job` handler + Queue/Dispatcher/
 * Worker Cluster. Idempotent — safe to run repeatedly.
 */
import { db, aiEventSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SUBSCRIPTIONS: Array<{
  subscriptionName: string;
  eventType: string;
  jobType: string;
  requiredCapability: string;
}> = [
  {
    subscriptionName: "asset-lifecycle:generated->archive",
    eventType: "asset.generated",
    jobType: "archive_asset",
    requiredCapability: "archive_asset",
  },
  {
    subscriptionName: "asset-lifecycle:archived->optimize",
    eventType: "asset.archived",
    jobType: "optimize_asset",
    requiredCapability: "optimize_asset",
  },
  {
    subscriptionName: "asset-lifecycle:archived->thumbnail",
    eventType: "asset.archived",
    jobType: "generate_thumbnail",
    requiredCapability: "generate_thumbnail",
  },
];

export async function seedAssetLifecycleSubscriptions(): Promise<void> {
  for (const s of SUBSCRIPTIONS) {
    const [existing] = await db
      .select({ id: aiEventSubscriptionsTable.id })
      .from(aiEventSubscriptionsTable)
      .where(eq(aiEventSubscriptionsTable.subscriptionName, s.subscriptionName))
      .limit(1);

    if (existing) continue;

    await db.insert(aiEventSubscriptionsTable).values({
      subscriptionName: s.subscriptionName,
      eventType: s.eventType,
      handlerType: "create_job",
      handlerConfigJson: {
        jobType: s.jobType,
        requiredCapability: s.requiredCapability,
        priority: 60,
      },
      status: "active",
      retryPolicy: { maxAttempts: 3, backoff: "exponential" },
    });
    console.log(`  ✓ seeded event subscription: ${s.subscriptionName}`);
  }
}
