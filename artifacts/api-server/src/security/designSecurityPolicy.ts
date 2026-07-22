/**
 * designSecurityPolicy.ts — Design Platform Security Policy Contracts (Team 36)
 *
 * Defines the canonical type vocabulary for design security decisions.
 * These types are ADDITIVE — they do not replace the existing RBAC vocabulary
 * (roles: admin/owner/tenant_admin/system from requestContext.ts). They map
 * onto it via adapter pattern; no competing enum is introduced.
 *
 * Usage:
 *   1. Routes call resolveAuthenticatedTenantContext (from tenantResolution.ts)
 *      to get the actor + tenant — that is the single source of truth.
 *   2. Service functions receive tenantId and enforce resource ownership.
 *   3. Security-sensitive denials produce a DesignSecurityAuditEvent (logged,
 *      never thrown to the client verbatim).
 *   4. Resource and rate limits are checked against DesignResourceLimitPolicy /
 *      DesignRateLimitPolicy before invoking expensive operations.
 */

// ── Resource scope ─────────────────────────────────────────────────────────────

/**
 * The design platform resources that can be access-controlled.
 * Scoped to design studio — does not attempt to model the whole platform.
 */
export type DesignResourceScope =
  | "design:project"
  | "design:canvas"
  | "design:version"
  | "design:export"
  | "design:ai_regenerate"
  | "design:template"
  | "design:plugin"
  | "design:asset";

// ── Permission names ──────────────────────────────────────────────────────────

/**
 * Fine-grained permission names for design resources.
 * These map onto the existing admin/owner/tenant_admin role grants in the app.
 */
export type DesignPermission =
  | "design.project.read"
  | "design.project.create"
  | "design.project.update"
  | "design.project.delete"
  | "design.canvas.read"
  | "design.canvas.write"
  | "design.version.read"
  | "design.version.restore"
  | "design.export.execute"
  | "design.ai.regenerate"
  | "design.template.read"
  | "design.plugin.load"
  | "design.asset.read"
  | "design.asset.write"
  | "design.platform.crossTenant"; // platform-admin only

// ── Decision and reason ───────────────────────────────────────────────────────

/** Machine-readable reason codes for security decisions. */
export type DesignSecurityReason =
  | "allowed"
  | "tenant_mismatch"
  | "missing_tenant_context"
  | "insufficient_permission"
  | "platform_scope_required"
  | "resource_not_found_in_tenant"
  | "plugin_unknown_id"
  | "plugin_incompatible_version"
  | "plugin_capability_escalation"
  | "plugin_unsafe_module"
  | "plugin_raw_secret_in_manifest"
  | "ai_provider_key_missing"
  | "ai_budget_exceeded"
  | "ai_rate_limited"
  | "ai_output_invalid"
  | "svg_unsafe_content"
  | "html_injection_blocked"
  | "upload_mime_rejected"
  | "upload_size_exceeded"
  | "resource_limit_exceeded"
  | "rate_limit_exceeded"
  | "token_invalid"
  | "token_expired"
  | "token_revoked"
  | "duplicate_execution"
  | "audit_log_failed"; // must not change the decision

/**
 * The outcome of a policy evaluation.
 * - `allow`: request may proceed.
 * - `deny`: request must be rejected (use the HTTP status from `httpStatus`).
 */
export interface DesignSecurityDecision {
  action: "allow" | "deny";
  reason: DesignSecurityReason;
  /** Suggested HTTP status code for deny decisions. */
  httpStatus?: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;
  /** Developer-facing detail — NEVER sent to the client verbatim. */
  detail?: string;
}

// ── Policy shape ──────────────────────────────────────────────────────────────

/** Full security policy context for a single design request. */
export interface DesignSecurityPolicy {
  /** Server-resolved tenant identifier — never from client input. */
  tenantId: string;
  /** Actor identifier (user id or "system"). */
  actorId: string;
  /** Actor type determines platform vs. tenant scope. */
  actorType: "platform_admin" | "tenant_admin" | "system" | "plugin" | "ai_agent";
  /** Whether this actor may perform cross-tenant operations. */
  isPlatformActor: boolean;
  /** The resource being accessed. */
  resourceScope: DesignResourceScope;
  /** The specific operation requested. */
  permission: DesignPermission;
  /** Resource-level tenant key for IDOR check (e.g. project.tenantId). */
  resourceTenantId?: string;
}

