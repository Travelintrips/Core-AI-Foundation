#!/usr/bin/env python3
"""Issue159 CST-DEV original signer -> one-read -> original relock entrypoint.

Short-lived ONESHOT runtime, source only (not installed or enabled).
The approved four-signature packet is supplied ONLY as a systemd-encrypted
credential. The original pinned verifier performs the ONE authoritative
Owner/Hub/Core/issuer validation; a deferred supervisor opens no credential
or database connection before that validation succeeds.

This program performs no task/job creation, signer activation, credential
issuance, approval writing, DELL command, or dispatch. Even success is only
a reviewed, independently relocked read; overall task release is NO_GO.
"""
from __future__ import annotations

import json
import os
import re
import sys

from gpt02_issue159_systemd_native_factories import (
    signed_packet_from_systemd, SystemdDeferredOneTaskSupervisor,
)
from gpt02_issue159_one_shot_reader_broker import (
    review_one_shot_reader_readback,
)


def _status(reason: str,*, read_relocked: bool=False) -> dict:
    return {
        "environment":"CST-DEV",
        "stage":"NATIVE_ONE_SHOT_SIGNED_READ_REVIEW",
        "oneCanonicalReadReviewed":read_relocked,
        "nativeRelockAttested":read_relocked,
        "authorizationGranted":False,
        "signingPermitted":False,
        "dispatchPermitted":False,
        "releaseDecision":"NO_GO",
        "reason":reason,
    }


def main() -> int:
    if len(sys.argv)!=1 or os.environ.get("APP_ENV")!="development":
        print(json.dumps(_status("DEV_SYSTEMD_ONLY_REQUIRED")),flush=True)
        return 3
    try:
        packet=signed_packet_from_systemd()
        # The original broker derives candidate ONLY after checking pinned
        # four-signer roots, the existing Unix verifier and persisted intent.
        # The deferred supervisor opens encrypted native credentials only
        # in the first original consume_scope_once callback, not before.
        proof=review_one_shot_reader_readback(
            packet,SystemdDeferredOneTaskSupervisor(),
        )
        if (
            type(proof) is not dict
            or proof.get("releaseDecision")!="NO_GO"
            or proof.get("oneCanonicalReadReviewed") is not True
            or proof.get("postReadRelockVerifiedByNativePostgres") is not True
            or proof.get("preReadConsumptionVerifiedByPostgres") is not True
            or proof.get("authorizationGranted") is not False
            or proof.get("dispatchPermitted") is not False
        ):
            raise ValueError("ONE_SHOT_NATIVE_PROOF_INCOMPLETE")
        print(json.dumps(_status(
            "ONE_SHOT_READ_RELOCKED_NOT_RELEASE_AUTHORITY",read_relocked=True,
        )),flush=True)
        return 0
    except Exception as error:
        # Stable codes only: never print SQL, passwords, packet, DSN or raw
        # native DB errors. Post-crash relock is the pre-existing watchdog.
        code=str(error)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,110}",code):
            code="ONE_SHOT_NATIVE_READ_OR_RELOCK_UNAVAILABLE"
        print(json.dumps(_status(code)),flush=True)
        return 3


if __name__=="__main__":
    raise SystemExit(main())
