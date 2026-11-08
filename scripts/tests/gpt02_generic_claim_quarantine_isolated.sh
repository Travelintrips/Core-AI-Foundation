#!/usr/bin/env bash
# Network-isolated PG16 truth table using the EXACT Drizzle SQL fragment from
# the server-side generic command claimant. Never touches CST-DEV or PROD.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="job135-claim-quarantine-$$"
temp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :;rm -rf "$temp"; }
trap cleanup EXIT
cd "$root"
pnpm --dir artifacts/api-server exec tsx -e "
import {PgDialect} from 'drizzle-orm/pg-core';
import {genericClaimNotGpt02Recovery} from './src/services/gpt02RecoveryGenericClaimQuarantine.ts';
console.log(new PgDialect().sqlToQuery(genericClaimNotGpt02Recovery).sql);
" > "$temp/predicate.sql"
grep -q 'metadata_json ?|' "$temp/predicate.sql"
grep -q 'parentCommandId' "$temp/predicate.sql"
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=isolated_only postgres:16-alpine >/dev/null
for i in $(seq 1 120); do
 if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then
  sleep 1
  if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then break;fi
 fi
 sleep .25
done
cat > "$temp/check.sql" <<'SQL'
CREATE TEMP TABLE test_bridge (
 id integer PRIMARY KEY,
 metadata_json jsonb NOT NULL,
 status text NOT NULL DEFAULT 'RECEIVED',
 assigned_client_id text NOT NULL DEFAULT 'dell'
);
INSERT INTO test_bridge(id,metadata_json) VALUES
(1, '{"capability":"chatgpt:wake","assignedClientId":"dell"}'),
(2, '{"gpt02Recovery":false,"capability":"chatgpt:wake"}'),
(3, '{"gpt02Recovery":null}'),
(4, '{"recoveryParentCommandId":"parent"}'),
(5, '{"recovery_parent_command_id":"parent"}'),
(6, '{"capability":"chatgpt:wake","parentCommandId":"parent"}'),
(7, '{"capability":"other","parentCommandId":"ordinary"}'),
(8, '{"gpt02RecoveryParentCommandId":"parent"}'),
(9, '{"capability":"chatgpt:wake","devContinuity":{"active":true}}');
CREATE TEMP VIEW eligible AS SELECT id FROM test_bridge
 WHERE status='RECEIVED' AND
SQL
cat "$temp/predicate.sql" >> "$temp/check.sql"
cat >> "$temp/check.sql" <<'SQL'
;
DO $$
DECLARE ids integer[];
BEGIN
 SELECT array_agg(id ORDER BY id) INTO ids FROM eligible;
 IF ids IS DISTINCT FROM ARRAY[1,7,9] THEN
   RAISE EXCEPTION 'GENERIC_CLAIM_TRUTH_TABLE_DRIFT eligible %',ids;
 END IF;
END $$;
-- Simulate the server's claim selection with SKIP LOCKED and direct target.
BEGIN;
WITH candidate AS (
 SELECT id FROM test_bridge WHERE assigned_client_id='dell'
  AND id=2 AND status='RECEIVED' AND
SQL
cat "$temp/predicate.sql" >> "$temp/check.sql"
cat >> "$temp/check.sql" <<'SQL'
 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE test_bridge c SET status='PROCESSING' FROM candidate
 WHERE c.id=candidate.id;
DO $$ BEGIN
 IF (SELECT status FROM test_bridge WHERE id=2)<>'RECEIVED'
 THEN RAISE EXCEPTION 'RECOVERY_TARGET_BYPASSED_QUARANTINE';END IF;
END $$;
WITH candidate AS (
 SELECT id FROM test_bridge WHERE assigned_client_id='dell'
  AND id=1 AND status='RECEIVED' AND
SQL
cat "$temp/predicate.sql" >> "$temp/check.sql"
cat >> "$temp/check.sql" <<'SQL'
 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE test_bridge c SET status='PROCESSING' FROM candidate
 WHERE c.id=candidate.id;
DO $$ BEGIN
 IF (SELECT status FROM test_bridge WHERE id=1)<>'PROCESSING'
 THEN RAISE EXCEPTION 'NORMAL_TARGET_NOT_CLAIMED';END IF;
END $$;
ROLLBACK;
SQL
docker cp "$temp/check.sql" "$name:/tmp/check.sql"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/check.sql >"$temp/log" 2>&1 || { cat "$temp/log";exit 1; }
echo 'PASS: isolated PG16 generic claim quarantines all recovery markers, direct-target bypass denied, ordinary targets still claimable'
