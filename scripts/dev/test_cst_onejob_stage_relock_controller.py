#!/usr/bin/env python3
"""No-network PostgreSQL16 test of idempotent stage relock; no live access."""
import os,sys,subprocess,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_relock_controller as r

NAME="cst-stage-relock-controller-qa-"+str(os.getpid())
def sh(args,stdin=None,allow=False):
    p=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=35)
    if p.returncode and not allow:raise RuntimeError("QA_SUBPROCESS_FAILED")
    return p
def psql(statement,user="postgres",allow=False):
    return sh(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
      "-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],statement,allow)
def query(statement):
    result=psql(statement)
    return [line.strip().split("|") for line in result.stdout.splitlines() if line.strip()]

class ReLockRealPostgres(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sh(["docker","run","-d","--rm","--name",NAME,"--network","none",
          "--memory","384m","--cpus","1","-e","POSTGRES_DB=postgres",
          "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"])
        for _ in range(120):
            p=sh(["docker","exec",NAME,"pg_isready","-h","127.0.0.1",
               "-U","postgres","-d","postgres"],allow=True)
            if not p.returncode: break
            time.sleep(.25)
        else:raise AssertionError("ISOLATED_POSTGRES_NOT_READY")
        psql("CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        psql("CREATE ROLE cst_unrelated_worker NOLOGIN NOINHERIT NOBYPASSRLS;")

    @classmethod
    def tearDownClass(cls):
        sh(["docker","rm","-f",NAME],allow=True)

    def test_relock_existing_session_and_idempotent_restart(self):
        psql("ALTER ROLE cst_team_model_pilot_stage_login LOGIN VALID UNTIL '2099-01-01';")
        sh(["docker","exec","-d",NAME,"psql","-U",r.ROLE,"-d","postgres",
            "-c","SELECT pg_sleep(40)"])
        for _ in range(50):
            if query(r.ACTIVE_QUERY)==[["1"]]:break
            time.sleep(.1)
        else:self.fail("STAGING_SESSION_NOT_ESTABLISHED")
        self.assertEqual(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_unrelated_worker'"),[["0"]])
        outcome=r.relock_once(query,pause=lambda _:None)
        self.assertEqual(outcome["residualRoleSessions"],0)
        self.assertFalse(outcome["roleLogin"])
        self.assertEqual(query(r.ACTIVE_QUERY),[["0"]])
        self.assertNotEqual(psql("SELECT 1;",user=r.ROLE,allow=True).returncode,0)
        self.assertEqual(r.relock_once(query,pause=lambda _:None)["status"],"PASS")
        self.assertEqual(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_unrelated_worker'"),[["0"]])
        print("ISOLATED_RELOCK_CRASH_RETRY_PASS")

    def test_mismatch_still_relocks_and_terminates_before_failing(self):
        statements=[]
        def false_catalog(statement):
            statements.append(statement)
            if statement==r.ROLE_QUERY:
                return [["1","1","0","0","1"]]
            if statement==r.ACTIVE_QUERY:
                return [["0"]]
            return []
        with self.assertRaisesRegex(r.RelockError,"FINAL_ROLE_CHANGED"):
            r.relock_once(false_catalog,pause=lambda _:None)
        self.assertIn(r.NOLOGIN_QUERY,statements)
        self.assertIn(r.TERMINATE_QUERY,statements)
        self.assertIn(r.ACTIVE_QUERY,statements)

    def test_residual_sessions_fail_closed(self):
        statements=[]
        def stuck(statement):
            statements.append(statement)
            if statement==r.ROLE_QUERY:
                return [["0","0","0","0","1"]]
            if statement==r.ACTIVE_QUERY:
                return [["1"]]
            return []
        with self.assertRaisesRegex(r.RelockError,"RESIDUAL_SESSIONS"):
            r.relock_once(stuck,pause=lambda _:None,attempts=2)
        self.assertEqual(statements.count(r.TERMINATE_QUERY),2)

    def test_no_operational_cli_or_credential_reader(self):
        src=Path(r.__file__).read_text()
        self.assertIn("SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT",src)
        self.assertNotIn("service_role",src)
        self.assertNotIn("os.environ",src)
        self.assertNotIn("SUPABASE_PROD_DATABASE_URL",src)
        self.assertNotIn("ALTER ROLE cst_team_model_pilot_stage_login LOGIN",src)

if __name__=="__main__":
    unittest.main(verbosity=2)
