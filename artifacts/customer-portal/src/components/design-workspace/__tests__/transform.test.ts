/**
 * transform.test.ts — Pure logic tests for viewport transform utilities.
 * No DOM, no React — these run in the node environment.
 */

import { describe, it, expect } from 'vitest';
import {
  clampScale,
  clampTransform,
  calculateFitTransform,
  calculateCenterTransform,
  resetTransform,
  zoomAroundPoint,
  panByKeyboard,
  serializeTransform,
  deserializeTransform,
  transformToCss,
  CANVAS_MIN_SCALE,
  CANVAS_MAX_SCALE,
  CANVAS_PAN_STEP,
  DEFAULT_TRANSFORM,
} from '../utils/transform';
import type { CanvasTransform } from '../types';

// ── clampScale ────────────────────────────────────────────────────────────────

describe('clampScale', () => {
  it('allows values within range', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2)).toBe(2);
  });

  it('clamps to min', () => {
    expect(clampScale(0)).toBe(CANVAS_MIN_SCALE);
    expect(clampScale(-1)).toBe(CANVAS_MIN_SCALE);
    expect(clampScale(0.001)).toBe(CANVAS_MIN_SCALE);
  });

  it('clamps to max', () => {
    expect(clampScale(100)).toBe(CANVAS_MAX_SCALE);
    expect(clampScale(CANVAS_MAX_SCALE + 1)).toBe(CANVAS_MAX_SCALE);
  });

  it('handles NaN and Infinity as 1', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(CANVAS_MAX_SCALE);
    expect(clampScale(-Infinity)).toBe(CANVAS_MIN_SCALE);
  });
});

// ── calculateFitTransform ─────────────────────────────────────────────────────

describe('calculateFitTransform', () => {
  it('fits portrait content into landscape viewport', () => {
    // 400×800 content → 800×600 viewport
    const t = calculateFitTransform(800, 600, 400, 800);
    // Scale should be limited by height: (600-48)/800 = 0.69
    expect(t.scale).toBeCloseTo((600 - 48) / 800, 2);
    expect(t.scale).toBeLessThanOrEqual(1);
    // Content should be horizontally centered
    expect(t.offsetX).toBeGreaterThan(0);
  });

  it('fits landscape content into portrait viewport', () => {
    // 1200×400 content → 400×800 viewport
    const t = calculateFitTransform(400, 800, 1200, 400);
    expect(t.scale).toBeCloseTo((400 - 48) / 1200, 2);
    expect(t.scale).toBeLessThanOrEqual(1);
    expect(t.offsetY).toBeGreaterThan(0); // vertically centered
  });

  it('returns default transform for zero viewport', () => {
    const t = calculateFitTransform(0, 0, 1024, 1024);
    expect(t).toEqual(DEFAULT_TRANSFORM);
  });

  it('returns default transform for zero content', () => {
    const t = calculateFitTransform(800, 600, 0, 0);
    expect(t).toEqual(DEFAULT_TRANSFORM);
  });

  it('clamps scale to min', () => {
    // Huge content into tiny viewport
    const t = calculateFitTransform(10, 10, 1_000_000, 1_000_000);
    expect(t.scale).toBeGreaterThanOrEqual(CANVAS_MIN_SCALE);
  });

  it('fits square content symmetrically', () => {
    const t = calculateFitTransform(800, 800, 400, 400);
    expect(t.offsetX).toBeCloseTo(t.offsetY, 1);
  });
});

// ── clampTransform ────────────────────────────────────────────────────────────

describe('clampTransform', () => {
  it('allows transform within bounds', () => {
    const t: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    const result = clampTransform(t, 800, 600, 400, 400);
    expect(result).toEqual(t);
  });

  it('clamps offsetX to keep content visible', () => {
    const t: CanvasTransform = { scale: 1, offsetX: -10000, offsetY: 0 };
    const result = clampTransform(t, 800, 600, 400, 400);
    expect(result.offsetX).toBeGreaterThan(-10000);
  });

  it('clamps offsetY to keep content visible', () => {
    const t: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 10000 };
    const result = clampTransform(t, 800, 600, 400, 400);
    expect(result.offsetY).toBeLessThan(10000);
  });

  it('returns transform unchanged when dimensions are zero', () => {
    const t: CanvasTransform = { scale: 1, offsetX: 999, offsetY: 999 };
    expect(clampTransform(t, 0, 600, 400, 400)).toEqual(t);
    expect(clampTransform(t, 800, 0, 400, 400)).toEqual(t);
    expect(clampTransform(t, 800, 600, 0, 400)).toEqual(t);
  });
});

// ── resetTransform ────────────────────────────────────────────────────────────

