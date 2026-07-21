/**
 * registry.test.ts — CanvasRendererRegistry tests.
 * No DOM, no React rendering — tests the registry class logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { CanvasRendererRegistry } from '../renderers/registry';
import type { CanvasArtifact, CanvasRendererAdapter } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArtifact(type: string, id = 'a1'): CanvasArtifact {
  return {
    id,
    type,
    title: `Test artifact ${id}`,
    status: 'ready',
  };
}

function makeAdapter(
  id: string,
  types: string[],
  priority = 0,
): CanvasRendererAdapter {
  return {
    rendererId: id,
    supportedArtifactTypes: types,
    priority,
    canRender: (a) => types.includes(a.type),
    Component: vi.fn() as unknown as CanvasRendererAdapter['Component'],
    getIntrinsicSize: () => ({ width: 100, height: 100 }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

describe('CanvasRendererRegistry — registration', () => {
  it('registers a valid adapter', () => {
    const registry = new CanvasRendererRegistry();
    const adapter = makeAdapter('test:image', ['image']);
    registry.register(adapter);
    expect(registry.has('test:image')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('rejects duplicate rendererId', () => {
    const registry = new CanvasRendererRegistry();
    const a1 = makeAdapter('dup', ['image']);
    const a2 = makeAdapter('dup', ['pdf']);
    registry.register(a1);
    expect(() => registry.register(a2)).toThrow(/Duplicate rendererId/);
  });

  it('rejects adapter with empty rendererId', () => {
    const registry = new CanvasRendererRegistry();
    const bad = makeAdapter('', ['image']);
    expect(() => registry.register(bad)).toThrow(/rendererId must be a non-empty string/);
  });

  it('rejects adapter with non-array supportedArtifactTypes', () => {
    const registry = new CanvasRendererRegistry();
    const bad = {
      ...makeAdapter('bad', ['image']),
      supportedArtifactTypes: 'image' as unknown as string[],
    };
    expect(() => registry.register(bad)).toThrow(/supportedArtifactTypes must be an array/);
  });

  it('rejects adapter with missing canRender function', () => {
    const registry = new CanvasRendererRegistry();
    const bad = {
      ...makeAdapter('bad2', ['image']),
      canRender: null as unknown as CanvasRendererAdapter['canRender'],
    };
    expect(() => registry.register(bad)).toThrow(/canRender must be a function/);
  });

  it('rejects adapter with missing Component', () => {
    const registry = new CanvasRendererRegistry();
    const bad = {
      ...makeAdapter('bad3', ['image']),
      Component: null as unknown as CanvasRendererAdapter['Component'],
    };
    expect(() => registry.register(bad)).toThrow(/Component must be a React component/);
  });

  it('rejects invalid adapter object', () => {
    const registry = new CanvasRendererRegistry();
    expect(() => registry.register(null as unknown as CanvasRendererAdapter)).toThrow();
  });

  it('returns this for chaining', () => {
    const registry = new CanvasRendererRegistry();
    const a = makeAdapter('chain1', ['image']);
    const b = makeAdapter('chain2', ['pdf']);
    expect(() => registry.register(a).register(b)).not.toThrow();
    expect(registry.size).toBe(2);
  });
});

// ── Resolution ────────────────────────────────────────────────────────────────

describe('CanvasRendererRegistry — resolve', () => {
  it('resolves a supported artifact', () => {
    const registry = new CanvasRendererRegistry();
    const adapter = makeAdapter('test:image', ['image'], 10);
    registry.register(adapter);

    const result = registry.resolve(makeArtifact('image'));
    expect(result.adapter).not.toBeNull();
    expect(result.adapter!.rendererId).toBe('test:image');
  });

  it('returns null adapter for unsupported artifact', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('test:image', ['image'], 10));

    const result = registry.resolve(makeArtifact('3d_model'));
    expect(result.adapter).toBeNull();
    expect((result as { adapter: null; reason: string }).reason).toContain('3d_model');
  });

  it('includes registered renderer IDs in failure reason', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('r:img', ['image'], 10));

    const result = registry.resolve(makeArtifact('unknown'));
    expect((result as { adapter: null; reason: string }).reason).toContain('r:img');
  });

  it('returns failure reason when no renderers registered', () => {
    const registry = new CanvasRendererRegistry();
    const result = registry.resolve(makeArtifact('image'));
    expect(result.adapter).toBeNull();
    expect((result as { adapter: null; reason: string }).reason).toContain('no renderers registered');
  });

  it('resolves higher-priority adapter over lower', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('low-prio', ['image'], 1));
    registry.register(makeAdapter('high-prio', ['image'], 100));

    const result = registry.resolve(makeArtifact('image'));
    expect(result.adapter!.rendererId).toBe('high-prio');
  });

  it('resolves deterministically (same result on repeated calls)', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('r1', ['image'], 5));
    registry.register(makeAdapter('r2', ['image'], 3));

    const a = registry.resolve(makeArtifact('image'));
    const b = registry.resolve(makeArtifact('image'));
    expect(a.adapter!.rendererId).toBe(b.adapter!.rendererId);
  });

  it('uses insertion order as tiebreaker when priorities equal', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('first', ['image'], 0));
    registry.register(makeAdapter('second', ['image'], 0));

    // First registered wins on tie
    const result = registry.resolve(makeArtifact('image'));
    expect(result.adapter!.rendererId).toBe('first');
  });

  it('does not mutate the artifact during resolve', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('r', ['image'], 0));
    const artifact = makeArtifact('image');
    const before = JSON.stringify(artifact);
    registry.resolve(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
  });
});

// ── getAll ────────────────────────────────────────────────────────────────────

describe('CanvasRendererRegistry — getAll', () => {
  it('returns all registered adapters in insertion order', () => {
    const registry = new CanvasRendererRegistry();
    const a = makeAdapter('a', ['image']);
    const b = makeAdapter('b', ['pdf']);
    registry.register(a).register(b);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].rendererId).toBe('a');
    expect(all[1].rendererId).toBe('b');
  });

  it('returns a snapshot (modifying result does not affect registry)', () => {
    const registry = new CanvasRendererRegistry();
    registry.register(makeAdapter('r', ['image']));

    const all = registry.getAll() as CanvasRendererAdapter[];
    all.push(makeAdapter('injected', ['pdf']));
    expect(registry.size).toBe(1);
  });
});

// ── IMAGE_RENDERER adapter ────────────────────────────────────────────────────

describe('IMAGE_RENDERER', () => {
  it('can render "image" type', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    expect(IMAGE_RENDERER.canRender(makeArtifact('image'))).toBe(true);
  });

  it('can render "preview_image" type', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    expect(IMAGE_RENDERER.canRender(makeArtifact('preview_image'))).toBe(true);
  });

  it('cannot render "pdf" type', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    expect(IMAGE_RENDERER.canRender(makeArtifact('pdf'))).toBe(false);
  });

  it('returns intrinsic size from metadata', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    const artifact: CanvasArtifact = {
      id: 'x',
      type: 'image',
      title: 'test',
      status: 'ready',
      metadata: { width: 1920, height: 1080 },
    };
    expect(IMAGE_RENDERER.getIntrinsicSize(artifact)).toEqual({ width: 1920, height: 1080 });
  });

  it('returns default size when metadata missing', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    const size = IMAGE_RENDERER.getIntrinsicSize(makeArtifact('image'));
    expect(size!.width).toBeGreaterThan(0);
    expect(size!.height).toBeGreaterThan(0);
  });
});

// ── FALLBACK_RENDERER adapter ─────────────────────────────────────────────────

describe('FALLBACK_RENDERER', () => {
  it('can render any artifact type', async () => {
    const { FALLBACK_RENDERER } = await import('../renderers/FallbackRenderer');
    expect(FALLBACK_RENDERER.canRender(makeArtifact('unknown'))).toBe(true);
    expect(FALLBACK_RENDERER.canRender(makeArtifact('3d_model'))).toBe(true);
    expect(FALLBACK_RENDERER.canRender(makeArtifact('pdf'))).toBe(true);
  });

  it('has priority -999 (lowest)', async () => {
    const { FALLBACK_RENDERER } = await import('../renderers/FallbackRenderer');
    expect(FALLBACK_RENDERER.priority).toBe(-999);
  });

  it('is not chosen over a specialist renderer', async () => {
    const { IMAGE_RENDERER } = await import('../renderers/ImageRenderer');
    const { FALLBACK_RENDERER } = await import('../renderers/FallbackRenderer');
    const registry = new CanvasRendererRegistry();
    registry.register(IMAGE_RENDERER).register(FALLBACK_RENDERER);

    const result = registry.resolve(makeArtifact('image'));
    expect(result.adapter!.rendererId).toBe('builtin:image');
  });
});

// ── Selection state ───────────────────────────────────────────────────────────

describe('selectionReducer', () => {
  it('selects artifact and clears frame/region', async () => {
    const { selectionReducer, initialSelection } = await import('../state/selection');
    const state = initialSelection('a1');
    const next = selectionReducer(
      { ...state, frameId: 'f1', regionId: 'r1' },
      { type: 'SELECT_ARTIFACT', artifactId: 'a2' },
    );
    expect(next.artifactId).toBe('a2');
    expect(next.frameId).toBeNull();
    expect(next.regionId).toBeNull();
  });

  it('selects frame preserving artifact', async () => {
    const { selectionReducer, initialSelection } = await import('../state/selection');
    const state = { ...initialSelection('a1'), source: 'programmatic' as const };
    const next = selectionReducer(state, { type: 'SELECT_FRAME', frameId: 'f2' });
    expect(next.artifactId).toBe('a1');
    expect(next.frameId).toBe('f2');
    expect(next.regionId).toBeNull();
  });

  it('clears all selection', async () => {
    const { selectionReducer, EMPTY_SELECTION } = await import('../state/selection');
    // import EMPTY_SELECTION from types
    const state = { artifactId: 'a1', frameId: 'f1', regionId: 'r1', source: 'user' as const };
    const next = selectionReducer(state, { type: 'CLEAR' });
    expect(next.artifactId).toBeNull();
    expect(next.frameId).toBeNull();
    expect(next.regionId).toBeNull();
  });
});
