/**
 * auditTypes.test.ts — WP-03: RequestContext actor type → audit actor type
 * mapping and context derivation.
 */
import { describe, it, expect } from "vitest";
import { toAuditActorType, deriveAuditContext, AUDIT_ACTOR_TYPES } from "../auditTypes.js";
import { createSessionTenantContext, createSystemContext, createPublicTokenContext } from "../../../security/requestContext.js";

describe("toAuditActorType", () => {
  it("maps every RequestContext ActorType into one of the audit's coarse categories", () => {
    expect(toAuditActorType("customer")).toBe("customer");
    expect(toAuditActorType("public_token")).toBe("public_token");
    expect(toAuditActorType("worker")).toBe("worker");
    expect(toAuditActorType("system")).toBe("system");
    expect(toAuditActorType("scheduler")).toBe("system");
    expect(toAuditActorType("webhook")).toBe("system");
    expect(toAuditActorType("tenant_admin")).toBe("internal_user");
    expect(toAuditActorType("platform_admin")).toBe("internal_user");
    expect(toAuditActorType("vendor")).toBe("internal_user");
  });

  it("only ever returns a value from AUDIT_ACTOR_TYPES", () => {
    const inputs = ["customer", "tenant_admin", "platform_admin", "vendor", "public_token", "system", "worker", "scheduler", "webhook"] as const;
    for (const input of inputs) {
      expect(AUDIT_ACTOR_TYPES).toContain(toAuditActorType(input));
    }
  });
});

describe("deriveAuditContext", () => {
  it("carries tenantId and actorId through unchanged, and maps actorType", () => {
    const ctx = createSessionTenantContext({
      tenantId: "tenant-1",
      actorId: "user-42",
      actorType: "tenant_admin",
      source: "admin_portal",
      requestId: "req-1",
    });
    expect(deriveAuditContext(ctx)).toEqual({ tenantId: "tenant-1", actorId: "user-42", actorType: "internal_user" });
  });

  it("system/worker/scheduler contexts with a null tenantId (platform-wide) derive a null tenantId", () => {
    const ctx = createSystemContext({
      tenantId: null,
      actorType: "scheduler",
      source: "scheduler",
      requestId: "req-2",
      isPlatformWide: true,
    });
    expect(deriveAuditContext(ctx)).toEqual({ tenantId: null, actorId: null, actorType: "system" });
  });

  it("public token contexts have no actorId but do carry tenantId", () => {
    const ctx = createPublicTokenContext({
      tenantId: "tenant-9",
      resourceScope: { resourceType: "quotation", resourceId: 1 },
      source: "public_page",
      requestId: "req-3",
    });
    expect(deriveAuditContext(ctx)).toEqual({ tenantId: "tenant-9", actorId: null, actorType: "public_token" });
  });
});