// ── Policy evaluator ──────────────────────────────────────────────────────────

/**
 * Evaluates a DesignSecurityPolicy and returns a deterministic decision.
 *
 * Rules (in order):
 *   1. tenantId must be non-empty — deny with missing_tenant_context.
 *   2. If resourceTenantId is set and differs from tenantId — deny with tenant_mismatch
 *      UNLESS the actor is a platform actor AND permission includes .crossTenant.
 *   3. platform.crossTenant permission requires isPlatformActor — deny with
 *      platform_scope_required otherwise.
 *   4. All other checks pass → allow.
 *
 * Audit events must be emitted by the caller — this function does not log.
 */
export function evaluateDesignPolicy(policy: DesignSecurityPolicy): DesignSecurityDecision {
  // Rule 1: tenant context must exist
  if (!policy.tenantId || policy.tenantId.trim() === "") {
    return {
      action: "deny",
      reason: "missing_tenant_context",
      httpStatus: 401,
      detail: "No tenant context resolved — request rejected fail-closed",
    };
  }

  // Rule 2: cross-tenant IDOR guard
  if (
    policy.resourceTenantId &&
    policy.resourceTenantId !== policy.tenantId &&
    !policy.isPlatformActor
  ) {
    return {
      action: "deny",
      reason: "tenant_mismatch",
      httpStatus: 404, // 404 not 403 — do not confirm existence to other tenants
      detail: `Resource tenant '${policy.resourceTenantId}' ≠ actor tenant '${policy.tenantId}'`,
    };
  }

  // Rule 3: platform-scope permission requires platform actor
  if (policy.permission === "design.platform.crossTenant" && !policy.isPlatformActor) {
    return {
      action: "deny",
      reason: "platform_scope_required",
      httpStatus: 403,
      detail: "Cross-tenant access requires platform-admin actor",
    };
  }

  return { action: "allow", reason: "allowed" };
}

// ── Audit event ───────────────────────────────────────────────────────────────

/**
 * Structured audit event for security-sensitive design operations.
 * Must NOT include: provider secrets, raw tokens, full prompt text,
 * sensitive artifact payload, or PII beyond actorId.
 */
export interface DesignSecurityAuditEvent {
  event: string;
  decision: "allow" | "deny";
  reason: DesignSecurityReason;
  tenantId: string;
  actorId: string;
  actorType: DesignSecurityPolicy["actorType"];
  resourceScope: DesignResourceScope;
  permission: DesignPermission;
  requestId?: string;
  correlationId?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Short, non-sensitive context label (e.g. route name). */
  context?: string;
}

/**
 * Builds a safe audit event from a policy + decision.
 * Caller must pass this to the audit logger — it is not persisted here.
 * Audit failure MUST NOT change the decision.
 */
export function buildDesignAuditEvent(
  policy: DesignSecurityPolicy,
  decision: DesignSecurityDecision,
  context?: string,
  requestId?: string,
  correlationId?: string,
): DesignSecurityAuditEvent {
  return {
    event: `design_security.${decision.action}`,
    decision: decision.action,
    reason: decision.reason,
    tenantId: policy.tenantId,
    actorId: policy.actorId,
    actorType: policy.actorType,
    resourceScope: policy.resourceScope,
    permission: policy.permission,
    requestId,
    correlationId,
    timestamp: new Date().toISOString(),
    context,
  };
}

// ── Rate limit policy ─────────────────────────────────────────────────────────

/**
 * Rate limit policy for design endpoints.
 * Keys must be tenant + actor aware — never IP-only for authenticated endpoints.
 */
export interface DesignRateLimitPolicy {
  /** Unique key for this limiter (used to namespace Redis/memory store). */
  limiterId: string;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Maximum requests per window. */
  max: number;
  /** Key generator: must include tenantId or actorId. */
  keyBy: "tenantId" | "actorId" | "publicToken";
  /** If config fails to load, this MUST be the safe default (lowest max). */
  failClosedMax: number;
}

