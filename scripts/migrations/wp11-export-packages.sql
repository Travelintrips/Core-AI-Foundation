-- WP-11 Interior Design Export Engine
-- Additive and idempotent. Binary files remain in Supabase Storage bucket ai-assets.
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.export_packages (
  id                   BIGSERIAL PRIMARY KEY,
  tenant_id            TEXT NOT NULL DEFAULT 'default',
  project_uuid         TEXT NOT NULL,
  source_version_id    TEXT,
  source_version_number INTEGER,
  source_version_hash  TEXT NOT NULL,
  format               TEXT NOT NULL DEFAULT 'zip',
  included_sections    JSONB NOT NULL DEFAULT '["specification","materials","furniture","moodboard"]'::jsonb,
  status               TEXT NOT NULL DEFAULT 'queued',
  job_id               BIGINT,
  idempotency_key      TEXT NOT NULL,
  manifest_json        JSONB,
  storage_path         TEXT,
  file_name            TEXT,
  mime_type            TEXT,
  file_size_bytes      INTEGER,
  checksum             TEXT,
  error_code            TEXT,
  error_message        TEXT,
  retry_count          INTEGER NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT export_packages_status_chk
    CHECK (status IN ('queued', 'generating', 'completed', 'failed', 'cancelled')),
  CONSTRAINT export_packages_format_chk
    CHECK (format IN ('zip', 'specification_pdf', 'materials_csv', 'materials_pdf',
                      'furniture_csv', 'furniture_pdf', 'moodboard_pdf'))
);

CREATE INDEX IF NOT EXISTS export_packages_tenant_project_idx
  ON ai_platform.export_packages (tenant_id, project_uuid);
CREATE INDEX IF NOT EXISTS export_packages_active_idx
  ON ai_platform.export_packages (tenant_id, project_uuid, status);
CREATE UNIQUE INDEX IF NOT EXISTS export_packages_idempotency_uidx
  ON ai_platform.export_packages
    (tenant_id, project_uuid, source_version_hash, idempotency_key);
CREATE INDEX IF NOT EXISTS export_packages_source_version_idx
  ON ai_platform.export_packages (tenant_id, project_uuid, source_version_id);