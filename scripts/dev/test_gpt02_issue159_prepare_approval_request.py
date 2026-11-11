#!/usr/bin/env python3
import importlib.util,json,os,sqlite3,tempfile,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
DEPLOY=ROOT/"deploy/ai-coding-standalone-dev"
SCRIPT=DEPLOY/"prepare_gpt02_issue159_approval_request.py"
SCHEMA=DEPLOY/"gpt02_issue159_approval_intent_schema.sql"
import sys
sys.path.insert(0,str(DEPLOY))
spec=importlib.util.spec_from_file_location("issue159_prepare",SCRIPT)
mod=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(mod)

AUTH="11111111-2222-4333-8444-555555555555"
HUB="google_fixture_super_admin"
CMD="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ATT="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

class PrepareMappedIssue159RequestTest(unittest.TestCase):
    def fixture(self,*,mapping_enabled=1,admin_enabled=1):
        td=tempfile.TemporaryDirectory(prefix="issue159-prepare-"); self.addCleanup(td.cleanup)
        db=str(Path(td.name)/"tasks.db"); out=str(Path(td.name)/"pending.json")
        con=sqlite3.connect(db)
        con.execute("CREATE TABLE admin_identities(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,enabled INTEGER NOT NULL)")
        con.executescript(SCHEMA.read_text())
        con.execute("INSERT INTO admin_identities VALUES (?,?,?)",(AUTH,"super_admin",admin_enabled))
        con.execute("""INSERT INTO gpt02_issue159_admin_operator_links
          (auth_user_id,hub_operator_id,email,enabled) VALUES (?,?,?,?)""",
          (AUTH,HUB,"fixture@example.com",mapping_enabled))
        con.commit(); con.close()
        return db,out

    def test_claim_uses_hub_operator_not_auth_uuid_and_stays_no_go(self):
        db,out=self.fixture()
        result=mod.prepare(db,out,140,CMD,ATT,now_ms=1000,operational=False)
        packet=json.loads(Path(out).read_text())
        claims=packet["claims"]
        self.assertEqual(claims["taskId"],140)
        self.assertEqual(claims["superAdminId"],HUB)
        self.assertNotEqual(claims["superAdminId"],AUTH)
        self.assertEqual(claims["operatorNamespace"],"ai-task-hub.public.users")
        self.assertFalse(result["signingPermitted"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["dispatchPermitted"])
        self.assertEqual(result["releaseDecision"],"NO_GO")
        self.assertEqual(os.stat(out).st_mode & 0o777,0o600)

    def test_old_task_and_disabled_mapping_fail_closed(self):
        db,out=self.fixture()
        with self.assertRaisesRegex(RuntimeError,"FRESH_TASK_AFTER_139"):
            mod.prepare(db,out,139,CMD,ATT,now_ms=1000,operational=False)
        db2,out2=self.fixture(mapping_enabled=0)
        with self.assertRaisesRegex(RuntimeError,"MAPPING_NOT_UNIQUE"):
            mod.prepare(db2,out2,140,CMD,ATT,now_ms=1000,operational=False)

    def test_pending_path_is_single_use(self):
        db,out=self.fixture()
        mod.prepare(db,out,140,CMD,ATT,now_ms=1000,operational=False)
        with self.assertRaisesRegex(RuntimeError,"PENDING_REQUEST_ALREADY_EXISTS"):
            mod.prepare(db,out,140,CMD,ATT,now_ms=1000,operational=False)

if __name__=="__main__": unittest.main()
