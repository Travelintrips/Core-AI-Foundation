/**
 * creativePresentationRegistry.ts — Phase 4 Presentation Engine
 *
 * Registers all PresentationDefinitions into the generic presentation worker
 * registry. Import once at server startup (or from jobWorkerService.ts) so
 * every definition is available before any pptx_export job runs.
 *
 * To add a new presentation type:
 *   1. Create a mapper in services/presentation/mappers/
 *   2. Export a PresentationDefinition from it
 *   3. Import and call registerPresentation() here
 *   4. Add its serviceCode mapping in creativeProjectPresentationType.ts
 */

import { registerPresentation } from "./creativePresentationWorkerService.js";
import { pitchDeckDefinition } from "./mappers/pitchDeckPresentationMapper.js";

/** Call once at startup to register all presentation type definitions. */
export function initPresentationRegistry(): void {
  registerPresentation(pitchDeckDefinition);
}
