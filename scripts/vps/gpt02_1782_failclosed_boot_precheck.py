#!/usr/bin/env python3
"""GPT02-1782 fail-closed startup precheck; install only with Owner approval.

Preserves the originally pinned COMPLETE closed Nginx vhost byte-for-byte,
except the four verified upstream transitions or two exact reviewed closed
PR252 frontend snapshots. Unknown edits remain denied.
This is strictly narrower than accepting arbitrary unrelated config edits.
Never loads credentials, connects to PostgreSQL, starts services or opens gate.
"""
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile

GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"
LOCATION = b"location ^~ /api/gpt02-owner-ledger/ {"
PROXY = b"proxy_pass http://127.0.0.1:18082;"
ORIGINAL_CLOSED_SHA256 = "e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed"
# Exact whole-file closed states reviewed on 27 Nov 2026 from the verified
# 48,092-byte prior backup through AI Task DEV PR252 preview and cutover.
# The protected Owner Ledger location is byte-identical in all three states.
# Do not accept arbitrary dashboard edits or normalize arbitrary directives.
PR252_CLOSED_SNAPSHOTS = frozenset((
    "df256e23dae4cf20dbd23c33f3c259e341d86719363ccd1e0b0b80a3dff6777c",
    "1d8b8fd3492845c6fd0586d0fc43ff9fb366f5f62772eb4d968c84e0c3b31846",
))
ACTIVE = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")

# Recorded independent AI Task DEV releases: 17:05:43 UTC default cutover;
# 17:51:29 UTC three read-only bridge-admin routes. The approved values are
# only the exact original upstream and exact already-tested new upstream.
NEW_PROXY = b"proxy_pass http://127.0.0.1:18181;"
ALLOWED_UPSTREAM_TRANSITIONS = (
    (b"    location = /api/bridge/admin/jobs {",
     b"proxy_pass http://127.0.0.1:18296;"),
    (b"    location = /api/bridge/admin/sessions {",
     b"proxy_pass http://127.0.0.1:18296;"),
    (b"    location ^~ /api/bridge/admin/jobs/ {",
     b"proxy_pass http://127.0.0.1:18296;"),
    (b"    location / {",
     b"proxy_pass http://127.0.0.1:18501;"),
)


def canonical_closed(data: bytes) -> bool:
    """True only for reviewed full-file closed baselines, never a route-only check."""
    if (len(data) > 200000 or data.count(GATE) != 1 or
        data.count(LOCATION) != 1 or data.count(PROXY) < 1 or
        data.count(COMMENT) != 0):
        return False
    if hashlib.sha256(data).hexdigest() in PR252_CLOSED_SNAPSHOTS:
        return True
    original = data
    for marker, prior_proxy in ALLOWED_UPSTREAM_TRANSITIONS:
        if original.count(marker) != 1:
            return False
        start = original.index(marker)
        end = original.find(b"\n    }", start)
        if end == -1:
            return False
        block = original[start:end]
        # Each selected location must contain exactly ONE of the two allowed
        # proxy values; do not normalize an extra duplicated directive.
        if block.count(prior_proxy) + block.count(NEW_PROXY) != 1:
            return False
        if block.count(NEW_PROXY) == 1:
            replaced = block.replace(NEW_PROXY, prior_proxy, 1)
            original = original[:start] + replaced + original[end:]
    return hashlib.sha256(original).hexdigest() == ORIGINAL_CLOSED_SHA256


def guarded(active=ACTIVE, backup=BACKUP):
    if active.is_symlink() or not active.is_file():
        return "BLOCK_ACTIVE_NOT_REGULAR", 2
    data = active.read_bytes()
    if len(data) > 200000:
        return "BLOCK_ACTIVE_SIZE", 2
    if canonical_closed(data):
        return "PASS_GATE_CLOSED", 0
    if backup.is_symlink() or not backup.is_file():
        return "BLOCK_MISSING_BACKUP", 2
    meta = backup.stat()
    if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or
        meta.st_gid != 0 or stat.S_IMODE(meta.st_mode) != 0o600 or
        meta.st_size > 200000 or meta.st_nlink != 1):
        return "BLOCK_UNTRUSTED_BACKUP", 2
    original = backup.read_bytes()
    if not canonical_closed(original):
        return "BLOCK_INVALID_BASELINE", 2
    if data != original.replace(GATE, COMMENT, 1):
        return "BLOCK_UNEXPECTED_ACTIVE_CHANGE", 2
    mode = stat.S_IMODE(active.stat().st_mode)
    fd, tmp = tempfile.mkstemp(prefix=".gpt02-boot-restore-", dir=str(active.parent))
    try:
        os.fchmod(fd, mode)
        os.write(fd, original)
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(tmp, active)
        directory = os.open(active.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if fd >= 0:
            os.close(fd)
        if os.path.exists(tmp):
            os.unlink(tmp)
    if active.read_bytes() != original:
        return "BLOCK_RESTORE_READBACK", 2
    return "PASS_RESTORED_GATE", 0


if __name__ == "__main__":
    try:
        state, code = guarded()
    except (OSError, ValueError):
        state, code = "BLOCK_IO_ERROR", 2
    print("GPT02_BOOT_GATE=" + state)
    sys.exit(code)
