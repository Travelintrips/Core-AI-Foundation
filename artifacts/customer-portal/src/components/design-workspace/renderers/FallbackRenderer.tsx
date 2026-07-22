/**
 * design-workspace/renderers/FallbackRenderer.tsx
 * Explicit "unsupported artifact" renderer — never silently renders garbage.
 *
 * This adapter is always registered last (lowest priority = 0).
 * It catches any artifact type that no specialist adapter can render and
 * shows a clear, honest unavailable state.
 */

import { FileQuestion } from 'lucide-react';
import type { CanvasArtifact, CanvasRendererAdapter, RendererProps } from '../types';

function FallbackRendererComponent({ artifact }: RendererProps) {
  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full gap-4 text-center px-6"
      role="img"
      aria-label={`${artifact.title} — preview unavailable`}
    >
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <FileQuestion className="w-7 h-7 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-400">Preview unavailable</p>
        <p className="text-xs text-slate-600 mt-1">
          No renderer supports <code className="text-slate-500">{artifact.type}</code>
        </p>
      </div>
    </div>
  );
}

export const FALLBACK_RENDERER: CanvasRendererAdapter = {
  rendererId: 'builtin:fallback',
  supportedArtifactTypes: ['*'],
  priority: -999,
  isReadOnly: true,
  supportsFrames: false,
  supportsOverlays: false,
  supportsSelection: false,

  /** Matches anything — only activated when no specialist renderer matches. */
  canRender(_artifact: CanvasArtifact): boolean {
    return true;
  },

  Component: FallbackRendererComponent,

  getIntrinsicSize(_artifact: CanvasArtifact) {
    return { width: 400, height: 300 };
  },
};
