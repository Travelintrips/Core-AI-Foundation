/**
 * design-workspace/hooks/use-canvas-transform.ts
 * React reducer hook for viewport transform state.
 * Keeps server state, UI state, transform state, and selection state SEPARATE
 * (per TASK K). This hook owns only transform state.
 */

import { useReducer, useCallback, useRef } from 'react';
import type { CanvasTransform } from '../types';
import {
  clampScale,
  clampTransform,
  calculateFitTransform,
  resetTransform,
  zoomAroundPoint,
  CANVAS_MIN_SCALE,
  CANVAS_MAX_SCALE,
  DEFAULT_TRANSFORM,
} from '../utils/transform';

// ── State & actions ───────────────────────────────────────────────────────────

interface TransformState {
  transform: CanvasTransform;
  viewportW: number;
  viewportH: number;
  contentW: number;
  contentH: number;
}

type TransformAction =
  | { type: 'SET_VIEWPORT'; width: number; height: number }
  | { type: 'SET_CONTENT'; width: number; height: number }
  | { type: 'ZOOM'; scale: number; focalX?: number; focalY?: number }
  | { type: 'PAN'; dx: number; dy: number }
  | { type: 'FIT' }
  | { type: 'RESET' }
  | { type: 'SET'; transform: CanvasTransform };

const INITIAL_STATE: TransformState = {
  transform: DEFAULT_TRANSFORM,
  viewportW: 0,
  viewportH: 0,
  contentW: 0,
  contentH: 0,
};

function reducer(state: TransformState, action: TransformAction): TransformState {
  switch (action.type) {
    case 'SET_VIEWPORT':
      return { ...state, viewportW: action.width, viewportH: action.height };

    case 'SET_CONTENT':
      return { ...state, contentW: action.width, contentH: action.height };

    case 'ZOOM': {
      const fX = action.focalX ?? state.viewportW / 2;
      const fY = action.focalY ?? state.viewportH / 2;
      const t = zoomAroundPoint(state.transform, action.scale, fX, fY);
      return {
        ...state,
        transform: clampTransform(t, state.viewportW, state.viewportH, state.contentW, state.contentH),
      };
    }

    case 'PAN': {
      const t: CanvasTransform = {
        ...state.transform,
        offsetX: state.transform.offsetX + action.dx,
        offsetY: state.transform.offsetY + action.dy,
      };
      return {
        ...state,
        transform: clampTransform(t, state.viewportW, state.viewportH, state.contentW, state.contentH),
      };
    }

    case 'FIT': {
      const t = calculateFitTransform(
        state.viewportW,
        state.viewportH,
        state.contentW,
        state.contentH,
      );
      return { ...state, transform: t };
    }

    case 'RESET':
      return { ...state, transform: resetTransform() };

    case 'SET': {
      const t = clampTransform(
        action.transform,
        state.viewportW,
        state.viewportH,
        state.contentW,
        state.contentH,
      );
      return { ...state, transform: t };
    }

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseCanvasTransformReturn {
  transform: CanvasTransform;
  viewportW: number;
  viewportH: number;
  contentW: number;
  contentH: number;
  minScale: number;
  maxScale: number;
  /** Zoom to an absolute scale value, optionally around a focal point (viewport coords). */
  zoom: (scale: number, focalX?: number, focalY?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Pan by dx/dy pixels. */
  pan: (dx: number, dy: number) => void;
  /** Fit content into viewport. */
  fit: () => void;
  /** Reset to 1:1 at origin. */
  reset: () => void;
  setViewport: (width: number, height: number) => void;
  setContent: (width: number, height: number) => void;
  setTransform: (t: CanvasTransform) => void;
}

const ZOOM_STEP = 1.25;

export function useCanvasTransform(): UseCanvasTransformReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const zoom = useCallback((scale: number, focalX?: number, focalY?: number) => {
    dispatch({ type: 'ZOOM', scale: clampScale(scale), focalX, focalY });
  }, []);

  // Use a ref to always access the latest scale in zoomIn/zoomOut without
  // adding scale to their dependency arrays (avoids stale closure).
  const scaleRef = useRef(state.transform.scale);
  scaleRef.current = state.transform.scale;

  const zoomIn = useCallback(() => {
    dispatch({ type: 'ZOOM', scale: clampScale(scaleRef.current * ZOOM_STEP) });
  }, []);

  const zoomOut = useCallback(() => {
    dispatch({ type: 'ZOOM', scale: clampScale(scaleRef.current / ZOOM_STEP) });
  }, []);

  const pan = useCallback((dx: number, dy: number) => {
    dispatch({ type: 'PAN', dx, dy });
  }, []);

  const fit = useCallback(() => {
    dispatch({ type: 'FIT' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const setViewport = useCallback((width: number, height: number) => {
    dispatch({ type: 'SET_VIEWPORT', width, height });
  }, []);

  const setContent = useCallback((width: number, height: number) => {
    dispatch({ type: 'SET_CONTENT', width, height });
  }, []);

  const setTransform = useCallback((t: CanvasTransform) => {
    dispatch({ type: 'SET', transform: t });
  }, []);

  return {
    transform: state.transform,
    viewportW: state.viewportW,
    viewportH: state.viewportH,
    contentW: state.contentW,
    contentH: state.contentH,
    minScale: CANVAS_MIN_SCALE,
    maxScale: CANVAS_MAX_SCALE,
    zoom,
    zoomIn,
    zoomOut,
    pan,
    fit,
    reset,
    setViewport,
    setContent,
    setTransform,
  };
}
