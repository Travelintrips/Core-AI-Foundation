/**
 * design-workspace/DesignWorkspaceShell.tsx
 * Top-level workspace shell — orchestrates viewport, toolbar, status bar,
 * panel slots, overlays, and artifact navigation.
 *
 * PRESENTATIONAL: Does NOT fetch project data. Callers supply controlled props.
 * This keeps fetch/auth/tenant logic outside the generic shell.
 *
 * Supports: desktop, tablet, mobile fallback, read-only, no-artifact, error.
 */

import React, { useState, useCallback, useReducer, useEffect, useId } from 'react';
import type {
  CanvasArtifact,
  CanvasSelection,
  CanvasOverlayDefinition,
  CanvasWorkspaceError,
  WorkspacePermissions,
  CanvasOverlayProps,
} from './types';
import { EMPTY_SELECTION, READ_ONLY_PERMISSIONS } from './types';
import type { CanvasRendererRegistry } from './renderers/registry';
import { CanvasViewport } from './CanvasViewport';
import { CanvasRendererHost } from './CanvasRendererHost';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { WorkspaceStatusBar } from './WorkspaceStatusBar';
import { CanvasOverlayHost } from './overlays/CanvasOverlayHost';
import { useCanvasTransform } from './hooks/use-canvas-transform';
import { selectionReducer, initialSelection } from './state/selection';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DesignWorkspaceShellProps {
  // Project identity
  projectId?: string;
  projectTitle?: string;

  // Artifact data (controlled — caller owns fetch/cache)
  artifacts: CanvasArtifact[];
  activeArtifactId: string | null;

  // Renderer registry
  rendererRegistry: CanvasRendererRegistry;

  // Panel slots — Team 12 (property), Team 13 (layers), Team 18 (annotations)
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel?: React.ReactNode;

  // Extra toolbar actions from domain plugins
  extraToolbarActions?: React.ReactNode;

  // State
  isLoading?: boolean;
  error?: CanvasWorkspaceError | null;
  permissions?: WorkspacePermissions;

  // Overlays contributed by plugins / Team 18
  overlays?: CanvasOverlayDefinition[];

  // Callbacks — forwarded to property panel, layer system, etc.
  onArtifactSelect?: (artifactId: string) => void;
  onFrameSelect?: (frameId: string) => void;
  onRegionSelect?: (regionId: string) => void;
  onSelectionChange?: (selection: CanvasSelection) => void;
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function DesignWorkspaceShell({
  projectTitle,
  artifacts,
  activeArtifactId,
  rendererRegistry,
  leftPanel,
  rightPanel,
  bottomPanel,
  extraToolbarActions,
  isLoading = false,
  error = null,
  permissions = READ_ONLY_PERMISSIONS,
  overlays = [],
  onArtifactSelect,
  onFrameSelect: _onFrameSelect,
  onRegionSelect,
  onSelectionChange,
}: DesignWorkspaceShellProps) {
  // ── Artifact navigation ──────────────────────────────────────────────────
  const [localActiveId, setLocalActiveId] = useState<string | null>(activeArtifactId);

  // Sync if parent changes
  useEffect(() => {
    setLocalActiveId(activeArtifactId);
  }, [activeArtifactId]);

  const activeArtifact = artifacts.find((a) => a.id === localActiveId) ?? null;
  const activeIndex = artifacts.findIndex((a) => a.id === localActiveId);

  const handleArtifactSelect = useCallback(
    (id: string) => {
      setLocalActiveId(id);
      onArtifactSelect?.(id);
    },
    [onArtifactSelect],
  );

  const handlePreviousArtifact = useCallback(() => {
    if (activeIndex > 0) handleArtifactSelect(artifacts[activeIndex - 1].id);
  }, [activeIndex, artifacts, handleArtifactSelect]);

  const handleNextArtifact = useCallback(() => {
    if (activeIndex < artifacts.length - 1) handleArtifactSelect(artifacts[activeIndex + 1].id);
  }, [activeIndex, artifacts, handleArtifactSelect]);

  // ── Selection ────────────────────────────────────────────────────────────
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    initialSelection(activeArtifactId),
  );

  const handleRegionSelect = useCallback(
    (regionId: string) => {
      const next = selectionReducer(selection, { type: 'SELECT_REGION', regionId });
      dispatchSelection({ type: 'SELECT_REGION', regionId });
      onRegionSelect?.(regionId);
      onSelectionChange?.(next);
    },
    [selection, onRegionSelect, onSelectionChange],
  );

  // ── Viewport transform ───────────────────────────────────────────────────
  const {
    transform,
    zoom,
    zoomIn,
    zoomOut,
    pan,
    fit,
    reset,
    setViewport,
    setContent,
    minScale,
    maxScale,
  } = useCanvasTransform();

  // Derive content size from active artifact via registry
  const intrinsicSize = activeArtifact
    ? rendererRegistry.resolve(activeArtifact).adapter?.getIntrinsicSize(activeArtifact) ?? null
    : null;

  useEffect(() => {
    if (intrinsicSize) {
      setContent(intrinsicSize.width, intrinsicSize.height);
    }
  }, [intrinsicSize, setContent]);

  // ── Overlays ─────────────────────────────────────────────────────────────
  const [overlayStates, setOverlayStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(overlays.map((o) => [o.id, o.enabled])),
  );
  const [showOverlays, setShowOverlays] = useState(false);

  const toggleOverlays = useCallback(() => setShowOverlays((v) => !v), []);

  const activeOverlays: CanvasOverlayDefinition[] = overlays
    .map((o) => ({ ...o, enabled: showOverlays && (overlayStates[o.id] ?? o.enabled) }));

  const overlayProps: CanvasOverlayProps = { transform, artifact: activeArtifact };

  // ── Fullscreen ───────────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shellRef = React.useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      shellRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Escape to exit fullscreen ────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // ── Renderer diagnostic ──────────────────────────────────────────────────
  const resolveResult = activeArtifact ? rendererRegistry.resolve(activeArtifact) : null;
  const rendererDiagnostic = resolveResult && !resolveResult.adapter ? resolveResult.reason : null;

  // ── Current frame ────────────────────────────────────────────────────────
  const [currentFrameId, setCurrentFrameId] = useState<string | null>(null);

  const currentFrame = activeArtifact?.frames?.find((f) => f.id === currentFrameId) ?? null;

  // ── Panel visibility (responsive) ────────────────────────────────────────
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const shellId = useId();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={shellRef}
      id={shellId}
      className="flex flex-col w-full h-full bg-[#0b0c10] overflow-hidden"
      data-testid="design-workspace-shell"
    >
      {/* ── Top toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/6 bg-slate-950/80 backdrop-blur-sm shrink-0">
        {/* Left: project title + panel toggle */}
        <div className="flex items-center gap-2 min-w-0">
          {leftPanel && (
            <button
              type="button"
              onClick={() => setLeftOpen((v) => !v)}
              aria-label={leftOpen ? 'Hide left panel' : 'Show left panel'}
              aria-expanded={leftOpen}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:hidden"
            >
              <span className="text-xs">≡</span>
            </button>
          )}
          {projectTitle && (
            <span className="text-sm font-medium text-slate-300 truncate max-w-[160px] sm:max-w-xs">
              {projectTitle}
            </span>
          )}
        </div>

        {/* Center: canvas toolbar */}
        <WorkspaceToolbar
          scale={transform.scale}
          minScale={minScale}
          maxScale={maxScale}
          canGoToPreviousArtifact={activeIndex > 0}
          canGoToNextArtifact={activeIndex < artifacts.length - 1}
          overlaysEnabled={showOverlays}
          canToggleOverlays={overlays.length > 0}
          canFullscreen={typeof document !== 'undefined' && 'exitFullscreen' in document}
          isFullscreen={isFullscreen}
          extraActions={extraToolbarActions}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fit}
          onReset={reset}
          onPreviousArtifact={handlePreviousArtifact}
          onNextArtifact={handleNextArtifact}
          onToggleOverlays={toggleOverlays}
          onToggleFullscreen={toggleFullscreen}
        />

        {/* Right: panel toggle */}
        <div className="flex items-center gap-1">
          {rightPanel && (
            <button
              type="button"
              onClick={() => setRightOpen((v) => !v)}
              aria-label={rightOpen ? 'Hide right panel' : 'Show right panel'}
              aria-expanded={rightOpen}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hidden lg:flex"
            >
              <span className="text-xs">⊟</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main content area ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel slot — Team 13 (layers) */}
        {leftPanel && leftOpen && (
          <aside
            aria-label="Left panel"
            className="w-56 xl:w-64 shrink-0 border-r border-white/6 bg-slate-950/60 overflow-y-auto hidden lg:block"
          >
            {leftPanel}
          </aside>
        )}

        {/* Canvas viewport */}
        <main
          className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
          aria-label="Canvas area"
        >
          <div className="flex-1 relative min-h-0 overflow-hidden">
            <CanvasViewport
              transform={transform}
              contentWidth={intrinsicSize?.width ?? 0}
              contentHeight={intrinsicSize?.height ?? 0}
              label={`${projectTitle ?? 'Design'} canvas`}
              onZoom={zoom}
              onPan={pan}
              onFit={fit}
              onViewportResize={setViewport}
              overlayChildren={
                activeOverlays.length > 0 ? (
                  <CanvasOverlayHost overlays={activeOverlays} overlayProps={overlayProps} />
                ) : undefined
              }
            >
              <CanvasRendererHost
                artifact={activeArtifact}
                registry={rendererRegistry}
                transform={transform}
                isLoading={isLoading}
                error={error}
                frameId={currentFrameId}
                isReadOnly={!permissions.canEdit}
                onRegionSelect={handleRegionSelect}
              />
            </CanvasViewport>
          </div>

          {/* Frame/page navigation (if artifact has frames) */}
          {activeArtifact?.frames && activeArtifact.frames.length > 1 && (
            <div
              role="navigation"
              aria-label="Frame navigation"
              className="flex items-center gap-1.5 px-3 py-2 border-t border-white/6 bg-slate-950/60 overflow-x-auto scrollbar-none shrink-0"
            >
              {activeArtifact.frames.map((frame) => (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => {
                    setCurrentFrameId(frame.id);
                    _onFrameSelect?.(frame.id);
                  }}
                  aria-label={`Go to ${frame.label}`}
                  aria-current={frame.id === currentFrameId ? 'page' : undefined}
                  className={`px-3 py-1 rounded-lg text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    frame.id === currentFrameId
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {frame.label}
                </button>
              ))}
            </div>
          )}

          {/* Bottom panel slot — Team 18 (annotations timeline) */}
          {bottomPanel && (
            <aside
              aria-label="Bottom panel"
              className="shrink-0 border-t border-white/6 bg-slate-950/60 max-h-48 overflow-y-auto"
            >
              {bottomPanel}
            </aside>
          )}
        </main>

        {/* Right panel slot — Team 12 (properties) */}
        {rightPanel && rightOpen && (
          <aside
            aria-label="Right panel"
            className="w-64 xl:w-72 shrink-0 border-l border-white/6 bg-slate-950/60 overflow-y-auto hidden lg:block"
          >
            {rightPanel}
          </aside>
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <WorkspaceStatusBar
        artifact={activeArtifact}
        scale={transform.scale}
        currentFrame={currentFrame?.label ?? null}
        isReadOnly={!permissions.canEdit}
        rendererDiagnostic={rendererDiagnostic}
        isLoading={isLoading}
      />
    </div>
  );
}
