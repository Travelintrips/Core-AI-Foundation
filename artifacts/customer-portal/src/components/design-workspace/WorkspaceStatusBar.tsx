/**
 * design-workspace/WorkspaceStatusBar.tsx
 * Status bar: artifact info, version, zoom, status, renderer diagnostic.
 *
 * Security: MUST NOT display raw storage paths, internal AI prompts,
 * API keys, provider payloads, or hidden system metadata.
 */

import React from 'react';
import type { CanvasArtifact, CanvasArtifactStatus } from './types';

const STATUS_LABEL: Record<CanvasArtifactStatus, { label: string; color: string }> = {
  ready:       { label: 'Ready',      color: 'text-emerald-400' },
  generating:  { label: 'Generating', color: 'text-indigo-400' },
  failed:      { label: 'Failed',     color: 'text-red-400' },
  archived:    { label: 'Archived',   color: 'text-slate-500' },
  review:      { label: 'Review',     color: 'text-amber-400' },
  unavailable: { label: 'Unavailable',color: 'text-slate-500' },
};

export interface WorkspaceStatusBarProps {
  artifact: CanvasArtifact | null;
  scale: number;
  currentFrame?: string | null;
  isReadOnly?: boolean;
  rendererDiagnostic?: string | null;
  isLoading?: boolean;
}

export function WorkspaceStatusBar({
  artifact,
  scale,
  currentFrame,
  isReadOnly = true,
  rendererDiagnostic,
  isLoading = false,
}: WorkspaceStatusBarProps) {
  return (
    <div
      role="status"
      aria-label="Canvas status"
      aria-live="polite"
      className="flex items-center gap-4 px-3 py-1.5 text-xs text-slate-500 border-t border-white/6 bg-slate-900/60 select-none overflow-x-auto scrollbar-none"
    >
      {/* Artifact info */}
      {artifact ? (
        <>
          <span className="font-medium text-slate-400 truncate max-w-[200px]" title={artifact.title}>
            {artifact.title}
          </span>

          {artifact.type && (
            <span className="text-slate-600 hidden sm:inline">
              {artifact.type}
            </span>
          )}

          {artifact.version != null && (
            <span className="text-slate-600 hidden sm:inline">v{artifact.version}</span>
          )}

          {currentFrame && (
            <span className="text-slate-600 hidden md:inline">
              Frame: {currentFrame}
            </span>
          )}

          {/* Status */}
          {(() => {
            const s = STATUS_LABEL[artifact.status];
            return (
              <span className={`${s.color} hidden sm:inline`} aria-label={`Status: ${s.label}`}>
                {s.label}
              </span>
            );
          })()}
        </>
      ) : (
        <span className="text-slate-600 italic">
          {isLoading ? 'Loading…' : 'No artifact selected'}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Renderer diagnostic (only shown when there's a warning) */}
      {rendererDiagnostic && (
        <span
          className="text-amber-500/70 hidden lg:inline truncate max-w-[200px]"
          title={rendererDiagnostic}
          aria-label={`Renderer: ${rendererDiagnostic}`}
        >
          {rendererDiagnostic}
        </span>
      )}

      {/* Read-only indicator */}
      {isReadOnly && (
        <span className="text-slate-600 hidden sm:inline" aria-label="Read-only mode">
          Read-only
        </span>
      )}

      {/* Zoom */}
      <span className="font-mono tabular-nums" aria-label={`Zoom: ${Math.round(scale * 100)}%`}>
        {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
