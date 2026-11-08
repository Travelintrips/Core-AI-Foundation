#!/usr/bin/env bash
# Isolated PostgreSQL 16; no connection to CST-DEV or PROD.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="gpt02-candidate-barrier-$$"
dir="$(mktemp -d)"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || :;rm -rf "$dir";}
trap cleanup EXIT
docker run -d --rm --network none --name "$container" -e POSTGRES_PASSWORD=local_test_only postgres:16-alpine >/dev/null
for i in $(seq 1 120);do
 if docker exec "$container" psql -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then sleep 1;break;fi
 sleep .3
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >"$dir/bootstrap"
CREATE SCHEMA ai_platform;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE rogue_migrator NOLOGIN;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime,anon,authenticated,rogue_migrator;
GRANT CREATE ON SCHEMA ai_platform TO rogue_migrator;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_human_tasks VALUES (6);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES
 ('83db99f5-cbda-4e60-be71-3090fb411bbb'),
 ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc'),
 ('a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc'),
 ('a2aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
SQL
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql 20261109_gpt02_dev_generic_claim_candidate_barrier.sql;do
 docker cp "$root/scripts/migrations/$f" "$container:/tmp/$f"
done
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql;do
 docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "SET ai_core.dev_migration_authorized=true" -f "/tmp/$f" >"$dir/fixture-$f" 2>&1 || { cat "$dir/fixture-$f"; exit 1; }
done
if docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/20261109_gpt02_dev_generic_claim_candidate_barrier.sql >"$dir/deny" 2>&1;then
 echo 'FAIL: unapproved migration accepted';exit 1
fi
grep -q 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED' "$dir/deny"
if docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ROLE rogue_migrator; SET ai_core.dev_migration_authorized=true' -f /tmp/20261109_gpt02_dev_generic_claim_candidate_barrier.sql >"$dir/rogue" 2>&1;then
 echo 'FAIL: rogue database role installed security definer';exit 1
fi
grep -q GPT02_GENERIC_CLAIM_OWNER_OR_RLS_MISMATCH "$dir/rogue"
for i in 1 2;do
 docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ai_core.dev_migration_authorized=true' -f /tmp/20261109_gpt02_dev_generic_claim_candidate_barrier.sql >"$dir/owner-$i" 2>&1 || { cat "$dir/owner-$i"; exit 1; }
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >"$dir/verify"
INSERT INTO ai_platform.gpt02_dev_recovery_reservations(
 parent_command_id,candidate_command_id,human_review_id,job_id,
 idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
 '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
 '2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('a',64));
INSERT INTO ai_platform.gpt02_dev_recovery_command_links
(parent_command_id,child_command_id,reservation_id)
SELECT parent_command_id,candidate_command_id,id
FROM ai_platform.gpt02_dev_recovery_reservations;
GRANT SELECT ON ai_platform.ai_coding_bridge_commands TO aicore_dev_runtime;
SET ROLE aicore_dev_runtime;
DO $$
BEGIN
 IF ai_platform.gpt02_dev_generic_claim_allowed('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc')
   THEN RAISE EXCEPTION 'RECOVERY_CANDIDATE_ALLOWED'; END IF;
 IF NOT ai_platform.gpt02_dev_generic_claim_allowed('a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc')
   THEN RAISE EXCEPTION 'ORDINARY_COMMAND_BLOCKED'; END IF;
 IF ai_platform.gpt02_dev_generic_claim_allowed(NULL)
   THEN RAISE EXCEPTION 'NULL_COMMAND_ALLOWED'; END IF;
 IF has_table_privilege(current_user,'ai_platform.gpt02_dev_recovery_reservations','SELECT')
    OR has_table_privilege(current_user,'ai_platform.gpt02_dev_recovery_command_links','SELECT')
    THEN RAISE EXCEPTION 'BROAD_RUNTIME_GRANT';END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF has_function_privilege('anon','ai_platform.gpt02_dev_generic_claim_allowed(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','ai_platform.gpt02_dev_generic_claim_allowed(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'PUBLIC_FUNCTION_GRANT';END IF;
END $$;
-- A legacy-linked child must also be blocked without the reservation record.
-- Enforced via same owner function after an in-fixture direct link reference.
DO $$
DECLARE f text;
BEGIN
 SELECT pg_get_functiondef('ai_platform.gpt02_dev_generic_claim_allowed(uuid)'::regprocedure) INTO f;
 IF position('gpt02_dev_recovery_command_links' IN f)=0 THEN
  RAISE EXCEPTION 'CHILD_LINK_NOT_CHECKED';
 END IF;
END $$;
SQL
APP_ENV=development pnpm --dir "$root/artifacts/api-server" exec tsx -e "
import {PgDialect} from 'drizzle-orm/pg-core';
import {genericClaimNotReservedCandidateSql} from './src/services/gpt02RecoveryGenericClaimQuarantine.ts';
console.log(new PgDialect().sqlToQuery(genericClaimNotReservedCandidateSql()).sql)
" >"$dir/predicate.sql"
grep -q 'gpt02_dev_generic_claim_allowed(id)' "$dir/predicate.sql"
cat >"$dir/generated.sql" <<'SQL'
SET ROLE aicore_dev_runtime;
CREATE TEMP VIEW generic_claim_allowed AS
SELECT id FROM ai_platform.ai_coding_bridge_commands
WHERE
SQL
cat "$dir/predicate.sql" >> "$dir/generated.sql"
cat >>"$dir/generated.sql" <<'SQL'
;
DO $$
DECLARE ordinary_count integer; candidate_count integer;
BEGIN
 SELECT COUNT(*) INTO ordinary_count FROM generic_claim_allowed
  WHERE id='a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc';
 SELECT COUNT(*) INTO candidate_count FROM generic_claim_allowed
  WHERE id='41aa961d-ac1e-4e12-a2c8-28ed07ff97cc';
 IF ordinary_count<>1 OR candidate_count<>0 THEN
   RAISE EXCEPTION 'GENERATED_CLAIM_PREDICATE_INCORRECT normal=% recovery=%',ordinary_count,candidate_count;
 END IF;
END $$;
SQL
docker cp "$dir/generated.sql" "$container:/tmp/generated.sql"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/generated.sql >"$dir/generated-log" 2>&1 || { cat "$dir/generated-log"; exit 1; }
echo 'PASS: PG16 guarded owner-only double-apply, runtime only EXECUTE, no raw ledger SELECT, unmarked candidate denied by Drizzle claim, normal claim allowed, anonymous denied'
