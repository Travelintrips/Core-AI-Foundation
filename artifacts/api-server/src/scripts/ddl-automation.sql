-- DDL: ai_customer_segments, ai_automation_rules, ai_automation_executions
-- Run once against the Supabase dev/prod database.
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_segments (
  id                   serial PRIMARY KEY,
  customer_profile_id  integer NOT NULL UNIQUE,
  segment              text    NOT NULL DEFAULT 'new',
  previous_segment     text,
  segment_score        integer NOT NULL DEFAULT 0,
  segment_reason       text,
  metadata_json        jsonb,
  calculated_at        timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_automation_rules (
  id                   serial PRIMARY KEY,
  rule_code            text NOT NULL UNIQUE,
  rule_name            text NOT NULL,
  description          text,
  trigger_event        text NOT NULL,
  conditions_json      jsonb NOT NULL DEFAULT '{}',
  action_type          text NOT NULL,
  action_config_json   jsonb,
  priority             integer NOT NULL DEFAULT 50,
  is_enabled           boolean NOT NULL DEFAULT true,
  execution_count      integer NOT NULL DEFAULT 0,
  last_executed_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_automation_executions (
  id                   serial PRIMARY KEY,
  rule_id              integer NOT NULL REFERENCES ai_platform.ai_automation_rules(id) ON DELETE CASCADE,
  trigger_event_id     text,
  trigger_event_type   text,
  customer_profile_id  integer,
  status               text NOT NULL DEFAULT 'success',
  result_json          jsonb,
  executed_at          timestamptz NOT NULL DEFAULT now()
);
