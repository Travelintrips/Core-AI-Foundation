#!/usr/bin/env python3
"""CST-DEV Gate A source-only exclusive JIT-stage lock.

No CLI, credentials, DB, issuer or service activation. A future approved
launcher may call make_stage_lock() on its separate, persistent private
StateDirectory, and must hold the context through database relock/readback.
Advisory flock does NOT replace independently running crash watchdog.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat

class SingleFlightDenied(RuntimeError):
    pass

def make_stage_lock(ledger_directory):
    directory=Path(ledger_directory)
    if not directory.is_absolute():
        raise SingleFlightDenied("GATEA_LOCK_ABSOLUTE_PRIVATE_DIR_REQUIRED")

    @contextmanager
    def acquire():
        # Open the directory without following symlinks, then open the lock
        # relative to that verified directory fd to prevent path replacement.
        dir_fd=None
        fd=None
        try:
            dir_fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
            d=os.fstat(dir_fd)
            if (not stat.S_ISDIR(d.st_mode) or d.st_uid!=os.getuid()
                or stat.S_IMODE(d.st_mode)!=0o700):
                raise SingleFlightDenied("GATEA_LOCK_DIRECTORY_UNSAFE")
            fd=os.open("jit-stage.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_CLOEXEC,
                       0o600,dir_fd=dir_fd)
            f=os.fstat(fd)
            if (not stat.S_ISREG(f.st_mode) or f.st_uid!=os.getuid()
                or f.st_nlink!=1 or stat.S_IMODE(f.st_mode)!=0o600):
                raise SingleFlightDenied("GATEA_LOCK_FILE_UNSAFE")
            try:
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError as e:
                raise SingleFlightDenied("GATEA_LOCK_ANOTHER_STAGE_ACTIVE") from e
            try:
                yield
            finally:
                fcntl.flock(fd,fcntl.LOCK_UN)
        finally:
            if fd is not None: os.close(fd)
            if dir_fd is not None: os.close(dir_fd)
    return acquire

if __name__=="__main__":
    raise SystemExit("CST_GATEA_SINGLE_FLIGHT_SOURCE_ONLY_NO_OPERATIONAL_CLI")