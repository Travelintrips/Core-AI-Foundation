#!/usr/bin/env python3
"""GPT02-1782 fail-closed startup precheck; install only with Owner approval.

Return zero only if the *exact GPT02 Owner Ledger location* retains its
pinned closed bytes and unique routing; otherwise fail closed. Unlike a full
shared-vhost hash, unrelated AI Task DEV upstream releases no longer block
Nginx START. The remaining shared configuration is outside this GPT02 guard's
integrity scope. Restore only the exact gate→comment mutation from a root-
owned trusted closed backup, preserving concurrent unrelated route changes.
No network, credentials, SQL, or systemctl calls.
"""
import hashlib
import os
import re
from pathlib import Path
import stat
import sys
import tempfile

GATE = b"""return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
COMMENT = b"# GPT02-1782 bounded Owner GET test: automatic rollback armed"
LOCATION = b"location ^~ /api/gpt02-owner-ledger/ {"
PROXY = b"proxy_pass http://127.0.0.1:18082;"
# Byte-verified on the live closed GPT02 block before and after the 3-route DEV
# cutover 2026-11-26T17:51:29Z; the protected 1015 bytes are identical.
EXPECTED_OWNER_BLOCK_SHA256 = "cdbd857bddb84579257182e746281f7e5f12eb1052bab1df64cc101e01a16319"
EXPECTED_OWNER_BLOCK_BYTES = 1015
OWNER_URI = b"/api/gpt02-owner-ledger"
SERVER_NAME = b"server_name dev-ai-task.cstlogistic.co.id;"
END_MARKER = b"\n    # GPT02 Owner approval: DEV-only exact POST endpoints"
ACTIVE = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")

def closed_owner_gate(data: bytes) -> bool:
    # Fail closed for duplicate/alternative exact Owner Ledger routes, or
    # modifications anywhere within the byte-pinned protected location.
    if (len(data) > 200000 or data.count(LOCATION) != 1 or
        data.count(OWNER_URI) != 1 or data.count(SERVER_NAME) != 2 or
        data.count(END_MARKER) != 1 or data.count(GATE) != 1 or
        data.count(COMMENT) != 0 or
        # A server-level 503 error_page can turn a closed return 503 into
        # an alternate response without touching the protected location.
        re.search(rb"(?m)^[ \t]*error_page[ \t]+[^;\r\n]*\b503\b", data)):
        return False
    try:
        start = data.index(LOCATION)
        if start < 4 or data[start - 4:start] != b"    ":
            return False
        end = data.index(END_MARKER, start)
        if end <= start:
            return False
        block = data[start - 4:end]
        return (
            len(block) == EXPECTED_OWNER_BLOCK_BYTES and
            block.count(LOCATION) == 1 and block.count(GATE) == 1 and
            block.count(PROXY) == 1 and
            hashlib.sha256(block).hexdigest() == EXPECTED_OWNER_BLOCK_SHA256
        )
    except ValueError:
        return False


def guarded(active=ACTIVE, backup=BACKUP):
    if active.is_symlink() or not active.is_file():
        return "BLOCK_ACTIVE_NOT_REGULAR", 2
    a = active.read_bytes()
    if len(a) > 200000:
        return "BLOCK_ACTIVE_SIZE", 2
    if closed_owner_gate(a):
        return "PASS_GATE_CLOSED", 0
    # If this is an unknown closed-site mutation, do not attempt restoration:
    # only the one exact approved gate→comment switch may use a backup.
    if a.count(GATE) != 0 or a.count(COMMENT) != 1:
        return "BLOCK_CLOSED_OWNER_GATE_DRIFT", 2
    if backup.is_symlink() or not backup.is_file():
        return "BLOCK_MISSING_BACKUP", 2
    st = backup.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o600 or st.st_size > 200000:
        return "BLOCK_UNTRUSTED_BACKUP", 2
    original = backup.read_bytes()
    if not closed_owner_gate(original):
        return "BLOCK_INVALID_BASELINE", 2
    if a != original.replace(GATE, COMMENT, 1):
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
        if fd >= 0: os.close(fd)
        if os.path.exists(tmp): os.unlink(tmp)
    if active.read_bytes() != original:
        return "BLOCK_RESTORE_READBACK", 2
    return "PASS_RESTORED_GATE", 0

if __name__ == "__main__":
    try:
        state, code = guarded()
    except (OSError, ValueError) as e:
        state, code = "BLOCK_IO_ERROR_" + type(e).__name__, 2
    print("GPT02_BOOT_GATE=" + state)
    sys.exit(code)
