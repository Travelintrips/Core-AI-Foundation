#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME="gpt02-binding-test-$$"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$NAME" -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=isolated postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 35); do if docker exec "$NAME" pg_isready -U postgres -d isolated >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[ "$ready" = 1 ] || { echo "DISPOSABLE_POSTGRES_NOT_READY"; exit 2; }
docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d isolated < "$ROOT/docs/dev/gpt02-task-attempt-binding.proposed.sql" >/dev/null
# Script is idempotent for schema and trigger (no rows yet).
docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d isolated < "$ROOT/docs/dev/gpt02-task-attempt-binding.proposed.sql" >/dev/null
cat <<'SQL' | docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d isolated >/tmp/gpt02-task-binding-$$.log
DO $test$
DECLARE
 cmd uuid:='c43000bf-c952-4e91-9344-02d9256f9768';
 claim uuid; n int;
BEGIN
 INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
 (tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,recorded_by,
 source_observed_at,receiver_observed_at)
 VALUES ('default',cmd,'965604aa-9e6b-478b-8e33-cc52a8f0b8ca',
 'e343ceee-98cb-4f28-9314-e96be590ea82',42,
 '93f178a4-444e-48df-8a49-242f0bdf1b51',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
 'owner-reviewer-1',repeat('a',64),'independent_dev_attestation','internal:301',now(),now()) RETURNING id INTO claim;
 SELECT count(*) INTO n FROM ai_platform.dev_gpt02_task_attempt_binding_claims
 WHERE binding_verified=false AND may_dispatch_worker=false AND may_close_job=false;
 IF n<>1 THEN RAISE EXCEPTION 'FAIL_INERT_CLAIM'; END IF;
 RAISE NOTICE 'INERT_CLAIM_INSERT_PASS';
 BEGIN
  INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
  SELECT gen_random_uuid(),tenant_id,core_command_id,core_coding_task_id,
   gen_random_uuid(),hub_ai_task_id,gen_random_uuid(),attempt_number,worker_id,
   assignee_namespace,assignee_id,owner_namespace,accountable_owner_id,repeat('b',64),
   evidence_source,recorded_by,source_observed_at,receiver_observed_at,created_at,
   false,false,false FROM ai_platform.dev_gpt02_task_attempt_binding_claims WHERE id=claim;
  RAISE EXCEPTION 'REPLAY_NOT_REJECTED';
 EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'COMMAND_REPLAY_DENIED_PASS'; END;
 BEGIN
  UPDATE ai_platform.dev_gpt02_task_attempt_binding_claims SET accountable_owner_id='forged' WHERE id=claim;
  RAISE EXCEPTION 'MUTATION_NOT_REJECTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'UPDATE_IMMUTABLE_PASS'; END;
 BEGIN
  DELETE FROM ai_platform.dev_gpt02_task_attempt_binding_claims WHERE id=claim;
  RAISE EXCEPTION 'DELETE_NOT_REJECTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'DELETE_IMMUTABLE_PASS'; END;
 BEGIN
  UPDATE ai_platform.dev_gpt02_task_attempt_binding_claims SET binding_verified=true WHERE id=claim;
  RAISE EXCEPTION 'SELF_ATTESTATION_NOT_REJECTED';
 EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'SELF_ATTESTATION_DENIED_PASS'; END;
 BEGIN
  INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
  (tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,attempt_id,
   attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
   accountable_owner_id,evidence_sha256,evidence_source,recorded_by,source_observed_at,receiver_observed_at)
  VALUES ('other',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),99,gen_random_uuid(),1,
   'openclaw-dell-chatgpt-wake-dev','ai_task_hub.public.ai_tasks.assigned_to_id',7,
   'ai_task_hub.accountable_owner','owner-reviewer-1',repeat('c',64),
   'independent_dev_attestation','internal:301',now(),now());
  RAISE EXCEPTION 'CROSS_TENANT_NOT_REJECTED';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'CROSS_TENANT_DENIED_PASS'; END;
