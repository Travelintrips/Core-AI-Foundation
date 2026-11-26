"""Negative QA #238 work-claim adapter tests; no network or privileged execution."""
import unittest
from datetime import datetime, timezone, timedelta
from issue238_qa_permit import PermitDenied
from issue238_qa_preflight import bind_claimed_ai_core_work

class ClaimBindingTests(unittest.TestCase):
    def setUp(self):
        self.credential={"name":"openclaw-vps-dev-consumer","isActive":True,"scopes":["agent:work"]}
        self.clock=datetime(2026,11,26,13,0,tzinfo=timezone.utc)
        self.work={"commandId":"11111111-1111-4111-8111-111111111111",
                   "taskId":"22222222-2222-4222-8222-222222222222",
                   "status":"PROCESSING","claimToken":"33333333-3333-4333-8333-333333333333",
                   "metadata":{"claimedBy":"openclaw-vps-main","assignedClientId":"openclaw-vps-main",
                   "claimLeaseExpiresAt":"2026-11-26 13:02:00+00"}}
    def test_bound_canonical_work(self):
        identity=bind_claimed_ai_core_work(credential=self.credential,claimed_work=self.work,now=self.clock)
        self.assertEqual(identity.authenticated_worker_id,"openclaw-vps-main")
        self.assertEqual(identity.durable_command_id,self.work["commandId"])
        self.assertEqual(identity.durable_job_id,self.work["taskId"])
    def test_canonical_worker_name_is_not_an_agent_token_identity(self):
        with self.assertRaisesRegex(PermitDenied,"worker_credential_mismatch"):
            bind_claimed_ai_core_work(
                credential={**self.credential,"name":"openclaw-vps-main"},
                claimed_work=self.work,now=self.clock)

    def test_cross_worker_credential_and_claim_denied(self):
        for side in ("credential","claimedBy","assignedClientId"):
            c=self.credential.copy();w={**self.work,"metadata":self.work["metadata"].copy()}
            if side=="credential":c["name"]="openclaw-pc-worker"
            else:w["metadata"][side]="openclaw-pc-worker"
            with self.subTest(side=side),self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=c,claimed_work=w,now=self.clock)
    def test_missing_lease_token_task_or_work_scope_denied(self):
        for key,value in (("claimToken",""),("taskId",None),("commandId",None),("status","RECEIVED")):
            with self.subTest(key=key),self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=self.credential,claimed_work={**self.work,key:value},now=self.clock)
        for credential in ({**self.credential,"isActive":False},
                           {**self.credential,"scopes":["agent:presence"]},
                           {**self.credential,"scopes":"agent:work"}):
            with self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=credential,claimed_work=self.work,now=self.clock)
    def test_expired_missing_or_unbounded_lease_denied(self):
        for lease in (None,"", "2026-11-26 12:59:59+00", "2026-11-26 13:06:00+00",
                      "2026-11-26 13:02:00", "not-a-time"):
            with self.subTest(lease=lease),self.assertRaises(PermitDenied):
                work={**self.work,"metadata":{**self.work["metadata"],"claimLeaseExpiresAt":lease}}
                bind_claimed_ai_core_work(credential=self.credential,claimed_work=work,now=self.clock)
    def test_malformed_identifiers_and_clock_denied(self):
        for key in ("claimToken","commandId","taskId"):
            with self.subTest(key=key),self.assertRaises(PermitDenied):
                bind_claimed_ai_core_work(credential=self.credential,
                    claimed_work={**self.work,key:"not-a-uuid"},now=self.clock)
        with self.assertRaises(PermitDenied):
            bind_claimed_ai_core_work(credential=self.credential,claimed_work=self.work,
                                      now=self.clock.replace(tzinfo=None))
    def test_real_postgres_iso_lease_format_and_utc_offset(self):
        for lease in ("2026-11-26 20:02:00+07", "2026-11-26T13:02:00Z",
                      "2026-11-26 13:02:00.000000+00"):
            work={**self.work,"metadata":{**self.work["metadata"],"claimLeaseExpiresAt":lease}}
            binding=bind_claimed_ai_core_work(credential=self.credential,claimed_work=work,now=self.clock)
            self.assertEqual(binding.authenticated_worker_id,"openclaw-vps-main")

    def test_arbitrary_user_payload_does_not_have_authenticated_fields(self):
        with self.assertRaises(PermitDenied):
            bind_claimed_ai_core_work(credential=None,claimed_work=self.work,now=self.clock)
        with self.assertRaises(PermitDenied):
            bind_claimed_ai_core_work(credential=self.credential,claimed_work={"clientId":"openclaw-vps-main"},now=self.clock)

if __name__=="__main__":unittest.main()
