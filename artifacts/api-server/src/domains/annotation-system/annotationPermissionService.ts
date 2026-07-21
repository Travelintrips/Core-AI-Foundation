/**
 * annotationPermissionService.ts — Team 18 / Universal Annotation and Comment System
 *
 * All authorization checks for annotations. Tenant isolation is enforced here;
 * actor identity is always resolved server-side.
 *
 * Security invariants:
 *   - tenantId is never trusted from client payload — callers must pass the
 *     server-resolved tenantId.
 *   - createdBy / actor identity is never accepted from client body.
 *   - Cross-project annotation association is blocked.
 *   - Rate-limiting for public (token-based) review actors is the
 *     responsibility of the route layer (reuse existing middleware).
 */
import type { AnnotationActorContext, AuthorType } from "./types.js";
import type { AiAnnotation, AiAnnotationComment } from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Throws if the annotation's tenantId does not match the request's resolved
 * tenantId. Call this before any read or write that involves a stored annotation.
 */
export function assertTenantMatch(
  annotationTenantId: string,
  requestTenantId: string,
): void {
  if (annotationTenantId !== requestTenantId) {
    throw new AnnotationPermissionError(
      "TENANT_MISMATCH",
      "Annotation does not belong to the current tenant",
    );
  }
}

/**
 * Throws if the anchor's artifactId differs from the annotation's stored
 * artifactId. Prevents cross-project association.
 */
export function assertNoCrossProjectAnchor(
  storedArtifactId: string,
  requestArtifactId: string,
): void {
  if (storedArtifactId !== requestArtifactId) {
    throw new AnnotationPermissionError(
      "CROSS_PROJECT_ANCHOR",
      "Cannot associate annotation with a different artifact",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actor-identity guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a safe actor context built purely from server-side sources.
 * Call this at the route layer; never let client body supply actorId or tenantId.
 *
 * @param tenantId       Resolved from auth context (e.g. DEFAULT_TENANT_ID)
 * @param actorId        Resolved from session / API key / token (never req.body)
 * @param actorName      Human-readable display name
 * @param authorType     "admin" (api-key) | "client" (workspace token)
 * @param isPlatformAdmin Whether the actor holds platform-admin privileges
 */
export function buildActorContext(
  tenantId: string,
  actorId: string,
  actorName: string,
  authorType: AuthorType,
  isPlatformAdmin = false,
): AnnotationActorContext {
  if (!tenantId) throw new AnnotationPermissionError("MISSING_TENANT", "tenantId is required");
  if (!actorId)  throw new AnnotationPermissionError("MISSING_ACTOR",  "actorId is required");
  return { tenantId, actorId, actorName: actorName || actorId, authorType, isPlatformAdmin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / write permission
// ─────────────────────────────────────────────────────────────────────────────

/** Admin actors can always create. Client actors can create during review. */
export function canCreateAnnotation(ctx: AnnotationActorContext): boolean {
  return ctx.authorType === "admin" || ctx.authorType === "client";
}

// ─────────────────────────────────────────────────────────────────────────────
// Status-transition permissions
// ─────────────────────────────────────────────────────────────────────────────

export function canResolveAnnotation(
  annotation: Pick<AiAnnotation, "tenantId" | "status">,
  ctx: AnnotationActorContext,
): boolean {
  if (annotation.tenantId !== ctx.tenantId) return false;
  return ["open", "acknowledged", "reopened"].includes(annotation.status);
}

export function canReopenAnnotation(
  annotation: Pick<AiAnnotation, "tenantId" | "status">,
  ctx: AnnotationActorContext,
): boolean {
  if (annotation.tenantId !== ctx.tenantId) return false;
  return annotation.status === "resolved";
}

export function canAcknowledgeAnnotation(
  annotation: Pick<AiAnnotation, "tenantId" | "status">,
  ctx: AnnotationActorContext,
): boolean {
  if (annotation.tenantId !== ctx.tenantId) return false;
  return annotation.status === "open";
}

export function canArchiveAnnotation(
  annotation: Pick<AiAnnotation, "tenantId" | "status">,
  ctx: AnnotationActorContext,
): boolean {
  if (annotation.tenantId !== ctx.tenantId) return false;
  // Only admins may archive
  return ctx.authorType === "admin" && annotation.status === "resolved";
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete permission
// ─────────────────────────────────────────────────────────────────────────────

export function canDeleteAnnotation(
  annotation: Pick<AiAnnotation, "tenantId" | "createdBy">,
  ctx: AnnotationActorContext,
): boolean {
  if (annotation.tenantId !== ctx.tenantId) return false;
  if (ctx.isPlatformAdmin) return true;
  if (ctx.authorType === "admin") return true;
  // Clients may only delete their own annotations
  return annotation.createdBy === ctx.actorId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment permissions
// ─────────────────────────────────────────────────────────────────────────────

export function canEditComment(
  comment: Pick<AiAnnotationComment, "createdBy" | "isDeleted">,
  actorId: string,
): boolean {
  if (comment.isDeleted) return false;
  return comment.createdBy === actorId;
}

export function canDeleteComment(
  comment: Pick<AiAnnotationComment, "createdBy" | "isDeleted">,
  ctx: AnnotationActorContext,
): boolean {
  if (comment.isDeleted) return false;
  if (ctx.authorType === "admin") return true;
  return comment.createdBy === ctx.actorId;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML sanitization — no raw HTML stored or returned
// ─────────────────────────────────────────────────────────────────────────────

/** Matches dangerous block elements including their inner content. */
const DANGEROUS_BLOCK_RE = /<(script|style|iframe|object|embed|form|svg)[^>]*>[\s\S]*?<\/\1>/gi;
/** Matches any remaining HTML tag. */
const HTML_TAG_RE        = /<[^>]*>/g;

const ENTITY_MAP: Record<string, string> = {
  "&amp;":  "&",
  "&lt;":   "<",
  "&gt;":   ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;":  "'",
};

/**
 * Strips all HTML tags (including dangerous block content) and decodes
 * common entities. Comments are stored and displayed as plain text only.
 *
 * Pass 1: remove entire blocks like <script>…</script> (content + tags).
 * Pass 2: remove any remaining tags like <b>, <em>, self-closing <img />.
 * Pass 3: decode HTML entities.
 */
export function sanitizeComment(raw: string): string {
  let text = raw.replace(DANGEROUS_BLOCK_RE, "");
  text = text.replace(HTML_TAG_RE, "");
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    text = text.replaceAll(entity, char);
  }
  return text.trim();
}

/**
 * Returns true if the raw text appears to contain HTML markup.
 * Used in tests to assert that unsafe input is rejected.
 */
export function containsHtml(text: string): boolean {
  return HTML_TAG_RE.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationPermissionError
// ─────────────────────────────────────────────────────────────────────────────

export class AnnotationPermissionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AnnotationPermissionError";
  }
}
