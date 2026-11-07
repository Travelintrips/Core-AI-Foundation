#!/usr/bin/env bash
set -euo pipefail
NAME="gpt02-resume-race-20261108-$$"
WORK="$(mktemp -d /tmp/gpt02-race.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --shm-size=64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 25); do if docker exec "$NAME" pg_isready -U postgres -q; then break; fi; sleep 1; done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA sandbox;
CREATE TABLE sandbox.grant_records(id int primary key, command_id int not null, worker_id text not null, status text not null, consumed_at timestamptz);
CREATE TABLE sandbox.command_lease(command_id int primary key, grant_id int not null, worker_id text not null, fence bigint not null, token text not null, expires_at timestamptz not null, released boolean not null default false);
CREATE TABLE sandbox.command_results(command_id int primary key, fence bigint not null, token text not null);
INSERT INTO sandbox.grant_records VALUES (1,99,'worker1','APPROVED',NULL);
CREATE FUNCTION sandbox.claim(p_grant int,p_worker text,p_fail boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE g sandbox.grant_records%ROWTYPE; l sandbox.command_lease%ROWTYPE;
BEGIN
 SELECT * INTO g FROM sandbox.grant_records WHERE id=p_grant FOR UPDATE;
 IF NOT FOUND OR g.status<>'APPROVED' OR g.consumed_at IS NOT NULL OR g.worker_id<>p_worker THEN
   RAISE EXCEPTION 'GRANT_DENIED';
 END IF;
 INSERT INTO sandbox.command_lease AS x(command_id,grant_id,worker_id,fence,token,expires_at)
 VALUES(g.command_id,p_grant,p_worker,1,'token-'||p_grant,clock_timestamp()+interval '90 seconds')
 ON CONFLICT(command_id) DO UPDATE
 SET grant_id=excluded.grant_id, worker_id=excluded.worker_id, fence=x.fence+1,
     token=excluded.token,expires_at=excluded.expires_at,released=false
 WHERE x.expires_at<=clock_timestamp() OR x.released
 RETURNING * INTO l;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_BUSY'; END IF;
 UPDATE sandbox.grant_records SET status='CONSUMED',consumed_at=clock_timestamp() WHERE id=p_grant;
 IF p_fail THEN RAISE EXCEPTION 'INJECTED_ROLLBACK'; END IF;
 PERFORM pg_sleep(0.3);
 RETURN l.token || ':' || l.fence;
END $$;
CREATE FUNCTION sandbox.write_result(p_command int,p_fence bigint,p_token text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sandbox.command_lease WHERE command_id=p_command AND fence=p_fence
 AND token=p_token AND expires_at>clock_timestamp() AND NOT released) THEN RETURN false; END IF;
 INSERT INTO sandbox.command_results VALUES (p_command,p_fence,p_token)
 ON CONFLICT(command_id) DO UPDATE SET fence=excluded.fence,token=excluded.token;
 RETURN true;
END $$;
SQL
# Three real PostgreSQL client sessions competing for one grant.
for i in 1 2 3; do
  (docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.claim(1,'worker1');" >"$WORK/claim$i.out" 2>"$WORK/claim$i.err" && echo success >"$WORK/claim$i.status" || echo reject >"$WORK/claim$i.status") &
done
wait
SUCCESS="$(grep -l success "$WORK"/claim*.status | wc -l)"
REJECT="$(grep -l reject "$WORK"/claim*.status | wc -l)"
[ "$SUCCESS" -eq 1 ] && [ "$REJECT" -eq 2 ] || { echo "RACE FAIL success=$SUCCESS reject=$REJECT"; exit 1; }
echo "RACE PASS: 1 winner, 2 rejected"
STATE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM sandbox.grant_records WHERE status='CONSUMED'),(SELECT count(*) FROM sandbox.command_lease);")"
[ "$STATE" = "1|1" ] || { echo "STATE FAIL $STATE"; exit 1; }
echo "STATE PASS: one consumed grant and one lease"
if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.claim(1,'worker1');" >"$WORK/replay.out" 2>&1; then echo "REPLAY FAIL"; exit 1; fi
echo "REPLAY PASS"
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO sandbox.grant_records VALUES (2,100,'worker2','APPROVED',NULL);
SQL
echo "PRE-ROLLBACK $(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT id,command_id,status FROM sandbox.grant_records ORDER BY id;')"
if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.claim(2,'worker2',true);" >"$WORK/rollback.out" 2>&1; then echo "ROLLBACK INJECTION FAIL";exit 1; fi
cat "$WORK/rollback.out"
echo "POST-ROLLBACK $(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT id,command_id,status FROM sandbox.grant_records ORDER BY id;')"
STATE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT status,(SELECT count(*) FROM sandbox.command_lease WHERE command_id=100) FROM sandbox.grant_records WHERE id=2;")"
[ "$STATE" = "APPROVED|0" ] || { echo "ROLLBACK FAIL $STATE";exit 1; }
echo "ROLLBACK PASS: grant unconsumed, no partial lease"
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO sandbox.grant_records VALUES (3,99,'worker3','APPROVED',NULL);
UPDATE sandbox.command_lease SET expires_at=clock_timestamp()-interval '1 second' WHERE command_id=99;
SQL
FENCE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.claim(3,'worker3');")"
[ "$FENCE" = "token-3:2" ] || { echo "FENCING FAIL $FENCE";exit 1; }
STALE="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.write_result(99,1,'token-1');")"
CURRENT="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.write_result(99,2,'token-3');")"
[ "$STALE" = "f" ] && [ "$CURRENT" = "t" ] || { echo "RESULT-FENCE FAIL $STALE $CURRENT";exit 1; }
echo "FENCE PASS: old owner denied, new owner accepted"
echo "ISOLATED POSTGRES 16 CONTRACT TESTS PASS (prototype only; NOT production claim function)"
