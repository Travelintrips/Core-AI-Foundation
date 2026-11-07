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
-- Persist actual command-linked response identities in this disposable test DB.
CREATE TABLE sandbox.response_events (
  command_id int not null, event_id text not null, kind text not null, sequence_no int not null,
  PRIMARY KEY (command_id,event_id), UNIQUE (command_id,sequence_no)
);
INSERT INTO sandbox.response_events VALUES
 (99,'cp99','CHECKPOINT',1),(99,'block99','BLOCKER',2),
 (100,'cp100','CHECKPOINT',1),(100,'block100','BLOCKER',2);
CREATE TABLE sandbox.command_evidence (
 command_id int primary key, command_status text not null, checkpoint_verified boolean not null,
 receiver_ack_verified boolean not null, last_kind text not null, blocker_matches boolean not null,
 approved boolean not null, retries int not null, retry_limit int not null,
 retry_after timestamptz, circuit_open boolean not null
);
INSERT INTO sandbox.command_evidence VALUES
 (99,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false),
 (100,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false);
INSERT INTO sandbox.grant_records VALUES (1,99,'worker1','APPROVED',NULL);
CREATE FUNCTION sandbox.claim(p_grant int,p_worker text,p_fail boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE g sandbox.grant_records%ROWTYPE; l sandbox.command_lease%ROWTYPE; e sandbox.command_evidence%ROWTYPE;
BEGIN
 SELECT * INTO g FROM sandbox.grant_records WHERE id=p_grant FOR UPDATE;
 IF NOT FOUND OR g.status<>'APPROVED' OR g.consumed_at IS NOT NULL OR g.worker_id<>p_worker THEN
   RAISE EXCEPTION 'GRANT_DENIED';
 END IF;
 SELECT * INTO e FROM sandbox.command_evidence WHERE command_id=g.command_id FOR UPDATE;
 IF NOT FOUND OR e.command_status NOT IN ('RECEIVED','PROCESSING') OR
    NOT e.checkpoint_verified OR NOT e.receiver_ack_verified OR
    e.last_kind<>'BLOCKER' OR NOT e.blocker_matches OR NOT e.approved OR
    e.retries<0 OR e.retry_limit<=0 OR e.retries>=e.retry_limit OR
    e.circuit_open OR (e.retry_after IS NOT NULL AND e.retry_after>clock_timestamp())
 THEN RAISE EXCEPTION 'RECOVERY_EVIDENCE_DENIED'; END IF;
 -- Look up checkpoint and BLOCKER as rows belonging to the *same* command.
 -- Reject terminal evidence anywhere in the command history, or a stale BLOCKER.
 IF NOT EXISTS (
   SELECT 1 FROM sandbox.response_events cp
   JOIN sandbox.response_events bl ON bl.command_id=cp.command_id
   WHERE cp.command_id=g.command_id AND cp.kind='CHECKPOINT'
     AND bl.kind='BLOCKER' AND cp.sequence_no<bl.sequence_no
     AND NOT EXISTS (SELECT 1 FROM sandbox.response_events t
       WHERE t.command_id=g.command_id AND t.kind IN ('FAILED','COMPLETED'))
     AND (SELECT last.kind FROM sandbox.response_events last
          WHERE last.command_id=g.command_id
          ORDER BY last.sequence_no DESC LIMIT 1)='BLOCKER'
 ) THEN RAISE EXCEPTION 'RESPONSE_IDENTITY_DENIED'; END IF;
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
 -- Hold the command lease row lock across the fenced result write. An expired
 -- worker cannot race with lease rotation between checking and writing.
 PERFORM 1 FROM sandbox.command_lease WHERE command_id=p_command AND fence=p_fence
 AND token=p_token AND expires_at>clock_timestamp() AND NOT released FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
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
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO sandbox.command_evidence(command_id,command_status,checkpoint_verified,receiver_ack_verified,last_kind,blocker_matches,approved,retries,retry_limit,retry_after,circuit_open)
VALUES
(201,'FAILED',true,true,'BLOCKER',true,true,0,3,NULL,false),
(202,'PROCESSING',false,true,'BLOCKER',true,true,0,3,NULL,false),
(203,'PROCESSING',true,false,'BLOCKER',true,true,0,3,NULL,false),
(204,'PROCESSING',true,true,'CHECKPOINT',true,true,0,3,NULL,false),
(205,'PROCESSING',true,true,'BLOCKER',false,true,0,3,NULL,false),
(206,'PROCESSING',true,true,'BLOCKER',true,false,0,3,NULL,false),
(207,'PROCESSING',true,true,'BLOCKER',true,true,3,3,NULL,false),
(208,'PROCESSING',true,true,'BLOCKER',true,true,0,3,clock_timestamp()+interval '1 hour',false),
(209,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,true),
(210,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false),
(211,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false),
(212,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false),
(213,'PROCESSING',true,true,'BLOCKER',true,true,0,3,NULL,false);
INSERT INTO sandbox.response_events
 SELECT n,'cp'||n,'CHECKPOINT',1 FROM generate_series(201,213) n;
INSERT INTO sandbox.response_events
 SELECT n,'block'||n,'BLOCKER',2 FROM generate_series(201,213) n;
-- Wrong command binding, terminal before, terminal after, and stale BLOCKER.
DELETE FROM sandbox.response_events WHERE command_id=210 AND kind='BLOCKER';
INSERT INTO sandbox.response_events VALUES
 (211,'earlier-failed','FAILED',0),
 (212,'later-completed','COMPLETED',3),
 (213,'newer-checkpoint','CHECKPOINT',3);
INSERT INTO sandbox.grant_records
SELECT command_id,command_id,'worker1','APPROVED',NULL FROM sandbox.command_evidence
WHERE command_id BETWEEN 201 AND 213;
SQL
for cmd in $(seq 201 213); do
  if docker exec "$NAME" psql -U postgres -qAt -c "SELECT sandbox.claim($cmd,'worker1');" >"$WORK/guard$cmd.out" 2>&1; then
    echo "FAIL CLOSED GUARD $cmd permitted"; exit 1
  fi
  state="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT status,(SELECT count(*) FROM sandbox.command_lease WHERE command_id=$cmd) FROM sandbox.grant_records WHERE id=$cmd;")"
  [ "$state" = "APPROVED|0" ] || { echo "FAIL CLOSED STATE $cmd $state"; exit 1; }
done
echo "EVIDENCE GUARDS PASS: thirteen rejected (including 4 persisted-response relation checks), zero consumed grants or leases"
echo "ISOLATED POSTGRES 16 CONTRACT TESTS PASS (prototype only; NOT production claim function)"
