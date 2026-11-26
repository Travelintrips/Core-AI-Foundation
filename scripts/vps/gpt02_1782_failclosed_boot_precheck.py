#!/usr/bin/env python3
"""GPT02-1782 fail-closed startup precheck; install only with Owner approval.

Return zero if active Nginx config already has the expected gate, or restore
only the unique approved temporary gate→comment mutation using a trusted backup.
If untrusted/unknown, refuse Nginx startup (nonzero), never serve open config.
No network, credentials, SQL, or systemctl calls.
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
EXPECTED_CLOSED_SHA256 = "ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d"
ACTIVE = Path("/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id")
BACKUP = Path("/etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf")

def guarded(active=ACTIVE, backup=BACKUP):
    if active.is_symlink() or not active.is_file():
        return "BLOCK_ACTIVE_NOT_REGULAR", 2
    a = active.read_bytes()
    if len(a) > 200000:
        return "BLOCK_ACTIVE_SIZE", 2
    if a.count(GATE) == 1 and a.count(LOCATION) == 1 and a.count(PROXY) >= 1 and a.count(COMMENT) == 0:
        if hashlib.sha256(a).hexdigest() != EXPECTED_CLOSED_SHA256:
            return "BLOCK_CLOSED_BASELINE_DRIFT", 2
        return "PASS_GATE_CLOSED", 0
    if backup.is_symlink() or not backup.is_file():
        return "BLOCK_MISSING_BACKUP", 2
    st = backup.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o600 or st.st_size > 200000:
        return "BLOCK_UNTRUSTED_BACKUP", 2
    original = backup.read_bytes()
    if original.count(GATE) != 1 or original.count(LOCATION) != 1 or original.count(PROXY) < 1 or original.count(COMMENT) or hashlib.sha256(original).hexdigest() != EXPECTED_CLOSED_SHA256:
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
