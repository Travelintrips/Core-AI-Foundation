import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from issue238_qa_integrity import (
    QA_MANIFEST, IMAGE_NAME, verify_image_metadata, verify_source_manifest,
)
from issue238_qa_permit import APPROVED_IMAGE_SHA256, PermitDenied


class IntegrityGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "review"
        self.root.mkdir(mode=0o700)
        # Synthetic test content; digest map is mocked, not the production pins.
        self.payloads = {name: "synthetic-" + name for name in QA_MANIFEST}
        for name, content in self.payloads.items():
            (self.root / name).write_text(content, encoding="utf-8")
        self.manifest = {name: __import__("hashlib").sha256(s.encode()).hexdigest()
                         for name, s in self.payloads.items()}
        self.patch = patch("issue238_qa_integrity.QA_MANIFEST", self.manifest)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def verify(self):
        return verify_source_manifest(self.root, expected_owner_uid=os.getuid())

    def test_all_sources_verified(self):
        self.assertEqual(self.verify(), self.manifest)

    def test_changed_script_rejected(self):
        for name in list(self.payloads):
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                (self.root / name).write_bytes(original + b"tamper")
                self.assertRaises(PermitDenied, self.verify)
                (self.root / name).write_bytes(original)

    def test_missing_source_rejected(self):
        p = self.root / next(iter(self.manifest))
        p.unlink()
        self.assertRaises(PermitDenied, self.verify)

    def test_symlinked_script_rejected(self):
        p = self.root / next(iter(self.manifest))
        p.unlink()
        p.symlink_to(self.root / list(self.manifest)[1])
        self.assertRaises(PermitDenied, self.verify)

    def test_public_writable_script_rejected(self):
        p = self.root / next(iter(self.manifest))
        p.chmod(0o666)
        self.assertRaisesRegex(PermitDenied, "unsafe_source_permissions", self.verify)

    def test_public_writable_directory_rejected(self):
        self.root.chmod(0o777)
        self.assertRaisesRegex(PermitDenied, "untrusted_source_directory", self.verify)

    def test_wrong_owner_rejected(self):
        self.assertRaisesRegex(PermitDenied, "untrusted_source_directory",
                               verify_source_manifest, self.root, expected_owner_uid=os.getuid() + 500)

    def test_directory_symlink_rejected(self):
        link = Path(self.tmp.name) / "alias"
        link.symlink_to(self.root, target_is_directory=True)
        self.assertRaisesRegex(PermitDenied, "unsafe_source_directory",
                               verify_source_manifest, link, expected_owner_uid=os.getuid())

    def test_correct_local_image_metadata(self):
        image = {"Id": "sha256:" + APPROVED_IMAGE_SHA256, "RepoTags": [IMAGE_NAME]}
        self.assertEqual(verify_image_metadata(image), image["Id"])

    def test_wrong_image_digest_rejected(self):
        self.assertRaisesRegex(PermitDenied, "qa_image_digest_mismatch", verify_image_metadata,
                               {"Id": "sha256:" + "0"*64, "RepoTags": [IMAGE_NAME]})

    def test_wrong_image_tag_rejected(self):
        self.assertRaisesRegex(PermitDenied, "qa_image_tag_mismatch", verify_image_metadata,
                               {"Id": "sha256:" + APPROVED_IMAGE_SHA256, "RepoTags": ["postgres:17"]})

    def test_untrusted_metadata_rejected(self):
        for bad in (None, "", [], {"RepoTags": [IMAGE_NAME]}, {"Id": "sha256:" + APPROVED_IMAGE_SHA256}):
            with self.subTest(value=str(bad)):
                self.assertRaises(PermitDenied, verify_image_metadata, bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
