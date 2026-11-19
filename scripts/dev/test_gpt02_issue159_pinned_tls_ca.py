#!/usr/bin/env python3
"""Fixture-only public CA path and fingerprint regression; never connects to DB."""
import hashlib
from pathlib import Path
import ssl
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import gpt02_issue159_pinned_tls_ca as pin
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError


MISSING = object()


class PinnedPublicRootTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.location = Path(temp.name) / "reviewed-root.crt"
        self.der = b"synthetic-test-only-root-der-" + bytes(range(20))
        self.location.write_text(ssl.DER_cert_to_PEM_cert(self.der), "ascii")
        self.stat = SimpleNamespace(
            st_mode=stat.S_IFREG | 0o644, st_uid=0, st_gid=0,
            st_nlink=1, st_size=self.location.stat().st_size,
        )
        patches = (
            patch.object(pin, "PINNED_CA_PATH", str(self.location)),
            patch.object(pin, "PINNED_CA_SHA256", hashlib.sha256(self.der).hexdigest()),
            patch.object(pin.os, "lstat", return_value=self.stat),
        )
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.params = {"sslmode": "verify-full", "sslrootcert": str(self.location)}

    def denied(self, params=MISSING):
        with self.assertRaisesRegex(
            BrokerAdmissionError, "ISSUE159_PUBLIC_CA_NOT_PINNED",
        ):
            pin.require_pinned_cst_dev_tls(
                self.params if params is MISSING else params,
                "ISSUE159_PUBLIC_CA_NOT_PINNED",
            )

    def test_exact_public_fingerprint_and_owned_ca_pass(self):
        self.assertIsNone(pin.require_pinned_cst_dev_tls(
            self.params, "ISSUE159_PUBLIC_CA_NOT_PINNED",
        ))

    def test_verify_full_cannot_be_downgraded(self):
        for sslmode in ("require", "verify-ca", "disable", "", None):
            with self.subTest(mode=sslmode):
                self.denied({**self.params, "sslmode": sslmode})

    def test_alternate_trust_root_location_rejected_even_with_verify_full(self):
        for value in ("/tmp/fake-root.pem", "/etc/ssl/certs/ca-certificates.crt",
                      "", None):
            with self.subTest(path=value):
                self.denied({**self.params, "sslrootcert": value})

    def test_missing_invalid_parameters_are_denied(self):
        for value in (None, True, [], {}, {"sslmode": "verify-full"}):
            with self.subTest(value=value):
                self.denied(value)

    def test_changed_public_certificate_fingerprint_fails(self):
        self.location.write_text(
            ssl.DER_cert_to_PEM_cert(b"different-public-ca-for-test"),
            "ascii",
        )
        self.denied()

    def test_symlink_nonroot_and_writable_credential_metadata_fail(self):
        for kwargs in (
            {"st_mode": stat.S_IFLNK | 0o777},
            {"st_uid": 1000}, {"st_gid": 100},
            {"st_mode": stat.S_IFREG | 0o666}, {"st_nlink": 2},
            {"st_size": 0}, {"st_size": 8193},
        ):
            with self.subTest(kwargs=kwargs):
                original = vars(self.stat).copy()
                self.stat = SimpleNamespace(**{**original, **kwargs})
                pin.os.lstat = lambda _path: self.stat
                self.denied()
                self.stat = SimpleNamespace(**original)

    def test_missing_or_multiple_certificates_fail(self):
        self.location.unlink()
        self.denied()
        self.location.write_text(
            ssl.DER_cert_to_PEM_cert(self.der) * 2, "ascii",
        )
        self.denied()

    def test_refuses_with_no_credential_or_socket_interaction(self):
        # Only public CA + configuration parameters are in scope.
        import inspect
        source = inspect.getsource(pin)
        for term in ("psycopg.connect(", "subprocess.run(", "CREATE ROLE",
                     "ALTER ROLE", "pg_terminate_backend(", "dispatchOnce("):
            self.assertNotIn(term, source)


if __name__ == "__main__":
    unittest.main()
