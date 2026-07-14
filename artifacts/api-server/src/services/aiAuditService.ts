import { db, aiAuditLogsTable } from "@workspace/db";
import type { AuditActorType, AuditContext } from "./audit/auditTypes.js";

export type AuditStatus = "success" | "failure" | "warning";

/**
 * Optional tenant/actor identity to attach to a log row, on top of the
 * legacy (module, action, resourceId, resourceType, status, details)
 * positional call. Every field is optional so existing call sites never
 * need to change.
 */
export type LogAuditContext = Partial<AuditContext>;

/**
 * Object-style input, kept compatible with the pre-existing call sites in
 * assetIntelligenceService.ts, creativeBrandIntelligenceService.ts, and
 * brand-intelligence.ts that already call `logAudit({ action, entityType,
 * entityId, details })` — `entityType`/`entityId` are accepted as aliases
 * for `resourceType`/`resourceId` so those call sites do not need to change.
 */
export interface LogAuditInput {
  module?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** @deprecated alias for resourceType, kept for existing call sites */
  entityType?: string;
  /** @deprecated alias for resourceId, kept for existing call sites */
  entityId?: string;
  status?: AuditStatus;
  details?: Record<string, unknown> | null;
  tenantId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType | null;
}

/**
 * Centralized audit logger for `ai_audit_logs`. Never throws — audit
 * failures must not break the caller's main flow (matches the pre-existing
 * contract every current call site already relies on).
 *
 * Two calling conventions are supported:
 *   1. Legacy positional: logAudit(module, action, resourceId, resourceType, status?, details?, context?)
 *   2. Object form:       logAudit({ module?, action, resourceType|entityType, resourceId|entityId, status?, details?, tenantId?, actorId?, actorType? })
 *
 * `context` (positional form) / `tenantId`+`actorId`+`actorType` (object
 * form) are the WP-03 additions — see services/audit/auditTypes.ts for how a
 * RequestContext derives them, and repositories/auditHook.ts for the
 * repository-driven emission path that populates them automatically.
 */
export async function logAudit(
  module: string,
  action: string,
  resourceId: string,
  resourceType: string,
  status?: AuditStatus,
  details?: Record<string, unknown>,
  context?: LogAuditContext,
): Promise<void>;
export async function logAudit(input: LogAuditInput): Promise<void>;
export async function logAudit(
  moduleOrInput: string | LogAuditInput,
  action?: string,
  resourceId?: string,
  resourceType?: string,
  status: AuditStatus = "success",
  details?: Record<string, unknown>,
  context?: LogAuditContext,
): Promise<void> {
  try {
    const values =
      typeof moduleOrInput === "string"
        ? {
            module: moduleOrInput,
            action: action as string,
            resourceId: resourceId ?? null,
            resourceType: resourceType ?? null,
            status,
            details: details ?? null,
            tenantId: context?.tenantId ?? null,
            actorId: context?.actorId ?? null,
            actorType: context?.actorType ?? null,
          }
        : {
            module: moduleOrInput.module ?? moduleOrInput.resourceType ?? moduleOrInput.entityType ?? "system",
            action: moduleOrInput.action,
            resourceId: moduleOrInput.resourceId ?? moduleOrInput.entityId ?? null,
            resourceType: moduleOrInput.resourceType ?? moduleOrInput.entityType ?? null,
            status: moduleOrInput.status ?? "success",
            details: moduleOrInput.details ?? null,
            tenantId: moduleOrInput.tenantId ?? null,
            actorId: moduleOrInput.actorId ?? null,
            actorType: moduleOrInput.actorType ?? null,
          };

    await db.insert(aiAuditLogsTable).values(values);
  } catch (err) {
    console.error("[aiAuditService] Failed to write audit log:", err);
  }
}

/** Thrown by the immutability guards below — audit rows are append-only at the application layer. */
export class AuditLogImmutableError extends Error {
  constructor(operation: "update" | "delete") {
    super(`ai_audit_logs is immutable at the application layer: ${operation} is not implemented. See docs/implementation/wp03-audit-log-report.md`);
    this.name = "AuditLogImmutableError";
  }
}

/**
 * There is intentionally no working implementation of this function — it
 * exists so a future developer reaching for "update an audit row" finds an
 * explicit, documented refusal instead of either a missing symbol or a
 * silently-added mutation path. Do not implement this without a new
 * work package that revisits the immutability guarantee.
 */
export function updateAuditLog(): never {
  throw new AuditLogImmutableError("update");
}

/** See updateAuditLog — same rationale, for deletes. */
export function deleteAuditLog(): never {
  throw new AuditLogImmutableError("delete");
}
