-- WP-12 Interior Design export idempotency hardening
-- Additive index migration. Existing rows and package bytes are not modified.
SET search_path TO ai_platform, public;

-- The request identity is tenant + project + approved source + idempotency key.
-- Format and included sections are validated in the service before reuse.
-- A prior partial attempt used the same name without source_version_hash;
-- replace that index before creating the canonical scope.
DROP INDEX IF EXISTS ai_platform.export_packages_idempotency_scope_uidx;
CREATE UNIQUE INDEX export_packages_idempotency_scope_uidx
  ON ai_platform.export_packages
    (tenant_id, project_uuid, source_version_hash, idempotency_key);

-- Remove the earlier weaker scope after the canonical index exists.
DROP INDEX IF EXISTS ai_platform.export_packages_idempotency_uidx;