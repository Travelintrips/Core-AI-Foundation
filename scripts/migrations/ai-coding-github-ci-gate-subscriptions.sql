-- DEV-first wiring for the existing signed GitHub coding webhook.
-- The coding_ci_gate handler independently verifies sourceModule='github-webhook',
-- exact repository/SHA, check name, and the full required-check quorum.
-- This migration does not create task bindings, approve work, or promote PROD.
-- Do not overwrite intentionally disabled subscriptions.
INSERT INTO ai_platform.ai_event_subscriptions
  (subscription_name,event_type,handler_type,handler_config_json,status,retry_policy)
SELECT 'coding-github-check-run-ci-gate', 'coding.github.check_run',
       'coding_ci_gate', '{"trustedSource":"github-webhook","version":2}'::jsonb,
       'active','{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ai_platform.ai_event_subscriptions
  WHERE subscription_name='coding-github-check-run-ci-gate'
);

INSERT INTO ai_platform.ai_event_subscriptions
  (subscription_name,event_type,handler_type,handler_config_json,status,retry_policy)
SELECT 'coding-github-workflow-run-ci-gate', 'coding.github.workflow_run',
       'coding_ci_gate', '{"trustedSource":"github-webhook","version":2}'::jsonb,
       'active','{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ai_platform.ai_event_subscriptions
  WHERE subscription_name='coding-github-workflow-run-ci-gate'
);
