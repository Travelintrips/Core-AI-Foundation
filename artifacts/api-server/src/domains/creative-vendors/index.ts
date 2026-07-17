/**
 * index.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Barrel export for the creative-vendors domain.
 * Team 24 integration:
 *   import { vendorRouter } from './domains/creative-vendors/index.js';
 *   app.use('/', vendorRouter);
 */
export { vendorRouter } from "./vendorRouter.js";
export * from "./vendorService.js";
export * from "./vendorPortfolioService.js";
export * from "./vendorContactService.js";
export * from "./vendorRecommendationService.js";
export * from "./schema.js";
