-- CST-DEV independent SUBSCRIBER receipt role, NOT the pilot model-worker role.
-- TEMPLATE ONLY. Do not execute until one newly APPROVED Company-1 job exists,
-- independent subscriber custody, DNS/ACL and rollback review are complete.
-- Replace ALL placeholders with validated literals; never run raw template.
-- Run ONLY using the confirmed CST-DEV project xssrfshdrtdfupgqwfdw.
-- Does not change aicore_dev_runtime, active Core, GPT02 signer or PROD.
DO $guard$
BEGIN
 IF current_database()<>'{{EXPECTED_DATABASE}}'
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime')
   OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{SUBSCRIBER_ROLE}}')
   OR '{{SUBSCRIBER_ROLE}}' !~ '^cst_team_onejob_subscriber_[0-9]{8}_[a-f0-9]{8}$'
   OR '{{SUBSCRIBER_ID}}' !~ '^cst-dev-onejob-subscriber-[0-9]{8}-[a-f0-9]{8}$'
   OR '{{REQUEST_ID}}' !~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
   OR '{{EXPECTED_PUBLIC_KEY_SHA256}}' !~ '^[a-f0-9]{64}$'
   OR '{{JOB_ID}}' !~ '^[1-9][0-9]*$' OR '{{JOB_ID}}'='482'
   OR '{{WORKER_ID}}' !~ '^[1-9][0-9]*$'
   OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.ai_events'::regclass)
   OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.ai_audit_logs'::regclass)
   OR '{{EXPIRES}}'::timestamptz NOT BETWEEN
      clock_timestamp()+interval '2 minutes'
      AND clock_timestamp()+interval '45 minutes'
   OR NOT EXISTS(
     SELECT 1 FROM ai_platform.ai_jobs j
     WHERE j.id={{JOB_ID}} AND j.status='queued'
       AND j.job_type='ollama_model_invocation'
       AND j.required_capability='ollama_inference'
       AND j.payload_json->>'requestId'='{{REQUEST_ID}}'
       AND j.payload_json->>'modelId'='qwen2.5:3b'
   )
 THEN RAISE EXCEPTION 'CST_ONEJOB_SUBSCRIBER_WRONG_DEV_OR_UNAPPROVED_JOB'; END IF;
END $guard$;

-- DB password is a new ephemeral machine-to-machine credential, not a user's
-- interactive login or the shared aicore_dev_runtime database password.
CREATE ROLE {{SUBSCRIBER_ROLE}} LOGIN PASSWORD '{{SUBSCRIBER_PASSWORD}}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  VALID UNTIL '{{EXPIRES}}';
GRANT CONNECT ON DATABASE {{EXPECTED_DATABASE}} TO {{SUBSCRIBER_ROLE}};
GRANT USAGE ON SCHEMA ai_platform TO {{SUBSCRIBER_ROLE}};
-- No SELECT on ai_jobs or ai_event_subscriptions; no event UPDATE or DELETE.
GRANT SELECT ON TABLE ai_platform.ai_events TO {{SUBSCRIBER_ROLE}};
GRANT INSERT ON TABLE ai_platform.ai_audit_logs TO {{SUBSCRIBER_ROLE}};
GRANT USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq TO {{SUBSCRIBER_ROLE}};

CREATE POLICY cst_onejob_subscriber_event_select ON ai_platform.ai_events
 FOR SELECT TO {{SUBSCRIBER_ROLE}}
 USING (
    clock_timestamp()<'{{EXPIRES}}'::timestamptz
    AND source_module='job-engine' AND event_type='job.completed'
    AND source_id='{{JOB_ID}}' AND status='published'
    AND payload_json->>'jobId'='{{JOB_ID}}'
    AND payload_json->>'workerId'='{{WORKER_ID}}'
    AND payload_json->>'jobType'='ollama_model_invocation'
 );
-- Append-only independent receipt: one event and one expected independent
-- subscriber. No fabricated status from the pilot's own event publication.
CREATE POLICY cst_onejob_subscriber_receipt_insert ON ai_platform.ai_audit_logs
 FOR INSERT TO {{SUBSCRIBER_ROLE}}
 WITH CHECK (
    clock_timestamp()<'{{EXPIRES}}'::timestamptz
    AND module='cst-team-model-subscriber'
    AND action='job_completed_received'
    AND resource_type='ai_event' AND status='success'
    AND actor_id='{{SUBSCRIBER_ID}}'
    AND actor_type='independent-subscriber'
    AND tenant_id='1'
    AND jsonb_typeof(details)='object'
    AND jsonb_typeof(details->'payload')='object'
    AND details->'payload'->>'type'='CST_DEV_JOB_COMPLETED_SUBSCRIBER_RECEIPT'
    AND details->'payload'->>'project'='xssrfshdrtdfupgqwfdw'
    AND details->'payload'->>'companyId'='1'
    AND details->'payload'->>'subscriberId'='{{SUBSCRIBER_ID}}'
    AND details->'payload'->>'jobId'='{{JOB_ID}}'
    AND details->'payload'->>'workerId'='{{WORKER_ID}}'
    AND details->'payload'->>'requestId'='{{REQUEST_ID}}'
    AND details->'payload'->>'eventId'=resource_id
    AND details->>'publicKeySha256'='{{EXPECTED_PUBLIC_KEY_SHA256}}'
    AND details->>'signatureBase64' ~ '^[A-Za-z0-9+/]{86}==$'
    AND EXISTS(
      SELECT 1 FROM ai_platform.ai_events e
      WHERE e.event_id=ai_audit_logs.resource_id
        AND e.source_id='{{JOB_ID}}' AND e.event_type='job.completed'
        AND e.source_module='job-engine' AND e.status='published'
        AND e.payload_json->>'workerId'='{{WORKER_ID}}'
        AND e.payload_json->>'jobId'='{{JOB_ID}}'
        AND e.correlation_id=details->'payload'->>'correlationId'
    )
 );
-- A single immutable ACK per independent subscriber/event; duplicate
-- delivery cannot append multiple "success" evidence rows.
-- This additive index affects only a new, exact module/action and retains
-- original audit records. Never drop existing audit rows for cleanup.
CREATE UNIQUE INDEX IF NOT EXISTS cst_onejob_subscriber_receipt_once
 ON ai_platform.ai_audit_logs (resource_id,actor_id)
 WHERE module='cst-team-model-subscriber'
   AND action='job_completed_received'
   AND status='success';

DO $index$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM pg_index ix
   JOIN pg_class idx ON idx.oid=ix.indexrelid
   JOIN pg_class tab ON tab.oid=ix.indrelid
   JOIN pg_namespace ns ON ns.oid=tab.relnamespace
   WHERE ns.nspname='ai_platform'
     AND tab.relname='ai_audit_logs'
     AND idx.relname='cst_onejob_subscriber_receipt_once'
     AND ix.indisunique AND ix.indisvalid AND ix.indisready
     AND position('(resource_id, actor_id)' in pg_get_indexdef(ix.indexrelid))>0
     AND position('cst-team-model-subscriber' in pg_get_indexdef(ix.indexrelid))>0
     AND position('job_completed_received' in pg_get_indexdef(ix.indexrelid))>0
 )
 THEN RAISE EXCEPTION 'CST_ONEJOB_RECEIPT_INDEX_NOT_VERIFIED'; END IF;
END $index$;

DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{SUBSCRIBER_ROLE}}'
   AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
   WHERE r.rolname='{{SUBSCRIBER_ROLE}}')
 THEN RAISE EXCEPTION 'CST_ONEJOB_SUBSCRIBER_ESCALATED'; END IF;
END $guard$;
