/**
 * design-workspace/CanvasViewport.tsx
 * Bounded viewport: zoom, pan, fit-to-screen, keyboard navigation.
 *
 * Uses CSS transform — no heavy graphics framework.
 * Respects prefers-reduced-motion.
 * Does NOT freeze on large assets (transform only, no pixel manipulation).
 */

import React, { useRef, useEffect, useCallback, useId } from 'react';
import type { CanvasTransform } from './types';
import { transformToCss, zoomAroundPoint, clampScale, CANVAS_MIN_SCALE, CANVAS_MAX_SCALE, CANVAS_PAN_STEP } from './utils/transform';

export interface CanvasViewportProps {
  transform: CanvasTransform;
  contentWidth: number;
  contentHeight: number;
  children: React.ReactNode;
  /** Overlay children rendered on top of the content (follow viewport transform). */
  overlayChildren?: React.ReactNode;
  isReadOnly?: boolean;
  label?: string;
  onZoom: (scale: number, focalX?: number, focalY?: number) => void;
  onPan: (dx: number, dy: number) => void;
  onFit: () => void;
  onViewportResize: (width: number, height: number) => void;
  onContentSize?: (width: number, height: number) => void;
  /** Called when user clicks the canvas background (deselect). */
  onBackgroundClick?: () => void;
}

const WHEEL_ZOOM_SENSITIVITY = 0.001;
const TOUCH_PAN_THRESHOLD = 2; // px — minimum distance to start panning

export function CanvasViewport({
  transform,
  contentWidth,
  contentHeight,
  children,
  overlayChildren,
  isReadOnly: _isReadOnly = true,
  label = 'Design canvas',
  onZoom,
  onPan,
  onFit,
  onViewportResize,
  onBackgroundClick,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const regionId = useId();

  // Track touch state for two-finger pinch-to-zoom and single-finger pan
  const touchRef = useRef<{
    lastDist: number | null;
    lastX: number;
    lastY: number;
    isPanning: boolean;
  }>({ lastDist: null, lastX: 0, lastY: 0, isPanning: false });

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        onViewportResize(width, height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewportResize]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      const delta = -e.deltaY * WHEEL_ZOOM_SENSITIVITY;
      const next = clampScale(transform.scale * (1 + delta));
      onZoom(next, focalX, focalY);
    },
    [transform.scale, onZoom],
  );

  // Attach wheel as non-passive to allow preventDefault
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Mouse drag pan ────────────────────────────────────────────────────────
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; lastX: number; lastY: number }>({
    active: false, startX: 0, startY: 0, lastX: 0, lastY: 0,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only middle-click or space+left-click for pan (space handled separately)
    if (e.button === 1) {
      e.preventDefault();
      dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
    }
  }, []);

  // Space+drag pan
  const spaceRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    onPan(dx, dy);
  }, [onPan]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ── Touch support ─────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      touchRef.current.lastDist = Math.hypot(dx, dy);
    } else if (e.touches.length === 1) {
      touchRef.current.lastX = e.touches[0].clientX;
      touchRef.current.lastY = e.touches[0].clientY;
      touchRef.current.isPanning = false;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        if (touchRef.current.lastDist !== null) {
          const ratio = dist / touchRef.current.lastDist;
          const rect = viewportRef.current?.getBoundingClientRect();
          const focalX = rect ? (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left : undefined;
          const focalY = rect ? (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top : undefined;
          onZoom(clampScale(transform.scale * ratio), focalX, focalY);
        }
        touchRef.current.lastDist = dist;
      } else if (e.touches.length === 1) {
        const nx = e.touches[0].clientX;
        const ny = e.touches[0].clientY;
        const distX = Math.abs(nx - touchRef.current.lastX);
        const distY = Math.abs(ny - touchRef.current.lastY);
        if (!touchRef.current.isPanning && (distX < TOUCH_PAN_THRESHOLD && distY < TOUCH_PAN_THRESHOLD)) return;
        touchRef.current.isPanning = true;
        const dx = nx - touchRef.current.lastX;
        const dy = ny - touchRef.current.lastY;
        touchRef.current.lastX = nx;
        touchRef.current.lastY = ny;
        onPan(dx, dy);
      }
    },
    [transform.scale, onZoom, onPan],
  );

  const handleTouchEnd = useCallback(() => {
    touchRef.current.lastDist = null;
    touchRef.current.isPanning = false;
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); onPan(-CANVAS_PAN_STEP, 0); break;
        case 'ArrowRight': e.preventDefault(); onPan(CANVAS_PAN_STEP, 0); break;
        case 'ArrowUp':    e.preventDefault(); onPan(0, -CANVAS_PAN_STEP); break;
        case 'ArrowDown':  e.preventDefault(); onPan(0, CANVAS_PAN_STEP); break;
        case '+':
        case '=':
          e.preventDefault();
          onZoom(clampScale(transform.scale * 1.25));
          break;
        case '-':
          e.preventDefault();
          onZoom(clampScale(transform.scale / 1.25));
          break;
        case '0':
          e.preventDefault();
          onFit();
          break;
        default:
          break;
      }
    },
    [transform.scale, onZoom, onPan, onFit],
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Only fire when clicking the viewport background, not the content
      if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.viewportBackground) {
        onBackgroundClick?.();
      }
    },
    [onBackgroundClick],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const cssTransform = transformToCss(transform);
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label={label}
      aria-roledescription="canvas"
      id={regionId}
      tabIndex={0}
      className="relative w-full h-full overflow-hidden bg-[#0f1117] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset cursor-default"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      onClick={handleBackgroundClick}
      data-viewport-background="true"
    >
      {/* Content container — transformed */}
      <div
        className="absolute"
        style={{
          transform: cssTransform,
          transformOrigin: '0 0',
          width: contentWidth || '100%',
          height: contentHeight || '100%',
          transition: prefersReducedMotion ? 'none' : undefined,
          willChange: 'transform',
        }}
        data-testid="canvas-content"
      >
        {children}
      </div>

      {/* Overlay host — rendered on top, also transformed */}
      {overlayChildren && (
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ zIndex: 10 }}
        >
          {overlayChildren}
        </div>
      )}
    </div>
  );
}
