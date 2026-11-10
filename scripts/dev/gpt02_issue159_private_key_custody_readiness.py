#!/usr/bin/env python3
"""Metadata-only GPT02 Issue #159 encrypted signer-custody readiness probe.

Never opens credential files, never invokes systemd-creds decrypt/cat/setup,
never loads a key, and never grants signing/dispatch authority.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys

STORE = "/etc/credstore.encrypted"
HOST_SECRET = "/var/lib/systemd/credential.secret"
ROLES = ("approval", "hub", "core", "issuer")
NAMES = {
    role: f"gpt02-issue159-{role}-private-key.pkcs8"
    for role in ROLES
}


def _meta(path):
    try:
        st = os.lstat(path)
    except OSError:
        return {"present": False, "regular": False, "mode": None,
                "uid": None, "gid": None}
    return {
        "present": True,
        "regular": stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode),
        "mode": f"{stat.S_IMODE(st.st_mode):04o}",
        "uid": st.st_uid,
        "gid": st.st_gid,
    }


def _systemd_version():
    try:
        out = subprocess.run(
            ["systemd", "--version"], capture_output=True, text=True,
            timeout=2, check=False,
        ).stdout.splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError):
        return None
    m = re.match(r"^systemd\s+(\d+)", out)
    return int(m.group(1)) if m else None


def inspect(store=STORE, host_secret=HOST_SECRET, operational=True):
    if operational and (store != STORE or host_secret != HOST_SECRET):
        return {
            "environment": "DEV",
            "reason": "OPERATIONAL_CUSTODY_PATH_NOT_PINNED",
            "signingPermitted": False,
            "authorizationGranted": False,
            "dispatchPermitted": False,
            "operationalCustodyReady": False,
            "releaseDecision": "NO_GO",
        }

    try:
        st = os.lstat(store)
        store_ok = (
            stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)
            and stat.S_IMODE(st.st_mode) == 0o700
            and st.st_uid == 0 and st.st_gid == 0
        )
        store_meta = {
            "present": True, "mode": f"{stat.S_IMODE(st.st_mode):04o}",
            "uid": st.st_uid, "gid": st.st_gid,
        }
    except OSError:
        store_ok = False
        store_meta = {"present": False, "mode": None, "uid": None, "gid": None}

    creds_tool = shutil.which("systemd-creds")
    version = _systemd_version()
    host_meta = _meta(host_secret)

    credentials = {}
    all_credential_meta_ok = True
    for role in ROLES:
        path = os.path.join(store, NAMES[role])
        meta = _meta(path)
        credentials[role] = {
            "fileName": NAMES[role],
            **meta,
        }
        if meta["present"] and not (
            meta["regular"] and meta["mode"] in ("0400", "0600")
            and meta["uid"] == 0 and meta["gid"] == 0
        ):
            all_credential_meta_ok = False

    present_count = sum(
        1 for role in ROLES if credentials[role]["present"]
    )
    host_secret_ok = (
        host_meta["present"] and host_meta["regular"]
        and host_meta["mode"] in ("0400", "0600")
        and host_meta["uid"] == 0 and host_meta["gid"] == 0
    )

    baseline = bool(
        store_ok and creds_tool and isinstance(version, int) and version >= 252
        and all_credential_meta_ok
    )

    return {
        "environment": "DEV",
        "reason": (
            "CUSTODY_METADATA_BASELINE_READY_NO_SIGNING_AUTHORITY"
            if baseline else "CUSTODY_METADATA_BASELINE_NOT_READY"
        ),
        "systemdVersion": version,
        "systemdCredsAvailable": bool(creds_tool),
        "encryptedStore": store_meta,
        "hostCredentialSecret": {
            "present": host_meta["present"],
            "metadataSecure": host_secret_ok,
        },
        "signerCredentialFiles": credentials,
        "signerCredentialPresentCount": present_count,
        "fourSignerCredentialMetadataSecure": (
            present_count == 4 and all_credential_meta_ok
        ),
        "privateCredentialBytesRead": False,
        "hostMetadataIndependentlyAttested": False,
        "signerRuntimeMounted": False,
        "signingPermitted": False,
        "authorizationGranted": False,
        "dispatchPermitted": False,
        "operationalCustodyReady": False,
        "releaseDecision": "NO_GO",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--store", default=STORE)
    p.add_argument("--host-secret", default=HOST_SECRET)
    p.add_argument("--test-mode", action="store_true")
    args = p.parse_args()
    out = inspect(args.store, args.host_secret, operational=not args.test_mode)
    print(json.dumps(out, sort_keys=True))
    return 0 if out.get("reason") == (
        "CUSTODY_METADATA_BASELINE_READY_NO_SIGNING_AUTHORITY"
    ) else 2


if __name__ == "__main__":
    sys.exit(main())
