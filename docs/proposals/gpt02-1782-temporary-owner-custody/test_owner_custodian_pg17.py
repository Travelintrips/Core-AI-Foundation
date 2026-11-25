#!/usr/bin/env python3
"""Run only a new isolated Docker fixture; there is no external DB connection API."""
from __future__ import annotations

import argparse
import hashlib
import json
import queue
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMAGE = 'sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7'
PHASE_B_SHA256 = '5aaa574b02a5d712dbb08e1cf2aef227ebcb00e895b1c7f1a1630c97a8972f72'
PHASE_B_GIT_BLOB = '444bad054492ed77a565600d2d1bba02ba3dd1fe'
OWNER = 'gpt02_relock_owner_approval_owner'
READER = 'gpt02_owner_ledger_reader_1782_dev'
BOOTSTRAP = 'fixture_bootstrap'
CHALLENGE = 'gpt02_owner_approval.gpt02_relock_owner_approval_challenges'
DECISION = 'gpt02_owner_approval.gpt02_relock_owner_approval_decisions'
LABEL = 'gpt02-1782-isolated-delegation-proposal'

SNAPSHOT = """
SELECT jsonb_build_object(
 'sessionUser', session_user, 'currentUser', current_user,
 'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
 'canSet', pg_has_role('postgres','gpt02_relock_owner_approval_owner','SET'),
 'canInherit', pg_has_role('postgres','gpt02_relock_owner_approval_owner','USAGE'),
 'memberships', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM (
   SELECT oid,roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members
 ) AS m),
 'roles', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM (
   SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
     rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil FROM pg_roles
 ) AS r),
 'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM (
   SELECT oid,polname,polrelid,polcmd,polpermissive,polroles,
          pg_get_expr(polqual,polrelid) AS expression
   FROM pg_policy
 ) AS p),
 'schemaUsage',has_schema_privilege('gpt02_owner_ledger_reader_1782_dev','gpt02_owner_approval','USAGE'),
 'schemaCreate',has_schema_privilege('gpt02_owner_ledger_reader_1782_dev','gpt02_owner_approval','CREATE'),
 'tables', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM (
   SELECT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,
     has_table_privilege('gpt02_owner_ledger_reader_1782_dev',c.oid,'SELECT') AS broad_select,
     has_table_privilege('gpt02_owner_ledger_reader_1782_dev',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
     (SELECT array_agg(a.attname ORDER BY a.attname) FROM pg_attribute a
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND has_column_privilege('gpt02_owner_ledger_reader_1782_dev',c.oid,a.attnum,'SELECT')) AS reader_columns,
     (SELECT array_agg(a.attname ORDER BY a.attname) FROM pg_attribute a
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND has_column_privilege('gpt02_owner_ledger_reader_dev',c.oid,a.attnum,'SELECT')) AS old_reader_columns
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='gpt02_owner_approval'
 ) AS t)
);
"""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise AssertionError(code)


