/**
 * services/audit/auditTypes.ts — WP-03 Canonical Audit Log shared types.
 *
 * `AuditActorType` is deliberately a coarser vocabulary than
 * security/requestContext.ts's `ActorType`: the audit table is a long-lived,
 * externally-reviewable trail (compliance / support / security review), so
 * it groups the finer-grained request actor types into a small, stable set
 * per docs/specifications/p0-database-change-plan.md §2 and
 * docs/blueprints/p0-audit-log-blueprint.md. This module only reads
 * `RequestContext`'s type — it never imports or mutates
 * security/requestContext.ts itself.
 */
import type { ActorType, RequestContext } from "../../security/requestContext.js";

export const AUDIT_ACTOR_TYPES = ["internal_user", "customer", "public_token", "system", "worker"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** The subset of an audit row's identity fields that can be derived from a RequestContext. */
export interface AuditContext {
  readonly tenantId: string | null;
  readonly actorId: string | null;
  readonly actorType: AuditActorType | null;
}

/**
 * Maps the fine-grained request `ActorType` onto the audit table's coarser
 * category. Kept as an explicit switch (not a lookup object) so adding a new
 * `ActorType` in requestContext.ts is a compile error here until someone
 * decides which audit bucket it belongs to.
 */
export function toAuditActorType(actorType: ActorType): AuditActorType {
  switch (actorType) {
    case "customer":
      return "customer";
    case "public_token":
      return "public_token";
    case "worker":
      return "worker";
    case "system":
    case "scheduler":
    case "webhook":
      return "system";
    case "tenant_admin":
    case "platform_admin":
    case "vendor":
      return "internal_user";
    default: {
      // Exhaustiveness guard: if a new ActorType is ever added without
      // updating this switch, fall back to "system" rather than throwing —
      // audit emission must never be the reason a write fails — but this
      // branch being reached at all indicates a missing case above.
      const _exhaustive: never = actorType;
      void _exhaustive;
      return "system";
    }
  }
}

/** Derives the audit-relevant identity fields from a canonical RequestContext. */
export function deriveAuditContext(ctx: RequestContext): AuditContext {
  return {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorType: toAuditActorType(ctx.actorType),
  };
}
