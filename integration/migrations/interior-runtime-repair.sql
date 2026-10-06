-- Interior Design runtime repair
-- Additive/idempotent production drift repair for pre-existing Team 17 tables.
SET search_path TO ai_platform, public;

CREATE SEQUENCE IF NOT EXISTS ai_platform.id_projects_id_seq;
ALTER SEQUENCE ai_platform.id_projects_id_seq OWNED BY ai_platform.id_projects.id;
ALTER TABLE ai_platform.id_projects
  ALTER COLUMN id SET DEFAULT nextval('ai_platform.id_projects_id_seq'::regclass);

CREATE SEQUENCE IF NOT EXISTS ai_platform.id_briefs_id_seq;
ALTER SEQUENCE ai_platform.id_briefs_id_seq OWNED BY ai_platform.id_briefs.id;
ALTER TABLE ai_platform.id_briefs
  ALTER COLUMN id SET DEFAULT nextval('ai_platform.id_briefs_id_seq'::regclass);

CREATE SEQUENCE IF NOT EXISTS ai_platform.id_outputs_id_seq;
ALTER SEQUENCE ai_platform.id_outputs_id_seq OWNED BY ai_platform.id_outputs.id;
ALTER TABLE ai_platform.id_outputs
  ALTER COLUMN id SET DEFAULT nextval('ai_platform.id_outputs_id_seq'::regclass);

DO $$
DECLARE
  max_id BIGINT;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM ai_platform.id_projects;
  PERFORM setval('ai_platform.id_projects_id_seq', GREATEST(max_id, 1), max_id > 0);

  SELECT COALESCE(MAX(id), 0) INTO max_id FROM ai_platform.id_briefs;
  PERFORM setval('ai_platform.id_briefs_id_seq', GREATEST(max_id, 1), max_id > 0);

  SELECT COALESCE(MAX(id), 0) INTO max_id FROM ai_platform.id_outputs;
  PERFORM setval('ai_platform.id_outputs_id_seq', GREATEST(max_id, 1), max_id > 0);
END $$;

ALTER TABLE ai_platform.creative_ai_assets
  ADD COLUMN IF NOT EXISTS render_stage TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS render_session_id INTEGER
    REFERENCES ai_platform.creative_render_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concept_index INTEGER,
  ADD COLUMN IF NOT EXISTS ai_explanation TEXT,
  ADD COLUMN IF NOT EXISTS estimated_final_cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS estimated_render_time_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_creative_ai_assets_render_stage
  ON ai_platform.creative_ai_assets(render_stage);

CREATE INDEX IF NOT EXISTS idx_creative_ai_assets_render_session
  ON ai_platform.creative_ai_assets(render_session_id);
