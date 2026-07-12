import { archiveReplicateAsset } from "../services/portfolioStorageService.js";

async function main() {
  try {
    const result = await archiveReplicateAsset({
      sourceUrl: "https://replicate.delivery/yhqm/4LTmGQb4swIXIZqoFSmOyV9UMhEisEGkW4q4lF2BKazktDuF/out-0.webp",
      brandSlug: "kopisari-test",
      role: "color_palette",
    });
    console.log("SUCCESS:", JSON.stringify(result));
  } catch (err) {
    console.log("FAILED:", err instanceof Error ? err.stack : String(err));
  }
  process.exit(0);
}
main();
