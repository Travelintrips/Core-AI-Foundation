#!/usr/bin/env python3
"""Source-only systemd -> nonroot Docker credential handoff.

Copies only two existing systemd-provided plaintext credentials from the
root-only ephemeral service directory to a fresh private /run directory,
owned 28502:28501, with 0400 files. No stdout of credential bytes, no key
generation, no role changes. Fail closed on symlink, reused target or
unexpected ownership/mode; stop hook deletes only the exact managed files.
"""
from __future__ import annotations
import os
import stat
import sys
from pathlib import Path

SOURCE=Path("/run/credentials/cst-onejob-owner-stage-bootstrap.service")
TARGET=Path("/run/cst-onejob-stage-credentials")
UID,GID=28502,28501
NAMES=("database-url","session-secret")

def fail(reason):
    raise RuntimeError("ONEJOB_STAGE_CREDENTIAL_HANDOFF_"+reason)

def checked_dir(path,uid):
    st=path.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=uid:
        fail("DIR_NOT_TRUSTED")
    if st.st_mode&0o022:
        fail("DIR_WRITABLE_BY_OTHER")
    return st

def read_safe(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        st=os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1
            or st.st_uid!=0 or st.st_mode&0o077 or st.st_size<32 or st.st_size>2050):
            fail("UNSAFE_INPUT_METADATA")
        data=os.read(fd,2051)
        if len(data)!=st.st_size:
            fail("READ_SIZE_MISMATCH")
        return data
    finally:
        os.close(fd)

def prepare(source=SOURCE,target=TARGET,uid=UID,gid=GID):
    if os.geteuid()!=0:
        fail("ROOT_LAUNCHER_REQUIRED")
    checked_dir(source,0)
    checked_dir(target.parent,0)
    if target.is_symlink():
        fail("TARGET_ALREADY_EXISTS")
    # systemd RuntimeDirectory creates a ROOT 0700 EMPTY directory first,
    # with ProtectSystem=strict granting write access only to that path.
    if target.exists():
        if target.lstat().st_uid!=0:
            fail("TARGET_ALREADY_EXISTS")
        st=checked_dir(target,0)
        if stat.S_IMODE(st.st_mode)!=0o700 or any(target.iterdir()):
            fail("TARGET_ALREADY_EXISTS")
    else:
        # Synthetic QA may create it directly under a root-owned parent.
        os.mkdir(target,0o700)
    try:
        os.chown(target,uid,gid)
        for name in NAMES:
            raw=read_safe(source/name)
            out=target/name
            fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o400)
            try:
                os.fchown(fd,uid,gid)
                os.fchmod(fd,0o400)
                written=os.write(fd,raw)
                if written!=len(raw):
                    fail("SHORT_WRITE")
            finally:
                os.close(fd)
        if any(not (target/name).is_file() for name in NAMES):
            fail("INCOMPLETE_TARGET")
        print("STAGE_CREDENTIAL_HANDOFF_METADATA_PASS")
    except BaseException:
        cleanup(target,uid,gid,allow_absent=True)
        raise

def cleanup(target=TARGET,uid=UID,gid=GID,allow_absent=False):
    if os.geteuid()!=0:
        fail("ROOT_LAUNCHER_REQUIRED")
    if not target.exists() and not target.is_symlink():
        if allow_absent:return
        fail("TARGET_MISSING")
    st=target.lstat()
    if (not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode)
        or st.st_uid!=uid or st.st_gid!=gid or stat.S_IMODE(st.st_mode)!=0o700):
        fail("TARGET_OWNERSHIP_DRIFT")
    names={f.name for f in target.iterdir()}
    if not names.issubset(set(NAMES)):
        fail("TARGET_UNEXPECTED_CONTENT")
    for name in NAMES:
        path=target/name
        if path.exists() or path.is_symlink():
            fst=path.lstat()
            if (not stat.S_ISREG(fst.st_mode) or stat.S_ISLNK(fst.st_mode)
                or fst.st_uid!=uid or fst.st_gid!=gid
                or stat.S_IMODE(fst.st_mode)!=0o400 or fst.st_nlink!=1):
                fail("TARGET_FILE_OWNERSHIP_DRIFT")
            path.unlink()
    target.rmdir()
    print("STAGE_CREDENTIAL_HANDOFF_CLEAN_PASS")

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("prepare","cleanup"):
        fail("ONLY_PINNED_ACTIONS")
    if sys.argv[1]=="prepare":prepare()
    else:cleanup(allow_absent=True)

if __name__=="__main__":
    try:main()
    except Exception as e:
        code=str(e)
        print(code if code.startswith("ONEJOB_STAGE_CREDENTIAL_HANDOFF_") else
              "ONEJOB_STAGE_CREDENTIAL_HANDOFF_FAIL_CLOSED",file=sys.stderr)
        sys.exit(2)