/** Canonical rate limit policies for design platform endpoints. */
export const DESIGN_RATE_LIMIT_POLICIES: Record<string, DesignRateLimitPolicy> = {
  design_ai_regenerate: {
    limiterId: "design:ai_regenerate",
    windowMs: 60_000,     // 1 minute
    max: 10,              // 10 AI calls per minute per tenant
    keyBy: "tenantId",
    failClosedMax: 1,     // fail-closed: 1/min if config unreadable
  },
  design_export: {
    limiterId: "design:export",
    windowMs: 60_000,
    max: 20,
    keyBy: "tenantId",
    failClosedMax: 2,
  },
  design_canvas_save: {
    limiterId: "design:canvas_save",
    windowMs: 60_000,
    max: 60,
    keyBy: "actorId",
    failClosedMax: 10,
  },
};

// ── Resource limit policy ─────────────────────────────────────────────────────

/**
 * Hard resource limits for design platform operations.
 * All limits must fail-closed: if the config cannot be read, use the
 * most restrictive (lowest) value, never an unlimited default.
 */
export interface DesignResourceLimitPolicy {
  /** Maximum canvas width in pixels. */
  maxCanvasWidth: number;
  /** Maximum canvas height in pixels. */
  maxCanvasHeight: number;
  /** Maximum number of elements per canvas. */
  maxElementsPerCanvas: number;
  /** Maximum number of active versions per project. */
  maxVersionsPerProject: number;
  /** Maximum number of design projects per tenant. */
  maxProjectsPerTenant: number;
  /** Maximum request payload size in bytes. */
  maxPayloadBytes: number;
  /** Maximum element text content length in characters. */
  maxTextLength: number;
  /** Maximum element name/label length. */
  maxLabelLength: number;
  /** Maximum number of AI regeneration suggestions returned. */
  maxAiSuggestions: number;
  /** Maximum export scale factor. */
  maxExportScale: number;
}

/**
 * Canonical resource limits for the design platform.
 * If process.env values are absent or invalid, fail-closed values are used.
 */
export function getDesignResourceLimits(): DesignResourceLimitPolicy {
  function safeInt(val: string | undefined, failClosed: number, max: number): number {
    if (!val) return failClosed;
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n <= 0) return failClosed;
    return Math.min(n, max);
  }

  return {
    maxCanvasWidth: safeInt(process.env["DESIGN_MAX_CANVAS_WIDTH"], 7680, 16384),
    maxCanvasHeight: safeInt(process.env["DESIGN_MAX_CANVAS_HEIGHT"], 4320, 16384),
    maxElementsPerCanvas: safeInt(process.env["DESIGN_MAX_ELEMENTS"], 500, 2000),
    maxVersionsPerProject: safeInt(process.env["DESIGN_MAX_VERSIONS"], 50, 500),
    maxProjectsPerTenant: safeInt(process.env["DESIGN_MAX_PROJECTS"], 100, 10000),
    maxPayloadBytes: safeInt(process.env["DESIGN_MAX_PAYLOAD_BYTES"], 5_242_880, 52_428_800), // 5 MB fail-closed
    maxTextLength: safeInt(process.env["DESIGN_MAX_TEXT_LENGTH"], 2000, 10000),
    maxLabelLength: safeInt(process.env["DESIGN_MAX_LABEL_LENGTH"], 200, 1000),
    maxAiSuggestions: 3,   // hard-coded — AI responses always trimmed to 3
    maxExportScale: safeInt(process.env["DESIGN_MAX_EXPORT_SCALE"], 4, 8),
  };
}

/**
 * Validates a canvas state against resource limits.
 * Returns a denial decision if any limit is exceeded.
 */
export function validateCanvasResourceLimits(
  state: { width: number; height: number; elements: unknown[] },
  limits: DesignResourceLimitPolicy,
): DesignSecurityDecision {
  if (state.width > limits.maxCanvasWidth || state.height > limits.maxCanvasHeight) {
    return {
      action: "deny",
      reason: "resource_limit_exceeded",
      httpStatus: 422,
      detail: `Canvas dimensions ${state.width}×${state.height} exceed limit ${limits.maxCanvasWidth}×${limits.maxCanvasHeight}`,
    };
  }
  if (state.elements.length > limits.maxElementsPerCanvas) {
    return {
      action: "deny",
      reason: "resource_limit_exceeded",
      httpStatus: 422,
      detail: `Element count ${state.elements.length} exceeds limit ${limits.maxElementsPerCanvas}`,
    };
  }
  return { action: "allow", reason: "allowed" };
}

