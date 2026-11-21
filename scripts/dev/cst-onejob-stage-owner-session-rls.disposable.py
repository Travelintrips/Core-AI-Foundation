#!/usr/bin/python3
"""Exact narrow Owner password-state SELECT migration, isolated PG16 only.

Docker --network none. No connected CST-DEV credentials, Owner JWTs,
production access, signer, Queue or Dispatch operations.
"""
import os,sys,json,time,subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
NAME='cst-onejob-owner-session-rls-pg16-'+str(os.getpid())
MIG=(ROOT/'docs/dev/cst-onejob-stage-owner-password-state-read.CSTDEV-ONLY.sql').read_text()
BACK=(ROOT/'docs/dev/cst-onejob-stage-owner-password-state-read.ROLLBACK-CSTDEV-ONLY.sql').read_text()
def run(cmd,stdin=None,allow=False,seconds=30):
 r=subprocess.run(cmd,input=stdin,text=True,capture_output=True,timeout=seconds)
 if r.returncode and not allow:
  raise RuntimeError('ISOLATED_COMMAND_FAILED_'+cmd[1].upper())
 return r
def psql(sql,allow=False):
 return run(['docker','exec','-i',NAME,'psql','-X','-qAt',
   '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],sql,allow)
def expect(value,msg):
 if not value:raise RuntimeError(msg)
def main():
 expect('GRANT SELECT (must_change_password)' in MIG,'MIGRATION_NOT_SCOPED')
 expect('REVOKE SELECT (must_change_password)' in BACK,'ROLLBACK_NOT_SCOPED')
 run(['docker','run','-d','--rm','--name',NAME,
  '--network','none','--memory','384m','--cpus','1',
  '-e','POSTGRES_DB=postgres','-e','POSTGRES_HOST_AUTH_METHOD=trust',
  'postgres:16-alpine'],seconds=90)
 try:
  # TCP only: the official image can briefly run a bootstrap socket server
  # before the final PostgreSQL process accepts connections.
  for i in range(100):
   r=run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1',
    '-U','postgres','-d','postgres'],allow=True)
   if r.returncode==0:break
   time.sleep(.25)
  else:raise RuntimeError('FINAL_PG_TCP_NOT_READY')
  psql("""CREATE SCHEMA ai_platform;
   CREATE ROLE cst_team_model_pilot_writer NOLOGIN NOINHERIT NOBYPASSRLS;
   CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;
   GRANT cst_team_model_pilot_writer TO cst_team_model_pilot_stage_login
     WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
   CREATE ROLE cst_untrusted_client NOLOGIN NOINHERIT NOBYPASSRLS;
   CREATE TABLE ai_platform.internal_users(
     id integer primary key,role text not null,status text not null,
     account_type text not null,must_change_password boolean not null,
     email text not null,password_hash text);
   CREATE TABLE ai_platform.cst_onejob_owner_approvals(
     id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     approved_by_user_id integer);
   INSERT INTO ai_platform.internal_users VALUES
     (1,'owner','active','internal',false,'owner-ok@example.invalid',null),
     (2,'owner','active','internal',true,'owner-password-change@example.invalid',null),
     (3,'admin','active','internal',false,'admin@example.invalid',null),
     (4,'owner','blocked','internal',false,'owner-blocked@example.invalid',null);
   ALTER TABLE ai_platform.internal_users ENABLE ROW LEVEL SECURITY;
   -- Match real CST-DEV: RLS enabled, NO FORCE, table owner postgres.
   -- The stage writer is a distinct NOLOGIN/NOBYPASSRLS nonowner role.
   GRANT USAGE ON SCHEMA ai_platform
      TO cst_team_model_pilot_writer,cst_untrusted_client;
   GRANT SELECT(id,role,status,account_type)
      ON ai_platform.internal_users TO cst_team_model_pilot_writer;
   CREATE POLICY cst_onejob_stage_owner_select
     ON ai_platform.internal_users FOR SELECT
     TO cst_team_model_pilot_writer USING (
       role='owner' AND status='active' AND account_type='internal');""")
  baseline=psql("""SELECT
    relrowsecurity::text||'|'||relforcerowsecurity::text||'|'||
    relowner::regrole::text
    FROM pg_class WHERE oid='ai_platform.internal_users'::regclass;""").stdout.strip()
  expect(baseline=='true|false|postgres',
    'LIVE_PARITY_OWNER_AND_NONFORCED_RLS_NOT_VERIFIED')
  pre=psql("""BEGIN;
    SET TRANSACTION READ ONLY;
    SET LOCAL ROLE cst_team_model_pilot_writer;
    SELECT must_change_password FROM ai_platform.internal_users WHERE id=1;
    ROLLBACK;""",True)
  expect(pre.returncode!=0,'PASSWORD_FLAG_WAS_READABLE_BEFORE_MINIMAL_GRANT')
  psql(MIG)
  row=psql("""SELECT has_column_privilege(
    'cst_team_model_pilot_writer',
    'ai_platform.internal_users','must_change_password','SELECT'),
    has_column_privilege('cst_team_model_pilot_writer',
    'ai_platform.internal_users','email','SELECT'),
    has_table_privilege('cst_team_model_pilot_writer',
    'ai_platform.internal_users','UPDATE');""").stdout.strip()
  expect(row=='t|f|f','MINIMAL_AUTH_GRANT_TOO_BROAD')
  result=psql("""BEGIN;
    SET TRANSACTION READ ONLY;
    SET LOCAL ROLE cst_team_model_pilot_writer;
    SELECT id::text||'|'||must_change_password::text
      FROM ai_platform.internal_users
      WHERE role='owner' AND status='active'
        AND account_type='internal' ORDER BY id;
    ROLLBACK;""").stdout.strip().splitlines()
  expect(result==['1|false','2|true'],'SCOPED_OWNER_OR_RESET_READBACK_INVALID')
  blocked=psql("""BEGIN;
    SET TRANSACTION READ ONLY;
    SET LOCAL ROLE cst_team_model_pilot_writer;
    SELECT count(*) FROM ai_platform.internal_users WHERE id IN (3,4);
    ROLLBACK;""").stdout.strip()
  expect(blocked=='0','ADMIN_OR_BLOCKED_USER_VISIBLE_TO_STAGE')
  untrusted=psql("""BEGIN;
    SET TRANSACTION READ ONLY;
    SET LOCAL ROLE cst_untrusted_client;
    SELECT must_change_password FROM ai_platform.internal_users WHERE id=1;
    ROLLBACK;""",True)
  expect(untrusted.returncode!=0,'UNTRUSTED_ROLE_OWNER_PASSWORD_FLAG_VISIBLE')
  repeat=psql(MIG,True)
  expect(repeat.returncode!=0,'DUPLICATE_STAGE_SESSION_GRANT_NOT_DENIED')
  psql("""INSERT INTO ai_platform.cst_onejob_owner_approvals(approved_by_user_id)
    VALUES (1);""")
  rollback_active=psql(BACK,True)
  expect(rollback_active.returncode!=0,'ROLLBACK_ALLOWED_AFTER_REAL_OWNER_RECORD')
  psql("""DELETE FROM ai_platform.cst_onejob_owner_approvals;""")
  psql(BACK)
  revoked=psql("""SELECT has_column_privilege('cst_team_model_pilot_writer',
    'ai_platform.internal_users','must_change_password','SELECT');""").stdout.strip()
  expect(revoked=='f','ROLLBACK_LEAKED_EXTRA_SELECT')
  print('CST_ONEJOB_STAGE_OWNER_SESSION_RLS_DISPOSABLE_PASS '+json.dumps({
    'environment':'PG16_DOCKER_NETWORK_NONE',
    'exactMinimalGrantAndRollback':True,
    'ownerActiveVerified':True,
    'passwordChangePendingOwnerVisibleForExplicitDenial':True,
    'nonOwnerAndBlockedOwnerHiddenByRLS':True,
    'untrustedClientDenied':True,
    'migrationReplayDenied':True,
    'rollbackAfterApprovalDenied':True,
    'realDatabaseChanged':False,'prodChanged':False,
    'signersActivated':False,'releaseDecision':'NO_GO'
  },sort_keys=True))
 finally:run(['docker','rm','-f',NAME],allow=True)
if __name__=='__main__':
 try:main()
 except Exception as e:
  # Synthetic fixture only: output a stable no-private-detail category.
  print('CST_ONEJOB_STAGE_OWNER_SESSION_RLS_DISPOSABLE_FAIL '+str(e).split(':',1)[0][:90])
  sys.exit(2)
