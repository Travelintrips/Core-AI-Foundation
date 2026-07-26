/**
 * Universal Catalog Import — API Adapter (Foundation)
 * Stub implementation for future official API provider integration.
 * Returns an empty result with a clear message until an official API
 * source is confirmed and the live feed is unblocked.
 *
 * See: docs/material-phase4-official-provider-report.md (LIVE SOURCE BLOCKED)
 * This adapter will be wired to the Niro Granite provider transport in Phase 5.
 */

import type { CatalogAdapter, AdapterInput, AdapterResult } from "../types.js";

export class ApiAdapter implements CatalogAdapter {
  readonly sourceType = "api" as const;
  readonly displayName = "Official API (Foundation)";
  readonly supportedMimeTypes: string[] = [];

  async extract(_input: AdapterInput): Promise<AdapterResult> {
    return {
      rawItems: [],
      warnings: [
        "API adapter is a foundation stub. Live API integration requires a confirmed official source endpoint and credentials.",
        "See docs/material-phase4-official-provider-report.md for prerequisite checklist.",
      ],
      errors: [],
      sourceMetadata: {
        status: "LIVE_SOURCE_BLOCKED",
        phase: "Phase 5 (pending prerequisite clearance)",
      },
    };
  }
}

export const apiAdapter = new ApiAdapter();
