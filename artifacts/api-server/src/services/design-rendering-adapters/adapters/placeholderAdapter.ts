/**
 * Team 32 — PlaceholderAdapter
 *
 * Returns an honest "placeholder" or "unavailable" result for artifact kinds
 * that have no native renderer available (e.g. 3D previews).
 *
 * HONESTY RULE: This adapter NEVER claims a real render occurred.
 * classification is always "placeholder" or "unavailable".
 * It MUST NOT return a real rendered image.
 *
 * This adapter has the lowest priority (999) so it is only resolved when
 * no other adapter can handle the request.
 */

import { randomUUID } from "crypto";
import type {
  DesignRendererAdapter,
  DesignRenderCapability,
  DesignRenderRequest,
  DesignRenderResult,
  DesignRenderFormat,
} from "../types.js";
import { MIME_FOR_FORMAT } from "../types.js";

// Known artifact kinds that have no renderer
const UNAVAILABLE_KINDS = new Set(["3d_model", "3d_scene"]);

// Supported placeholder targets
const PLACEHOLDER_TARGETS = [
  "3d_preview_placeholder",
  "artifact_preview",
  "thumbnail",
  "workspace_image",
  "review_preview",
  "technical_preview",
  "mockup_preview",
] as const;

const PLACEHOLDER_FORMATS: DesignRenderFormat[] = [
  "png", "jpg", "webp", "thumbnail",
];

export class PlaceholderAdapter implements DesignRendererAdapter {
  readonly rendererId = "placeholder-adapter-v1";

  readonly capability: DesignRenderCapability = {
    rendererId: "placeholder-adapter-v1",
    description:
      "Returns placeholder/unavailable descriptors for artifact kinds without a native renderer (e.g. 3D). Never claims a real render.",
    supportedFormats: PLACEHOLDER_FORMATS,
    supportedTargets: [...PLACEHOLDER_TARGETS],
    supportedArtifactKinds: [
      "3d_model",
      "3d_scene",
      "unknown",
    ],
    maxWidthPx: 1024,
    maxHeightPx: 1024,
    maxFileSizeBytes: 0, // no real output produced
    timeoutMs: 1_000,
    retryable: false,
    available: true,
    priority: 999, // lowest priority — only when nothing else matches
  };

  canHandle(request: DesignRenderRequest): boolean {
    // Always handles the unavailable kinds regardless of format
    return UNAVAILABLE_KINDS.has(request.artifactKind);
  }

  async render(request: DesignRenderRequest): Promise<DesignRenderResult> {
    const requestId = request.requestId ?? randomUUID();
    const format = request.profile.format;

    // Determine honest classification
    const classification =
      request.profile.purpose === "3d_preview_placeholder"
        ? "placeholder"
        : "unavailable";

    return {
      requestId,
      rendererId: this.rendererId,
      format,
      target: request.profile.purpose,
      classification,
      // No storage path, no signed URL — this is a placeholder descriptor
      mimeType: MIME_FOR_FORMAT[format] ?? "image/png",
      durationMs: 0,
      warnings: [
        `No native renderer is available for artifact kind "${request.artifactKind}". ` +
          `This result is a ${classification}, not a real render.`,
      ],
      tenantId: request.tenantId,
    };
  }
}
