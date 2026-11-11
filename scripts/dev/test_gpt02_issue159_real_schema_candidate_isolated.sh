#!/bin/bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="gpt02-real-schema-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :;rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 100);do
 if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1;then
  sleep .25
  if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1;then ready=1;break;fi
 fi
 sleep .2
done
test "$ready" = 1 || exit 1
docker cp "$root/scripts/dev/gpt02_issue159_real_schema_disposable_seed.sql" "$name:/tmp/seed.sql"
sed 's/postgres/gpt02_fixture_migrator/g' \
  "$root/scripts/dev/gpt02_issue159_operational_candidate_NOT_APPLIED.sql" > "$tmp/candidate-migrator.sql"
docker cp "$tmp/candidate-migrator.sql" "$name:/tmp/candidate.sql"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/seed.sql >"$tmp/seed.log" 2>&1 || { tail -50 "$tmp/seed.log";exit 1; }
docker exec "$name" psql -U gpt02_fixture_migrator -d postgres -v ON_ERROR_STOP=1 -f /tmp/candidate.sql >"$tmp/migration.log" 2>&1 || { tail -65 "$tmp/migration.log";exit 1; }
docker exec "$name" psql -U gpt02_fixture_migrator -d postgres -v ON_ERROR_STOP=1 -f /tmp/candidate.sql >"$tmp/idempotent.log" 2>&1 || { tail -65 "$tmp/idempotent.log";exit 1; }
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "
DO \$g\$
DECLARE x record;
BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='gpt02_stage' AND p.proname='prepare_core_task')
   OR (n.nspname='gpt02_private' AND p.proname IN
   ('record_linked_approval','consume_linked_approval','reserve_post_consumption_fence',
   'record_issuer_evidence','consume_issuer_lease')))<>6
 THEN RAISE EXCEPTION 'SIX_RPCS_MISSING';END IF;
 IF (SELECT rolcanlogin FROM pg_roles WHERE rolname='gpt02_core_prep_login')
 THEN RAISE EXCEPTION 'WRITER_SHOULD_STAY_NOLOGIN'; END IF;
 FOR x IN
  SELECT c.oid,n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
   pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private' AND c.relname IN('issuer_evidences','issuer_lease_consumptions')
 LOOP
  IF NOT x.relrowsecurity OR NOT x.relforcerowsecurity OR x.owner<>'gpt02_store_owner'
  THEN RAISE EXCEPTION 'STORAGE_ROLE_RLS_DRIFT';END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private' AND c.relname IN('issuer_evidences','issuer_lease_consumptions'))<>2
 THEN RAISE EXCEPTION 'ISSUER_SIDECAR_MISSING';END IF;
END \$g\$;
" >/dev/null
# Non-superuser migrator must finish with no SET permission for either owner.
role_set="$(docker exec "$name" psql -U postgres -Atqc "
 SELECT pg_has_role('gpt02_fixture_migrator','gpt02_core_prep_owner','SET')::text || ':' ||
 pg_has_role('gpt02_fixture_migrator','gpt02_store_owner','SET')::text;")"
test "$role_set" = 'false:false' || { echo "MIGRATOR_SET_ROLE_NOT_RESTORED_$role_set"; exit 1; }
# Regression: refusing schema drift is required, even for an idempotent migration.
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "ALTER TABLE gpt02_private.approvals NO FORCE ROW LEVEL SECURITY" >/dev/null
if docker exec "$name" psql -U gpt02_fixture_migrator -d postgres -v ON_ERROR_STOP=1 -f /tmp/candidate.sql >"$tmp/drift" 2>&1; then
 echo 'FAIL: FORCE_RLS_DRIFT_ACCEPTED'; exit 1
fi
grep -q 'GPT02_LIFECYCLE_SCHEMA_DRIFT' "$tmp/drift"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY" >/dev/null
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "ALTER ROLE gpt02_core_prep_login LOGIN CONNECTION LIMIT 3" >/dev/null
if docker exec "$name" psql -U gpt02_fixture_migrator -d postgres -v ON_ERROR_STOP=1 -f /tmp/candidate.sql >"$tmp/login-drift" 2>&1; then
 echo 'FAIL: WRITER_LOGIN_DRIFT_ACCEPTED'; exit 1
fi
grep -q 'DEV_WRITER_ROLE_NOT_DORMANT' "$tmp/login-drift"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0" >/dev/null
echo "PASS: idempotent six restricted SQL functions and two FORCE-RLS sidecars, writer NOLOGIN, schema and login drift rejected (disposable PostgreSQL 16)"