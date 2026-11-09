#!/usr/bin/env bash
# DEV fixture only: disposable PostgreSQL with --network none.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="gpt02-sign-receipt-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; rm -rf "$tmp"; }
trap 'echo "FENCE_RECEIPT_FIXTURE_FAILED at line $LINENO" >&2; for f in "$tmp"/*; do [ -f "$f" ] && { echo "fixture log: $(basename "$f")" >&2; tail -n 24 "$f" >&2; }; done; docker logs --tail 15 "$name" >&2 || :' ERR
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=test-only postgres:16-alpine >/dev/null
for i in $(seq 1 60); do
 if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1;then break;fi
 sleep .2
done
docker exec "$name" pg_isready -U postgres >/dev/null
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql 20261109_gpt02_dev_native_fence_signing_receipts.sql; do
 docker cp "$root/scripts/migrations/$f" "$name:/tmp/$f"
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA ai_platform;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'RECEIVED');
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands(id,status) VALUES
 ('83db99f5-cbda-4e60-be71-3090fb411bbb','FAILED'),
 ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc','RECEIVED');
INSERT INTO ai_platform.ai_human_tasks VALUES(6);
SQL
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql; do
 docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ai_core.dev_migration_authorized=true' -f "/tmp/$f" >"$tmp/setup" 2>&1 || { cat "$tmp/setup"; exit 1; }
done
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/20261109_gpt02_dev_native_fence_signing_receipts.sql >"$tmp/denied" 2>&1; then
 echo "FAIL: unguarded migration"; exit 1
fi
if ! grep -q GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED "$tmp/denied"; then cat "$tmp/denied"; exit 1; fi
for i in 1 2; do
 docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ai_core.dev_migration_authorized=true' -f /tmp/20261109_gpt02_dev_native_fence_signing_receipts.sql >"$tmp/created" 2>&1 || { cat "$tmp/created"; exit 1; }
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
(parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
 '2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
DO $$
DECLARE rid uuid;
BEGIN
 SELECT id INTO rid FROM ai_platform.gpt02_dev_recovery_reservations;
 INSERT INTO ai_platform.gpt02_dev_native_fence_signing_receipts
 (reservation_id,child_command_id,fencing_token,sequence,worker_id,payload_sha256,signature_sha256,issued_at_utc_ms,expires_at_utc_ms)
 VALUES (rid,'41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',2,0,'dell-gpt02-dev',repeat('a',64),repeat('b',64),1794078278000,1794078288000);
 -- An idempotent duplicate cannot create a second issuance receipt.
 INSERT INTO ai_platform.gpt02_dev_native_fence_signing_receipts
 (reservation_id,child_command_id,fencing_token,sequence,worker_id,payload_sha256,signature_sha256,issued_at_utc_ms,expires_at_utc_ms)
 VALUES (rid,'41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',2,0,'dell-gpt02-dev',repeat('a',64),repeat('b',64),1794078278000,1794078288000)
 ON CONFLICT DO NOTHING;
 IF (SELECT count(*) FROM ai_platform.gpt02_dev_native_fence_signing_receipts) <> 1
 THEN RAISE EXCEPTION 'DUPLICATE_SIGNING_RECEIPT_ACCEPTED'; END IF;
 -- Negative path rejects invalid proof TTL and preserves original durable receipt.
 BEGIN
 INSERT INTO ai_platform.gpt02_dev_native_fence_signing_receipts
 (reservation_id,child_command_id,fencing_token,sequence,worker_id,payload_sha256,signature_sha256,issued_at_utc_ms,expires_at_utc_ms)
 VALUES (rid,'41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',3,0,'dell-gpt02-dev',repeat('a',64),repeat('b',64),1794078278000,1794078278000);
 RAISE EXCEPTION 'INVALID_TTL_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM ai_platform.gpt02_dev_native_fence_signing_receipts) <> 1
 THEN RAISE EXCEPTION 'INVALID_TTL_LEFT_RECEIPT'; END IF;
 IF has_table_privilege('aicore_dev_runtime','ai_platform.gpt02_dev_native_fence_signing_receipts','INSERT')
 OR has_table_privilege('anon','ai_platform.gpt02_dev_native_fence_signing_receipts','SELECT')
 OR has_table_privilege('authenticated','ai_platform.gpt02_dev_native_fence_signing_receipts','SELECT')
 THEN RAISE EXCEPTION 'RECEIPT_ROLE_GRANT_LEAK';END IF;
END $$;
SQL
echo 'PASS: isolated PG16 migration guard/idempotency, duplicate receipt denial, TTL rollback, no broad grants'
