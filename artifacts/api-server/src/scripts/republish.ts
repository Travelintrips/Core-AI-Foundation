import { db, aiPortfolioAssetsTable, aiServicePortfoliosTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { publishSafe } from "../services/aiEventBusService.js";

async function main() {
  const ids = [72, 73, 76];
  const assets = await db.select().from(aiPortfolioAssetsTable).where(inArray(aiPortfolioAssetsTable.id, ids));
  for (const asset of assets) {
    const [portfolio] = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, asset.portfolioId)).limit(1);
    const brandSlug = (portfolio?.metadataJson as Record<string, unknown> | null)?.["brandSlug"] as string | undefined;
    await db.update(aiPortfolioAssetsTable).set({ archiveStatus: "pending", archiveError: null }).where(eq(aiPortfolioAssetsTable.id, asset.id));
    await publishSafe({
      eventType: "asset.generated", sourceModule: "sprint-smoke-test", sourceId: String(asset.id),
      payload: { portfolioAssetId: asset.id, sourceUrl: asset.sourceUrl, brandSlug, role: asset.assetRole, portfolioId: asset.portfolioId },
    });
    console.log("republished for asset", asset.id, "brandSlug", brandSlug);
  }
  process.exit(0);
}
main();