// ── Plugin security guard ─────────────────────────────────────────────────────

/**
 * Minimum required fields in a design plugin manifest.
 * Plugins must be static/compiled — no remote loading or arbitrary imports.
 */
export interface DesignPluginManifest {
  id: string;
  version: string;
  /** Semver range of the host contract the plugin is compatible with. */
  contractVersion: string;
  /** Declared capabilities — no capability not in this list may be used. */
  capabilities: DesignPluginCapability[];
  /** Secrets must reference secret-service keys, never raw values. */
  secretRefs?: string[];
  /** A raw secret in manifest is a hard rejection. */
  rawSecrets?: never;
}

export type DesignPluginCapability =
  | "canvas.read"
  | "canvas.write"
  | "asset.read"
  | "export.trigger"
  | "ai.prompt"; // highest privilege — requires explicit grant

/** The host plugin registry contract version. */
export const DESIGN_PLUGIN_CONTRACT_VERSION = "1.0";

/** Known registered plugin IDs (static list — no dynamic registration from untrusted sources). */
const KNOWN_PLUGIN_IDS = new Set<string>([
  // Built-in plugins — extend via PR + review, never at runtime from untrusted source
]);

/**
 * Validates a plugin manifest before loading.
 * Fail-closed: any validation failure returns deny.
 */
export function validatePluginManifest(
  manifest: Partial<DesignPluginManifest>,
  requestedCapabilities: DesignPluginCapability[],
): DesignSecurityDecision {
  // Unknown plugin ID
  if (!manifest.id || !KNOWN_PLUGIN_IDS.has(manifest.id)) {
    return { action: "deny", reason: "plugin_unknown_id", httpStatus: 403,
      detail: `Plugin '${manifest.id}' is not in the known registry` };
  }

  // Contract version mismatch
  if (manifest.contractVersion !== DESIGN_PLUGIN_CONTRACT_VERSION) {
    return { action: "deny", reason: "plugin_incompatible_version", httpStatus: 422,
      detail: `Plugin contract '${manifest.contractVersion}' ≠ host '${DESIGN_PLUGIN_CONTRACT_VERSION}'` };
  }

  // Capability escalation: requested must be subset of declared
  const declared = new Set(manifest.capabilities ?? []);
  const escalated = requestedCapabilities.filter((c) => !declared.has(c));
  if (escalated.length > 0) {
    return { action: "deny", reason: "plugin_capability_escalation", httpStatus: 403,
      detail: `Plugin requested undeclared capabilities: ${escalated.join(", ")}` };
  }

  // Raw secret check (belt-and-suspenders for TS — the `never` type handles this)
  if ("rawSecrets" in manifest) {
    return { action: "deny", reason: "plugin_raw_secret_in_manifest", httpStatus: 422,
      detail: "Plugin manifest contains raw secrets — use secret-service refs instead" };
  }

  return { action: "allow", reason: "allowed" };
}

/**
 * Rejects any module path that could load untrusted or remote code.
 * Path traversal, URL schemes, and non-allowlisted paths are all rejected.
 */
export function validatePluginModulePath(modulePath: string): DesignSecurityDecision {
  // Block URL-based module loading (http://, https://, data:, ftp:, etc.)
  // Matches both schemes with :// (http://) and bare schemes (data:, javascript:)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(modulePath)) {
    return { action: "deny", reason: "plugin_unsafe_module", httpStatus: 422,
      detail: `Remote module path rejected: ${modulePath.slice(0, 100)}` };
  }

  // Block path traversal
  if (modulePath.includes("..") || modulePath.includes("\0")) {
    return { action: "deny", reason: "plugin_unsafe_module", httpStatus: 422,
      detail: "Path traversal in plugin module path" };
  }

  // Block absolute paths outside the workspace
  if (modulePath.startsWith("/") && !modulePath.startsWith("/workspace/plugins/")) {
    return { action: "deny", reason: "plugin_unsafe_module", httpStatus: 422,
      detail: "Plugin module path must be within /workspace/plugins/" };
  }

  return { action: "allow", reason: "allowed" };
}
