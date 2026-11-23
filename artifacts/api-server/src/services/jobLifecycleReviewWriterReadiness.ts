/**
 * DEV-only fail-closed writer readiness gate.
 *
 * The existing @workspace/db runtime must never receive generic audit INSERT.
 * The proposed SQL writer role and synthetic locking procedure are not a
 * deployed, independently authenticated and proof-bound execution boundary.
 *
 * Signing cannot be activated merely by setting the signing feature flag.
 * Replace this deliberate NO-GO only after a separately credentialed writer
 * with atomic evidence fencing and review signature validation is proven E2E.
 */
export function isTrustedDevReviewWriterReady():false {
  return false;
}
