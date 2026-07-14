/**
 * imageBatchRegistryInit.ts — Phase 5 Creative Asset Batch Engine
 *
 * Registers all ImageBatchDefinitions into the generic worker registry.
 * Import this module once at server startup (from jobWorkerService.ts),
 * mirroring creativeDocumentRegistry.ts / creativePresentationRegistry.ts.
 *
 * To add a new batch type: create a definition in definitions/, import it
 * here, and call registerImageBatch().
 */

import { registerImageBatch } from "./creativeImageBatchRegistry.js";
import { logoDesignBatchDefinition } from "./definitions/logoDesignBatchDefinition.js";
import { socialMediaBatchDefinition } from "./definitions/socialMediaBatchDefinition.js";
import { packagingDesignBatchDefinition } from "./definitions/packagingDesignBatchDefinition.js";

export function initImageBatchRegistry(): void {
  registerImageBatch(logoDesignBatchDefinition);
  registerImageBatch(socialMediaBatchDefinition);
  registerImageBatch(packagingDesignBatchDefinition);
}
