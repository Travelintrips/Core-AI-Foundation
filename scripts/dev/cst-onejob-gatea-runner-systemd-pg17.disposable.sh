#!/usr/bin/env bash
# CST-DEV Gate A real Python runner, synthetic PostgreSQL17, transient systemd.
# Trust auth only in disposable Docker --internal bridge, never live DB.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo QA_ROOT_REQUIRED; exit 3; }
for cmd in docker systemd-run systemctl python3; do command -v "$cmd" >/dev/null; done
root="$(cd "$(dirname "$0")/../.." && pwd)"
container=cst-gatea-pg17-synthetic-$$
net=cst-gatea-pg17-net-$$
unit=cst-gatea-pg17-watchdog-$$
cleanup() {
  # Restore any paused QA database BEFORE stopping a watcher that must relock.
  docker unpause "$container" >/dev/null 2>&1 || :
  systemctl stop "$unit.service" >/dev/null 2>&1 || :
  systemctl reset-failed "$unit.service" >/dev/null 2>&1 || :
  docker rm -f "$container" >/dev/null 2>&1 || :
  docker network rm "$net" >/dev/null 2>&1 || :
}
trap cleanup EXIT
docker network create --internal --driver bridge "$net" >/dev/null
docker run -d --rm --network "$net" --name "$container" --memory 448m \
  --cpus 1 -e POSTGRES_HOST_AUTH_METHOD=trust mirror.gcr.io/library/postgres:17-alpine >/dev/null
