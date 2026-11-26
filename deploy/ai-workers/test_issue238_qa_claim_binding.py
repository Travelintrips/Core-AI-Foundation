"""Negative QA #238 work-claim adapter tests; no network or privileged execution."""
import unittest
from issue238_qa_permit import PermitDenied
from issue238_qa_preflight import bind_claimed_ai_core_work

class ClaimBindingTests(unittest.TestCase):
    def setUp(self):
        self.credential={"name":"openclaw-vps-dev-consumer","isActive":True,"scopes":["agent:work"]}
        self.work={"commandId":"CMD-issue238-123","taskId":"JOB-issue238-123",
                   "status":"PROCESSING","claimToken":"claim-1",
                   "metadata":{"claimedBy":"openclaw-vps-main","assignedClientId":"openclaw-vps-main"}}
    def test_bound_canonical_work(self):
        identity=bind_claimed_ai_core_work(credential=self.credential,claimed_work=self.work)
        self.assertEqual(identity.authenticated_worker_id,"openclaw-vps-main")
        self.assertEqual(identity.durable_command_id,self.work["commandId"])
        self.assertEqual(identity.durable_job_id,self.work["taskId"])
    def test_canonical_worker_name_is_not_an_agent_token_identity(self):
        with self.assertRaisesRegex(PermitDenied,"worker_credential_mismatch"):
            bind_claimed_ai_core_work(
                credential={**self.credential,"name":"openclaw-vps-main"},
                claimed_work=self.work)

    def test_cross_worker_credential_and_claim_denied(self):
        for side in ("credential","claimedBy","assignedClientId"):
            c=self.credential.copy();w={**self.work,"metadata":self.work["metadata"].copy()}
            if side=="credential":c["name"]="openclaw-pc-worker"
            else:w["metadata"][side]="openclaw-pc-worker"
            with self.subTest(side=side),self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=c,claimed_work=w)
    def test_missing_lease_token_task_or_work_scope_denied(self):
        for key,value in (("claimToken",""),("taskId",None),("commandId",None),("status","RECEIVED")):
            with self.subTest(key=key),self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=self.credential,claimed_work={**self.work,key:value})
        for credential in ({**self.credential,"isActive":False},
                           {**self.credential,"scopes":["agent:presence"]},
                           {**self.credential,"scopes":"agent:work"}):
            with self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=credential,claimed_work=self.work)
    def test_arbitrary_user_payload_does_not_have_authenticated_fields(self):
        with self.assertRaises(PermitDenied):
            bind_claimed_ai_core_work(credential=None,claimed_work=self.work)
        with self.assertRaises(PermitDenied):
            bind_claimed_ai_core_work(credential=self.credential,claimed_work={"clientId":"openclaw-vps-main"})

if __name__=="__main__":unittest.main()