describe('resetTransform', () => {
  it('returns 1:1 at origin', () => {
    const t = resetTransform();
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
  });

  it('returns a new object (no mutation)', () => {
    expect(resetTransform()).not.toBe(resetTransform());
  });
});

// ── zoomAroundPoint ───────────────────────────────────────────────────────────

describe('zoomAroundPoint', () => {
  it('zooms around center keeping center stationary', () => {
    const base: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    // Focal point at (200, 150)
    const t = zoomAroundPoint(base, 2, 200, 150);
    expect(t.scale).toBe(2);
    // After doubling zoom at (200,150), content point under (200,150) should stay
    // content-coords: (200-0)/1 = 200, after: offsetX + 200*scale = 200
    // => offsetX = 200 - 200*2 = -200
    expect(t.offsetX).toBe(-200);
    expect(t.offsetY).toBe(-150);
  });

  it('clamps the resulting scale', () => {
    const base: CanvasTransform = { scale: CANVAS_MAX_SCALE, offsetX: 0, offsetY: 0 };
    const t = zoomAroundPoint(base, CANVAS_MAX_SCALE * 10, 0, 0);
    expect(t.scale).toBe(CANVAS_MAX_SCALE);
  });

  it('handles zero focal point (viewport origin)', () => {
    // focal (0,0): new_offset = 0 - ratio*(0 - old_offset) = ratio * old_offset
    const base: CanvasTransform = { scale: 1, offsetX: 100, offsetY: 50 };
    const t = zoomAroundPoint(base, 2, 0, 0);
    expect(t.scale).toBe(2);
    // ratio=2: offsetX = 0 - 2*(0 - 100) = 200
    expect(t.offsetX).toBe(200);
    // ratio=2: offsetY = 0 - 2*(0 - 50) = 100
    expect(t.offsetY).toBe(100);
  });
});

// ── panByKeyboard ─────────────────────────────────────────────────────────────

describe('panByKeyboard', () => {
  it('pans right by one step', () => {
    const base: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    const t = panByKeyboard(base, 1, 0);
    expect(t.offsetX).toBe(CANVAS_PAN_STEP);
    expect(t.offsetY).toBe(0);
    expect(t.scale).toBe(1);
  });

  it('pans up (negative dy)', () => {
    const base: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    const t = panByKeyboard(base, 0, -1);
    expect(t.offsetY).toBe(-CANVAS_PAN_STEP);
  });

  it('does not change scale', () => {
    const base: CanvasTransform = { scale: 2.5, offsetX: 0, offsetY: 0 };
    const t = panByKeyboard(base, 1, 1);
    expect(t.scale).toBe(2.5);
  });
});

// ── transformToCss ────────────────────────────────────────────────────────────

describe('transformToCss', () => {
  it('produces correct CSS string', () => {
    const t: CanvasTransform = { scale: 1.5, offsetX: 100, offsetY: -20 };
    expect(transformToCss(t)).toBe('translate(100px, -20px) scale(1.5)');
  });

  it('handles zero transform', () => {
    expect(transformToCss({ scale: 1, offsetX: 0, offsetY: 0 })).toBe('translate(0px, 0px) scale(1)');
  });
});

// ── Serialization ─────────────────────────────────────────────────────────────

describe('serializeTransform / deserializeTransform', () => {
  it('roundtrips a valid transform', () => {
    const t: CanvasTransform = { scale: 1.25, offsetX: 100, offsetY: -50 };
    const s = serializeTransform(t);
    const out = deserializeTransform(s);
    expect(out).not.toBeNull();
    expect(out!.scale).toBeCloseTo(1.25);
    expect(out!.offsetX).toBe(100);
    expect(out!.offsetY).toBe(-50);
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeTransform('{invalid')).toBeNull();
    expect(deserializeTransform('null')).toBeNull();
    expect(deserializeTransform('"string"')).toBeNull();
  });

  it('clamps out-of-range scale during deserialize', () => {
    const s = JSON.stringify({ scale: 999, offsetX: 0, offsetY: 0 });
    const out = deserializeTransform(s);
    expect(out!.scale).toBe(CANVAS_MAX_SCALE);
  });

  it('returns null for missing fields', () => {
    expect(deserializeTransform(JSON.stringify({ scale: 1 }))).toBeNull();
    expect(deserializeTransform(JSON.stringify({ offsetX: 0, offsetY: 0 }))).toBeNull();
  });
});

// ── calculateCenterTransform ──────────────────────────────────────────────────

describe('calculateCenterTransform', () => {
  it('centers content at 1:1 scale', () => {
    const t = calculateCenterTransform(800, 600, 400, 300);
    expect(t.scale).toBe(1);
    expect(t.offsetX).toBe(200); // (800-400)/2
    expect(t.offsetY).toBe(150); // (600-300)/2
  });
});