psql_qa() { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
for i in $(seq 1 120); do
  if [[ "$(psql_qa -c 'SELECT 1' 2>/dev/null || :)" == 1 ]]; then
    sleep .3
    if [[ "$(psql_qa -c 'SELECT 1' 2>/dev/null || :)" == 1 ]]; then break; fi
  fi
  sleep .2
done
[[ "$(psql_qa -c 'SELECT 1')" == 1 ]] || { echo QA_PG17_UNAVAILABLE; exit 2; }
ip=$(docker inspect "$container" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
[[ "$ip" =~ ^(172|192|10)\.[0-9]{1,3}(\.[0-9]{1,3}){2}$ ]] || {
 echo QA_PUBLIC_OR_INVALID_PG_IP_DENIED; exit 2; }
psql_qa <<'SQL'
CREATE SCHEMA ai_platform;
CREATE ROLE cst_team_model_pilot_stage_login
 NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS CONNECTION LIMIT 1;
CREATE TABLE ai_platform.cst_onejob_owner_approvals(status text);
SQL
# Reuse the EXISTING CST-DEV source-defined lease schema and constraints.
# The migration marker is scoped to this disposable psql process only.
{ printf "SET cst_gatea.reviewed_dev_migration='true';\n"
  cat "$root/docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql"
} | psql_qa
psql_qa < "$root/docs/dev/cst-gatea-relock-only.CSTDEV-ONLY.PROPOSED.sql"
[[ "$(psql_qa -c "SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_gatea_watchdog_relock'")" == 0 ]]
# ONLY synthetic disposable roles use trust auth here.
psql_qa -c "ALTER ROLE cst_gatea_watchdog_relock LOGIN;" >/dev/null
stage_state() { psql_qa -c "SELECT r.rolcanlogin::int,(SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname) FROM pg_roles r WHERE r.rolname='cst_team_model_pilot_stage_login'"; }
activate_synthetic_stage() {
  psql_qa -c "ALTER ROLE cst_team_model_pilot_stage_login LOGIN" >/dev/null
  docker exec -d "$container" psql -X -qAt -U cst_team_model_pilot_stage_login -d postgres -c "SELECT pg_sleep(90)" >/dev/null
  for i in $(seq 1 75); do
    [[ "$(stage_state)" == "1|1" ]] && return 0
    sleep .1
  done
  echo QA_SYNTHETIC_STAGE_SESSION_MISSING
  return 2
}
verify_closed() {
  for i in $(seq 1 100); do
    [[ "$(stage_state)" == "0|0" ]] && return 0
    sleep .15
  done
  echo QA_SYNTHETIC_STAGE_SESSIONS_NOT_TERMINATED
  return 2
}
start_watcher() {
  systemd-run --quiet --collect --unit="$unit" \
    --property=Type=simple \
    --property=DynamicUser=yes \
    --property=User=cst-onejob-gatea-watchdog \
    --property=NoNewPrivileges=yes \
    --property=Environment=CST_GATEA_DISPOSABLE_PG17_QA=1 \
    --property=IPAddressDeny=any \
    --property=IPAddressAllow="$ip/32" \
    --property=Restart=always \
    --property=RestartSec=1s \
    --property=StartLimitIntervalSec=0 \
    --property=ProtectSystem=strict \
    --property=ProtectHome=yes \
    --property=PrivateTmp=yes \
    /usr/bin/python3 -B "$root/scripts/dev/cst-onejob-gatea-synthetic-runner-entry.py" "$ip"
}
# A valid durable lease must be observed without false-positive relock.
psql_qa <<'SQL'
INSERT INTO ai_platform.cst_gatea_stage_leases VALUES(
 'xssrfshdrtdfupgqwfdw',
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
 now()-interval '20 seconds',now()+interval '3 minutes',
 now()-interval '1 second','ACTIVE');
SQL
activate_synthetic_stage
start_watcher
sleep 2
[[ "$(systemctl is-active "$unit.service")" == active ]] || {
 echo QA_WATCHER_FAILED_TO_START; exit 2; }
[[ "$(stage_state)" == "1|1" ]] || {
 echo QA_VALID_LEASE_PREMATURELY_RELOCKED; exit 2; }
echo CST_GATEA_VALID_LEASE_OBSERVATION_PASS
# SIGTERM must trigger the runner's real finally/relock path.
systemctl stop "$unit.service"
verify_closed
echo CST_GATEA_SYSTEMD_SIGTERM_REAL_RUNNER_RELOCK_PASS
psql_qa -c "DELETE FROM ai_platform.cst_gatea_stage_leases" >/dev/null
activate_synthetic_stage
start_watcher
verify_closed
echo CST_GATEA_SYSTEMD_REAL_RUNNER_ORPHAN_RELOCK_PASS
first=$(systemctl show "$unit.service" -p MainPID --value)
[[ "$first" =~ ^[0-9]+$ && "$first" -gt 1 ]]
# Real process crash, not a mocked test callback.
systemctl kill --signal=SIGKILL --kill-whom=main "$unit.service"
newpid=0; restarts=0
for i in $(seq 1 100); do
  newpid=$(systemctl show "$unit.service" -p MainPID --value)
  restarts=$(systemctl show "$unit.service" -p NRestarts --value)
  if [[ "$newpid" =~ ^[0-9]+$ && "$newpid" -gt 1 &&
        "$newpid" != "$first" && "$restarts" =~ ^[0-9]+$ &&
        "$restarts" -ge 1 ]]; then break; fi
  sleep .2
done
[[ "$newpid" != "$first" && "$restarts" -ge 1 ]] || {
 echo QA_SIGKILL_RESTART_NOT_VERIFIED; exit 2; }
echo CST_GATEA_SYSTEMD_REAL_RUNNER_SIGKILL_RESTART_PASS
# Re-arm a healthy lease FIRST so the fast watchdog cannot relock before
# a synthetic stage session exists. Then age its heartbeat to force relock.
psql_qa <<'SQL'
INSERT INTO ai_platform.cst_gatea_stage_leases VALUES(
 'xssrfshdrtdfupgqwfdw',
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
 now()-interval '60 seconds',now()+interval '3 minutes',
 now()-interval '1 second','ACTIVE');
SQL
activate_synthetic_stage
[[ "$(stage_state)" == "1|1" ]] || { echo QA_REARM_STAGE_NOT_HEALTHY; exit 2; }
psql_qa -c "UPDATE ai_platform.cst_gatea_stage_leases SET heartbeat_at=now()-interval '40 seconds'" >/dev/null
verify_closed
echo CST_GATEA_SYSTEMD_RESTARTED_RUNNER_EXPIRED_HEARTBEAT_RELOCK_PASS
# Scenario 6: a real temporary PostgreSQL outage must not be mistaken for
# healthy lease access. systemd restarts the process, then recovered DB
# connectivity must permit the runner to relock again.
docker pause "$container" >/dev/null
systemctl kill --signal=SIGKILL --kill-whom=main "$unit.service"
sleep 10
if ! journalctl -q -u "$unit.service" -n 80 --no-pager 2>/dev/null |
    grep -q "CST_GATEA_DISPOSABLE_RUNNER_FAILED_CLOSED"; then
  echo QA_DISPOSABLE_DB_OUTAGE_FAILCLOSED_NOT_OBSERVED
  exit 2
fi
echo CST_GATEA_REAL_RUNNER_DB_OUTAGE_FAILCLOSED_PASS
docker unpause "$container" >/dev/null
psql_qa -c "UPDATE ai_platform.cst_gatea_stage_leases
 SET issued_at=now()-interval '60 seconds',
     expires_at=now()+interval '3 minutes',
     heartbeat_at=now()-interval '1 second'" >/dev/null
activate_synthetic_stage
psql_qa -c "UPDATE ai_platform.cst_gatea_stage_leases SET heartbeat_at=now()-interval '40 seconds'" >/dev/null
verify_closed
echo CST_GATEA_REAL_RUNNER_RECONNECT_AND_RELOCK_PASS
systemctl stop "$unit.service"
verify_closed
echo CST_GATEA_REAL_WATCHDOG_DYNAMICUSER_PG17_DISPOSABLE_PASS
echo QA_DATABASE=SYNTHETIC_DOCKER_PG17_ONLY
echo QA_TRUST_AUTH_WITHOUT_PASSWORD=TRUE
echo QA_PRODUCTION_AND_CST_DEV_UNTOUCHED=TRUE
echo RELEASE_DECISION=NO_GO