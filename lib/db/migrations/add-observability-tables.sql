-- ============================================================
-- AI Observability & Cost Intelligence — DDL Migration
-- Run once in Supabase SQL editor (or via the seed route below)
-- ============================================================

-- 1. Per-request execution log
CREATE TABLE IF NOT EXISTS ai_platform.ai_execution_logs (
  id                 serial PRIMARY KEY,
  company_id         text,
  workflow_id        integer,
  job_id             integer,
  order_id           text,
  conversation_id    text,
  agent_id           integer,
  agent_name         text,
  provider_id        integer,
  provider_name      text,
  model_id           integer,
  model_name         text,
  request_type       text NOT NULL DEFAULT 'text',
  prompt_tokens      integer NOT NULL DEFAULT 0,
  completion_tokens  integer NOT NULL DEFAULT 0,
  cached_tokens      integer NOT NULL DEFAULT 0,
  reasoning_tokens   integer NOT NULL DEFAULT 0,
  total_tokens       integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(14,8),
  currency           text NOT NULL DEFAULT 'USD',
  latency_ms         integer,
  started_at         timestamptz,
  finished_at        timestamptz,
  status             text NOT NULL DEFAULT 'success',
  error_message      text,
  retry_count        integer NOT NULL DEFAULT 0,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_execution_logs_job_id_idx        ON ai_platform.ai_execution_logs (job_id);
CREATE INDEX IF NOT EXISTS ai_execution_logs_workflow_id_idx   ON ai_platform.ai_execution_logs (workflow_id);
CREATE INDEX IF NOT EXISTS ai_execution_logs_created_at_idx    ON ai_platform.ai_execution_logs (created_at);
CREATE INDEX IF NOT EXISTS ai_execution_logs_provider_name_idx ON ai_platform.ai_execution_logs (provider_name);
CREATE INDEX IF NOT EXISTS ai_execution_logs_agent_name_idx    ON ai_platform.ai_execution_logs (agent_name);

-- 2. Aggregated per-workflow cost
CREATE TABLE IF NOT EXISTS ai_platform.ai_workflow_costs (
  id                      serial PRIMARY KEY,
  workflow_id             integer,
  job_id                  integer,
  order_id                text,
  company_id              text,
  total_agents            integer NOT NULL DEFAULT 0,
  total_prompt_tokens     integer NOT NULL DEFAULT 0,
  total_completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens            integer NOT NULL DEFAULT 0,
  total_cost_usd          numeric(14,8),
  processing_time_ms      integer,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_workflow_costs_workflow_id_idx ON ai_platform.ai_workflow_costs (workflow_id);
CREATE INDEX IF NOT EXISTS ai_workflow_costs_order_id_idx   ON ai_platform.ai_workflow_costs (order_id);
CREATE INDEX IF NOT EXISTS ai_workflow_costs_created_at_idx ON ai_platform.ai_workflow_costs (created_at);

-- 3. Dynamic model pricing (per 1M tokens, USD)
CREATE TABLE IF NOT EXISTS ai_platform.ai_provider_pricing (
  id                   serial PRIMARY KEY,
  provider             text NOT NULL,
  model                text NOT NULL,
  input_price_per_1m   numeric(12,6) NOT NULL DEFAULT 2.50,
  output_price_per_1m  numeric(12,6) NOT NULL DEFAULT 10.00,
  cached_input_price   numeric(12,6),
  reasoning_price      numeric(12,6),
  currency             text NOT NULL DEFAULT 'USD',
  effective_date       date,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_provider_pricing_provider_model_idx ON ai_platform.ai_provider_pricing (provider, model);
CREATE INDEX IF NOT EXISTS ai_provider_pricing_active_idx         ON ai_platform.ai_provider_pricing (active);

-- 4. Seed default pricing (July 2025 public rates)
INSERT INTO ai_platform.ai_provider_pricing
  (provider, model, input_price_per_1m, output_price_per_1m, cached_input_price, reasoning_price, effective_date)
VALUES
  ('openai',    'gpt-4o',                    2.50,   10.00,  1.25,   NULL,  '2024-11-01'),
  ('openai',    'gpt-4o-mini',               0.15,    0.60,  0.075,  NULL,  '2024-07-01'),
  ('openai',    'gpt-4-turbo',               10.00,  30.00,  NULL,   NULL,  '2024-04-01'),
  ('openai',    'gpt-3.5-turbo',             0.50,    1.50,  NULL,   NULL,  '2024-01-01'),
  ('openai',    'o1',                        15.00,  60.00,  7.50,   NULL,  '2024-12-01'),
  ('openai',    'o1-mini',                   3.00,   12.00,  1.50,   NULL,  '2024-09-01'),
  ('openai',    'o3-mini',                   1.10,    4.40,  0.55,   NULL,  '2025-01-01'),
  ('anthropic', 'claude-3-5-sonnet-20241022',3.00,   15.00,  1.50,   NULL,  '2024-10-01'),
  ('anthropic', 'claude-3-5-haiku-20241022', 0.80,    4.00,  0.40,   NULL,  '2024-11-01'),
  ('anthropic', 'claude-3-opus-20240229',    15.00,  75.00,  7.50,   NULL,  '2024-03-01'),
  ('anthropic', 'claude-3-sonnet-20240229',  3.00,   15.00,  NULL,   NULL,  '2024-03-01'),
  ('anthropic', 'claude-3-haiku-20240307',   0.25,    1.25,  NULL,   NULL,  '2024-03-01'),
  ('google',    'gemini-1.5-pro',            1.25,    5.00,  NULL,   NULL,  '2024-05-01'),
  ('google',    'gemini-1.5-flash',          0.075,   0.30,  NULL,   NULL,  '2024-05-01'),
  ('google',    'gemini-2.0-flash',          0.10,    0.40,  NULL,   NULL,  '2025-02-01'),
  ('mistral',   'mistral-large-latest',      2.00,    6.00,  NULL,   NULL,  '2024-01-01'),
  ('mistral',   'mistral-small-latest',      0.20,    0.60,  NULL,   NULL,  '2024-01-01'),
  ('mistral',   'open-mistral-7b',           0.25,    0.25,  NULL,   NULL,  '2024-01-01'),
  ('replicate', 'black-forest-labs/flux-1.1-pro', 0.00, 0.00, NULL,  NULL,  '2024-01-01')
ON CONFLICT DO NOTHING;
