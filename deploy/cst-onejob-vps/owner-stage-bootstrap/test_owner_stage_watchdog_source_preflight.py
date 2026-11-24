#!/usr/bin/env python3
"""Synthetic public-pin contract tests. No host reads or service calls."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).with_name("owner-stage-watchdog-source-preflight.py")
spec = importlib.util.spec_from_file_location("onejob_watchdog_pin_preflight", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SHA = "b" * 40
W = {module.WATCHDOG_SOURCE: SHA}
S = {module.STAGE_SOURCE: SHA, module.STAGE_IMAGE: module.IMAGE + SHA}


class WatchdogPinGate(unittest.TestCase):
    def test_matching_public_pins_and_active_watchdog_not_authority(self):
        self.assertEqual(module.review(S, W, True), (True, "SOURCE_BINDING_MATCH_ONLY"))

    def test_mismatched_watchdog_source_denied(self):
        self.assertEqual(module.review(S, {module.WATCHDOG_SOURCE: "e" * 40}, True),
                         (False, "WATCHDOG_STAGE_SOURCE_MISMATCH"))

    def test_missing_watchdog_source_denied(self):
        self.assertEqual(module.review(S, {}, True),
                         (False, "WATCHDOG_PUBLIC_SOURCE_NOT_PINNED"))

    def test_wrong_image_or_source_denied(self):
        for stage in (
            {},
            {**S, module.STAGE_SOURCE: "short"},
            {**S, module.STAGE_IMAGE: module.IMAGE + "e" * 40},
            {**S, module.STAGE_IMAGE: "outside/repo:" + SHA},
        ):
            self.assertEqual(module.review(stage, W, True)[0], False)

    def test_watchdog_stopped_denies_even_matching_source(self):
        self.assertEqual(module.review(S, W, False),
                         (False, "WATCHDOG_NOT_ACTIVE"))

    def test_no_operational_powers_in_preflight(self):
        source = path.with_name("owner-stage-watchdog-source-preflight.py").read_text()
        for disallowed in ("ALTER ROLE", "psycopg.connect", "docker run",
                           "systemctl start", "service_role", "CREATE ROLE"):
            self.assertNotIn(disallowed, source)
        self.assertIn('["--read-only"]', source)


if __name__ == "__main__":
    unittest.main()
