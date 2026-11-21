"""Disposable tests for exact source-pair verification. Never deploy."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
import zipfile
from unittest import mock

SOURCE = pathlib.Path(__file__).with_name("cst-onejob-ci-pair-readonly-gate.py")
SPEC = importlib.util.spec_from_file_location("ci_pair_readonly", SOURCE)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)

HEAD = "a" * 40
MERGE = "b" * 40
UI = b"function dummy(){/*Setujui satu job DEV owner-stage-readiness owner-approve-and-stage*/}" + b"x" * 1500
API = b"owner-stage-readiness owner-approve-and-stage" + b"y" * 1800


class GateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="cstdev-onejob-pair-test-")
        self.addCleanup(self.tmp.cleanup)
        self.artifact = pathlib.Path(self.tmp.name) / "pair.zip"
        self.build()

    def build(self, *, merge=MERGE, js=UI, api=API, unsafe=False, omit_api=False):
        with zipfile.ZipFile(self.artifact, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("ai-platform/dist/public/build-meta.json",
                       json.dumps({"commitSha": merge, "builtAt": "2026-11-21T00:00:00Z"}))
            z.writestr("ai-platform/dist/public/index.html", "<html><head></head><body>root</body></html>")
            z.writestr("ai-platform/dist/public/assets/index-QATEST.js", js)
            # Incompressible bytes give the fixture a realistically sized ZIP.
            z.writestr("qa-only/random.bin", os.urandom(3000))
            if not omit_api:
                z.writestr("api-server/dist/index.mjs", api)
            if unsafe:
                z.writestr("../secret.txt", b"never")
        self.sha = checker.digest_file(self.artifact)

    def verify(self, **args):
        opt=dict(
            archive=str(self.artifact), expected_digest=self.sha,
            ci_head=HEAD, current_head=HEAD, merge_sha=MERGE, ci_conclusion="success",
        )
        opt.update(args)
        return checker.verify(**opt)

    def denied(self, reason, **args):
        with self.assertRaisesRegex(ValueError, reason):
            self.verify(**args)

    def test_same_ci_pair_is_verified_as_source_only_never_release(self):
        r=self.verify()
        self.assertTrue(r["frontendAndBackendFromSameZip"])
        self.assertTrue(r["ownerGetAndPostCompiled"])
        self.assertEqual(r["releaseDecision"], "NO_GO")
        self.assertFalse(r["devDeployed"])
        self.assertFalse(r["authenticatedOwnerSessionVerified"])

    def test_fails_closed_on_stale_draft_head(self):
        self.denied("STALE_CI_HEAD", current_head="c"*40)

    def test_rejects_failed_or_queued_ci(self):
        for state in ("failure", "queued", "cancelled"):
            with self.subTest(state=state):
                self.denied("CI_CHECK_NOT_SUCCESS", ci_conclusion=state)

    def test_rejects_invalid_sha_and_reused_merge_head(self):
        self.denied("INVALID_GIT_SHA", ci_head="notasha")
        self.denied("INVALID_ARTIFACT_SHA", expected_digest="notasha")
        self.denied("CI_PR_MERGE_SHA_NOT_INDEPENDENT", merge_sha=HEAD)

    def test_rejects_artifact_digest_mismatch(self):
        self.denied("ARTIFACT_ZIP_DIGEST_MISMATCH", expected_digest="d"*64)

    def test_rejects_unsigned_wrong_merge_build_meta(self):
        self.build(merge="c"*40)
        self.denied("CI_MERGE_BUILD_META_MISMATCH")

    def test_rejects_frontend_only_no_api(self):
        self.build(omit_api=True)
        self.denied("CI_FRONTEND_BACKEND_PAIR_MISSING")

    def test_rejects_compiled_owner_ui_missing(self):
        self.build(js=b"old UI" + b"x"*1700)
        self.denied("OWNER_UI_NOT_IN_COMPILED_FRONTEND")

    def test_rejects_compiled_owner_backend_missing(self):
        self.build(api=b"old API" + b"x"*1700)
        self.denied("OWNER_API_NOT_IN_COMPILED_BACKEND")

    def test_rejects_path_traversal_in_zip(self):
        self.build(unsafe=True)
        self.denied("UNSAFE_ARTIFACT_ZIP_ENTRY")

    def test_rejects_multiple_same_js_bundles(self):
        with zipfile.ZipFile(self.artifact, "a") as z:
            z.writestr("ai-platform/dist/public/assets/index-ANOTHER.js", b"x")
        self.sha=checker.digest_file(self.artifact)
        self.denied("MAIN_FRONTEND_JS_NOT_UNIQUE")

    def test_rejects_symlink_like_archive_entry(self):
        with zipfile.ZipFile(self.artifact, "a") as z:
            info=zipfile.ZipInfo("extra-link")
            info.create_system=3
            info.external_attr=(0o120777 << 16)
            z.writestr(info, "index.html")
        self.sha=checker.digest_file(self.artifact)
        self.denied("ARTIFACT_SYMLINK_FORBIDDEN")

    def test_missing_zip_denied(self):
        self.denied("ARTIFACT_NOT_REGULAR_FILE", archive=str(self.artifact)+"-nonexistent")


if __name__ == "__main__":
    unittest.main()
