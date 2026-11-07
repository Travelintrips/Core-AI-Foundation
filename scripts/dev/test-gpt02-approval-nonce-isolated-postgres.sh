#!/usr/bin/env bash
# Disposable PostgreSQL contract only — NOT a deployed approval issuer.
set -euo pipefail
NAME="gpt02-proof-nonce-$$"
WORK="$(mktemp -d /tmp/gpt02-nonce.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --shm-size=64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 30); do if docker exec "$NAME" pg_isready -U postgres -q; then break; fi; sleep 1; done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA sandbox;
CREATE TABLE sandbox.commands(command_id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE sandbox.proof_nonces(
 nonce text PRIMARY KEY, command_id uuid NOT NULL REFERENCES sandbox.commands(command_id),
 operator_id text NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sandbox.grants(
 id bigserial PRIMARY KEY, command_id uuid NOT NULL REFERENCES sandbox.commands(command_id),
 nonce text NOT NULL UNIQUE REFERENCES sandbox.proof_nonces(nonce),
 operator_id text NOT NULL);
INSERT INTO sandbox.commands VALUES
 ('169a7492-cfd8-4a56-bb57-18001b6b5968','PROCESSING'),
 ('28e38692-73c0-470e-aaea-51894504a5f0','FAILED');
CREATE FUNCTION sandbox.consume_approved_proof(
 p_command uuid,p_nonce text,p_operator text,p_expires timestamptz,p_verified boolean,
 p_fail boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
 -- p_verified models server-verified Ed25519; it is NOT cryptographic proof.
 IF p_verified IS DISTINCT FROM true OR p_operator IS NULL OR length(p_operator)<3 OR
 p_nonce !~ '^[a-f0-9]{32}$' OR p_expires IS NULL OR
 p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '120 seconds'
 THEN RAISE EXCEPTION 'PROOF_REJECTED'; END IF;
 PERFORM 1 FROM sandbox.commands WHERE command_id=p_command
  AND status IN ('RECEIVED','PROCESSING') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMAND_REJECTED'; END IF;
 INSERT INTO sandbox.proof_nonces(nonce,command_id,operator_id,expires_at)
 VALUES (p_nonce,p_command,p_operator,p_expires);
 INSERT INTO sandbox.grants(command_id,nonce,operator_id)
 VALUES (p_command,p_nonce,p_operator) RETURNING id INTO v_id;
 IF p_fail THEN RAISE EXCEPTION 'ROLLBACK_INJECTED'; END IF;
 PERFORM pg_sleep(0.15);
 RETURN v_id;
END $$;
SQL
COMMAND="169a7492-cfd8-4a56-bb57-18001b6b5968"
NONCE="0123456789abcdef0123456789abcdef"
EXP="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT to_char(clock_timestamp()+interval '90 seconds','YYYY-MM-DD HH24:MI:SSOF');")"
for i in 1 2 3; do
 (docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.consume_approved_proof('$COMMAND','$NONCE','operator-123','$EXP',true);" >"$WORK/out$i" 2>&1 && echo ok >"$WORK/s$i" || echo denied >"$WORK/s$i") &
done
wait
WIN="$(grep -l '^ok$' "$WORK"/s* | wc -l)"
DENIED="$(grep -l '^denied$' "$WORK"/s* | wc -l)"
[ "$WIN" -eq 1 ] && [ "$DENIED" -eq 2 ] || { echo "NONCE RACE FAIL $WIN $DENIED";exit 1; }
ROWS="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM sandbox.proof_nonces),(SELECT count(*) FROM sandbox.grants);")"
[ "$ROWS" = "1|1" ] || { echo "NONCE ATOMICITY FAIL $ROWS";exit 1; }
echo "NONCE RACE PASS: 1 winner, 2 rejected; exactly one consumed nonce and grant"
if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.consume_approved_proof('$COMMAND','$NONCE','operator-123','$EXP',true);" >"$WORK/replay" 2>&1; then echo "REPLAY FAIL";exit 1;fi
echo "REPLAY PASS"
ROLLBACK_NONCE="abcdef0123456789abcdef0123456789"
if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.consume_approved_proof('$COMMAND','$ROLLBACK_NONCE','operator-123','$EXP',true,true);" >"$WORK/rollback" 2>&1; then echo "INJECTED FAILURE ACCEPTED";exit 1;fi
STATE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM sandbox.proof_nonces WHERE nonce='$ROLLBACK_NONCE'),(SELECT count(*) FROM sandbox.grants WHERE nonce='$ROLLBACK_NONCE');")"
[ "$STATE" = "0|0" ] || { echo "ROLLBACK LEAK $STATE";exit 1; }
echo "ROLLBACK PASS: nonce and grant rollback together"
for case in "169a7492-cfd8-4a56-bb57-18001b6b5968|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|false|$EXP" "28e38692-73c0-470e-aaea-51894504a5f0|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|true|$EXP" "169a7492-cfd8-4a56-bb57-18001b6b5968|cccccccccccccccccccccccccccccccc|true|2000-01-01 00:00:00+00"; do
 IFS='|' read -r cmd nonce verified expiry <<<"$case"
 if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.consume_approved_proof('$cmd','$nonce','operator-123','$expiry',$verified);" >"$WORK/invalid" 2>&1; then echo "INVALID PROOF ACCEPTED";exit 1;fi
done
STATE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM sandbox.proof_nonces),(SELECT count(*) FROM sandbox.grants);")"
[ "$STATE" = "1|1" ] || { echo "DENIAL STATE FAIL $STATE";exit 1; }
echo "FAIL CLOSED PASS: unsigned, FAILED command, expired proof; no extra nonce or grants"
echo "ISOLATED NONCE REPLAY CONTRACT PASS (synthetic signature flag, NOT real signer)"
