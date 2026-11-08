#!/usr/bin/env bash
# Isolated evidence fencing prototype. No Ed25519 check, deployment, or grant.
set -euo pipefail
cd "$(dirname "$0")/../.."
name="gpt02-evidence-fence-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; }
trap cleanup EXIT
docker run -d --name "$name" --network none --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_PASSWORD=synthetic-container-admin-only -e POSTGRES_HOST_AUTH_METHOD=scram-sha-256 postgres:16-alpine >/dev/null
for i in $(seq 1 40); do
 if docker exec "$name" pg_isready -q -U postgres && docker exec "$name" psql -U postgres -qAt -c 'SELECT 1' 2>/dev/null | grep -qx 1; then break; fi
 sleep 1
done
# Official image seeds loopback trust before host all/all SCRAM. Enforce
# password authentication also on loopback within this disposable container.
docker exec "$name" sh -c "sed -i -E 's/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+)trust/\1scram-sha-256/' /var/lib/postgresql/data/pg_hba.conf"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c 'SELECT pg_reload_conf()' | grep -qx t
docker exec "$name" sh -c "grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+scram-sha-256' /var/lib/postgresql/data/pg_hba.conf"
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE writer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE verified_service NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE runtime NOLOGIN;
CREATE ROLE issuer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE attestor NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE lease_worker NOLOGIN NOINHERIT NOBYPASSRLS;
-- Disposable real login identities with unique test-only credentials. All
-- connections are to the networkless PostgreSQL container via loopback.
CREATE ROLE runtime_login LOGIN PASSWORD 'isolated-runtime-credential';
CREATE ROLE writer_login LOGIN PASSWORD 'isolated-writer-credential';
CREATE ROLE verifier_login LOGIN PASSWORD 'isolated-verifier-credential';
CREATE ROLE attestor_login LOGIN PASSWORD 'isolated-attestor-credential';
GRANT attestor TO attestor_login;
CREATE ROLE issuer_login LOGIN PASSWORD 'isolated-issuer-credential';
CREATE ROLE lease_worker_login LOGIN PASSWORD 'isolated-worker-credential';
GRANT issuer TO issuer_login;
GRANT lease_worker TO lease_worker_login;
GRANT runtime TO runtime_login;
GRANT writer TO writer_login;
GRANT verified_service TO verifier_login;
CREATE SCHEMA isolated;
GRANT USAGE ON SCHEMA isolated TO writer,runtime,verified_service,issuer,lease_worker,attestor;
CREATE TABLE isolated.commands(id integer PRIMARY KEY,status text NOT NULL);
CREATE TABLE isolated.responses(id integer PRIMARY KEY, command_id integer NOT NULL REFERENCES isolated.commands(id),
 kind text NOT NULL, created_at integer NOT NULL, acknowledged boolean NOT NULL DEFAULT false);
