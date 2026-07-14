/**
 * creativeImageBatchRegistry.ts — Phase 5 Creative Asset Batch Engine
 *
 * Same registry pattern as creativeDocumentWorkerService.ts /
 * creativePresentationRegistry.ts: definitions register themselves once at
 * startup, the worker looks them up by batch type at dispatch time.
 */

import type { ImageBatchDefinition, ImageBatchType } from "./imageBatchTypes.js";

const _registry = new Map<ImageBatchType, ImageBatchDefinition>();

export function registerImageBatch(definition: ImageBatchDefinition): void {
  _registry.set(definition.batchType, definition);
}

export function getImageBatchDefinition(batchType: ImageBatchType): ImageBatchDefinition | undefined {
  return _registry.get(batchType);
}

export function getSupportedImageBatchTypes(): ImageBatchType[] {
  return Array.from(_registry.keys());
}

/** Look up a definition by catalog serviceCode. Used to resolve a project's batch type. */
export function findImageBatchDefinitionByServiceCode(serviceCode: string): ImageBatchDefinition | undefined {
  for (const def of _registry.values()) {
    if (def.serviceCodes.includes(serviceCode)) return def;
  }
  return undefined;
}

