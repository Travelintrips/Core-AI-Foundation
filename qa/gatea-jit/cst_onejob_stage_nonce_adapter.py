#!/usr/bin/env python3
"""CST-DEV Gate-A nonce callback reusing the already tested VPS signer ledger.

Source-only adapter: neither creates a ledger, connects to any database,
issues an approval, reads credentials, nor changes a service/role.
A future approved systemd launcher must supply its own dedicated persistent
StateDirectory (not any signer StateDirectory) and call this under the
directory owner UID. The existing consume_nonce uses O_EXCL, file and
directory fsync, and never removes consumed permits on errors.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import importlib.util
import re

PROJECT="xssrfshdrtdfupgqwfdw"
DOMAIN=b"CST_DEV_GATE_A_STAGE_SIGNED_NONCE_V1\x00"
SIGNER_SOURCE=Path(__file__).resolve().parents[2]/"deploy/cst-onejob-vps/cst_onejob_vps_signer.py"
HEX32=re.compile(r"[0-9a-f]{32}\Z")
HEX40=re.compile(r"[0-9a-f]{40}\Z")

class StageNonceDenied(RuntimeError):
    pass

def _signer_nonce_function():
    # Import the already tested primitive only, never call signer.serve().
    spec=importlib.util.spec_from_file_location("cst_onejob_signer_nonce_primitive",SIGNER_SOURCE)
    if spec is None or spec.loader is None:
        raise StageNonceDenied("SIGNER_NONCE_PRIMITIVE_UNAVAILABLE")
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not callable(getattr(mod,"consume_nonce",None)) or mod.PROJECT!=PROJECT:
        raise StageNonceDenied("SIGNER_NONCE_PRIMITIVE_INVALID")
    return mod.consume_nonce

def make_stage_nonce_reserver(ledger_directory):
    """Create the reserve_nonce callback expected by the JIT source contract.

    The *same signed nonce*, even across differing source SHAs, always maps
    to the same durable record within this one dedicated Gate-A ledger.
    This binding intentionally cannot reserve an arbitrary signer nonce.
    """
    directory=Path(ledger_directory)
    if not directory.is_absolute():
        raise StageNonceDenied("ABSOLUTE_LEDGER_PATH_REQUIRED")
    consume=_signer_nonce_function()

    def reserve_nonce(project,nonce,source_sha,expires_at):
        if (project!=PROJECT or not isinstance(nonce,str)
            or HEX32.fullmatch(nonce) is None
            or not isinstance(source_sha,str)
            or HEX40.fullmatch(source_sha) is None
            or not isinstance(expires_at,datetime)
            or expires_at.tzinfo is None
            or expires_at.utcoffset() is None):
            raise StageNonceDenied("SIGNED_NONCE_CONTEXT_INVALID")
        # Project+nonce, NOT source SHA: a previously signed nonce cannot be
        # reused after a source release rotation. The SHA is still checked.
        digest=sha256(DOMAIN+PROJECT.encode("ascii")+b"\x00"+nonce.encode("ascii")).hexdigest()
        try:
            consume(str(directory),digest)
        except FileExistsError:
            return False
        # Every other error (bad ownership, write/fsync failure, symlink,
        # missing volume) propagates and cannot yield a successful LOGIN.
        return True
    return reserve_nonce

if __name__=="__main__":
    raise SystemExit("CST_ONEJOB_STAGE_NONCE_SOURCE_ONLY_NO_OPERATIONAL_ENTRYPOINT")
