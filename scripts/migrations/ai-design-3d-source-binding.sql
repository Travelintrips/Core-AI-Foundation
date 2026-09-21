-- AI Design Core 3D canonical source binding
-- Additive/idempotent: preserves existing Design Studio projects and versions.
ALTER TABLE ai_platform.ai_design_projects
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ai_design_projects_tenant_source_uidx
  ON ai_platform.ai_design_projects (tenant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE ai_platform.ai_design_projects
  DROP CONSTRAINT IF EXISTS ai_design_projects_source_type_check;

ALTER TABLE ai_platform.ai_design_projects
  ADD CONSTRAINT ai_design_projects_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('interior', 'fashion'));
