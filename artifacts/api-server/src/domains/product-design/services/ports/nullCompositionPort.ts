/**
 * product-design — Null Composition Port (test stub)
 *
 * Returns a deterministic fake asset key without performing any real rendering.
 * Records all calls for test assertions.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type {
  CompositionPort,
  CompositionRenderInput,
  CompositionRenderResult,
} from "../../types/ports";

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export class NullCompositionPort implements CompositionPort {
  /** All render calls recorded for test assertions. */
  readonly calls: CompositionRenderInput[] = [];

  /** Sequence counter to produce unique asset keys per call. */
  private _seq = 0;

  async render(input: CompositionRenderInput): Promise<CompositionRenderResult> {
    this.calls.push(input);
    this._seq += 1;

    const { spec, format } = input;
    const assetKey = `null-composition/${spec.conceptId}/${spec.viewAngle}/${this._seq}.${format}`;

    return {
      assetKey,
      widthPx:  spec.widthPx,
      heightPx: spec.heightPx,
      mimeType: MIME_MAP[format] ?? "application/octet-stream",
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  reset(): void {
    this.calls.length = 0;
    this._seq = 0;
  }
}
