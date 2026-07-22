/**
 * design-workspace/overlays/CanvasOverlayHost.tsx
 * Generic overlay host. Renders enabled overlays in z-order.
 *
 * Contract:
 * - Each overlay component receives the current transform and active artifact.
 * - Overlays that set pointerEvents=false use pointer-events:none CSS.
 * - Interactive overlays must supply aria-label.
 * - The host does NOT modify artifact data.
 * - Annotation system (Team 18), property overlays (Team 12/19), and domain
 *   overlays contribute via CanvasOverlayDefinition — no canvas-core changes needed.
 */

import React, { useMemo } from 'react';
import type { CanvasOverlayDefinition, CanvasOverlayProps } from '../types';

export interface CanvasOverlayHostProps {
  overlays: CanvasOverlayDefinition[];
  overlayProps: CanvasOverlayProps;
}

export function CanvasOverlayHost({ overlays, overlayProps }: CanvasOverlayHostProps) {
  const sorted = useMemo(
    () =>
      [...overlays]
        .filter((o) => o.enabled)
        .sort((a, b) => a.zOrder - b.zOrder),
    [overlays],
  );

  if (sorted.length === 0) return null;

  return (
    <>
      {sorted.map((overlay) => (
        <div
          key={overlay.id}
          className="absolute inset-0"
          style={{
            zIndex: overlay.zOrder,
            pointerEvents: overlay.pointerEvents ? 'auto' : 'none',
          }}
          aria-label={overlay['aria-label'] ?? overlay.label}
          aria-hidden={!overlay.pointerEvents}
          data-overlay-id={overlay.id}
        >
          <overlay.Component {...overlayProps} />
        </div>
      ))}
    </>
  );
}

// ── Built-in generic overlays ─────────────────────────────────────────────────

/** A simple loading spinner overlay — used by CanvasRendererHost. */
export function LoadingOverlay() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
      role="status"
      aria-label="Loading artifact"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
        <p className="text-xs text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

/** Generic error overlay — never shows raw stack traces. */
export function ErrorOverlay({ message }: { message: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/20"
      role="alert"
      aria-label={`Error: ${message}`}
    >
      <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <span className="text-red-400 text-lg">!</span>
      </div>
      <p className="text-sm text-red-400/80 max-w-xs text-center">{message}</p>
    </div>
  );
}

/** Overlay shown when artifact is still generating. */
export function GeneratingOverlay({ label = 'Generating…' }: { label?: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-indigo-950/20"
      role="status"
      aria-label={label}
    >
      <div className="w-9 h-9 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
      <p className="text-xs text-indigo-300/70">{label}</p>
    </div>
  );
}
