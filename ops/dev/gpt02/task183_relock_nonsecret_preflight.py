#!/usr/bin/env python3
"""Read-only CST-DEV Task183 relock launch preflight.

Examines systemd source/unit contract and the existence (never contents) of
the sealed one-use relock credential. It does not query or modify PostgreSQL,
enable a timer, create a credential, or authorize a relock.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

SERVICE = "gpt02-task183-preparer-relock.service"
TIMER = "gpt02-task183-preparer-relock.timer"
CREDENTIAL = Path("/etc/credstore.encrypted/gpt02-task183-relock-dsn")
SOURCE = Path("/opt/ai-task-gpt02-preparer/current/scripts/dev/gpt02-task183-relock-once.mjs")
EXPECTED_DIRECTORY = "/run/credentials/" + SERVICE
EXPECTED_ROLE = "gpt02_task183_relock_login."
PROJECT = "xssrfshdrtdfupgqwfdw"

@dataclass(frozen=True)
class Verdict:
    checks: dict[str, bool]
    blockers: list[str]

    def as_dict(self) -> dict:
        return {
            "environment": "CST-DEV",
            "purpose": "TASK183_RELOCK_READ_ONLY_PREFLIGHT",
            "checks": self.checks,
            "blockers": self.blockers,
            "canActivate": False,  # A preflight never grants authorization.
            "credentialContentsRead": False,
            "databaseQueried": False,
            "roleModified": False,
            "timerModified": False,
            "relockExecuted": False,
        }

def check_contract(source_text: str, unit_text: str, *, credential_present: bool,
                   timer_active: bool, service_active: bool) -> Verdict:
    # Both values must be rooted in a trusted local source, not a caller's claim.
    expected_user = EXPECTED_ROLE + PROJECT
    directory_match = re.search(
        r"const root=env.CREDENTIALS_DIRECTORY;\s*if\([^)]*root!==['\"]([^'\"]+)['\"]",
        source_text,
    )
    # Do not interpret a PostgreSQL pooler username as a pg_roles rolname.
    checks = {
        "fixed_dev_project": ("const REF='" + PROJECT + "'") in source_text,
        "pooler_username_contract": ("const ROLE='" + EXPECTED_ROLE + "'+REF;") in source_text,
        "systemd_credential_directory_matches": bool(
            directory_match and directory_match.group(1) == EXPECTED_DIRECTORY
        ),
        "unit_credential_source_matches": (
            "LoadCredentialEncrypted=task183-relock-dsn:" + str(CREDENTIAL)
        ) in unit_text,
        "service_dev_only": all(s in unit_text for s in (
            "Environment=NODE_ENV=development",
            "Environment=APP_ENV=development",
            "Environment=GPT02_TASK183_RELOCK_SCOPE=CST-DEV_TASK183",
        )),
        "source_requires_dev": "TASK183_RELOCK_DEV_ONLY" in source_text,
        "source_has_pinned_tls": "TASK183_RELOCK_CA_INVALID" in source_text,
        "sealed_relock_credential_exists": credential_present,
        "timer_not_running": not timer_active,
        "service_not_running": not service_active,
    }
    blockers = [key.upper() for key, passed in checks.items() if not passed]
    # A true here does not demonstrate SQL GRANT/LOGIN, credential validity,
    # independent issuer approval, or ability to safely run relock.
    blockers += [
        "DB_ROLE_LOGIN_AND_NARROW_EXECUTE_GRANT_REQUIRE_INDEPENDENT_VERIFICATION",
        "AUTHORIZED_JIT_ISSUER_AND_POST_RELOCK_PROOF_REQUIRED",
    ]
    return Verdict(checks=checks, blockers=blockers)

def systemctl(*args: str) -> str:
    return subprocess.run(
        ["systemctl", *args], check=True, capture_output=True,
        text=True, timeout=6,
    ).stdout

def main() -> int:
    try:
        # Explicitly require the service to exist; never load password data.
        unit = systemctl("cat", SERVICE)
        source = SOURCE.read_text(encoding="utf-8")
        status = systemctl("show", SERVICE, "--property=ActiveState", "--value").strip()
        timer = systemctl("show", TIMER, "--property=ActiveState", "--value").strip()
        if status not in ("active", "inactive", "failed") or timer not in (
            "active", "inactive", "failed",
        ):
            raise ValueError("INVALID_SYSTEMD_STATUS")
        report = check_contract(
            source, unit, credential_present=CREDENTIAL.is_file(),
            timer_active=timer == "active", service_active=status == "active",
        ).as_dict()
    except (OSError, ValueError, subprocess.SubprocessError):
        report = {
            "environment": "CST-DEV", "purpose": "TASK183_RELOCK_READ_ONLY_PREFLIGHT",
            "checks": {}, "blockers": ["HOST_PREFLIGHT_UNAVAILABLE"],
            "canActivate": False, "credentialContentsRead": False,
            "databaseQueried": False, "roleModified": False,
            "timerModified": False, "relockExecuted": False,
        }
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if not report["blockers"] else 2

if __name__ == "__main__":
    raise SystemExit(main())