def command(args: list[str], text: str | None = None, timeout: float = 30,
            check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('FIXTURE_COMMAND_FAILED:' + str(result.returncode) + ':' + result.stderr[-1200:])
    return result


class SqlFailure(RuntimeError):
    pass


class Session:
    def __init__(self, container: str, user: str = 'postgres') -> None:
        self.process = subprocess.Popen(
            ['docker','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
             '-v','VERBOSITY=sqlstate','-U',user,'-d','postgres'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        self.lines: queue.Queue[str | None] = queue.Queue()
        def collect() -> None:
            assert self.process.stdout is not None
            for line in self.process.stdout:
                self.lines.put(line.rstrip('\n'))
            self.lines.put(None)
        threading.Thread(target=collect, daemon=True).start()

    def execute(self, sql: str, timeout: float = 20) -> list[str]:
        marker = 'FIXTURE_' + uuid.uuid4().hex
        assert self.process.stdin is not None
        self.process.stdin.write(sql + '\n\\echo ' + marker + '\n')
        self.process.stdin.flush()
        result = []
        deadline = time.monotonic() + timeout
        while True:
            try:
                line = self.lines.get(timeout=max(.01,deadline-time.monotonic()))
            except queue.Empty as exc:
                raise SqlFailure('FIXTURE_SQL_TIMEOUT') from exc
            if line is None:
                raise SqlFailure('\n'.join(result)[-1200:] or 'FIXTURE_SQL_SESSION_ENDED')
            if line == marker:
                return result
            result.append(line)

    def snapshot(self) -> dict:
        return json.loads(next(line for line in self.execute(SNAPSHOT) if line.startswith('{')))

    def close(self) -> None:
        if self.process.stdin and not self.process.stdin.closed:
            try:
                self.process.stdin.close()
            except BrokenPipeError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=5)


class Fixture:
    def __init__(self) -> None:
        suffix = uuid.uuid4().hex[:12]
        self.name = 'gpt02-1782-proposal-pg17-' + suffix
        self.volume = self.name + '-data'
        self.sessions: list[Session] = []
        self.container_created = False
        self.volume_created = False
        self.cleanup_evidence: dict = {}

    def session(self, user: str = 'postgres') -> Session:
        session = Session(self.name,user)
        self.sessions.append(session)
        return session

    def sql(self, sql: str, user: str = 'postgres', check: bool = True) -> subprocess.CompletedProcess[str]:
        return command(['docker','exec','-i',self.name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
                        '-v','VERBOSITY=sqlstate','-U',user,'-d','postgres'],sql,check=check)

    def start(self) -> dict:
        image = json.loads(command(['docker','image','inspect',IMAGE,'--format','{{json .Id}}']).stdout)
        require(image == IMAGE,'CACHED_IMAGE_ID_MISMATCH')
        command(['docker','volume','create','--label',LABEL+'=true',self.volume])
        self.volume_created = True
        command(['docker','run','-d','--pull=never','--name',self.name,'--label',LABEL+'=true',
                 '--network','none','--memory','384m','--memory-swap','384m','--cpus','0.5',
                 '--pids-limit','128','--security-opt','no-new-privileges',
                 '--mount','type=volume,source='+self.volume+',target=/var/lib/postgresql/data',
                 '-e','POSTGRES_USER='+BOOTSTRAP,'-e','POSTGRES_DB=postgres',
                 '-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE,
                 'postgres','-c','listen_addresses=','-c','max_connections=12','-c','shared_buffers=32MB'])
        self.container_created = True
        deadline = time.monotonic()+30
        while time.monotonic()<deadline:
            logs = command(['docker','logs','--tail','40',self.name],timeout=5,check=False)
            ready = command(['docker','exec',self.name,'pg_isready','-U',BOOTSTRAP,'-d','postgres'],
                            timeout=5,check=False)
            if ready.returncode == 0 and 'init process complete; ready for start up' in (logs.stdout+logs.stderr):
                break
            time.sleep(.25)
        else:
            raise RuntimeError('ISOLATED_DATABASE_START_TIMEOUT')
        meta = json.loads(command(['docker','inspect',self.name,'--format',
                                  '{{json .}}']).stdout)
        require(meta['HostConfig']['NetworkMode']=='none','FIXTURE_NETWORK_NOT_DISABLED')
        require(not meta['HostConfig']['Binds'] and not meta['HostConfig']['PortBindings'],
                'FIXTURE_HOST_BIND_OR_PUBLISHED_PORT')
        require(len(meta['Mounts'])==1 and meta['Mounts'][0]['Type']=='volume'
                and meta['Mounts'][0]['Name']==self.volume,'FIXTURE_MOUNT_SCOPE_INVALID')
        version = self.sql("SELECT current_setting('server_version_num');",BOOTSTRAP).stdout.strip()
        require(170000<=int(version)<180000,'POSTGRES_MAJOR_NOT_17')
        setup = (ROOT/'fixture_bootstrap.sql').read_text()
        first, rest = setup.split('-- BEGIN_DIRECT_POSTGRES_ROLE_SETUP\n')
        direct, last = rest.split('-- END_DIRECT_POSTGRES_ROLE_SETUP\n')
        self.sql(first,BOOTSTRAP)
        self.sql(direct,'postgres')
        self.sql(last,BOOTSTRAP)
        return {'serverVersion':self.sql('SHOW server_version;',BOOTSTRAP).stdout.strip(),
                'serverVersionNum':int(version),'imageId':IMAGE,'network':'none',
                'hostBinds':False,'publishedPorts':False,'onlyNewFixtureVolume':True,
                'memoryBytes':meta['HostConfig']['Memory'],'nanoCpus':meta['HostConfig']['NanoCpus'],
                'pidsLimit':meta['HostConfig']['PidsLimit']}

    def cleanup(self) -> None:
        for session in self.sessions:
            session.close()
        if self.container_created:
            info = json.loads(command(['docker','inspect',self.name,'--format','{{json .Config.Labels}}']).stdout)
            require(info.get(LABEL)=='true','FIXTURE_CLEANUP_CONTAINER_LABEL_MISMATCH')
            command(['docker','rm','-f',self.name])
        if self.volume_created:
            info = json.loads(command(['docker','volume','inspect',self.volume,'--format','{{json .Labels}}']).stdout)
            require(info.get(LABEL)=='true','FIXTURE_CLEANUP_VOLUME_LABEL_MISMATCH')
            command(['docker','volume','rm',self.volume])
        self.cleanup_evidence = {
            'containerAbsent':command(['docker','container','inspect',self.name],check=False).returncode != 0,
            'volumeAbsent':command(['docker','volume','inspect',self.volume],check=False).returncode != 0,
        }
        require(all(self.cleanup_evidence.values()),'FIXTURE_CLEANUP_INCOMPLETE')


def verify_artifacts() -> tuple[str, dict]:
    source = (ROOT/'pinned_phase_b.sql').read_bytes()
    require(hashlib.sha256(source).hexdigest()==PHASE_B_SHA256,'PHASE_B_PIN_CHANGED')
    require(hashlib.sha1(b'blob '+str(len(source)).encode()+b'\0'+source).hexdigest()==PHASE_B_GIT_BLOB,
            'PHASE_B_BLOB_CHANGED')
    before, body = source.split(b'BEGIN;\n',1)
    require(body.endswith(b'COMMIT;\n'),'PHASE_B_TRANSACTION_BOUNDARY_CHANGED')
    body=body[:-len(b'COMMIT;\n')]
    candidate=(ROOT/'owner_custodian_candidate.sql').read_bytes()
    embedded=candidate.split(b'-- BEGIN_PINNED_PHASE_B_BODY\n',1)[1].split(b'-- END_PINNED_PHASE_B_BODY\n',1)[0]
    require(embedded==body,'PHASE_B_BODY_NOT_BYTE_IDENTICAL')
    require(candidate==((ROOT/'candidate_prefix.sql').read_bytes()+body+(ROOT/'candidate_suffix.sql').read_bytes()),
            'CANDIDATE_PARTS_CHANGED')
    # The only top-level transaction wrappers are the new outer BEGIN and COMMIT.
    require(len(re.findall(rb'^BEGIN;$',candidate,re.M))==1,'MULTIPLE_TOP_LEVEL_BEGIN')
    require(len(re.findall(rb'^COMMIT;$',candidate,re.M))==1,'MULTIPLE_TOP_LEVEL_COMMIT')
    return candidate.decode(),{'phaseBSourceSha256':PHASE_B_SHA256,'phaseBGitBlob':PHASE_B_GIT_BLOB,
                              'phaseBBodySha256':hashlib.sha256(body).hexdigest(),
                              'candidateSha256':hashlib.sha256(candidate).hexdigest(),
                              'phaseBBodyByteIdentical':True,'singleOuterTransaction':True}


def run() -> dict:
    candidate,pins=verify_artifacts()
    pre,rest=candidate.split('-- CHECKPOINT_BEFORE_TEMPORARY_GRANT\n')
    grant,rest=rest.split('-- CHECKPOINT_AFTER_TEMPORARY_GRANT\n')
    phase,rest=rest.split('-- CHECKPOINT_BEFORE_ROLE_RESTORE\n')
    restore,commit=rest.split('-- CHECKPOINT_BEFORE_COMMIT\n')
    partial_phase=phase.split('GRANT SELECT (',1)[0]
    fixture=Fixture()
    result={'state':'ISOLATED_TESTS_RUNNING','newOwnerApprovalRequired':True,
            'liveDatabaseTouched':False,'pins':pins,'cases':[]}
    try:
        result['runtime']=fixture.start()
        observer=fixture.session()
        baseline=observer.snapshot()
        require(baseline['sessionUser']==baseline['currentUser']=='postgres' and not baseline['superuser'],
                'TEST_NOT_DIRECT_NON_SUPERUSER_POSTGRES')
        require(not baseline['canSet'] and not baseline['canInherit'],'INITIAL_AUTHORITY_TOO_BROAD')
        owner_oid=next(r['oid'] for r in baseline['roles'] if r['rolname']==OWNER)
        actor_oid=next(r['oid'] for r in baseline['roles'] if r['rolname']=='postgres')
        bootstrap_oid=next(r['oid'] for r in baseline['roles'] if r['rolname']==BOOTSTRAP)
        original=next(m for m in baseline['memberships'] if m['roleid']==owner_oid and m['member']==actor_oid)
        require(original['grantor']==bootstrap_oid and original['admin_option']
                and not original['set_option'] and not original['inherit_option'],
                'ORIGINAL_BOOTSTRAP_ADMIN_ONLY_ROW_MISSING')
        result['fixtureIdentity']={'sessionUser':'postgres','currentUser':'postgres','superuser':False,
                                   'bootstrapUser':BOOTSTRAP,'bootstrapAdminOnlyGrant':True}

        failed=fixture.session()
        failed.execute(pre+grant+partial_phase)
        require(failed.snapshot()['currentUser']==OWNER,'FAILURE_NOT_IN_OWNER_PHASE')
        try:
            failed.execute('SELECT 1/0;')
            raise AssertionError('INJECTED_ERROR_NOT_RAISED')
        except SqlFailure as exc:
            require('22012' in str(exc),'UNEXPECTED_INJECTED_FAILURE')
        failed.close()
        require(observer.snapshot()==baseline,'MID_PHASE_ERROR_DID_NOT_ROLL_BACK_EXACTLY')
        result['cases'].append({'case':'mid_phase_error_rolls_back_all','result':'PASS',
                                'membershipsRolesAclsPoliciesUnchanged':True})

        disconnected=fixture.session()
        disconnected.execute(pre+grant+partial_phase)
        disconnected.close()
        require(observer.snapshot()==baseline,'CLIENT_DISCONNECT_DID_NOT_ROLL_BACK_EXACTLY')
        result['cases'].append({'case':'client_disconnect_rolls_back_all','result':'PASS'})

        raced=fixture.session()
        raced.execute(pre)
        # Another direct postgres connection commits its own SET-false membership
        # in the precheck/GRANT gap. Our candidate must not erase that newer row.
        fixture.sql(f'GRANT {OWNER} TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET FALSE GRANTED BY postgres;')
        concurrent=observer.snapshot()
        try:
            raced.execute(grant)
            raise AssertionError('CONCURRENT_MEMBERSHIP_NOT_REJECTED')
        except SqlFailure as exc:
            require('P0001' in str(exc),'UNEXPECTED_CONCURRENT_MEMBERSHIP_FAILURE')
        raced.close()
        require(observer.snapshot()==concurrent,'CONCURRENT_GRANT_ROW_WAS_MODIFIED_OR_REMOVED')
        fixture.sql(f'REVOKE {OWNER} FROM postgres GRANTED BY postgres RESTRICT;')
        require(observer.snapshot()==baseline,'FIXTURE_RACE_CLEANUP_CHANGED_BASELINE')
        result['cases'].append({'case':'concurrent_own_grant_is_preserved_by_abort','result':'PASS',
                                'foreignMembershipOidAndOptionsPreserved':True})

        main=fixture.session()
        result['lastCheckpoint']='success_preflight'
        main.execute(pre)
        identity_before=json.loads(main.execute("SELECT jsonb_build_object('pid',pg_backend_pid(),'xid',pg_current_xact_id()::text);")[0])
        result['lastCheckpoint']='success_temporary_grant'
        main.execute(grant)
        temporary=main.snapshot()
        require(temporary['canSet'] and not temporary['canInherit'],'TEMPORARY_SCOPE_WRONG')
        require(original in temporary['memberships'],'ORIGINAL_ADMIN_ROW_CHANGED')
        result['lastCheckpoint']='success_warm_observer'
        require(observer.snapshot()==baseline,'WARM_OTHER_SESSION_SAW_UNCOMMITTED_GRANT')
        fresh=fixture.session()
        result['lastCheckpoint']='success_fresh_observer'
        require(fresh.snapshot()==baseline,'FRESH_OTHER_SESSION_SAW_UNCOMMITTED_GRANT')
        result['lastCheckpoint']='success_other_session_actual_set_role'
        denied=fixture.sql(f'SET ROLE {OWNER};',check=False)
        require(denied.returncode!=0 and '42501' in denied.stderr,'OTHER_SESSION_COULD_SET_ROLE')
        result['lastCheckpoint']='success_phase_b'
        main.execute(phase)
        require(main.snapshot()['currentUser']==OWNER,'PHASE_B_NOT_EXECUTED_AS_OWNER')
        result['lastCheckpoint']='success_observer_before_commit'
        # pg_get_expr() opens the policy relation, so the full descriptive
        # snapshot would wait on CREATE POLICY's table lock. Observe only raw
        # shared-catalog membership and policy count while that DDL is open.
        other=json.loads(observer.execute("""SELECT jsonb_build_object(
          'canSet',pg_has_role('postgres','gpt02_relock_owner_approval_owner','SET'),
          'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM (
            SELECT oid,roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members
          ) m), 'policyCount',(SELECT count(*) FROM pg_policy));""")[0])
        require(not other['canSet'] and other['memberships']==baseline['memberships']
                and other['policyCount']==len(baseline['policies']),
                'OTHER_SESSION_SAW_UNCOMMITTED_PHASE_B')
        result['lastCheckpoint']='success_restore'
        main.execute(restore)
        identity_after=json.loads(main.execute("SELECT jsonb_build_object('pid',pg_backend_pid(),'xid',pg_current_xact_id()::text);")[0])
        require(identity_before==identity_after,'TRANSACTION_OR_CONNECTION_SPLIT')
        result['lastCheckpoint']='success_commit'
        main.execute(commit)
        committed=observer.snapshot()
        require(committed['memberships']==baseline['memberships'],'FINAL_MEMBERSHIP_BASELINE_CHANGED')
        require(committed['roles']==baseline['roles'],'FINAL_ROLE_ATTRIBUTES_CHANGED')
        require(not committed['canSet'] and not committed['canInherit'],'FINAL_SET_OR_INHERIT_ENABLED')
        require(committed['schemaUsage'] and not committed['schemaCreate'],'READER_SCHEMA_SCOPE_WRONG')
        expected_columns={
          'gpt02_relock_owner_approval_challenges':sorted('id status manifest_sha256 manifest_json consumed_at expires_at scope environment project_id worker_principal owner_email owner_auth_supabase_id owner_subject issued_at'.split()),
          'gpt02_relock_owner_approval_decisions':sorted('challenge_id decision decided_at approval_method owner_email owner_auth_supabase_id owner_subject scope worker_principal manifest_sha256'.split()),
        }
        for old,new in zip(baseline['tables'],committed['tables']):
            require(new['reader_columns']==expected_columns[new['relname']], 'EXACT_COLUMN_GRANTS_WRONG')
            require(not new['broad_select'] and not new['write'],'BROAD_TABLE_OR_WRITE_GRANT')
            for field in ('oid','relowner','relrowsecurity','relforcerowsecurity','old_reader_columns'):
                require(new[field]==old[field],'OWNER_RLS_OR_OLD_READER_CHANGED')
        require(all(p in committed['policies'] for p in baseline['policies']),'EXISTING_POLICY_CHANGED')
        require(len(committed['policies'])==len(baseline['policies'])+2,'POLICY_DELTA_NOT_TWO')
        rows=fixture.sql(f'SET ROLE {READER}; SELECT id FROM {CHALLENGE}; SELECT challenge_id FROM {DECISION};',BOOTSTRAP).stdout.splitlines()
        require(rows==['9c4f21e1-48af-4f7f-9830-931b84e3e846']*2,'RLS_ORIGINAL_CHALLENGE_SCOPE_WRONG')
        forbidden=fixture.sql(f'SET ROLE {READER}; SELECT never_granted_private FROM {CHALLENGE};',BOOTSTRAP,check=False)
        require(forbidden.returncode!=0 and '42501' in forbidden.stderr,'UNGRANTED_COLUMN_READABLE')
        denied_after=fixture.sql(f'SET ROLE {OWNER};',check=False)
        require(denied_after.returncode!=0 and '42501' in denied_after.stderr,'SET_ROLE_SURVIVED_COMMIT')
        result['cases'].append({'case':'success_one_transaction_no_other_session_exposure','result':'PASS',
          'sameBackendAndTransaction':True,'warmObserverSetDenied':True,'freshObserverSetDenied':True,
          'actualOtherSessionSetRoleDenied':True,'originalBootstrapMembershipOidRetained':True,
          'allMembershipRowsExactlyRestored':True,'readerColumnCounts':[14,10],
          'onlyTwoOriginalChallengePoliciesAdded':True,'readerStillNoLoginAndExpired':True,
          'ownerAndForceRlsUnchanged':True,'oldReaderGrantsAndPolicyUnchanged':True,
          'postCommitSetDenied':True})
        result['state']='ISOLATED_PG17_RESULT_VERIFIED'
        result.pop('lastCheckpoint',None)
    except Exception as exc:
        result['state']='ISOLATED_PG17_TEST_FAILED'
        result['failureType']=type(exc).__name__
        result['failure']=str(exc)[-1600:]
    finally:
        try:
            fixture.cleanup()
            result['cleanup']=fixture.cleanup_evidence
        except Exception as exc:
            result['state']='ISOLATED_PG17_CLEANUP_FAILED'
            result['cleanupFailure']=str(exc)[-1000:]
    return result


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',type=Path)
    args=parser.parse_args()
    result=run()
    rendered=json.dumps(result,indent=2,sort_keys=True)+'\n'
    if args.evidence:
        args.evidence.write_text(rendered)
    print(rendered,end='')
    return 0 if result['state']=='ISOLATED_PG17_RESULT_VERIFIED' else 1


if __name__=='__main__':
    raise SystemExit(main())
