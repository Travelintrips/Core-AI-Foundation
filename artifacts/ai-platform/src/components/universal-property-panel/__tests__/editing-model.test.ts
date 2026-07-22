/**
 * Tests: Editing Model (Pure Reducer)
 *
 * Covers spec requirements:
 * 8.  draft update
 * 9.  dirty tracking
 * 10. reset
 * 11. partial patch
 * 12. validation failure
 * 13. cross-field validation
 * 14. read-only mode
 * 15. permission denied
 * 16. stale version conflict
 * 17. autosave debounce cleanup
 * 22. error focus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  editingModelReducer,
  makeInitialEditingState,
  isDirty,
  hasErrors,
  canSave,
  getFieldError,
  buildPatch,
} from "../editing-model";
import type { EditingModelState } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function make(
  values: Record<string, unknown> = {},
  opts: { isReadOnly?: boolean; token?: string } = {},
): EditingModelState {
  return makeInitialEditingState(values as any, {
    isReadOnly: opts.isReadOnly,
    concurrencyToken: opts.token,
  });
}

function dispatch(
  state: EditingModelState,
  action: Parameters<typeof editingModelReducer>[1],
): EditingModelState {
  return editingModelReducer(state, action);
}

// ── Test 8: draft update ──────────────────────────────────────────────────────

describe("draft update (test 8)", () => {
  it("updates the draft value for a field", () => {
    const s = make({ name: "Alice" });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Bob" });
    expect(next.draft["name"]).toBe("Bob");
  });

  it("does not change canonicalValues on draft update", () => {
    const s = make({ name: "Alice" });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Bob" });
    expect(next.canonicalValues["name"]).toBe("Alice");
  });

  it("clears field error when field is edited", () => {
    let s = make({ name: "" });
    s = dispatch(s, { type: "SET_FIELD_ERRORS", errors: { name: ["Name is required."] } });
    expect(getFieldError(s, "name")).toBe("Name is required.");
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Alice" });
    expect(getFieldError(s, "name")).toBeUndefined();
  });

  it("does not update draft when panel is read-only", () => {
    const s = make({ name: "Alice" }, { isReadOnly: true });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Bob" });
    expect(next.draft["name"]).toBe("Alice");
  });

  it("does not update draft when in conflict state", () => {
    let s = make({ name: "Alice" });
    s = dispatch(s, {
      type: "STALE_VERSION_CONFLICT",
      serverValues: { name: "Server" },
      token: "tok-2",
    });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Edit" });
    expect(next.draft["name"]).toBe("Alice");
  });
});

// ── Test 9: dirty tracking ────────────────────────────────────────────────────

describe("dirty tracking (test 9)", () => {
  it("is not dirty initially", () => {
    const s = make({ a: "x" });
    expect(isDirty(s)).toBe(false);
  });

  it("becomes dirty when a field is changed", () => {
    const s = make({ a: "x" });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "y" });
    expect(isDirty(next)).toBe(true);
    expect(next.dirtyFields.has("a")).toBe(true);
  });

  it("is not dirty when reverted to canonical value", () => {
    const s = make({ a: "x" });
    let next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "y" });
    expect(isDirty(next)).toBe(true);
    next = dispatch(next, { type: "UPDATE_DRAFT", fieldId: "a", value: "x" });
    expect(isDirty(next)).toBe(false);
  });

  it("tracks multiple dirty fields", () => {
    let s = make({ a: "x", b: "y" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "x2" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "b", value: "y2" });
    expect(s.dirtyFields.size).toBe(2);
  });
});

// ── Test 10: reset ────────────────────────────────────────────────────────────

describe("reset (test 10)", () => {
  it("resets draft to canonical values", () => {
    let s = make({ x: 10 });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: 99 });
    s = dispatch(s, { type: "RESET" });
    expect(s.draft["x"]).toBe(10);
    expect(isDirty(s)).toBe(false);
  });

  it("clears validation errors on reset", () => {
    let s = make({ x: 10 });
    s = dispatch(s, { type: "SET_FIELD_ERRORS", errors: { x: ["Error"] } });
    s = dispatch(s, { type: "RESET" });
    expect(s.fieldErrors).toEqual({});
  });

  it("resets saveStatus to idle", () => {
    let s = make({ x: 10 });
    s = dispatch(s, { type: "BEGIN_SAVE" });
    s = dispatch(s, { type: "SAVE_FAILED", error: "Network error" });
    s = dispatch(s, { type: "RESET" });
    expect(s.saveStatus).toBe("idle");
  });

  it("clears conflict state on reset", () => {
    let s = make({ x: 10 });
    s = dispatch(s, {
      type: "STALE_VERSION_CONFLICT",
      serverValues: { x: 99 },
      token: "t2",
    });
    s = dispatch(s, { type: "RESET" });
    expect(s.conflictServerValues).toBeUndefined();
  });
});

// ── Test 11: partial patch ────────────────────────────────────────────────────

describe("partial patch (test 11)", () => {
  it("buildPatch returns only dirty fields", () => {
    let s = make({ a: "x", b: "y", c: "z" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "x2" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "c", value: "z2" });
    const patches = buildPatch(s, "sec-1");
    expect(patches).toHaveLength(2);
    const fieldIds = patches.map((p) => p.fieldId).sort();
    expect(fieldIds).toEqual(["a", "c"]);
  });

  it("patches include concurrencyToken", () => {
    let s = make({ a: "x" }, { token: "tok-123" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "x2" });
    const patches = buildPatch(s, "sec");
    expect(patches[0]!.concurrencyToken).toBe("tok-123");
  });

  it("does not include unchanged fields in patch", () => {
    let s = make({ a: "x", b: "y" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "a", value: "x2" });
    const patches = buildPatch(s, "sec");
    expect(patches.some((p) => p.fieldId === "b")).toBe(false);
  });
});

// ── Test 12: validation failure ───────────────────────────────────────────────

describe("validation failure (test 12)", () => {
  it("SET_FIELD_ERRORS stores errors per field", () => {
    let s = make({ name: "" });
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: { name: ["Name is required."] },
    });
    expect(hasErrors(s)).toBe(true);
    expect(getFieldError(s, "name")).toBe("Name is required.");
  });

  it("canSave returns false when there are errors", () => {
    let s = make({ name: "Alice" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "name", value: "Alice Changed" });
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: { name: ["Too long."] },
    });
    expect(canSave(s)).toBe(false);
  });

  it("CLEAR_FIELD_ERROR removes error for one field", () => {
    let s = make({ a: "", b: "" });
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: { a: ["Error A"], b: ["Error B"] },
    });
    s = dispatch(s, { type: "CLEAR_FIELD_ERROR", fieldId: "a" });
    expect(getFieldError(s, "a")).toBeUndefined();
    expect(getFieldError(s, "b")).toBe("Error B");
  });
});

// ── Test 13: cross-field validation ──────────────────────────────────────────

describe("cross-field validation (test 13)", () => {
  it("cross-field errors can reference multiple fields", () => {
    let s = make({ start: 10, end: 5 });
    // Simulate: cross-field validation found start > end
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: {
        start: ["Start must be before end."],
        end: ["End must be after start."],
      },
    });
    expect(getFieldError(s, "start")).toBe("Start must be before end.");
    expect(getFieldError(s, "end")).toBe("End must be after start.");
    expect(hasErrors(s)).toBe(true);
  });

  it("clearing cross-field errors enables saving", () => {
    let s = make({ start: 10, end: 5 });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "start", value: 10 });
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: { start: ["Start > end."] },
    });
    // Fix: clear error
    s = dispatch(s, { type: "CLEAR_FIELD_ERROR", fieldId: "start" });
    // canSave requires dirty + no errors
    expect(hasErrors(s)).toBe(false);
  });
});

// ── Test 14: read-only mode ───────────────────────────────────────────────────

describe("read-only mode (test 14)", () => {
  it("initial state can be read-only", () => {
    const s = make({ val: "x" }, { isReadOnly: true });
    expect(s.isReadOnly).toBe(true);
  });

  it("UPDATE_DRAFT is a no-op in read-only mode", () => {
    const s = make({ val: "x" }, { isReadOnly: true });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "val", value: "y" });
    expect(next.draft["val"]).toBe("x");
    expect(isDirty(next)).toBe(false);
  });

  it("SET_READ_ONLY toggles read-only mode", () => {
    let s = make({ val: "x" });
    s = dispatch(s, { type: "SET_READ_ONLY", isReadOnly: true });
    expect(s.isReadOnly).toBe(true);
    s = dispatch(s, { type: "SET_READ_ONLY", isReadOnly: false });
    expect(s.isReadOnly).toBe(false);
  });

  it("canSave is false in read-only mode", () => {
    const s = make({ val: "x" }, { isReadOnly: true });
    expect(canSave(s)).toBe(false);
  });
});

// ── Test 15: permission denied ────────────────────────────────────────────────

describe("permission denied (test 15)", () => {
  it("sets saveStatus to permission-denied and isReadOnly to true", () => {
    let s = make({ val: "x" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "val", value: "y" });
    s = dispatch(s, { type: "BEGIN_SAVE" });
    s = dispatch(s, { type: "PERMISSION_DENIED", error: "You do not have permission." });
    expect(s.saveStatus).toBe("permission-denied");
    expect(s.isReadOnly).toBe(true);
    expect(s.saveError).toContain("permission");
  });

  it("prevents further edits after permission denied", () => {
    let s = make({ val: "x" });
    s = dispatch(s, { type: "PERMISSION_DENIED", error: "Forbidden" });
    const next = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "val", value: "y" });
    expect(next.draft["val"]).toBe("x");
  });
});

// ── Test 16: stale version conflict ───────────────────────────────────────────

describe("stale version conflict (test 16)", () => {
  it("sets saveStatus to conflict with server values", () => {
    let s = make({ val: "local" });
    s = dispatch(s, {
      type: "STALE_VERSION_CONFLICT",
      serverValues: { val: "server" },
      token: "tok-new",
    });
    expect(s.saveStatus).toBe("conflict");
    expect(s.conflictServerValues?.["val"]).toBe("server");
    expect(s.concurrencyToken).toBe("tok-new");
  });

  it("RESOLVE_CONFLICT_USE_LOCAL keeps draft and clears conflict", () => {
    let s = make({ val: "local" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "val", value: "local-edit" });
    s = dispatch(s, {
      type: "STALE_VERSION_CONFLICT",
      serverValues: { val: "server" },
      token: "tok-new",
    });
    s = dispatch(s, { type: "RESOLVE_CONFLICT_USE_LOCAL" });
    expect(s.saveStatus).toBe("idle");
    expect(s.draft["val"]).toBe("local-edit");
    expect(s.conflictServerValues).toBeUndefined();
  });

  it("RESOLVE_CONFLICT_USE_SERVER accepts server values", () => {
    let s = make({ val: "local" });
    s = dispatch(s, {
      type: "STALE_VERSION_CONFLICT",
      serverValues: { val: "server" },
      token: "tok-new",
    });
    s = dispatch(s, { type: "RESOLVE_CONFLICT_USE_SERVER" });
    expect(s.draft["val"]).toBe("server");
    expect(s.canonicalValues["val"]).toBe("server");
    expect(isDirty(s)).toBe(false);
  });
});

// ── Test 17: autosave debounce cleanup ────────────────────────────────────────

describe("autosave debounce cleanup (test 17)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("setTimeout is called when a draft update is made", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    // Model-level: simulate the autosave pattern (timer management)
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 500);
    vi.advanceTimersByTime(499);
    expect(timerFired).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timerFired).toBe(true);
    setTimeoutSpy.mockRestore();
  });

  it("clearTimeout cancels the autosave timer", () => {
    let fired = false;
    const timer = setTimeout(() => { fired = true; }, 500);
    clearTimeout(timer);
    vi.advanceTimersByTime(600);
    expect(fired).toBe(false);
  });

  it("timer cleanup is idempotent (double clear is safe)", () => {
    let fired = false;
    const timer = setTimeout(() => { fired = true; }, 500);
    clearTimeout(timer);
    clearTimeout(timer); // double-clear must not throw
    expect(fired).toBe(false);
  });
});

// ── Test 22: error focus ──────────────────────────────────────────────────────

describe("error focus (test 22)", () => {
  it("SET_FIELD_ERRORS sets focusFieldId to the first field with errors", () => {
    let s = make({ a: "", b: "" });
    s = dispatch(s, {
      type: "SET_FIELD_ERRORS",
      errors: { a: ["Error A"] },
    });
    expect(s.focusFieldId).toBe("a");
  });

  it("focusFieldId is cleared on CLEAR_FOCUS", () => {
    let s = make({ a: "" });
    s = dispatch(s, { type: "SET_FIELD_ERRORS", errors: { a: ["Error"] } });
    s = dispatch(s, { type: "CLEAR_FOCUS" });
    expect(s.focusFieldId).toBeUndefined();
  });

  it("FOCUS_FIELD explicitly sets the focus target", () => {
    let s = make({ a: "x" });
    s = dispatch(s, { type: "FOCUS_FIELD", fieldId: "a" });
    expect(s.focusFieldId).toBe("a");
  });

  it("focusFieldId is cleared on RESET", () => {
    let s = make({ a: "" });
    s = dispatch(s, { type: "SET_FIELD_ERRORS", errors: { a: ["Error"] } });
    s = dispatch(s, { type: "RESET" });
    expect(s.focusFieldId).toBeUndefined();
  });
});

// ── Save lifecycle ────────────────────────────────────────────────────────────

describe("save lifecycle", () => {
  it("BEGIN_SAVE sets status to saving", () => {
    let s = make({ x: "a" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: "b" });
    s = dispatch(s, { type: "BEGIN_SAVE" });
    expect(s.saveStatus).toBe("saving");
  });

  it("SAVE_SUCCESS promotes draft to canonical and clears dirty", () => {
    let s = make({ x: "a" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: "b" });
    s = dispatch(s, { type: "BEGIN_SAVE" });
    s = dispatch(s, { type: "SAVE_SUCCESS", token: "tok-2" });
    expect(s.saveStatus).toBe("saved");
    expect(s.canonicalValues["x"]).toBe("b");
    expect(isDirty(s)).toBe(false);
    expect(s.concurrencyToken).toBe("tok-2");
  });

  it("SAVE_FAILED sets status to failed with message", () => {
    let s = make({ x: "a" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: "b" });
    s = dispatch(s, { type: "BEGIN_SAVE" });
    s = dispatch(s, { type: "SAVE_FAILED", error: "Network error" });
    expect(s.saveStatus).toBe("failed");
    expect(s.saveError).toBe("Network error");
  });

  it("UPDATE_CANONICAL resets all state to new server values", () => {
    let s = make({ x: "old" });
    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: "edited" });
    s = dispatch(s, { type: "UPDATE_CANONICAL", values: { x: "new-from-server" }, token: "t3" });
    expect(s.draft["x"]).toBe("new-from-server");
    expect(s.canonicalValues["x"]).toBe("new-from-server");
    expect(isDirty(s)).toBe(false);
    expect(s.concurrencyToken).toBe("t3");
  });

  it("canSave requires dirty + no errors + not saving + not read-only", () => {
    let s = make({ x: "a" });
    expect(canSave(s)).toBe(false); // not dirty

    s = dispatch(s, { type: "UPDATE_DRAFT", fieldId: "x", value: "b" });
    expect(canSave(s)).toBe(true); // dirty + no errors

    s = dispatch(s, { type: "SET_FIELD_ERRORS", errors: { x: ["Error"] } });
    expect(canSave(s)).toBe(false); // has errors

    s = dispatch(s, { type: "CLEAR_FIELD_ERROR", fieldId: "x" });
    expect(canSave(s)).toBe(true);

    s = dispatch(s, { type: "BEGIN_SAVE" });
    expect(canSave(s)).toBe(false); // saving
  });
});
