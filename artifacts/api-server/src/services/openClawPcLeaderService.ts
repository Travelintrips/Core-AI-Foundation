import { eq, sql } from "drizzle-orm";
import { aiCodingBridgePresenceTable, db } from "@workspace/db";
import { getExternalAgentRegistrySnapshot } from "./externalAgentRegistryService.js";
import { selectOpenClawExecutor } from "./openClawFailoverSelectionService.js";

const PC_LEADER_KEY = "openclaw-pc-active-chat-leader";

/** Durable, sticky leader election with a database advisory lock across API replicas. */
export async function chooseActivePc(registry: Awaited<ReturnType<typeof getExternalAgentRegistrySnapshot>>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${PC_LEADER_KEY}::text, 0))`);
    const [stored] = await tx.select({ metadataJson: aiCodingBridgePresenceTable.metadataJson })
      .from(aiCodingBridgePresenceTable)
      .where(eq(aiCodingBridgePresenceTable.clientId, PC_LEADER_KEY))
      .limit(1);
    const metadata = stored?.metadataJson as Record<string, unknown> | undefined;
    const existing = typeof metadata?.activePcId === "string" ? metadata.activePcId : undefined;
    const selected = selectOpenClawExecutor(registry, { activePcId: existing });
    if (!selected || selected === existing) return selected;
    const now = new Date();
    await tx.insert(aiCodingBridgePresenceTable).values({
      clientId: PC_LEADER_KEY,
      source: "ai-core-pc-leader",
      leaseExpiresAt: new Date(now.getTime() + 90_000),
      lastSeenAt: now,
      metadataJson: { activePcId: selected, electedAt: now.toISOString() },
    }).onConflictDoUpdate({
      target: aiCodingBridgePresenceTable.clientId,
      set: {
        leaseExpiresAt: new Date(now.getTime() + 90_000),
        lastSeenAt: now,
        metadataJson: { activePcId: selected, electedAt: now.toISOString() },
        updatedAt: now,
      },
    });
    return selected;
  });
}

