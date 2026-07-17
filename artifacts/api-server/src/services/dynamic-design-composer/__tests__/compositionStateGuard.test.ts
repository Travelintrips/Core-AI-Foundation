/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: compositionStateGuard.ts + compositionSessionStore.ts
 *
 * Covers per remediation P1/P2 requirements:
 *   - completed → reprocess ditolak / return existing
 *   - cancelled → process ditolak
 *   - failed    → hanya retry path resmi
 *   - processing → blocked (concurrent guard)
 *   - tenant A membaca job tenant B → 404 equivalent (null)
 *   - identical idempotency key → job existing
 *   - Team 13 tidak menjalankan layout solver sendiri
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  guardCompositionState,
  validateTransition,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
} from "../compositionStateGuard.js";
import {
  getSession,
  createSession,
  transitionSession,
  deleteSession,
  sessionCount,
  clearStore,
} from "../compositionSessionStore.js";
import { compose } from "../composerEngine.js";
import type { CompositionSession, CompositionState, DesignCompositionSpec, LayoutPlanInput } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SPEC: DesignCompositionSpec = {
  compositionId: "test-hash-abc123",
  version: "1.0",
  blueprint: { name: "Test", columns: 12, rows: 0, gutter: 24, maxWidth: 1280, orientation: "portrait", medium: "digital" },
  layout: { name: "Hero", strategy: "hero-content", flow: "vertical", heroWeight: 0.4, sectionCount: 3, hasSidebar: false, emphasis: "balanced" },
  palette: { name: "Blue", primary: "#1E3A5F", secondary: "#2D6A9F", accent: "#F4A261", background: "#FFFFFF", surface: "#F8F9FA", text: "#1A1A2E", textMuted: "#6C757D", mood: "neutral" },
  typography: { name: "Inter", headingFont: "Inter", bodyFont: "Inter", headingWeight: "700", bodyWeight: "400", baseSize: 16, scaleRatio: 1.25, lineHeight: 1.6, letterSpacing: "normal", style: "sans-serif" },
  components: [],
  pattern: { name: "None", type: "none", intensity: 0, placement: "background", tile: false },
  decoration: { name: "Clean", borderRadius: "medium", borderStyle: "none", shadowDepth: "low", dividerStyle: "line", useGradients: false, overlayOpacity: 0 },
  material: { name: "Flat", surface: "flat", texture: "smooth", elevation: "low", opacity: "solid", blendMode: "normal" },
  motif: { name: "Abstract", theme: "abstract", repetition: "none", scale: "small", colorTreatment: "monochrome" },
  derivedTokens: { spacingUnit: 4, spacingScale: [], fontSizeScale: {}, borderRadiusMap: {}, shadowMap: {}, zIndexLayers: {}, breakpoints: {} },
  styleConsistencyScore: 100,
  brandConsistencyScore: 100,
  brandConsistency: { score: 100, colorAlignment: { score: 100, issues: [], suggestions: [] }, typographyAlignment: { score: 100, issues: [], suggestions: [] }, layoutAlignment: { score: 100, issues: [], suggestions: [] }, personalityAlignment: { score: 100, traits: [], mismatches: [] } },
  compatibility: { score: 100, materialPatternCompatible: true, layoutComponentCompatible: true, paletteTypographyCompatible: true, decorationMaterialCompatible: true, issues: [] },
  explainability: { layout: { chosen: "hero-content", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, palette: { chosen: "neutral", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, typography: { chosen: "sans-serif", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, pattern: { chosen: "none", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, components: [], decoration: { chosen: "medium", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, material: { chosen: "flat", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, motif: { chosen: "abstract", why: "test", brandSignal: null, alternativesRejected: [], overridden: false }, compositionRationale: "test" },
  fallbacksApplied: [],
  hasNoAssetFallbacks: false,
  composedAt: "2026-01-01T00:00:00.000Z",
};

function makeSession(state: CompositionState, tenantId = "tenant-A", key = "key-1"): CompositionSession {
  return {
    sessionId: "session-id",
    tenantId,
    idempotencyKey: key,
    state,
    result: state === "completed" ? MOCK_SPEC : undefined,
    failureReason: state === "failed" ? "Previous error" : undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const MINIMAL_REQUEST = {
  blueprint: { name: "Test", columns: 12, rows: 0, gutter: 24, maxWidth: 1280, orientation: "portrait" as const, medium: "digital" as const },
  layoutPlan: { name: "Hero", strategy: "hero-content" as const, flow: "vertical" as const, heroWeight: 0.4, sectionCount: 3, hasSidebar: false, emphasis: "balanced" as const },
  components: [],
  pattern: { name: "None", type: "none" as const, intensity: 0, placement: "background" as const, tile: false },
  palette: { name: "Blue", primary: "#1E3A5F", secondary: "#2D6A9F", accent: "#F4A261", background: "#FFFFFF", surface: "#F8F9FA", text: "#1A1A2E", textMuted: "#6C757D", mood: "neutral" as const },
  typography: { name: "Inter", headingFont: "Inter", bodyFont: "Inter", headingWeight: "700" as const, bodyWeight: "400" as const, baseSize: 16, scaleRatio: 1.25, lineHeight: 1.6, letterSpacing: "normal" as const, style: "sans-serif" as const },
  decoration: { name: "Clean", borderRadius: "medium" as const, borderStyle: "none" as const, shadowDepth: "low" as const, dividerStyle: "line" as const, useGradients: false, overlayOpacity: 0 },
  material: { name: "Flat", surface: "flat" as const, texture: "smooth" as const, elevation: "low" as const, opacity: "solid" as const, blendMode: "normal" as const },
  motif: { name: "Abstract", theme: "abstract" as const, repetition: "none" as const, scale: "small" as const, colorTreatment: "monochrome" as const },
};

// ── guardCompositionState ─────────────────────────────────────────────────────

describe("guardCompositionState", () => {
  describe("completed → reprocess ditolak, return existing spec", () => {
    it("returns ALREADY_COMPLETED with the existing result", () => {
      const session = makeSession("completed");
      const err = guardCompositionState(session, false);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("ALREADY_COMPLETED");
      expect(err!.state).toBe("completed");
      expect((err as any).existingResult).toBe(MOCK_SPEC);
    });

    it("never returns null for completed state — even with allowRetry=true", () => {
      const session = makeSession("completed");
      const err = guardCompositionState(session, true);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("ALREADY_COMPLETED");
    });

    it("always blocks reprocessing regardless of retry flag", () => {
      for (const retry of [true, false]) {
        const err = guardCompositionState(makeSession("completed"), retry);
        expect(err?.code).toBe("ALREADY_COMPLETED");
      }
    });
  });

  describe("cancelled → process ditolak, always", () => {
    it("returns CANCELLED error", () => {
      const err = guardCompositionState(makeSession("cancelled"), false);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("CANCELLED");
      expect(err!.state).toBe("cancelled");
    });

    it("still blocks even with allowRetry=true", () => {
      const err = guardCompositionState(makeSession("cancelled"), true);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("CANCELLED");
    });

    it("error message tells caller to create a new request", () => {
      const err = guardCompositionState(makeSession("cancelled"), false);
      expect((err as any).message).toMatch(/new request/i);
    });
  });

  describe("failed → hanya retry path resmi", () => {
    it("returns FAILED_NO_RETRY when allowRetry=false", () => {
      const err = guardCompositionState(makeSession("failed"), false);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("FAILED_NO_RETRY");
      expect(err!.state).toBe("failed");
    });

    it("includes the failure reason in the error", () => {
      const err = guardCompositionState(makeSession("failed"), false);
      expect((err as any).failureReason).toBe("Previous error");
    });

    it("returns null (allow) when allowRetry=true — official retry path", () => {
      const err = guardCompositionState(makeSession("failed"), true);
      expect(err).toBeNull();
    });

    it("error message instructs caller to set allowRetry=true", () => {
      const err = guardCompositionState(makeSession("failed"), false);
      expect((err as any).message).toMatch(/allowRetry/i);
    });
  });

  describe("processing → concurrent execution blocked", () => {
    it("returns IN_PROGRESS", () => {
      const err = guardCompositionState(makeSession("processing"), false);
      expect(err).not.toBeNull();
      expect(err!.code).toBe("IN_PROGRESS");
    });

    it("blocks even with allowRetry=true", () => {
      const err = guardCompositionState(makeSession("processing"), true);
      expect(err?.code).toBe("IN_PROGRESS");
    });
  });

  describe("pending → proceed", () => {
    it("returns null — execution allowed", () => {
      const err = guardCompositionState(makeSession("pending"), false);
      expect(err).toBeNull();
    });
  });
});

// ── validateTransition ────────────────────────────────────────────────────────

describe("validateTransition", () => {
  it("allows pending → processing", () => expect(validateTransition("pending", "processing")).toBe(true));
  it("allows pending → cancelled", () => expect(validateTransition("pending", "cancelled")).toBe(true));
  it("allows processing → completed", () => expect(validateTransition("processing", "completed")).toBe(true));
  it("allows processing → failed", () => expect(validateTransition("processing", "failed")).toBe(true));
  it("allows processing → cancelled", () => expect(validateTransition("processing", "cancelled")).toBe(true));
  it("allows failed → pending (explicit retry only)", () => expect(validateTransition("failed", "pending")).toBe(true));

  it("rejects completed → processing (no reprocess)", () => expect(validateTransition("completed", "processing")).toBe(false));
  it("rejects completed → pending", () => expect(validateTransition("completed", "pending")).toBe(false));
  it("rejects completed → failed", () => expect(validateTransition("completed", "failed")).toBe(false));
  it("rejects cancelled → processing", () => expect(validateTransition("cancelled", "processing")).toBe(false));
  it("rejects cancelled → pending", () => expect(validateTransition("cancelled", "pending")).toBe(false));
  it("rejects cancelled → completed", () => expect(validateTransition("cancelled", "completed")).toBe(false));
  it("rejects failed → completed (must go through pending)", () => expect(validateTransition("failed", "completed")).toBe(false));

  it("TERMINAL_STATES contains completed, failed, cancelled", () => {
    expect(TERMINAL_STATES.has("completed")).toBe(true);
    expect(TERMINAL_STATES.has("failed")).toBe(true);
    expect(TERMINAL_STATES.has("cancelled")).toBe(true);
    expect(TERMINAL_STATES.has("pending")).toBe(false);
    expect(TERMINAL_STATES.has("processing")).toBe(false);
  });

  it("ALLOWED_TRANSITIONS has no outgoing edges from completed", () => {
    expect(ALLOWED_TRANSITIONS.completed).toHaveLength(0);
  });

  it("ALLOWED_TRANSITIONS has no outgoing edges from cancelled", () => {
    expect(ALLOWED_TRANSITIONS.cancelled).toHaveLength(0);
  });
});

// ── CompositionSessionStore ───────────────────────────────────────────────────

describe("CompositionSessionStore", () => {
  beforeEach(() => {
    clearStore();
  });

  describe("IDOR — cross-tenant access", () => {
    it("tenant A cannot read tenant B's session (returns null)", () => {
      createSession("tenant-A", "shared-key");
      transitionSession("tenant-A", "shared-key", "processing");
      transitionSession("tenant-A", "shared-key", "completed", { result: MOCK_SPEC });

      // Tenant B trying to read Tenant A's session with the same key
      const result = getSession("tenant-B", "shared-key");
      expect(result).toBeNull();
    });

    it("same idempotencyKey for different tenants creates separate isolated sessions", () => {
      createSession("tenant-A", "common-key");
      createSession("tenant-B", "common-key");

      transitionSession("tenant-A", "common-key", "processing");
      transitionSession("tenant-A", "common-key", "completed", { result: MOCK_SPEC });

      const sessionA = getSession("tenant-A", "common-key");
      const sessionB = getSession("tenant-B", "common-key");

      expect(sessionA?.state).toBe("completed");
      expect(sessionB?.state).toBe("pending");
      // Different sessionIds confirm separate entries
      expect(sessionA?.sessionId).not.toBe(sessionB?.sessionId);
    });

    it("session lookup returns null for nonexistent tenant — not an error", () => {
      const result = getSession("nonexistent-tenant", "any-key");
      expect(result).toBeNull();
    });

    it("getSession never returns a session owned by a different tenant", () => {
      createSession("real-owner", "the-key");
      // Attacker tries every common tenant format
      for (const attacker of ["attacker", "REAL-OWNER", "real_owner", "", "real-owner "]) {
        expect(getSession(attacker, "the-key")).toBeNull();
      }
    });
  });

  describe("idempotency — identical key + tenant → existing session", () => {
    it("createSession throws if session already exists", () => {
      createSession("tenant-A", "dup-key");
      expect(() => createSession("tenant-A", "dup-key")).toThrow();
    });

    it("getSession returns the same session on repeated calls", () => {
      createSession("tenant-A", "stable-key");
      const s1 = getSession("tenant-A", "stable-key");
      const s2 = getSession("tenant-A", "stable-key");
      expect(s1?.sessionId).toBe(s2?.sessionId);
    });
  });

  describe("state transitions", () => {
    it("full happy path: pending → processing → completed", () => {
      createSession("tenant-A", "full-path");
      expect(getSession("tenant-A", "full-path")?.state).toBe("pending");

      transitionSession("tenant-A", "full-path", "processing");
      expect(getSession("tenant-A", "full-path")?.state).toBe("processing");

      transitionSession("tenant-A", "full-path", "completed", { result: MOCK_SPEC });
      const final = getSession("tenant-A", "full-path");
      expect(final?.state).toBe("completed");
      expect(final?.result).toBe(MOCK_SPEC);
    });

    it("failed → pending (explicit retry) → processing → completed", () => {
      createSession("tenant-A", "retry-path");
      transitionSession("tenant-A", "retry-path", "processing");
      transitionSession("tenant-A", "retry-path", "failed", { failureReason: "timeout" });

      expect(getSession("tenant-A", "retry-path")?.state).toBe("failed");

      // Official retry path
      transitionSession("tenant-A", "retry-path", "pending");
      const reset = getSession("tenant-A", "retry-path");
      expect(reset?.state).toBe("pending");
      expect(reset?.failureReason).toBeUndefined();
      expect(reset?.result).toBeUndefined();
    });

    it("throws on invalid transition: completed → processing", () => {
      createSession("tenant-A", "invalid-t");
      transitionSession("tenant-A", "invalid-t", "processing");
      transitionSession("tenant-A", "invalid-t", "completed", { result: MOCK_SPEC });

      expect(() =>
        transitionSession("tenant-A", "invalid-t", "processing"),
      ).toThrow(/invalid state transition/i);
    });

    it("throws on invalid transition: cancelled → pending", () => {
      createSession("tenant-A", "cancel-t");
      transitionSession("tenant-A", "cancel-t", "cancelled");

      expect(() =>
        transitionSession("tenant-A", "cancel-t", "pending"),
      ).toThrow(/invalid state transition/i);
    });

    it("transition for nonexistent session throws", () => {
      expect(() =>
        transitionSession("tenant-A", "ghost-key", "processing"),
      ).toThrow(/not found/i);
    });
  });

  describe("session count and cleanup", () => {
    it("sessionCount reflects created sessions", () => {
      expect(sessionCount()).toBe(0);
      createSession("t1", "k1");
      createSession("t2", "k2");
      expect(sessionCount()).toBe(2);
    });

    it("deleteSession removes by tenantId + key", () => {
      createSession("tenant-A", "del-key");
      expect(getSession("tenant-A", "del-key")).not.toBeNull();
      deleteSession("tenant-A", "del-key");
      expect(getSession("tenant-A", "del-key")).toBeNull();
    });

    it("deleteSession returns false for cross-tenant delete attempt", () => {
      createSession("tenant-A", "protected");
      const deleted = deleteSession("tenant-B", "protected");
      expect(deleted).toBe(false);
      // Session still exists for tenant-A
      expect(getSession("tenant-A", "protected")).not.toBeNull();
    });
  });
});

// ── Boundary — Team 13 does NOT run a layout solver ──────────────────────────

describe("Boundary: Team 13 does not run a layout solver (Team 12 boundary)", () => {
  it("compose() accepts LayoutPlanInput verbatim from Team 12 without modification", () => {
    // Simulate an unusual layout output from Team 12's solver
    const team12LayoutOutput: LayoutPlanInput = {
      name: "Team 12 Solved Layout",
      strategy: "asymmetric",  // unusual — confirms Team 13 doesn't override
      flow: "masonry",
      heroWeight: 0.15,        // non-standard weight
      sectionCount: 7,
      hasSidebar: true,
      emphasis: "data",
    };

    const result = compose({ ...MINIMAL_REQUEST, layoutPlan: team12LayoutOutput });

    // Every field must be preserved exactly — Team 13 does not re-solve
    expect(result.layout.strategy).toBe("asymmetric");
    expect(result.layout.flow).toBe("masonry");
    expect(result.layout.heroWeight).toBe(0.15);
    expect(result.layout.sectionCount).toBe(7);
    expect(result.layout.hasSidebar).toBe(true);
    expect(result.layout.emphasis).toBe("data");
    expect(result.layout.name).toBe("Team 12 Solved Layout");
  });

  it("compose() preserves all 10 layout strategies without remapping", () => {
    const strategies = [
      "hero-content", "grid", "asymmetric", "magazine", "editorial",
      "minimal", "card-grid", "split", "full-bleed", "sidebar",
    ] as const;

    for (const strategy of strategies) {
      const result = compose({
        ...MINIMAL_REQUEST,
        layoutPlan: { ...MINIMAL_REQUEST.layoutPlan, strategy },
      });
      expect(result.layout.strategy).toBe(strategy);
    }
  });

  it("does not export layout solving functions from the public API", async () => {
    const exports = await import("../index.js");
    const layoutSolverNames = [
      "solveLayout",
      "computeLayoutConstraints",
      "planLayout",
      "resolveLayoutGrid",
      "constraintSolver",
      "layoutSolver",
      "computeGridPositions",
    ];
    for (const name of layoutSolverNames) {
      expect(
        typeof (exports as Record<string, unknown>)[name],
        `"${name}" should not be exported — layout solving is Team 12's domain`,
      ).toBe("undefined");
    }
  });

  it("compose() blueprint is passed through verbatim — no grid re-computation", () => {
    const customBlueprint = {
      name: "Team 12 Blueprint",
      columns: 16,    // non-standard
      rows: 8,
      gutter: 32,
      maxWidth: 1920,
      orientation: "landscape" as const,
      medium: "presentation" as const,
    };
    const result = compose({ ...MINIMAL_REQUEST, blueprint: customBlueprint });
    expect(result.blueprint.columns).toBe(16);
    expect(result.blueprint.rows).toBe(8);
    expect(result.blueprint.gutter).toBe(32);
    expect(result.blueprint.maxWidth).toBe(1920);
    expect(result.blueprint.orientation).toBe("landscape");
  });
});
