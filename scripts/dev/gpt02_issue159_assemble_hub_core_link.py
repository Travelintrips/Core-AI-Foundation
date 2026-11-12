#!/usr/bin/env python3
"""One-shot GPT02 DEV Hub/Core link assembly; NO signing, DB write or dispatch.

Runs locally as root AFTER one fresh real Super Admin approval. Reuses the
already deployed, independent Hub/Core /pre-sign-facts reader and the
existing signer trust-gate. Leaves exact one-time claims root-owned 0600 for
both existing static Hub/Core signer units. Never refreshes an approval.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import sys
import time

ROOT = Path("/opt/ai-coding-standalone-dev")
APPROVED = ROOT / "gpt02_issue159_approved_claims.json"
OUT = ROOT / "gpt02_issue159_hub_core_link_claims.json"
MAX_APPROVED_SIZE = 8192


def private_approved_file() -> dict:
    if os.geteuid() != 0:
        raise RuntimeError("DEV_ROOT_ONLY_LINK_ASSEMBLY")
    if OUT.exists() or OUT.is_symlink():
        raise RuntimeError("DEV_HUB_CORE_LINK_ALREADY_STAGED")
    for path, mode in ((APPROVED, 0o600),):
        st = path.lstat()
        if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode)
                or st.st_uid != 0 or st.st_gid != 0
                or stat.S_IMODE(st.st_mode) != mode
                or st.st_size > MAX_APPROVED_SIZE):
            raise RuntimeError("DEV_PRIVATE_APPROVAL_FILE_INVALID")
    payload = json.loads(APPROVED.read_text(encoding="utf-8"))
    if type(payload) is not dict or set(payload) != {"claims", "claimsSha256"}:
        raise RuntimeError("DEV_APPROVED_CLAIMS_FILE_SHAPE_INVALID")
    return payload


def assemble() -> None:
    from gpt02_issue159_signer_approval_guard import (
        canonical_sha, persisted_approval_fresh,
    )
    from gpt02_issue159_hub_core_signer_guard import (
        assemble_verified_operator_link,
    )
    # Reuse the existing independently deployed, read-only Hub/Core sidecar
    # bridge instead of creating another database client or authentication.
    from gpt02_issue159_approval_request_refresh import _socket_fact_reader

    payload = private_approved_file()
    claims = payload["claims"]
    now = int(time.time() * 1000)
    digest = canonical_sha(claims)
    if payload["claimsSha256"] != digest:
        raise RuntimeError("DEV_PERSISTED_ADMIN_APPROVAL_DIGEST_INVALID")
    # One fresh persisted Super Admin approval is mandatory; unlike the
    # request refresher, this path cannot create or rotate a nonce.
    if persisted_approval_fresh(claims, now_ms=now) != digest:
        raise RuntimeError("DEV_PERSISTED_ADMIN_APPROVAL_NOT_PROVEN")
    identity = {
        "companyId": claims["companyId"],
        "hubTaskId": claims["taskId"],
        "commandCandidateId": claims["commandId"],
        "attemptId": claims["attemptId"],
    }
    facts = _socket_fact_reader(identity)
    link = assemble_verified_operator_link(claims, facts, now_ms=now)
    # Refuse expired/short-lived claims without saving partial artifacts.
    if link["expiresAt"] - int(time.time() * 1000) < 30_000:
        raise RuntimeError("DEV_OPERATOR_LINK_EXPIRED_BEFORE_WRITE")
    temp = OUT.with_name("." + OUT.name + ".tmp")
    if temp.exists() or temp.is_symlink():
        raise RuntimeError("DEV_OPERATOR_LINK_TEMP_ALREADY_EXISTS")
    data = (json.dumps(link, separators=(",", ":"), ensure_ascii=False)
            + "\n").encode("utf-8")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.link(temp, OUT)
        if OUT.stat().st_uid != 0 or stat.S_IMODE(OUT.stat().st_mode) != 0o600:
            raise RuntimeError("DEV_OPERATOR_LINK_FILE_CUSTODY_INVALID")
    finally:
        temp.unlink(missing_ok=True)
    print("GPT02_HUB_CORE_LINK_READY")
    print("task_id", link["hubTaskId"])
    print("signer_operational", False)
    print("dispatch_permitted", False)


if __name__ == "__main__":
    try:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        assemble()
    except Exception as exc:
        print("GPT02_LINK_ASSEMBLY_DENIED:", type(exc).__name__, file=sys.stderr)
        raise SystemExit(2)