END;
$test$;
-- Each independent identity or evidence digest is lifetime unique.
DO $test$
DECLARE
 baseline ai_platform.dev_gpt02_task_attempt_binding_claims%ROWTYPE;
 mutated ai_platform.dev_gpt02_task_attempt_binding_claims%ROWTYPE;
 k text;
BEGIN
 SELECT * INTO baseline FROM ai_platform.dev_gpt02_task_attempt_binding_claims LIMIT 1;
 FOR k IN SELECT unnest(ARRAY['receiver','attempt','task_attempt','evidence']) LOOP
  mutated:=baseline;
  mutated.id:=gen_random_uuid();
  mutated.core_command_id:=gen_random_uuid();
  mutated.hub_execution_job_id:=gen_random_uuid();
  mutated.attempt_id:=gen_random_uuid();
  mutated.hub_ai_task_id:=44;
  mutated.evidence_sha256:=repeat('d',64);
  IF k='receiver' THEN mutated.hub_execution_job_id:=baseline.hub_execution_job_id; END IF;
  IF k='attempt' THEN mutated.attempt_id:=baseline.attempt_id; END IF;
  IF k='task_attempt' THEN mutated.hub_ai_task_id:=baseline.hub_ai_task_id; END IF;
  IF k='evidence' THEN mutated.evidence_sha256:=baseline.evidence_sha256; END IF;
  BEGIN
   INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims SELECT mutated.*;
   RAISE EXCEPTION 'DUPLICATE_%_NOT_REJECTED',k;
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'DUPLICATE_%_DENIED_PASS',upper(k); END;
 END LOOP;
 BEGIN
  INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
  SELECT gen_random_uuid(),tenant_id,gen_random_uuid(),core_coding_task_id,
   gen_random_uuid(),55,gen_random_uuid(),2,worker_id,assignee_namespace,assignee_id,
   owner_namespace,' ',repeat('e',64),evidence_source,recorded_by,
   source_observed_at,receiver_observed_at,created_at,false,false,false
  FROM ai_platform.dev_gpt02_task_attempt_binding_claims WHERE id=baseline.id;
  RAISE EXCEPTION 'BLANK_OWNER_ACCEPTED';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'BLANK_OWNER_DENIED_PASS'; END;
 BEGIN
  INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
  SELECT gen_random_uuid(),tenant_id,gen_random_uuid(),core_coding_task_id,
   gen_random_uuid(),56,gen_random_uuid(),2,worker_id,assignee_namespace,assignee_id,
   owner_namespace,accountable_owner_id,repeat('f',64),evidence_source,recorded_by,
   source_observed_at,receiver_observed_at,created_at,false,true,false
  FROM ai_platform.dev_gpt02_task_attempt_binding_claims WHERE id=baseline.id;
  RAISE EXCEPTION 'GRANT_FLAG_ACCEPTED';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'DISPATCH_FLAG_DENIED_PASS'; END;
END;
$test$;
-- Ordinary application login has no table INSERT grant.
CREATE ROLE isolated_app_login LOGIN;
DO $test$
BEGIN
 IF has_table_privilege('isolated_app_login','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT') THEN
  RAISE EXCEPTION 'APPLICATION_WRITE_PRIVILEGE'; END IF;
 RAISE NOTICE 'APPLICATION_INSERT_DENIED_PASS';
END;$test$;
-- No privileges are given to non-owner application roles.
DO $test$
BEGIN
 IF has_table_privilege('public','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT') THEN
  RAISE EXCEPTION 'PUBLIC_WRITE_PRIVILEGE'; END IF;
 RAISE NOTICE 'PUBLIC_INSERT_DENIED_PASS';
END;$test$;
SQL
cat /tmp/gpt02-task-binding-$$.log | grep -E 'PASS|NOTICE' || true
rm -f /tmp/gpt02-task-binding-$$.log
printf 'DISPOSABLE_POSTGRES_BINDING_TEST_PASS\n'
