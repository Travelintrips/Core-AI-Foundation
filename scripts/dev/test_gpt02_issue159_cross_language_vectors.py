"""Cross-language Ed25519 synthetic vectors, never live signer credentials.

Python-signed packets must verify through the REAL TypeScript contract;
TypeScript-signed packets must verify through the REAL Python verifier.
Both implementations remain verification-only and NO_GO for actual dispatch.
"""
import copy
import hashlib
import json
import os
import subprocess
import unittest
from pathlib import Path

import test_gpt02_issue159_writer_broker_contract as synthetic
from gpt02_issue159_writer_broker_contract import (
    APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS,
    BrokerAdmissionError, verify_lifecycle_evidence_packet,
    _canonical,
)

ROOT = Path(__file__).resolve().parents[2]
TYPESCRIPT = ROOT / "scripts/dev/gpt02_issue159_ts_signing_vectors.ts"
TSX_DEFAULT = ROOT / "artifacts/api-server/node_modules/.bin/tsx"
ROLE_KEYS = ("approval", "hub", "core", "issuer")
FIELD_SETS = {
    "approval": APPROVAL_FIELDS,
    "hub": LINK_FIELDS,
    "core": LINK_FIELDS,
    "issuer": ISSUER_FIELDS,
}
PACKET_KEYS = {
    "approval": "approval",
    "hub": "hubLink",
    "core": "coreLink",
    "issuer": "issuerEvidence",
}
DOMAINS = {
    "approval": b"",
    "hub": b"GPT02_OPERATOR_LINK_V1:hub\n",
    "core": b"GPT02_OPERATOR_LINK_V1:core\n",
    "issuer": b"GPT02_ISSUER_LEASE_EVIDENCE_V1\n",
}

class CrossLanguageVectors(unittest.TestCase):
    def setUp(self):
        fixture = synthetic.WriterBrokerContractTest(
            methodName="test_four_domain_signatures_verify_but_no_authority"
        )
        fixture.setUp()
        self.fixture = fixture
        tsx = os.environ.get("GPT02_TEST_TSX_BINARY", str(TSX_DEFAULT))
        self.tsx = Path(tsx)
        if not self.tsx.is_file():
            self.fail("TYPESCRIPT_TEST_RUNNER_REQUIRED: pnpm install first")

    def call_ts(self, action, packet, roots=None):
        payload = {"action": action, "packet": packet}
        if roots is not None:
            payload["roots"] = roots
        proc = subprocess.run(
            [str(self.tsx), str(TYPESCRIPT)],
            input=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            capture_output=True, text=True, check=False, timeout=18,
            cwd=str(ROOT),
        )
        self.assertEqual(
            proc.returncode, 0,
            "Synthetic TypeScript contract test failed without using production keys"
        )
        response = json.loads(proc.stdout)
        self.assertEqual(set(response["hashes"]), set(ROLE_KEYS))
        for role, name in PACKET_KEYS.items():
            raw = DOMAINS[role] + _canonical(
                packet[name]["claims"], FIELD_SETS[role]
            )
            # Domain-separated digest checks compare the exact bytes signed.
            expected = hashlib.sha256(raw).hexdigest()
            self.assertEqual(response["hashes"][role], expected)
        return response

    def test_python_signatures_verified_by_real_typescript(self):
        f = self.fixture
        result = self.call_ts("verify", f.packet, f.roots)
        self.assertEqual(result["verified"], {role: True for role in ROLE_KEYS})
        self.assertFalse(
            verify_lifecycle_evidence_packet(f.packet, f.roots, f.now)["dispatchPermitted"]
        )

    def test_typescript_signatures_verified_by_real_python_verifier(self):
        f = self.fixture
        result = self.call_ts("sign", f.packet)
        obj = result["packet"]
        self.assertEqual(set(result["roots"]), set(ROLE_KEYS))
        actual = verify_lifecycle_evidence_packet(obj, result["roots"], f.now)
        self.assertTrue(actual["packetVerified"])
        for flag in ("signingPermitted", "authorizationGranted",
                     "dispatchPermitted", "databaseWritePerformed",
                     "nonceConsumed", "leaseConsumed"):
            self.assertFalse(actual[flag])
        self.assertEqual(actual["releaseDecision"], "NO_GO")

    def test_tamper_rejected_in_both_directions(self):
        f = self.fixture
        changed = copy.deepcopy(f.packet)
        changed["approval"]["claims"]["taskId"] += 1
        ts = self.call_ts("verify", changed, f.roots)
        self.assertFalse(ts["verified"]["approval"])
        with self.assertRaises(BrokerAdmissionError):
            verify_lifecycle_evidence_packet(changed, f.roots, f.now)

        result = self.call_ts("sign", f.packet)
        signed = result["packet"]
        signed["coreLink"]["signature"] = signed["hubLink"]["signature"]
        ts = self.call_ts("verify", signed, result["roots"])
        self.assertFalse(ts["verified"]["core"])
        with self.assertRaises(BrokerAdmissionError):
            verify_lifecycle_evidence_packet(signed, result["roots"], f.now)

    def test_source_fixture_cannot_open_live_signer_private_keys(self):
        source = TYPESCRIPT.read_text()
        for forbidden in (
            "/etc/credstore", "GPT02_ISSUE159_SIGNING_ENABLED=true",
            "DATABASE_URL", "SERVICE_ROLE", "supabase.co",
            "execSync(", "child_process", "readFileSync(",
        ):
            self.assertNotIn(forbidden, source)

if __name__ == "__main__":
    unittest.main()
