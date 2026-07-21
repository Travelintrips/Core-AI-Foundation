/**
 * annotationSecurity.test.ts — Team 18 / Security and Isolation
 *
 * Required tests: 10 (permission denied), 14 (hidden/unavailable artifact),
 *   15 (unsafe HTML), 16 (actor spoof rejection), 20 (no cross-project association)
 */
import { describe, it, expect } from "vitest";
import {
  assertTenantMatch,
  assertNoCrossProjectAnchor,
  buildActorContext,
  canCreateAnnotation,
  canResolveAnnotation,
  canReopenAnnotation,
  canArchiveAnnotation,
  canDeleteAnnotation,
  canEditComment,
  canDeleteComment,
  sanitizeComment,
  containsHtml,
  AnnotationPermissionError,
} from "../annotationPermissionService.js";
import type { AnnotationActorContext } from "../types.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const adminCtx: AnnotationActorContext = {
  tenantId: "tenant-a", actorId: "admin-1", actorName: "Admin",
  authorType: "admin", isPlatformAdmin: true,
};

const clientCtx: AnnotationActorContext = {
  tenantId: "tenant-a", actorId: "client-x", actorName: "Client X",
  authorType: "client", isPlatformAdmin: false,
};

const otherTenantCtx: AnnotationActorContext = {
  tenantId: "tenant-b", actorId: "admin-2", actorName: "Other Admin",
  authorType: "admin", isPlatformAdmin: false,
};

function makeAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    tenantId:   "tenant-a",
    status:     "open" as const,
    createdBy:  "admin-1",
    ...overrides,
  };
}

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    createdBy:  "admin-1",
    isDeleted:  false,
    ...overrides,
  };
}

// ─── Test 10: permission denied ───────────────────────────────────────────────

describe("permission denied — resolve requires open/acknowledged/reopened status", () => {
  it("denies resolve for archived annotation", () => {
    expect(canResolveAnnotation(makeAnnotation({ status: "archived" }), adminCtx)).toBe(false);
  });

  it("denies resolve for already-resolved annotation", () => {
    expect(canResolveAnnotation(makeAnnotation({ status: "resolved" }), adminCtx)).toBe(false);
  });

  it("denies reopen for open annotation", () => {
    expect(canReopenAnnotation(makeAnnotation({ status: "open" }), adminCtx)).toBe(false);
  });

  it("denies archive when actor is not admin", () => {
    // Client actors cannot archive
    const resolved = makeAnnotation({ status: "resolved" });
    expect(canArchiveAnnotation(resolved, clientCtx)).toBe(false);
  });

  it("denies archive when annotation is not yet resolved", () => {
    expect(canArchiveAnnotation(makeAnnotation({ status: "open" }), adminCtx)).toBe(false);
  });

  it("client cannot delete another user's annotation", () => {
    const ann = makeAnnotation({ createdBy: "some-other-client" });
    const ctx: AnnotationActorContext = { ...clientCtx, actorId: "client-x" };
    expect(canDeleteAnnotation(ann, ctx)).toBe(false);
  });

  it("client can delete their own annotation", () => {
    const ann = makeAnnotation({ createdBy: "client-x" });
    const ctx: AnnotationActorContext = { ...clientCtx, actorId: "client-x" };
    expect(canDeleteAnnotation(ann, ctx)).toBe(true);
  });

  it("denies edit of a deleted comment", () => {
    const comment = makeComment({ isDeleted: true, createdBy: "admin-1" });
    expect(canEditComment(comment, "admin-1")).toBe(false);
  });

  it("denies edit of another user's comment", () => {
    const comment = makeComment({ createdBy: "admin-1" });
    expect(canEditComment(comment, "different-user")).toBe(false);
  });
});

// ─── Test 14: hidden/unavailable artifact ────────────────────────────────────

describe("hidden/unavailable artifact — tenant isolation guard", () => {
  it("assertTenantMatch throws when tenantIds differ", () => {
    expect(() => assertTenantMatch("tenant-a", "tenant-b")).toThrowError(
      expect.objectContaining({ code: "TENANT_MISMATCH" }),
    );
  });

  it("assertTenantMatch passes when tenantIds match", () => {
    expect(() => assertTenantMatch("tenant-a", "tenant-a")).not.toThrow();
  });

  it("canResolveAnnotation returns false when tenant does not match", () => {
    const ann = makeAnnotation({ tenantId: "tenant-a", status: "open" });
    expect(canResolveAnnotation(ann, otherTenantCtx)).toBe(false);
  });

  it("canDeleteAnnotation returns false when tenant does not match", () => {
    const ann = makeAnnotation({ tenantId: "tenant-a", createdBy: "admin-1" });
    expect(canDeleteAnnotation(ann, otherTenantCtx)).toBe(false);
  });
});

