/**
 * auditRedaction.test.ts — WP-03: sensitive-field redaction and before/after
 * diffing for repository-driven audit emission.
 */
import { describe, it, expect } from "vitest";
import { sanitizeForAudit, computeAuditDiff } from "../auditRedaction.js";

describe("sanitizeForAudit", () => {
  it("redacts keys matching the sensitive pattern at any depth", () => {
    const input = {
      installedVersion: "1.2.3",
      apiKey: "sk-live-abc123",
      nested: { password: "hunter2", ok: "fine" },
      reviewTokenHash: "deadbeef",
    };
    const out = sanitizeForAudit(input) as Record<string, unknown>;
    expect(out.installedVersion).toBe("1.2.3");
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe("fine");
    expect(out.reviewTokenHash).toBe("[REDACTED]");
  });

  it("redacts inside arrays of objects", () => {
    const out = sanitizeForAudit([{ token: "x" }, { name: "y" }]) as Record<string, unknown>[];
    expect(out[0].token).toBe("[REDACTED]");
    expect(out[1].name).toBe("y");
  });

  it("truncates beyond the max recursion depth instead of recursing forever", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    const out = sanitizeForAudit(deep);
    expect(JSON.stringify(out)).toContain("TRUNCATED");
  });
});

describe("computeAuditDiff", () => {
  it("returns null when nothing changed", () => {
    const row = { id: 1, enabled: true };
    expect(computeAuditDiff(row, { ...row })).toBeNull();
  });

  it("returns only the changed keys, both sides", () => {
    const before = { id: 1, enabled: true, installedVersion: "1.0.0" };
    const after = { id: 1, enabled: false, installedVersion: "1.0.0" };
    const diff = computeAuditDiff(before, after);
    expect(diff).toEqual({ before: { enabled: true }, after: { enabled: false } });
  });

  it("returns null for two empty/undefined snapshots", () => {
    expect(computeAuditDiff(undefined, undefined)).toBeNull();
  });

  it("redacts sensitive fields inside the diff", () => {
    const diff = computeAuditDiff({ apiKey: "old" }, { apiKey: "new" });
    expect(diff).toEqual({ before: { apiKey: "[REDACTED]" }, after: { apiKey: "[REDACTED]" } });
  });
});
