#!/usr/bin/env bash
# DEV test only. The database, roles and records below are synthetic and disposable.
set -euo pipefail
NAME="gpt02-issuance-isolated-$$"
WORK="$(mktemp -d /tmp/gpt02-issuance.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --shm-size=64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 30); do if docker exec "$NAME" pg_isready -U postgres -q; then break; fi; sleep 1; done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA sandbox;
CREATE ROLE sandbox_approver NOLOGIN;
CREATE ROLE sandbox_worker NOLOGIN;
CREATE TABLE sandbox.commands(id integer PRIMARY KEY,status text NOT NULL);
CREATE TABLE sandbox.responses(id text PRIMARY KEY,command_id int NOT NULL REFERENCES sandbox.commands(id),kind text NOT NULL,seq int NOT NULL);
CREATE TABLE sandbox.evidence(
 command_id int PRIMARY KEY REFERENCES sandbox.commands(id),
 checkpoint_signed boolean NOT NULL, receiver_ack_signed boolean NOT NULL,
 rate_limit_clear boolean NOT NULL, retries int NOT NULL, retry_limit int NOT NULL);
CREATE TABLE sandbox.grants(
 id bigserial PRIMARY KEY,command_id int NOT NULL REFERENCES sandbox.commands(id),
 checkpoint_id text NOT NULL REFERENCES sandbox.responses(id),
 blocker_id text NOT NULL REFERENCES sandbox.responses(id),
 worker_id text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE UNIQUE INDEX only_live_grant ON sandbox.grants(command_id) WHERE consumed_at IS NULL;
INSERT INTO sandbox.commands VALUES(1,'PROCESSING'),(2,'FAILED'),(3,'PROCESSING'),(4,'PROCESSING'),(5,'PROCESSING');
INSERT INTO sandbox.responses VALUES
 ('cp1',1,'CHECKPOINT',1),('bl1',1,'BLOCKER',2),
 ('cp2',2,'CHECKPOINT',1),('bl2',2,'BLOCKER',2),
 ('cp3',3,'CHECKPOINT',1),('bl3',3,'BLOCKER',2),
 ('cp4',4,'CHECKPOINT',1),('bl4',4,'BLOCKER',2),
 ('cp5',5,'CHECKPOINT',1),('bl5',5,'BLOCKER',2),('terminal5',5,'FAILED',3);
INSERT INTO sandbox.evidence VALUES
 (1,true,true,true,0,3),(2,true,true,true,0,3),
 (3,false,true,true,0,3),(4,true,true,false,0,3),(5,true,true,true,0,3);
CREATE FUNCTION sandbox.approve(
 p_cmd int,p_cp text,p_block text,p_worker text,p_operator text,p_seconds int
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sandbox AS $$
DECLARE v_id bigint;
BEGIN
 -- The executor must have DB-granted permission to call this function.
 -- In this isolated test, only sandbox_approver is granted EXECUTE.
 IF p_worker IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' OR
    p_operator IS DISTINCT FROM 'authenticated-operator' OR
    p_seconds IS NULL OR p_seconds<30 OR p_seconds>300 THEN
   RAISE EXCEPTION 'INVALID_ISSUANCE_REQUEST';
 END IF;
 -- Server-owned snapshot check within the same transaction.
 PERFORM 1 FROM sandbox.commands c JOIN sandbox.evidence e ON e.command_id=c.id
 WHERE c.id=p_cmd AND c.status IN ('PROCESSING','RECEIVED')
 AND e.checkpoint_signed AND e.receiver_ack_signed AND e.rate_limit_clear
 AND e.retries>=0 AND e.retries<e.retry_limit FOR UPDATE OF c,e;
 IF NOT FOUND THEN RAISE EXCEPTION 'ISSUANCE_EVIDENCE_DENIED'; END IF;
 PERFORM 1 FROM sandbox.responses cp
 JOIN sandbox.responses bl ON bl.command_id=cp.command_id
 WHERE cp.id=p_cp AND bl.id=p_block AND cp.command_id=p_cmd
 AND cp.kind='CHECKPOINT' AND bl.kind='BLOCKER' AND cp.seq<bl.seq
 AND NOT EXISTS (SELECT 1 FROM sandbox.responses r
  WHERE r.command_id=p_cmd AND r.kind IN ('FAILED','COMPLETED'))
 AND (SELECT r.kind FROM sandbox.responses r
  WHERE r.command_id=p_cmd ORDER BY r.seq DESC LIMIT 1)='BLOCKER';
 IF NOT FOUND THEN RAISE EXCEPTION 'ISSUANCE_RESPONSE_DENIED'; END IF;
 INSERT INTO sandbox.grants(command_id,checkpoint_id,blocker_id,worker_id,approved_by,approved_at,expires_at)
 VALUES(p_cmd,p_cp,p_block,p_worker,p_operator,clock_timestamp(),clock_timestamp()+make_interval(secs=>p_seconds))
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON SCHEMA sandbox FROM PUBLIC;
GRANT USAGE ON SCHEMA sandbox TO sandbox_approver,sandbox_worker;
REVOKE ALL ON FUNCTION sandbox.approve(int,text,text,text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox.approve(int,text,text,text,text,int) TO sandbox_approver;
REVOKE ALL ON sandbox.grants,sandbox.commands,sandbox.responses,sandbox.evidence FROM PUBLIC,sandbox_approver,sandbox_worker;
SQL
# A database worker role must not be able to mint grants.
if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE sandbox_worker; SELECT sandbox.approve(1,'cp1','bl1','openclaw-dell-chatgpt-wake-dev','authenticated-operator',120);" >"$WORK/worker" 2>&1; then echo "UNAUTHORIZED WORKER FAIL"; exit 1; fi
echo "ROLE GUARD PASS: worker has no grant issuance permission"
# Native DB role grants scope the invocation; the function verifies in-transaction data.
GOOD="$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE sandbox_approver; SELECT sandbox.approve(1,'cp1','bl1','openclaw-dell-chatgpt-wake-dev','authenticated-operator',120);")"
[ "$GOOD" = "1" ] || { echo "AUTHENTICATED APPROVAL FAIL";exit 1; }
echo "APPROVAL PASS: one approved grant issued by permitted DB role"
for case in "1|cp1|bl1" "2|cp2|bl2" "3|cp3|bl3" "4|cp4|bl4" "5|cp5|bl5" "1|cp2|bl1" "1|cp1|bl2"; do
 IFS='|' read -r cmd cp bl <<<"$case"
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE sandbox_approver; SELECT sandbox.approve($cmd,'$cp','$bl','openclaw-dell-chatgpt-wake-dev','authenticated-operator',120);" >"$WORK/reject" 2>&1; then
 echo "INVALID ISSUANCE PERMITTED $case";exit 1;fi
done
# Additional identity/TTL failures.
for params in "1,'cp1','bl1','other-worker','authenticated-operator',120" "1,'cp1','bl1','openclaw-dell-chatgpt-wake-dev','unverified',120" "1,'cp1','bl1','openclaw-dell-chatgpt-wake-dev','authenticated-operator',3600"; do
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE sandbox_approver; SELECT sandbox.approve($params);" >"$WORK/reject" 2>&1; then echo "INVALID ISSUANCE PERMITTED $params";exit 1;fi
done
COUNT="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT count(*) FROM sandbox.grants;")"
[ "$COUNT" = "1" ] || { echo "GRANT DRIFT FAIL count=$COUNT"; exit 1; }
echo "DENIAL PASS: duplicate, terminal, unsigned, rate-limited, mismatched response, wrong worker/operator and TTL denied; count=1"
echo "ISOLATED ISSUANCE CONTRACT PASS (synthetic identities; NOT production issuer)"