CREATE TABLE isolated.operators(id integer PRIMARY KEY, role text NOT NULL,status text NOT NULL);
CREATE TABLE isolated.audit(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 command_id integer,nonce text UNIQUE NOT NULL,proof_json jsonb NOT NULL);
INSERT INTO isolated.commands VALUES(1,'PROCESSING');
INSERT INTO isolated.responses VALUES(10,1,'CHECKPOINT',10,true),(11,1,'BLOCKER',20,false);
INSERT INTO isolated.operators VALUES(7,'admin','active');
ALTER TABLE isolated.audit ENABLE ROW LEVEL SECURITY;
-- Review writer has no raw table or command write access.
CREATE FUNCTION isolated.try_append(p_command integer,p_operator integer,p_checkpoint integer,p_blocker integer,p_proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated
AS $$
DECLARE v_status text; v_inserted integer;
BEGIN
 -- Shape/binding checks only. PostgreSQL does NOT validate Ed25519.
 IF p_proof->>'version' IS DISTINCT FROM '1'
   OR p_proof->>'action' IS DISTINCT FROM 'gpt02.resume.grant.review'
   OR p_proof->>'operatorId' IS DISTINCT FROM 'internal:'||p_operator::text
   OR p_proof->>'operatorRole' IS DISTINCT FROM
      (SELECT role FROM isolated.operators WHERE id=p_operator)
   OR p_proof->>'commandId' IS DISTINCT FROM '169a7492-cfd8-4a56-bb57-18001b6b5968'
   OR p_proof->>'checkpointResponseId' IS DISTINCT FROM '822efca2-7428-428a-ac66-548c0462438e'
   OR p_proof->>'blockerResponseId' IS DISTINCT FROM '08b7b237-7a16-46d0-b79d-029d0363c112'
   OR p_proof->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
   OR p_proof->>'nonce' !~ '^[a-f0-9]{64}$'
   OR p_proof->>'signatureBase64' !~ '^[a-zA-Z0-9+/]{86}==$'
   OR p_proof->>'issuedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   OR p_proof->>'expiresAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 THEN RETURN false; END IF;
 -- These SQL checks are a second clock boundary, not signature validation.
 BEGIN
   IF (p_proof->>'issuedAt')::timestamptz > clock_timestamp()
      OR (p_proof->>'expiresAt')::timestamptz <= clock_timestamp()
      OR (p_proof->>'expiresAt')::timestamptz <= (p_proof->>'issuedAt')::timestamptz
      OR (p_proof->>'expiresAt')::timestamptz >
         (p_proof->>'issuedAt')::timestamptz + interval '120 seconds'
   THEN RETURN false; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
 END;
 SELECT status INTO v_status FROM isolated.commands WHERE id=p_command FOR UPDATE;
 IF v_status IS DISTINCT FROM 'PROCESSING' THEN RETURN false; END IF;
 -- Separate statement after the command lock gives the latest committed response
 -- snapshot under READ COMMITTED. This toy guard does NOT authenticate Ed25519.
 INSERT INTO isolated.audit(command_id,nonce,proof_json)
 SELECT p_command,p_proof->>'nonce',p_proof FROM isolated.operators u
 JOIN isolated.responses cp ON cp.id=p_checkpoint AND cp.command_id=p_command
   AND cp.kind='CHECKPOINT' AND cp.acknowledged
 JOIN isolated.responses bl ON bl.id=p_blocker AND bl.command_id=p_command
   AND bl.kind='BLOCKER' AND cp.created_at<bl.created_at
 WHERE u.id=p_operator AND u.role IN ('admin','owner') AND u.status='active'
 AND bl.id=(SELECT r.id FROM isolated.responses r
   WHERE r.command_id=p_command ORDER BY r.created_at DESC,r.id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM isolated.responses t WHERE t.command_id=p_command
   AND t.kind IN ('FAILED','COMPLETED'))
 ON CONFLICT (nonce) DO NOTHING
 RETURNING id INTO v_inserted;
 RETURN v_inserted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION isolated.try_append(integer,integer,integer,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION isolated.try_append(integer,integer,integer,integer,jsonb) TO verified_service;
-- ONE disposable database now exercises the review -> grant -> lease ->
-- fenced completion chain. This does not authenticate Ed25519 in PostgreSQL.
CREATE TABLE isolated.review_attestations(
 audit_id integer PRIMARY KEY REFERENCES isolated.audit(id),
 proof_digest text NOT NULL,
 attested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION isolated.attest_review(p_audit integer,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated AS $$
DECLARE v_inserted integer;
BEGIN
 INSERT INTO isolated.review_attestations(audit_id,proof_digest)
 SELECT a.id,p_digest FROM isolated.audit a
 WHERE a.id=p_audit AND p_digest=md5(a.proof_json::text)
   AND (a.proof_json->>'expiresAt')::timestamptz > clock_timestamp()
 ON CONFLICT (audit_id) DO NOTHING RETURNING audit_id INTO v_inserted;
 RETURN v_inserted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION isolated.attest_review(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION isolated.attest_review(integer,text) TO attestor;
CREATE TABLE isolated.grants(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 command_id integer NOT NULL REFERENCES isolated.commands(id),
 review_audit_id integer NOT NULL UNIQUE REFERENCES isolated.audit(id),
 worker_id text NOT NULL,
 state text NOT NULL DEFAULT 'APPROVED',
 consumed_at timestamptz,
 expires_at timestamptz NOT NULL
);
CREATE TABLE isolated.leases(
 command_id integer PRIMARY KEY REFERENCES isolated.commands(id),
 grant_id bigint NOT NULL REFERENCES isolated.grants(id),
 worker_id text NOT NULL,
 fence bigint NOT NULL,
 lease_token text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE isolated.worker_results(
 command_id integer PRIMARY KEY REFERENCES isolated.commands(id),
 fence bigint NOT NULL, lease_token text NOT NULL);
CREATE FUNCTION isolated.issue_grant(p_audit integer,p_worker text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated AS $$
DECLARE v_audit isolated.audit%ROWTYPE; v_grant bigint;
BEGIN
 IF p_worker IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' THEN RETURN NULL; END IF;
 SELECT * INTO v_audit FROM isolated.audit WHERE id=p_audit FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM isolated.commands c WHERE c.id=v_audit.command_id
 AND c.status='PROCESSING' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Source audit must be the actual, latest verified synthetic review proof.
 -- The SQL audit alone does NOT cryptographically authenticate the signature.
 IF NOT EXISTS (
  SELECT 1 FROM isolated.review_attestations a
  WHERE a.audit_id=v_audit.id AND a.proof_digest=md5(v_audit.proof_json::text)
 ) OR v_audit.proof_json->>'operatorId' IS DISTINCT FROM 'internal:7'
   OR v_audit.proof_json->>'workerId' IS DISTINCT FROM p_worker
   OR (v_audit.proof_json->>'expiresAt')::timestamptz <= clock_timestamp()
   OR NOT EXISTS(
    SELECT 1 FROM isolated.operators u
    WHERE u.id=7 AND u.status='active' AND u.role IN ('admin','owner')
   ) OR NOT EXISTS(
    SELECT 1 FROM isolated.responses cp
    JOIN isolated.responses bl ON bl.command_id=cp.command_id
    WHERE cp.id=10 AND cp.command_id=v_audit.command_id
      AND cp.kind='CHECKPOINT' AND cp.acknowledged
      AND bl.id=11 AND bl.kind='BLOCKER' AND bl.created_at>cp.created_at
      AND bl.id=(SELECT r.id FROM isolated.responses r WHERE
       r.command_id=v_audit.command_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)
   ) THEN RETURN NULL; END IF;
 INSERT INTO isolated.grants(command_id,review_audit_id,worker_id,expires_at)
 VALUES(v_audit.command_id,v_audit.id,p_worker,clock_timestamp()+interval '90 seconds')
 ON CONFLICT(review_audit_id) DO NOTHING RETURNING id INTO v_grant;
 RETURN v_grant;
END $$;
CREATE FUNCTION isolated.claim_grant(p_grant bigint,p_worker text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated AS $$
DECLARE v_grant isolated.grants%ROWTYPE; v_fence bigint;
BEGIN
 SELECT * INTO v_grant FROM isolated.grants WHERE id=p_grant FOR UPDATE;
 IF NOT FOUND OR v_grant.state<>'APPROVED'
  OR v_grant.consumed_at IS NOT NULL OR v_grant.expires_at<=clock_timestamp()
  OR v_grant.worker_id IS DISTINCT FROM p_worker THEN RETURN NULL; END IF;
 PERFORM 1 FROM isolated.commands c WHERE c.id=v_grant.command_id
  AND c.status='PROCESSING' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO isolated.leases AS l(command_id,grant_id,worker_id,fence,lease_token,expires_at)
 VALUES(v_grant.command_id,v_grant.id,p_worker,1,'token-'||p_grant::text,clock_timestamp()+interval '60 seconds')
 ON CONFLICT(command_id) DO UPDATE SET grant_id=excluded.grant_id,
 worker_id=excluded.worker_id, fence=l.fence+1, lease_token=excluded.lease_token,
 expires_at=excluded.expires_at
 WHERE l.expires_at<=clock_timestamp()
 RETURNING fence INTO v_fence;
 IF v_fence IS NULL THEN RETURN NULL; END IF;
 UPDATE isolated.grants SET state='CONSUMED',consumed_at=clock_timestamp() WHERE id=p_grant;
 PERFORM pg_sleep(0.1);
 RETURN 'token-'||p_grant::text||':'||v_fence::text;
END $$;
CREATE FUNCTION isolated.write_worker_result(p_command integer,p_fence bigint,p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated AS $$
BEGIN
 PERFORM 1 FROM isolated.leases l WHERE l.command_id=p_command AND
 l.fence=p_fence AND l.lease_token=p_token AND
 l.expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO isolated.worker_results(command_id,fence,lease_token)
 VALUES(p_command,p_fence,p_token)
 ON CONFLICT(command_id) DO UPDATE SET fence=excluded.fence,lease_token=excluded.lease_token;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION isolated.issue_grant(integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION isolated.claim_grant(bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION isolated.write_worker_result(integer,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION isolated.issue_grant(integer,text) TO issuer;
GRANT EXECUTE ON FUNCTION isolated.claim_grant(bigint,text) TO lease_worker;
GRANT EXECUTE ON FUNCTION isolated.write_worker_result(integer,bigint,text) TO lease_worker;
SQL
test_case() {
 local label="$1" expect="$2" json_b64="$3"
 local got
 got="$(docker exec -e PGPASSWORD=isolated-verifier-credential "$name" psql -h 127.0.0.1 -U verifier_login -d postgres -v ON_ERROR_STOP=1 -qAt -c "SELECT isolated.try_append(1,7,10,11,convert_from(decode('$json_b64','base64'),'UTF8')::jsonb)")"
 got="$(printf '%s\n' "$got" | tail -n 1)"
 [ "$got" = "$expect" ] || { echo "FAIL $label actual=$got wanted=$expect"; exit 1; }
 echo "$label PASS"
}
# The actual app verifies a freshly signed Ed25519 proof before the isolated
# SQL routine is invoked. Database checks proof identity and column bindings
# but cannot cryptographically verify the signature itself.
bundle_b64="$(cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts bundle)"
signed_proof_b64="$(printf '%s' "$bundle_b64" | base64 -d | python3 -c 'import json,sys,base64; b=json.load(sys.stdin); print(base64.b64encode(json.dumps(b["proof"]).encode()).decode())')"
trusted_pub_b64="$(printf '%s' "$bundle_b64" | base64 -d | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKeyDerBase64"])')"
[[ "$signed_proof_b64" =~ ^[a-zA-Z0-9+/]+={0,2}$ ]] || { echo "FAIL verified proof encoding";exit 1; }
test_case "REAL ED25519 VERIFIED BEFORE PROOF-BOUND SYNTHETIC APPEND" t "$signed_proof_b64"
test_case "SIGNED NONCE REPLAY DENIED WITHOUT SECOND AUDIT" f "$signed_proof_b64"
for invalid in tampered expired; do
 if (cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts "$invalid") >/dev/null 2>&1; then
  echo "FAIL $invalid proof verifier accepted invalid proof";exit 1
 fi
 count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
 [ "$count" = 1 ] || { echo "FAIL $invalid proof reached the database";exit 1; }
 echo "REAL ED25519 $invalid PRE-SQL REJECTION PASS"
done
# Structurally valid but mismatched binding must be refused by PostgreSQL,
# even when bypassing the application verifier. Signature itself is not checked.
bad_bind="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys,base64; p=json.load(sys.stdin); p["operatorId"]="internal:8"; print(base64.b64encode(json.dumps(p).encode()).decode())')"
test_case "DATABASE PROOF IDENTITY BINDING REJECTION" f "$bad_bind"
# Reject direct forged expiry bypass, even by a verifier DB credential.
# This is defense in depth; a valid-time forged signature still succeeds.
expired_direct="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys,base64; from datetime import datetime,timedelta,timezone; p=json.load(sys.stdin); t=datetime.now(timezone.utc)-timedelta(minutes=5); p["issuedAt"]=t.isoformat(timespec="milliseconds").replace("+00:00","Z"); p["expiresAt"]=(t+timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00","Z"); p["nonce"]="b"*64; print(base64.b64encode(json.dumps(p).encode()).decode())')"
test_case "DIRECT SQL EXPIRED PROOF DENIED" f "$expired_direct"
future_direct="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys,base64; from datetime import datetime,timedelta,timezone; p=json.load(sys.stdin); t=datetime.now(timezone.utc)+timedelta(minutes=5); p["issuedAt"]=t.isoformat(timespec="milliseconds").replace("+00:00","Z"); p["expiresAt"]=(t+timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00","Z"); p["nonce"]="c"*64; print(base64.b64encode(json.dumps(p).encode()).decode())')"
test_case "DIRECT SQL FUTURE-DATED PROOF DENIED" f "$future_direct"
# The generic writer role has no EXECUTE; direct signature reuse by that
# identity fails even while the command is PROCESSING.
forged="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys,base64; p=json.load(sys.stdin); p["nonce"]="a"*64; print(base64.b64encode(json.dumps(p).encode()).decode())')"
if docker exec -e PGPASSWORD=isolated-writer-credential "$name" psql -h 127.0.0.1 -U writer_login -d postgres -v ON_ERROR_STOP=1 -q \
 -c "SELECT isolated.try_append(1,7,10,11,convert_from(decode('$forged','base64'),'UTF8')::jsonb)" >/dev/null 2>&1; then
 echo "FAIL generic writer invoked privileged append"; exit 1
fi
echo "GENERIC WRITER DIRECT SQL FORGERY DENIED PASS"
# CRITICAL: a compromised verified_service credential still bypasses Ed25519;
# this is the outstanding proof that process isolation is required.
test_case "COMPROMISED VERIFIED SERVICE STILL ACCEPTS REUSED SIGNATURE" t "$forged"
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 2 ] || { echo "FAIL expected synthetic bypass demonstration";exit 1; }
# Use the real TypeScript service contract (not just a standalone verifier)
# with a private CLI test adapter invoking an isolated PostgreSQL transaction.
# No credentials, listener, or SQL endpoint are exposed to the running API.
(cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts contract-valid "$name")
for mode in tampered expired; do
 (cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts "contract-$mode" "$name")
done
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 3 ] || { echo "FAIL contract bypassed verifier or failed append: $count";exit 1; }
echo "SERVICE CONTRACT DATABASE AUDIT COUNT PASS"
# A separate test-only OS subprocess receives only proof JSON on stdin.
# The parent never supplies SQL text or DB role selection in the request.
(cd artifacts/api-server && \
 GPT02_SYNTHETIC_PARENT_SECRET_MARKER="must-never-reach-child" \
 SUPABASE_DEV_DATABASE_URL="postgresql://never:forward@parent.invalid/secret" \
 OPENCLAW_AI_CORE_API_KEY="synthetic-secret-must-not-leak" \
 pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts child-valid "$name")
for mode in tampered expired injected; do
 (cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts "child-$mode" "$name")
done
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 4 ] || { echo "FAIL subprocess isolation audit count: $count";exit 1; }
echo "PRIVATE PROCESS AUDIT COUNT PASS"
# Cross-component integration, all inside this same transient PostgreSQL DB:
# no review -> no grant; issuer cannot write audit; worker cannot issue grant;
# grant one-shot, lease one winner under concurrency, fenced worker result.
issuer_sql() { docker exec -e PGPASSWORD=isolated-issuer-credential "$name" psql -h 127.0.0.1 -U issuer_login -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
worker_sql() { docker exec -e PGPASSWORD=isolated-worker-credential "$name" psql -h 127.0.0.1 -U lease_worker_login -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
[ "$(issuer_sql "SELECT isolated.issue_grant(999,'openclaw-dell-chatgpt-wake-dev')")" = "" ] || { echo "FAIL nonexistent audit allowed grant";exit 1; }
if worker_sql "SELECT isolated.issue_grant(1,'openclaw-dell-chatgpt-wake-dev')" > /dev/null 2>&1; then
 echo "FAIL worker issued a grant";exit 1
fi
if issuer_sql "SELECT isolated.claim_grant(1,'openclaw-dell-chatgpt-wake-dev')" >/dev/null 2>&1; then
 echo "FAIL issuer claimed a worker lease";exit 1
fi
echo "END-TO-END ROLE SEPARATION PASS"
forged_id="$(docker exec "$name" psql -U postgres -qAt -c "SELECT id FROM isolated.audit WHERE nonce=repeat('a',64)")"
[ -n "$forged_id" ] || { echo "FAIL synthetic forged audit not found"; exit 1; }
[ "$(issuer_sql "SELECT isolated.issue_grant($forged_id,'openclaw-dell-chatgpt-wake-dev')")" = "" ] || { echo "FAIL un-attested forged audit issued grant"; exit 1; }
if issuer_sql "SELECT isolated.attest_review($forged_id,'incorrect')" >/dev/null 2>&1; then echo "FAIL issuer could self-attest";exit 1;fi
if docker exec -e PGPASSWORD=isolated-verifier-credential "$name" psql -h 127.0.0.1 -U verifier_login -d postgres -v ON_ERROR_STOP=1 -qAt -c "SELECT isolated.attest_review($forged_id,'incorrect')" >/dev/null 2>&1; then echo "FAIL verifier could self-attest";exit 1;fi
echo "FORGED AUDIT ISSUANCE AND SELF-ATTESTATION DENIED PASS"
signed_nonce="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys; print(json.load(sys.stdin)["nonce"])')"
[[ "$signed_nonce" =~ ^[a-f0-9]{64}$ ]] || { echo "FAIL verified nonce format";exit 1; }
audit_id="$(docker exec "$name" psql -U postgres -qAt -c "SELECT id FROM isolated.audit WHERE nonce='$signed_nonce'")"
[ "$(issuer_sql "SELECT isolated.issue_grant($audit_id,'openclaw-dell-chatgpt-wake-dev')")" = "" ] || { echo "FAIL un-attested valid audit issued grant"; exit 1; }
# A second process reads persisted audit bytes and cryptographically checks
# them with the pinned ephemeral test trust key BEFORE the attestor DB call.
for audit_to_check in "$audit_id" "$forged_id"; do
 proof_from_db="$(docker exec "$name" psql -U postgres -qAt -c "SELECT replace(encode(convert_to(proof_json::text,'UTF8'),'base64'),chr(10),'') FROM isolated.audit WHERE id=$audit_to_check")"
 if [ "$audit_to_check" = "$audit_id" ]; then
   (cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewAuditProofCheck.ts "$trusted_pub_b64" "$proof_from_db")
 else
   if (cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewAuditProofCheck.ts "$trusted_pub_b64" "$proof_from_db") >/dev/null 2>&1; then
    echo "FAIL forged persisted audit passed independent Ed25519 check"; exit 1
   fi
   echo "FORGED PERSISTED AUDIT ED25519 DENIED PASS"
 fi
done
attestor_sql() { docker exec -e PGPASSWORD=isolated-attestor-credential "$name" psql -h 127.0.0.1 -U attestor_login -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
digest="$(docker exec "$name" psql -U postgres -qAt -c "SELECT md5(proof_json::text) FROM isolated.audit WHERE id=$audit_id")"
[ "$(attestor_sql "SELECT isolated.attest_review($audit_id,'$digest')")" = t ] || { echo "FAIL attestor cannot attest";exit 1; }
[ "$(attestor_sql "SELECT isolated.attest_review($audit_id,'$digest')")" = f ] || { echo "FAIL attestation replay";exit 1; }
[ "$(attestor_sql "SELECT isolated.attest_review($forged_id,'bad-digest')")" = f ] || { echo "FAIL invalid audit digest attested";exit 1; }
grant="$(issuer_sql "SELECT isolated.issue_grant($audit_id,'openclaw-dell-chatgpt-wake-dev')")"
[[ "$grant" =~ ^[0-9]+$ ]] || { echo "FAIL signed audit did not yield synthetic grant";exit 1; }
[ "$(issuer_sql "SELECT isolated.issue_grant($audit_id,'openclaw-dell-chatgpt-wake-dev')")" = "" ] || { echo "FAIL replay grant issuance";exit 1; }
echo "SAME-DB REVIEW AUDIT TO ONE-SHOT GRANT PASS"
workdir="$(mktemp -d /tmp/gpt02-unified-race.XXXXXX)"
for i in 1 2 3; do
 (worker_sql "SELECT isolated.claim_grant($grant,'openclaw-dell-chatgpt-wake-dev')" > "$workdir/$i" 2> "$workdir/$i.err" || exit 0) &
done
wait
winners="$(grep -l '^token-[0-9]*:1$' "$workdir"/[123] | wc -l)"
[ "$winners" = 1 ] || { echo "FAIL grant race winners=$winners"; rm -rf "$workdir";exit 1; }
rm -rf "$workdir"
state="$(docker exec "$name" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM isolated.grants WHERE state='CONSUMED'),(SELECT count(*) FROM isolated.leases)")"
[ "$state" = '1|1' ] || { echo "FAIL consumed state $state";exit 1; }
[ "$(worker_sql "SELECT isolated.claim_grant($grant,'openclaw-dell-chatgpt-wake-dev')")" = "" ] || { echo "FAIL second worker claim";exit 1; }
[ "$(worker_sql "SELECT isolated.write_worker_result(1,0,'wrong')")" = f ] || { echo "FAIL stale fence accepted";exit 1; }
[ "$(worker_sql "SELECT isolated.write_worker_result(1,1,'token-$grant')")" = t ] || { echo "FAIL current fence rejected";exit 1; }
echo "SAME-DB SINGLE WINNER LEASE AND FENCED RESULT PASS"
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET status='suspended' WHERE id=7" >/dev/null
test_case "OPERATOR REVOKED" f "$signed_proof_b64"
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET status='active',role='viewer' WHERE id=7" >/dev/null
test_case "OPERATOR ROLE CHANGED" f "$signed_proof_b64"
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET role='admin'; UPDATE isolated.responses SET acknowledged=false WHERE id=10" >/dev/null
test_case "NATIVE ACK REMOVED" f "$signed_proof_b64"
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.responses SET acknowledged=true WHERE id=10; INSERT INTO isolated.responses VALUES(12,1,'BLOCKER',30,false)" >/dev/null
test_case "STALE BLOCKER" f "$signed_proof_b64"
docker exec "$name" psql -U postgres -q -c "DELETE FROM isolated.responses WHERE id=12; INSERT INTO isolated.responses VALUES(13,1,'FAILED',30,false)" >/dev/null
test_case "TERMINAL RESPONSE" f "$signed_proof_b64"
docker exec "$name" psql -U postgres -q -c "DELETE FROM isolated.responses WHERE id=13; UPDATE isolated.commands SET status='FAILED' WHERE id=1" >/dev/null
test_case "TERMINAL COMMAND" f "$signed_proof_b64"
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 4 ] || { echo "FAIL historical audit count: $count"; exit 1; }
echo "AUDIT COUNT UNCHANGED PASS"
if docker exec -e PGPASSWORD=isolated-runtime-credential "$name" psql -h 127.0.0.1 -U runtime_login -d postgres -v ON_ERROR_STOP=1 -q -c "SELECT isolated.try_append(1,7,10,11,'{}'::jsonb)" >/dev/null 2>&1; then
 echo "FAIL ordinary runtime executed trusted-writer procedure";exit 1
fi
echo "RUNTIME EXECUTE DENIED PASS"
privileges="$(docker exec "$name" psql -U postgres -qAt -c "SELECT has_function_privilege('writer','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE'),has_function_privilege('runtime','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE'),has_function_privilege('verified_service','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE')")"
[ "$privileges" = 'f|f|t' ] || { echo "FAIL privilege boundary $privileges"; exit 1; }
echo "THREE-ROLE EXECUTE ISOLATION PASS"
# Confirm the actual loopback-authenticated sessions hold non-superuser
# identities rather than merely simulating a role change from postgres.
for entry in 'runtime_login:isolated-runtime-credential' 'writer_login:isolated-writer-credential' 'verifier_login:isolated-verifier-credential'; do
 login="${entry%%:*}"; secret="${entry#*:}"
 actual="$(docker exec -e "PGPASSWORD=$secret" "$name" psql -h 127.0.0.1 -U "$login" -d postgres -qAt -c "SELECT current_user||':'||session_user||':'||rolsuper::text FROM pg_roles WHERE rolname=current_user")"
 [ "$actual" = "$login:$login:false" ] || { echo "FAIL separate DB login identity $login";exit 1; }
done
echo "REAL SEPARATE LOGIN AUTHENTICATION PASS"
# Fail closed on the wrong password, even for an existing login identity.
if docker exec -e PGPASSWORD=incorrect "$name" psql -h 127.0.0.1 -U verifier_login -d postgres -v ON_ERROR_STOP=1 -qAt -c 'SELECT 1' >/dev/null 2>&1; then
 echo "FAIL verifier login accepted invalid credential";exit 1
fi
echo "VERIFIER INCORRECT PASSWORD DENIED PASS"
echo "EVIDENCE FENCING PROTOTYPE PASS — unsigned synthetic inputs, NOT a real approval"
