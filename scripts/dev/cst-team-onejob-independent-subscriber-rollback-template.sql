-- CST-DEV one-job independent subscriber role teardown (TEMPLATE ONLY).
-- Run only after subscriber receipt evidence is archived and verified.
-- Never remove persisted receipts, the receipt uniqueness index, jobs or events.
-- The target project must be independently confirmed as CST-DEV.
DO $guard$
BEGIN
 IF current_database()<>'{{EXPECTED_DATABASE}}'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
    OR '{{SUBSCRIBER_ROLE}}' !~ '^cst_team_onejob_subscriber_[0-9]{8}_[a-f0-9]{8}$'
 THEN RAISE EXCEPTION 'CST_ONEJOB_SUBSCRIBER_ROLLBACK_WRONG_DATABASE'; END IF;
END $guard$;

-- Revoke the exact machine identity and invalidate only its own sessions.
ALTER ROLE {{SUBSCRIBER_ROLE}} NOLOGIN PASSWORD NULL;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE usename='{{SUBSCRIBER_ROLE}}' AND pid<>pg_backend_pid();

DROP POLICY IF EXISTS cst_onejob_subscriber_event_select ON ai_platform.ai_events;
DROP POLICY IF EXISTS cst_onejob_subscriber_receipt_insert ON ai_platform.ai_audit_logs;
REVOKE SELECT ON ai_platform.ai_events FROM {{SUBSCRIBER_ROLE}};
REVOKE INSERT ON ai_platform.ai_audit_logs FROM {{SUBSCRIBER_ROLE}};
REVOKE USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq FROM {{SUBSCRIBER_ROLE}};
REVOKE USAGE ON SCHEMA ai_platform FROM {{SUBSCRIBER_ROLE}};
REVOKE CONNECT ON DATABASE {{EXPECTED_DATABASE}} FROM {{SUBSCRIBER_ROLE}};
DROP ROLE {{SUBSCRIBER_ROLE}};

DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{SUBSCRIBER_ROLE}}')
 THEN RAISE EXCEPTION 'CST_ONEJOB_SUBSCRIBER_ROLE_STILL_EXISTS'; END IF;
 IF to_regclass('ai_platform.cst_onejob_subscriber_receipt_once') IS NULL
 THEN RAISE EXCEPTION 'CST_ONEJOB_IMMUTABLE_RECEIPT_UNIQUENESS_NOT_RETAINED'; END IF;
END $guard$;