// ─── Test 15: unsafe HTML ─────────────────────────────────────────────────────

describe("unsafe HTML sanitization", () => {
  it("strips script tags from comment body", () => {
    const raw   = "<script>alert('xss')</script>Hello";
    const safe  = sanitizeComment(raw);
    expect(safe).toBe("Hello");
    expect(containsHtml(safe)).toBe(false);
  });

  it("strips anchor tags with javascript: href", () => {
    const raw  = "<a href=\"javascript:void(0)\">click</a>";
    const safe = sanitizeComment(raw);
    expect(safe).toBe("click");
  });

  it("strips img tags with onerror handler", () => {
    const raw  = "<img src=x onerror=alert(1) />clean text";
    const safe = sanitizeComment(raw);
    expect(safe).not.toMatch(/<img/i);
    expect(safe).toContain("clean text");
  });

  it("strips bold/italic formatting tags", () => {
    const raw  = "<b>Bold</b> and <em>italic</em> text";
    const safe = sanitizeComment(raw);
    expect(safe).toBe("Bold and italic text");
  });

  it("decodes common HTML entities", () => {
    const raw  = "a &amp; b &lt;c&gt; d";
    const safe = sanitizeComment(raw);
    expect(safe).toBe("a & b <c> d");
  });

  it("preserves plain text exactly", () => {
    const plain = "This is a perfectly safe comment.";
    expect(sanitizeComment(plain)).toBe(plain);
  });

  it("containsHtml correctly detects tags", () => {
    expect(containsHtml("<b>Bold</b>")).toBe(true);
    expect(containsHtml("plain text")).toBe(false);
  });
});

// ─── Test 16: actor spoof rejection at adapter boundary ──────────────────────

describe("actor identity spoof rejection", () => {
  it("buildActorContext requires a non-empty tenantId", () => {
    expect(() => buildActorContext("", "admin-1", "Admin", "admin")).toThrowError(
      expect.objectContaining({ code: "MISSING_TENANT" }),
    );
  });

  it("buildActorContext requires a non-empty actorId", () => {
    expect(() => buildActorContext("tenant-a", "", "Admin", "admin")).toThrowError(
      expect.objectContaining({ code: "MISSING_ACTOR" }),
    );
  });

  it("buildActorContext rejects an empty actorId even if name is provided", () => {
    expect(() => buildActorContext("tenant-a", "", "Legit Name", "client")).toThrow();
  });

  it("builds a valid actor context from server-resolved values", () => {
    const ctx = buildActorContext("tenant-a", "admin-1", "Admin User", "admin", true);
    expect(ctx.tenantId).toBe("tenant-a");
    expect(ctx.actorId).toBe("admin-1");
    expect(ctx.authorType).toBe("admin");
    expect(ctx.isPlatformAdmin).toBe(true);
  });

  it("defaults actorName to actorId when name is blank", () => {
    const ctx = buildActorContext("t", "actor-id", "", "client");
    expect(ctx.actorName).toBe("actor-id");
  });

  it("AnnotationPermissionError carries a machine-readable code", () => {
    const err = new AnnotationPermissionError("FORBIDDEN", "Not allowed");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Not allowed");
    expect(err.name).toBe("AnnotationPermissionError");
  });
});

// ─── Test 20: no cross-project association ────────────────────────────────────

describe("cross-project association prevention", () => {
  it("assertNoCrossProjectAnchor throws when artifactIds differ", () => {
    expect(() => assertNoCrossProjectAnchor("project-A", "project-B")).toThrowError(
      expect.objectContaining({ code: "CROSS_PROJECT_ANCHOR" }),
    );
  });

  it("assertNoCrossProjectAnchor passes when artifactIds match", () => {
    expect(() => assertNoCrossProjectAnchor("project-A", "project-A")).not.toThrow();
  });

  it("client actor cannot annotate when tenantId does not match (second project guard)", () => {
    // Even if client has canCreate, they cannot resolve annotations on another tenant's artifact
    const foreignAnn = makeAnnotation({ tenantId: "tenant-b", status: "open" });
    expect(canResolveAnnotation(foreignAnn, clientCtx)).toBe(false);
  });
});

// ─── Bonus: canCreateAnnotation coverage ────────────────────────────────────

describe("canCreateAnnotation", () => {
  it("allows admin to create", () => {
    expect(canCreateAnnotation(adminCtx)).toBe(true);
  });

  it("allows client to create (during review flow)", () => {
    expect(canCreateAnnotation(clientCtx)).toBe(true);
  });
});
