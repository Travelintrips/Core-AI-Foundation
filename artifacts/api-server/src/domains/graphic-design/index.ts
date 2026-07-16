/**
 * graphic-design/index.ts — Team 15
 *
 * Barrel export for the Graphic Design domain.
 * Import from here instead of individual files.
 */

// Schema + types
export * from "./schema.js";
export * from "./blueprints.js";
export * from "./components.js";
export * from "./manifest.js";
export * from "./packagePolicy.js";

// QC engine
export * from "./qc.js";

// Port interfaces
export * from "./ports.js";

// Service functions
export {
  createBrief,
  listBriefs,
  getBrief,
  updateBriefStatus,
  approveBriefAndDispatch,
  runBriefQc,
  getBriefManifest,
  getBriefQcResult,
  resolveAdapters,
} from "./service.js";

// Router (default export)
export { default as graphicDesignRouter } from "./routes.js";
