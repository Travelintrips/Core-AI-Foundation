/**
 * design-workspace/renderers/ImageRenderer.tsx
 * Built-in adapter for image artifacts (type "image" or mime-image types).
 *
 * Security: renders only via <img> — never injects SVG markup into the DOM
 * from untrusted sources. SVG from untrusted sources must be served as image/svg+xml
 * via authenticated URL and rendered through this component, NOT via dangerouslySetInnerHTML.
 */

import { useState } from 'react';
import { ImageIcon, AlertCircle } from 'lucide-react';
import type { CanvasArtifact, CanvasRendererAdapter, RendererProps } from '../types';

// ── Component ─────────────────────────────────────────────────────────────────

function ImageRendererComponent({ artifact }: RendererProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');

  if (!artifact.url) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full gap-3 text-slate-500"
        role="img"
        aria-label={`${artifact.title} — no URL available`}
      >
        <ImageIcon className="w-10 h-10 opacity-40" />
        <p className="text-xs">No image URL</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {state === 'loading' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white/5"
          aria-label="Loading image"
          role="status"
        >
          <div className="w-8 h-8 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
        </div>
      )}

      {state === 'error' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-500/5"
          role="alert"
          aria-label="Image failed to load"
        >
          <AlertCircle className="w-8 h-8 text-red-400/60" />
          <p className="text-xs text-red-400/80">Failed to load image</p>
        </div>
      )}

      <img
        src={artifact.url}
        alt={artifact.title}
        className={`max-w-full max-h-full object-contain select-none transition-opacity duration-200 ${
          state === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
        draggable={false}
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        // Prevent user from opening raw storage URL via context menu
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

// ── Adapter ───────────────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set([
  'image',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  // Common project artifact type aliases
  'preview_image',
  'final_image',
  'concept_image',
  'campaign_image',
  'moodboard_image',
]);

export const IMAGE_RENDERER: CanvasRendererAdapter = {
  rendererId: 'builtin:image',
  supportedArtifactTypes: [...IMAGE_TYPES],
  priority: 10,
  isReadOnly: true,
  supportsFrames: false,
  supportsOverlays: true,
  supportsSelection: false,

  canRender(artifact: CanvasArtifact): boolean {
    return IMAGE_TYPES.has(artifact.type);
  },

  Component: ImageRendererComponent,

  getIntrinsicSize(artifact: CanvasArtifact) {
    const meta = artifact.metadata ?? {};
    const w = typeof meta.width === 'number' ? meta.width : null;
    const h = typeof meta.height === 'number' ? meta.height : null;
    if (w && h && w > 0 && h > 0) return { width: w, height: h };
    // Default aspect for unknown image dimensions
    return { width: 1024, height: 1024 };
  },
};
