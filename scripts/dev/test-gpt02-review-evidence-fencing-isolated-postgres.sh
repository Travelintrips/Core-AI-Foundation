#!/usr/bin/env bash
# Isolated evidence fencing prototype. No Ed25519 check, deployment, or grant.
set -euo pipefail
cd "$(dirname "$0")/../.."
name="gpt02-evidence-fence-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; }
trap cleanup EXIT
docker run -d --name "$name" --network none --tmpfs /var/lib/postgresql/data:rw,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 40); do
 if docker exec "$name" pg_isready -q -U postgres && docker exec "$name" psql -U postgres -qAt -c 'SELECT 1' 2>/dev/null | grep -qx 1; then break; fi
 sleep 1
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE writer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE verified_service NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE runtime NOLOGIN;
CREATE SCHEMA isolated;
GRANT USAGE ON SCHEMA isolated TO writer,runtime,verified_service;
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
 THEN RETURN false; END IF;
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
 RETURNING id INTO v_inserted;
 RETURN v_inserted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION isolated.try_append(integer,integer,integer,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION isolated.try_append(integer,integer,integer,integer,jsonb) TO verified_service;
SQL
test_case() {
 local label="$1" expect="$2" json_b64="$3"
 local got
 got="$(docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE verified_service; SELECT isolated.try_append(1,7,10,11,convert_from(decode('$json_b64','base64'),'UTF8')::jsonb)")"
 got="$(printf '%s\n' "$got" | tail -n 1)"
 [ "$got" = "$expect" ] || { echo "FAIL $label actual=$got wanted=$expect"; exit 1; }
 echo "$label PASS"
}
# The actual app verifies a freshly signed Ed25519 proof before the isolated
# SQL routine is invoked. Database checks proof identity and column bindings
# but cannot cryptographically verify the signature itself.
signed_proof_b64="$(cd artifacts/api-server && pnpm exec tsx src/scripts/devReviewProofIsolatedHarness.ts valid)"
[[ "$signed_proof_b64" =~ ^[a-zA-Z0-9+/]+={0,2}$ ]] || { echo "FAIL verified proof encoding";exit 1; }
test_case "REAL ED25519 VERIFIED BEFORE PROOF-BOUND SYNTHETIC APPEND" t "$signed_proof_b64"
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
# The generic writer role has no EXECUTE; direct signature reuse by that
# identity fails even while the command is PROCESSING.
forged="$(printf '%s' "$signed_proof_b64" | base64 -d | python3 -c 'import json,sys,base64; p=json.load(sys.stdin); p["nonce"]="a"*64; print(base64.b64encode(json.dumps(p).encode()).decode())')"
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -c "SET ROLE writer; SELECT isolated.try_append(1,7,10,11,convert_from(decode('$forged','base64'),'UTF8')::jsonb)" >/dev/null 2>&1; then
 echo "FAIL generic writer invoked privileged append"; exit 1
fi
echo "GENERIC WRITER DIRECT SQL FORGERY DENIED PASS"
# CRITICAL: a compromised verified_service credential still bypasses Ed25519;
# this is the outstanding proof that process isolation is required.
test_case "COMPROMISED VERIFIED SERVICE STILL ACCEPTS REUSED SIGNATURE" t "$forged"
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 2 ] || { echo "FAIL expected synthetic bypass demonstration";exit 1; }
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
[ "$count" = 2 ] || { echo "FAIL historical audit count: $count"; exit 1; }
echo "AUDIT COUNT UNCHANGED PASS"
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE runtime; SELECT isolated.try_append(1,7,10,11,'{}'::jsonb)" >/dev/null 2>&1; then
 echo "FAIL ordinary runtime executed trusted-writer procedure";exit 1
fi
echo "RUNTIME EXECUTE DENIED PASS"
privileges="$(docker exec "$name" psql -U postgres -qAt -c "SELECT has_function_privilege('writer','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE'),has_function_privilege('runtime','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE'),has_function_privilege('verified_service','isolated.try_append(integer,integer,integer,integer,jsonb)','EXECUTE')")"
[ "$privileges" = 'f|f|t' ] || { echo "FAIL privilege boundary $privileges"; exit 1; }
echo "THREE-ROLE EXECUTE ISOLATION PASS"
echo "EVIDENCE FENCING PROTOTYPE PASS — unsigned synthetic inputs, NOT a real approval"
