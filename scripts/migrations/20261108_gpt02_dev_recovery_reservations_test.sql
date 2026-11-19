-- Run in an isolated PostgreSQL database with stub parent tables.
\set ON_ERROR_STOP on
SET ai_core.dev_migration_authorized = 'true';
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id UUID PRIMARY KEY);
CREATE TABLE ai_platform.ai_human_tasks(id INTEGER PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb');
INSERT INTO ai_platform.ai_human_tasks VALUES (6);
\ir 20261108_gpt02_dev_recovery_reservations.sql
\ir 20261108_gpt02_dev_recovery_reservations.sql
DO $checks$
BEGIN
  IF (SELECT count(*) FROM ai_platform.gpt02_dev_recovery_reservations)<>0 THEN
    RAISE EXCEPTION 'MIGRATION_CREATED_RESERVATION';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.gpt02_dev_recovery_reservations'::regclass) THEN
    RAISE EXCEPTION 'RLS_DISABLED';
  END IF;
END $checks$;
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
(parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
 '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
 '2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
DO $tests$
BEGIN
  IF (SELECT count(*) FROM ai_platform.gpt02_dev_recovery_reservations)<>1 THEN
    RAISE EXCEPTION 'INSERT_FAILED';
  END IF;
  IF (SELECT bool_or(execution_authorized OR lease_token_hash IS NOT NULL OR lease_owner_worker_id IS NOT NULL)
    FROM ai_platform.gpt02_dev_recovery_reservations) THEN
    RAISE EXCEPTION 'RESERVATION_GRANTED_EXECUTION';
  END IF;
END $tests$;

-- Same parent, same candidate, or same idempotency UUID cannot be inserted twice.
DO $negative$
DECLARE err TEXT;
BEGIN
  BEGIN
    INSERT INTO ai_platform.gpt02_dev_recovery_reservations
    (parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
    VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
      'b1b5e73d-d77a-459f-8130-08e74fcbfc42',6,135,
      'd91d354c-38b8-48eb-92f4-af2e797c96f3',repeat('f',64));
    RAISE EXCEPTION 'DUPLICATE_PARENT_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE ai_platform.gpt02_dev_recovery_reservations SET execution_authorized=true;
    RAISE EXCEPTION 'EXECUTION_GRANT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE ai_platform.gpt02_dev_recovery_reservations SET lease_owner_worker_id='worker';
    RAISE EXCEPTION 'LEASE_GRANTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO ai_platform.gpt02_dev_recovery_reservations
    (parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
    VALUES ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',
      '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
      '9a63b0ac-b3fa-4930-a8b7-d6e4c521a412',repeat('f',64));
    RAISE EXCEPTION 'CANDIDATE_REPLAY_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $negative$;
SELECT count(*) AS rows_expected_1 FROM ai_platform.gpt02_dev_recovery_reservations;
