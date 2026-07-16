/**
 * Run seedServiceCatalog against the current NODE_ENV database.
 * Usage: NODE_ENV=production npx tsx src/scripts/runSeedCatalogProd.ts
 */
import { seedServiceCatalog } from "../seedCatalog.js";

await seedServiceCatalog();
process.exit(0);
