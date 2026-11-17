#!/usr/bin/env python3
"""Isolated safety regression for historical DEV archive verification."""
import base64
import hashlib
import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from gpt02_issue159_sign_once import APPROVAL_FIELDS, LINK_FIELDS, ISSUER_FIELDS, canonical
from gpt02_issue159_historical_archive_audit_readonly import (
    ArchiveAuditDenied, ROLE_DATA, SCHEMA, audit,
)
from test_gpt02_issue159_sign_once import claims as synthetic_claims


def digest(data):
    return hashlib.sha256(data).hexdigest()


class HistoricalArchiveSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gpt02-historical-evidence-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "archive"
        self.public = self.root / "public"
        self.archive.mkdir(mode=0o700)
        self.public.mkdir(mode=0o700)
        self.name = "task200_verified_signatures_complete_synthetic.json"
        roles = {}
        now = int(time.time() * 1000)
        for role, (pem_name, fields, domain) in ROLE_DATA.items():
            value = synthetic_claims(role, now)
            sig_data = canonical(value, fields).encode("utf-8")
            private = Ed25519PrivateKey.generate()
            pub = private.public_key()
            sig = base64.urlsafe_b64encode(private.sign(domain + sig_data)).decode().rstrip("=")
            document = {
                "environment": "DEV", "role": role, "algorithm": "Ed25519",
                "signatureBase64url": sig, "claimsSha256": digest(sig_data),
                "authorizationGranted": False, "dispatchPermitted": False,
                "releaseDecision": "NO_GO",
            }
            signature_file = role + "_signature_synthetic.json"
            claims_file = role + "_claims_task200_synthetic.json"
            self._save(signature_file, document)
            self._save(claims_file, {"claims": value})
            pem = self.public / pem_name
            pem.write_bytes(pub.public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
            ))
            pem.chmod(0o440)
            roles[role] = {
                "taskId": 200,
                "signatureFile": signature_file,
                "signatureFileSHA256": digest((self.archive / signature_file).read_bytes()),
                "claimsFile": claims_file,
                "claimsFileSHA256": digest((self.archive / claims_file).read_bytes()),
                "keyFingerprintSHA256": digest(pub.public_bytes(
                    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo,
                )),
                "signatureVerified": True,
            }
        self.foreign = "approved_task201_synthetic.json"
        self._save(self.foreign, {"claims": {"taskId": 201}})
        self.report = {
            "schema": SCHEMA, "environment": "DEV",
            "historicalTaskId": 200,
            "signatureAndClaimsFilesAllInsidePrivateArchive": True,
            "roles": roles, "excludedForeignTaskApproval": self.foreign,
            "excludedForeignTaskApprovalTaskId": 201,
            "authorizationGranted": False, "signingPermitted": False,
            "dispatchPermitted": False, "releaseDecision": "NO_GO",
        }
        self._save(self.name, self.report)

    def _save(self, name, obj):
        p = self.archive / name
        p.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")
        p.chmod(0o600)
        return p

    def verify(self):
        return audit(self.archive, self.public, self.name, 200,
                     expected_uid=os.geteuid())

    def rewrite_manifest(self):
        self._save(self.name, self.report)

    def test_all_four_signatures_pass_and_no_authorization(self):
        before = {p.name: digest(p.read_bytes()) for p in self.archive.iterdir()}
        report = self.verify()
        self.assertTrue(report["historicalArchiveVerified"])
        self.assertTrue(report["separateForeignTaskExcluded"])
        self.assertEqual(report["verifiedSignatureRoles"], 4)
        self.assertFalse(report["privateKeyBytesRead"])
        self.assertEqual(report["releaseDecision"], "NO_GO")
        self.assertFalse(report["dispatchPermitted"])
        self.assertEqual(
            before, {p.name: digest(p.read_bytes()) for p in self.archive.iterdir()}
        )

    def test_untrusted_manifest_never_grants_dispatch(self):
        for name, val in (
            ("signingPermitted", True),
            ("authorizationGranted", True),
            ("dispatchPermitted", True),
            ("releaseDecision", "GO"),
            ("historicalTaskId", 201),
        ):
            with self.subTest(field=name):
                prior = self.report[name]
                self.report[name] = val
                self.rewrite_manifest()
                with self.assertRaises(ArchiveAuditDenied):
                    self.verify()
                self.report[name] = prior
                self.rewrite_manifest()

    def test_tampered_claims_or_signature_denied(self):
        for role in ROLE_DATA:
            with self.subTest(role=role):
                name = self.report["roles"][role]["signatureFile"]
                target = self.archive / name
                prior = target.read_bytes()
                target.write_bytes(prior + b"X")
                with self.assertRaises(ArchiveAuditDenied):
                    self.verify()
                target.write_bytes(prior)

    def test_corrupt_claim_binding_denied_even_with_updated_manifest_hash(self):
        row = self.report["roles"]["approval"]
        p = self.archive / row["claimsFile"]
        data = json.loads(p.read_text())
        data["claims"]["taskId"] = 201
        self._save(row["claimsFile"], data)
        row["claimsFileSHA256"] = digest(p.read_bytes())
        self.rewrite_manifest()
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_wrong_key_denied(self):
        p = self.public / "approval-public.pem"
        wrong = Ed25519PrivateKey.generate().public_key()
        p.write_bytes(wrong.public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
        ))
        p.chmod(0o440)
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_symlink_and_overpermissive_file_denied(self):
        role = self.report["roles"]["hub"]
        path = self.archive / role["signatureFile"]
        historical = path.read_bytes()
        path.unlink()
        outside = self.root / "outside.json"
        outside.write_bytes(historical)
        path.symlink_to(outside)
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()
        path.unlink()
        path.write_bytes(historical)
        path.chmod(0o644)
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_foreign_approval_cannot_be_treated_as_same_task(self):
        p = self.archive / self.foreign
        self._save(self.foreign, {"claims": {"taskId": 200}})
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_cross_role_signature_substitution_denied(self):
        approval = self.report["roles"]["approval"]
        hub = self.report["roles"]["hub"]
        p = self.archive / hub["signatureFile"]
        p.write_bytes((self.archive / approval["signatureFile"]).read_bytes())
        hub["signatureFileSHA256"] = digest(p.read_bytes())
        self.rewrite_manifest()
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_missing_issuer_evidence_denied(self):
        p = self.archive / self.report["roles"]["issuer"]["claimsFile"]
        p.unlink()
        with self.assertRaises(ArchiveAuditDenied):
            self.verify()

    def test_archive_task_id_and_path_traversal_denied(self):
        with self.assertRaises(ArchiveAuditDenied):
            audit(self.archive, self.public, self.name, 201, expected_uid=os.geteuid())
        with self.assertRaises(ArchiveAuditDenied):
            audit(self.archive, self.public, "../" + self.name, 200,
                  expected_uid=os.geteuid())


if __name__ == "__main__":
    unittest.main()
