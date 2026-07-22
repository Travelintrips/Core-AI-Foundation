/**
 * design-workspace/WorkspaceToolbar.tsx
 * Toolbar: zoom controls, fit, reset, overlay toggle, artifact navigation.
 * All buttons are accessible (aria-label, disabled states, keyboard focusable).
 */

import React from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCcw, ChevronLeft, ChevronRight,
  Layers, Fullscreen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CANVAS_MIN_SCALE, CANVAS_MAX_SCALE } from './utils/transform';

// ── Toolbar button ────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  'aria-label': string;
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}

function ToolbarButton({
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
  children,
  active = false,
  title,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title ?? ariaLabel}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg text-slate-400',
        'hover:text-white hover:bg-white/8 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        'disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none',
        active && 'text-indigo-400 bg-indigo-500/15',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-1" aria-hidden="true" />;
}

// ── Zoom percentage display ───────────────────────────────────────────────────

interface ZoomDisplayProps {
  scale: number;
  onClick: () => void;
}

function ZoomDisplay({ scale, onClick }: ZoomDisplayProps) {
  const pct = Math.round(scale * 100);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Zoom ${pct}% — click to fit`}
      title="Click to fit"
      className={cn(
        'min-w-[3.5rem] h-8 px-2 rounded-lg text-xs font-mono text-slate-300',
        'hover:bg-white/8 hover:text-white transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
      )}
    >
      {pct}%
    </button>
  );
}

// ── Main toolbar ──────────────────────────────────────────────────────────────

export interface WorkspaceToolbarProps {
  scale: number;
  minScale?: number;
  maxScale?: number;
  canGoToPreviousArtifact?: boolean;
  canGoToNextArtifact?: boolean;
  overlaysEnabled?: boolean;
  canToggleOverlays?: boolean;
  canFullscreen?: boolean;
  isFullscreen?: boolean;
  extraActions?: React.ReactNode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  onPreviousArtifact?: () => void;
  onNextArtifact?: () => void;
  onToggleOverlays?: () => void;
  onToggleFullscreen?: () => void;
}

export function WorkspaceToolbar({
  scale,
  minScale = CANVAS_MIN_SCALE,
  maxScale = CANVAS_MAX_SCALE,
  canGoToPreviousArtifact = false,
  canGoToNextArtifact = false,
  overlaysEnabled = false,
  canToggleOverlays = false,
  canFullscreen = false,
  isFullscreen = false,
  extraActions,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  onPreviousArtifact,
  onNextArtifact,
  onToggleOverlays,
  onToggleFullscreen,
}: WorkspaceToolbarProps) {
  const atMin = scale <= minScale;
  const atMax = scale >= maxScale;

  return (
    <div
      role="toolbar"
      aria-label="Canvas toolbar"
      className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-900/80 backdrop-blur-sm border border-white/8 rounded-xl shadow-lg"
    >
      {/* Artifact navigation */}
      {(canGoToPreviousArtifact || canGoToNextArtifact) && (
        <>
          <ToolbarButton
            onClick={onPreviousArtifact!}
            disabled={!canGoToPreviousArtifact}
            aria-label="Previous artifact"
          >
            <ChevronLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={onNextArtifact!}
            disabled={!canGoToNextArtifact}
            aria-label="Next artifact"
          >
            <ChevronRight className="w-4 h-4" />
          </ToolbarButton>
          <Divider />
        </>
      )}

      {/* Zoom out */}
      <ToolbarButton
        onClick={onZoomOut}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out (−)"
      >
        <ZoomOut className="w-4 h-4" />
      </ToolbarButton>

      {/* Zoom percentage — click to fit */}
      <ZoomDisplay scale={scale} onClick={onFit} />

      {/* Zoom in */}
      <ToolbarButton
        onClick={onZoomIn}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        <ZoomIn className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      {/* Fit to screen */}
      <ToolbarButton onClick={onFit} aria-label="Fit to screen" title="Fit (0)">
        <Maximize2 className="w-4 h-4" />
      </ToolbarButton>

      {/* Reset */}
      <ToolbarButton onClick={onReset} aria-label="Reset view" title="Reset view">
        <RotateCcw className="w-3.5 h-3.5" />
      </ToolbarButton>

      {/* Overlays toggle */}
      {canToggleOverlays && (
        <>
          <Divider />
          <ToolbarButton
            onClick={onToggleOverlays!}
            aria-label={overlaysEnabled ? 'Hide overlays' : 'Show overlays'}
            active={overlaysEnabled}
            title="Toggle overlays"
          >
            <Layers className="w-4 h-4" />
          </ToolbarButton>
        </>
      )}

      {/* Fullscreen */}
      {canFullscreen && (
        <>
          <Divider />
          <ToolbarButton
            onClick={onToggleFullscreen!}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            active={isFullscreen}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          >
            <Fullscreen className="w-4 h-4" />
          </ToolbarButton>
        </>
      )}

      {/* Plugin/extra actions slot */}
      {extraActions && (
        <>
          <Divider />
          {extraActions}
        </>
      )}
    </div>
  );
}
