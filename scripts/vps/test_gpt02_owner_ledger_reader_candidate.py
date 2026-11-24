#!/usr/bin/env python3
"""Synthetic Owner ledger rows only; no live Supabase access."""
import importlib.util,sys,unittest,hashlib
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from pathlib import Path
root=Path(__file__).parent
for name in ("gpt02_relock_once_candidate","gpt02_owner_ledger_reader_candidate"):
    spec=importlib.util.spec_from_file_location(name,root/(name+".py"))
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
o=sys.modules["gpt02_relock_once_candidate"]
v=sys.modules["gpt02_owner_ledger_reader_candidate"]
ID="9c4f21e1-48af-4f7f-9830-931b84e3e846"
USER="00000000-1111-4222-8333-444444444444"
EMAIL="qa@example.test"
NOW=datetime(2026,11,24,7,25,16,tzinfo=timezone.utc)

def make_row():
    manifest={"version":1,"scope":o.SCOPE,"environment":"DEV","projectId":o.PROJECT,
        "hostId":o.HOST,"workerPrincipal":o.PRINCIPAL,
        "ownerEmail":EMAIL,"ownerSubject":"owner:google_qa123456",
        "ownerAuthSupabaseId":USER,"operations":list(o.OPERATIONS),
        "nonce":"fixture-only","preconditions":{"rolesFound":4},
        "postconditions":{"allRoleInvariantsPass":True}}
    digest=hashlib.sha256(v.CANONICAL_DOMAIN+v._canonical(manifest).encode()).hexdigest()
    return {"challenge_id":ID,"scope":o.SCOPE,"environment":"DEV","project_id":o.PROJECT,
        "worker_principal":o.PRINCIPAL,"owner_subject":"owner:google_qa123456",
        "owner_email":EMAIL,"owner_auth_supabase_id":USER,
        "challenge_status":"CONSUMED","manifest_json":manifest,"manifest_sha256":digest,
        "issued_at":NOW-timedelta(seconds=5),"expires_at":NOW+timedelta(seconds=110),
        "consumed_at":NOW,"decision":"APPROVED","decided_at":NOW,
        "approval_method":v.OWNER_METHOD,"decision_owner_subject":"owner:google_qa123456",
        "decision_owner_email":EMAIL,"decision_owner_auth_supabase_id":USER,
        "decision_digest":digest,"decision_scope":o.SCOPE,"decision_worker":o.PRINCIPAL,
        "decision_count":1,"consumed_count":1}

class FakeTrustedRead:
    def __init__(self,rows):self.rows=rows;self.requests=[]
    def read_exact_owner_decision(self,sql,args):
        self.requests.append((sql,args));return deepcopy(self.rows)

class LedgerTests(unittest.TestCase):
    def deny(self,rows):
        with self.assertRaises(o.GateDenied):v.verify_owner_ledger_record(FakeTrustedRead(rows),ID)
    def test_good_record_read_only(self):
        c=FakeTrustedRead([make_row()]);x=v.verify_owner_ledger_record(c,ID)
        self.assertEqual(x.challenge_id,ID);self.assertEqual(x.matching_decisions,1)
        self.assertEqual(c.requests[0][1],(ID,))
        self.assertNotIn("UPDATE ",c.requests[0][0].upper())
        self.assertNotIn("INSERT INTO",c.requests[0][0].upper())
    def test_duplicate_or_absent(self):
        self.deny([]);self.deny([make_row(),make_row()])
    def test_invalid_status_time_count(self):
        for key,val in (("challenge_status","PENDING"),("consumed_at",None),
            ("decision","REJECTED"),("decision_count",2),("consumed_count",0),
            ("approval_method","FAKE"),("expires_at",NOW-timedelta(seconds=1))):
            row=make_row();row[key]=val
            with self.subTest(key=key):self.deny([row])
    def test_cross_record_digest_and_scope(self):
        for key,val in (("manifest_sha256","0"*64),("decision_digest","0"*64),
            ("decision_owner_email","other@example.test"),
            ("decision_owner_subject","owner:fake"),("decision_scope","TASK183"),
            ("decision_worker","fake-worker"),("project_id","prod")):
            row=make_row();row[key]=val
            with self.subTest(key=key):self.deny([row])
    def test_tampered_manifest_even_if_rehashed(self):
        for key,val in (("scope","TASK183"),("hostId","prod"),
                        ("operations",["SIGN_AND_DISPATCH"]),
                        ("ownerEmail","other@example.test")):
            row=make_row();row["manifest_json"][key]=val
            digest=hashlib.sha256(v.CANONICAL_DOMAIN+v._canonical(row["manifest_json"]).encode()).hexdigest()
            row["manifest_sha256"]=digest;row["decision_digest"]=digest
            with self.subTest(key=key):self.deny([row])
    def test_invalid_id_or_missing_reader(self):
        with self.assertRaises(o.GateDenied):v.verify_owner_ledger_record(FakeTrustedRead([make_row()]),"DROP TABLE")
        with self.assertRaises(o.GateDenied):v.verify_owner_ledger_record(object(),ID)
    def test_naive_or_non_timestamp_is_denied(self):
        for value in (NOW.replace(tzinfo=None), "2026-11-24T07:25:16Z", None):
            row=make_row();row["decided_at"]=value
            with self.subTest(value=str(value)):
                self.deny([row])

    def test_reader_unavailable(self):
        class Broken:
            def read_exact_owner_decision(self,*a):raise ConnectionError("fixture down")
        with self.assertRaisesRegex(o.GateDenied,"OWNER_LEDGER_READ_UNAVAILABLE"):
            v.verify_owner_ledger_record(Broken(),ID)
    def test_malformed_manifest(self):
        for value in (None,[],{"bad":object()}):
            row=make_row();row["manifest_json"]=value;self.deny([row])

if __name__=="__main__":unittest.main()
