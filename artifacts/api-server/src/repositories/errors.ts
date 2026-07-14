/**
 * repositories/errors.ts — WP-02 typed error model for the repository layer.
 *
 * These are distinct from security/tenantResolution.ts's TenantMismatchError
 * (an HTTP-boundary/routing concern). Repository errors are thrown by
 * data-access code and are expected to be caught by callers (routes,
 * services) that already know how to map domain errors to HTTP responses —
 * mirroring the existing pattern used by PackageManagerError.
 */

export class RepositoryNotFoundError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string | number,
  ) {
    super(`${resourceType} ${resourceId} not found`);
    this.name = "RepositoryNotFoundError";
  }
}

/**
 * Thrown when a repository call would read/write a row belonging to a
 * different tenant than the one on the calling RequestContext. This is a
 * defense-in-depth check inside the repository itself — the route/service
 * layer should already have resolved the correct tenant (see
 * security/tenantResolution.ts) — but the repository never trusts that and
 * re-validates on every row it touches.
 */
export class RepositoryTenantMismatchError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string | number,
  ) {
    super(`${resourceType} ${resourceId} does not belong to the requesting tenant`);
    this.name = "RepositoryTenantMismatchError";
  }
}

/** Thrown when a soft-delete is attempted on a row that is already soft-deleted. */
export class RepositoryAlreadyDeletedError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string | number,
  ) {
    super(`${resourceType} ${resourceId} has already been deleted`);
    this.name = "RepositoryAlreadyDeletedError";
  }
}

/** Optimistic-concurrency / state-transition conflicts (e.g. concurrent install races). */
export class RepositoryConflictError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

/**
 * Thrown when a caller attempts a cross-tenant / platform-wide repository
 * operation without an explicit, justified PlatformOperation on the
 * RepositoryContext (see repositories/types.ts). This exists so
 * "isPlatformAdmin" can never silently widen a query's scope.
 */
export class RepositoryPlatformScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryPlatformScopeError";
  }
}
