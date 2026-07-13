import { db, aiServicePortfoliosTable, aiPortfolioAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const portfolios = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.isDemo, true));
  let total = 0;
  for (const p of portfolios) {
    const assets = await db.select().from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.portfolioId, p.id));
    const failed = assets.filter((a) => (a.metadataJson as { status?: string } | null)?.status === "failed");
    if (failed.length) console.log(p.id, p.title, failed.length);
    total += failed.length;
  }
  console.log("TOTAL FAILED:", total);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
