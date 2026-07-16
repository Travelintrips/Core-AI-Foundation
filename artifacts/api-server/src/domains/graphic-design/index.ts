/**
 * index.ts — Graphic Design Domain (Team 15)
 *
 * Barrel export for all public-facing domain modules.
 */

export * from "./types.js";
export * from "./briefSchema.js";
export * from "./blueprintMapping.js";
export * from "./componentMapping.js";
export * from "./qcRules.js";
export * from "./deliverableManifest.js";
export * from "./packagePolicy.js";
export { GraphicDesignService } from "./graphicDesignService.js";
export type { GdPorts, GdDispatchInput, GdDispatchResult, GdQcInput, GdDeliverInput } from "./graphicDesignService.js";
export { default as graphicDesignRouter } from "./graphicDesignRoutes.js";
