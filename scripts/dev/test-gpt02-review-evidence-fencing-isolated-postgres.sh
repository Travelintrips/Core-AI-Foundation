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
CREATE ROLE runtime NOLOGIN;
CREATE SCHEMA isolated;
GRANT USAGE ON SCHEMA isolated TO writer,runtime;
CREATE TABLE isolated.commands(id integer PRIMARY KEY,status text NOT NULL);
CREATE TABLE isolated.responses(id integer PRIMARY KEY, command_id integer NOT NULL REFERENCES isolated.commands(id),
 kind text NOT NULL, created_at integer NOT NULL, acknowledged boolean NOT NULL DEFAULT false);
CREATE TABLE isolated.operators(id integer PRIMARY KEY, role text NOT NULL,status text NOT NULL);
CREATE TABLE isolated.audit(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,command_id integer,nonce text UNIQUE NOT NULL);
INSERT INTO isolated.commands VALUES(1,'PROCESSING');
INSERT INTO isolated.responses VALUES(10,1,'CHECKPOINT',10,true),(11,1,'BLOCKER',20,false);
INSERT INTO isolated.operators VALUES(7,'admin','active');
ALTER TABLE isolated.audit ENABLE ROW LEVEL SECURITY;
-- Review writer has no raw table or command write access.
CREATE FUNCTION isolated.try_append(p_command integer,p_operator integer,p_checkpoint integer,p_blocker integer,p_nonce text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,isolated
AS $$
DECLARE v_status text; v_inserted integer;
BEGIN
 SELECT status INTO v_status FROM isolated.commands WHERE id=p_command FOR UPDATE;
 IF v_status IS DISTINCT FROM 'PROCESSING' THEN RETURN false; END IF;
 -- Separate statement after the command lock gives the latest committed response
 -- snapshot under READ COMMITTED. This toy guard does NOT authenticate Ed25519.
 INSERT INTO isolated.audit(command_id,nonce)
 SELECT p_command,p_nonce FROM isolated.operators u
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
REVOKE ALL ON FUNCTION isolated.try_append(integer,integer,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION isolated.try_append(integer,integer,integer,integer,text) TO writer;
SQL
test_case() {
 local label="$1" expect="$2" nonce="$3"
 local got
 got="$(docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -qAt -c "SET ROLE writer; SELECT isolated.try_append(1,7,10,11,'$nonce')")"
 got="$(printf '%s\n' "$got" | tail -n 1)"
 [ "$got" = "$expect" ] || { echo "FAIL $label actual=$got wanted=$expect"; exit 1; }
 echo "$label PASS"
}
test_case "VALID SYNTHETIC EVIDENCE" t n1
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET status='suspended' WHERE id=7" >/dev/null
test_case "OPERATOR REVOKED" f n2
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET status='active',role='viewer' WHERE id=7" >/dev/null
test_case "OPERATOR ROLE CHANGED" f n3
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.operators SET role='admin'; UPDATE isolated.responses SET acknowledged=false WHERE id=10" >/dev/null
test_case "NATIVE ACK REMOVED" f n4
docker exec "$name" psql -U postgres -q -c "UPDATE isolated.responses SET acknowledged=true WHERE id=10; INSERT INTO isolated.responses VALUES(12,1,'BLOCKER',30,false)" >/dev/null
test_case "STALE BLOCKER" f n5
docker exec "$name" psql -U postgres -q -c "DELETE FROM isolated.responses WHERE id=12; INSERT INTO isolated.responses VALUES(13,1,'FAILED',30,false)" >/dev/null
test_case "TERMINAL RESPONSE" f n6
docker exec "$name" psql -U postgres -q -c "DELETE FROM isolated.responses WHERE id=13; UPDATE isolated.commands SET status='FAILED' WHERE id=1" >/dev/null
test_case "TERMINAL COMMAND" f n7
count="$(docker exec "$name" psql -U postgres -qAt -c 'SELECT count(*) FROM isolated.audit')"
[ "$count" = 1 ] || { echo "FAIL historical audit count: $count"; exit 1; }
echo "AUDIT COUNT UNCHANGED PASS"
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE runtime; SELECT isolated.try_append(1,7,10,11,'forbidden')" >/dev/null 2>&1; then
 echo "FAIL ordinary runtime executed trusted-writer procedure";exit 1
fi
echo "RUNTIME EXECUTE DENIED PASS"
echo "EVIDENCE FENCING PROTOTYPE PASS — unsigned synthetic inputs, NOT a real approval"
