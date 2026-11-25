#!/usr/bin/env python3
"""Publish an externally provisioned CST-DEV credential into its fixed /run path.

Only the companion systemd unit decrypts the separately authorized credential.
This helper does not issue credentials, change a database role, or produce any
custody attestation. It never accepts an input/output path from its caller.
The default reader profile is unchanged; the explicit worker-key profile only
loads a separately authorized Ed25519 key and never generates or signs with it.
"""
from __future__ import annotations

import json
import os
import secrets
import stat
import sys
from pathlib import Path

SOURCE_FILE = Path(
    "/run/credentials/gpt02-owner-ledger-credential-loader.service/reader.json"
)
READER_DIR = Path("/run/credentials/gpt02-owner-ledger-reader")
READER_FILE = READER_DIR / "reader.json"
MAX_BYTES = 4096
WORKER_ISSUER_FLAG = "GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED"
WORKER_SOURCE_FILE = Path(
    "/run/credentials/gpt02-reader-custody-worker-attestor-key-loader.service/private-key.pkcs8"
)
WORKER_KEY_DIR = Path("/run/credentials/gpt02-reader-custody-worker-attestor")
WORKER_KEY_FILE = WORKER_KEY_DIR / "private-key.pkcs8"
WORKER_KEY_BYTES = 48
_WORKER_KEY_PREFIX = bytes.fromhex("302e020100300506032b657004220420")

_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
_EXPECTED = {
    "database": "postgres",
    "host": "db.xssrfshdrtdfupgqwfdw.supabase.co",
    "port": 5432,
    "projectId": "xssrfshdrtdfupgqwfdw",
    "sslMode": "verify-full",
    "user": "gpt02_owner_ledger_reader_1782_dev",
}
_SAFE_CODES = frozenset({
    "READER_LOADER_ENV_INVALID", "READER_LOADER_ROOT_REQUIRED",
    "READER_LOADER_ARGUMENTS_INVALID", "READER_DIRECTORY_UNSAFE",
    "READER_SOURCE_UNAVAILABLE", "READER_SOURCE_UNSAFE",
    "READER_SOURCE_CHANGED", "READER_SOURCE_TOO_LARGE",
    "READER_PAYLOAD_INVALID", "READER_DESTINATION_UNSAFE",
    "READER_PUBLICATION_FAILED", "READER_LOADER_FAILED",
    "WORKER_ATTESTOR_KEY_DISABLED", "WORKER_ATTESTOR_KEY_INVALID",
})


class LoaderDenied(RuntimeError):
    """A bounded diagnostic; underlying exceptions and payloads stay private."""

    def __init__(self, code: str):
        self.code = code if code in _SAFE_CODES else "READER_LOADER_FAILED"
        super().__init__(self.code)


def _guard_environment() -> None:
    if (
        os.environ.get("APP_ENV") != "development"
        or os.environ.get("NODE_ENV") != "development"
    ):
        raise LoaderDenied("READER_LOADER_ENV_INVALID")
    if os.geteuid() != 0 or os.getegid() != 0:
        raise LoaderDenied("READER_LOADER_ROOT_REQUIRED")


def _profile_paths(profile: str) -> tuple[Path, Path, Path, int, str]:
    # These are the only profiles. No path comes from CLI arguments or env.
    if profile == "reader":
        return SOURCE_FILE, READER_DIR, READER_FILE, MAX_BYTES, "reader.json"
    if profile == "worker-attestor-key":
        return WORKER_SOURCE_FILE, WORKER_KEY_DIR, WORKER_KEY_FILE, WORKER_KEY_BYTES, "private-key.pkcs8"
    raise LoaderDenied("READER_LOADER_ARGUMENTS_INVALID")


def _check_directory(meta: os.stat_result, exact_mode: int | None = None) -> None:
    if (
        not stat.S_ISDIR(meta.st_mode)
        or meta.st_uid != 0
        or meta.st_gid != 0
        or stat.S_IMODE(meta.st_mode) & 0o022
        or (exact_mode is not None and stat.S_IMODE(meta.st_mode) != exact_mode)
    ):
        raise LoaderDenied("READER_DIRECTORY_UNSAFE")


def _open_trusted_directory(path: Path, exact_mode: int | None = None) -> int:
    """Walk from root using pinned no-follow directory descriptors."""
    if not path.is_absolute() or ".." in path.parts:
        raise LoaderDenied("READER_DIRECTORY_UNSAFE")
    descriptor: int | None = None
    try:
        descriptor = os.open("/", _DIRECTORY_FLAGS)
        _check_directory(os.fstat(descriptor))
        for component in path.parts[1:]:
            child = os.open(component, _DIRECTORY_FLAGS, dir_fd=descriptor)
            try:
                _check_directory(os.fstat(child))
            except BaseException:
                os.close(child)
                raise
            os.close(descriptor)
            descriptor = child
        _check_directory(os.fstat(descriptor), exact_mode)
        result = descriptor
        descriptor = None
        return result
    except OSError:
        raise LoaderDenied("READER_DIRECTORY_UNSAFE") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _private_file(meta: os.stat_result, max_bytes: int = MAX_BYTES) -> bool:
    return (
        stat.S_ISREG(meta.st_mode)
        and meta.st_uid == 0
        and meta.st_gid == 0
        and meta.st_nlink == 1
        and stat.S_IMODE(meta.st_mode) in (0o400, 0o600)
        and 0 < meta.st_size <= max_bytes
    )


def _identity(meta: os.stat_result) -> tuple[int, ...]:
    return (
        meta.st_dev, meta.st_ino, meta.st_mode, meta.st_uid, meta.st_gid,
        meta.st_nlink, meta.st_size, meta.st_mtime_ns, meta.st_ctime_ns,
    )


def _read_source(profile: str = "reader") -> bytes:
    source_file, _, _, max_bytes, _ = _profile_paths(profile)
    parent: int | None = None
    descriptor: int | None = None
    try:
        parent = _open_trusted_directory(source_file.parent)
        descriptor = os.open(source_file.name, _FILE_FLAGS, dir_fd=parent)
        before = os.fstat(descriptor)
        if not _private_file(before, max_bytes):
            raise LoaderDenied("READER_SOURCE_UNSAFE")
        chunks: list[bytes] = []
        total = 0
        while total <= max_bytes:
            chunk = os.read(descriptor, max_bytes + 1 - total)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > max_bytes:
                raise LoaderDenied("READER_SOURCE_TOO_LARGE")
        after = os.fstat(descriptor)
        if _identity(before) != _identity(after) or total != before.st_size:
            raise LoaderDenied("READER_SOURCE_CHANGED")
        return b"".join(chunks)
    except OSError:
        raise LoaderDenied("READER_SOURCE_UNAVAILABLE") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if parent is not None:
            os.close(parent)


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate")
        result[key] = value
    return result


def _invalid_constant(_value: str) -> object:
    raise ValueError("constant")


def _validate_payload(payload: bytes) -> None:
    try:
        if not 0 < len(payload) <= MAX_BYTES:
            raise ValueError("size")
        value = json.loads(
            payload.decode("utf-8", errors="strict"),
            object_pairs_hook=_unique_object,
            parse_constant=_invalid_constant,
        )
        if not isinstance(value, dict) or set(value) != set(_EXPECTED) | {"password"}:
            raise ValueError("shape")
        if any(type(value[key]) is not type(expected) or value[key] != expected
               for key, expected in _EXPECTED.items()):
            raise ValueError("target")
        password = value["password"]
        # Match the API consumer's JavaScript string-length boundary exactly.
        if not isinstance(password, str) or not 32 <= len(
            password.encode("utf-16-le", errors="surrogatepass")
        ) // 2 <= 256:
            raise ValueError("password")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise LoaderDenied("READER_PAYLOAD_INVALID") from None


def _check_destination(directory: int, profile: str = "reader") -> None:
    _, _, target, max_bytes, _ = _profile_paths(profile)
    try:
        existing = os.stat(target.name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return
    if not _private_file(existing, max_bytes) or stat.S_IMODE(existing.st_mode) != 0o600:
        raise LoaderDenied("READER_DESTINATION_UNSAFE")


def _publish(payload: bytes, profile: str = "reader") -> None:
    _, target_dir, target_file, max_bytes, filename = _profile_paths(profile)
    directory: int | None = None
    descriptor: int | None = None
    temporary: str | None = None
    try:
        if target_file.parent != target_dir or target_file.name != filename:
            raise LoaderDenied("READER_DESTINATION_UNSAFE")
        directory = _open_trusted_directory(target_dir, exact_mode=0o700)
        _check_destination(directory, profile)
        candidate_name = "." + filename + "-" + secrets.token_hex(16)
        descriptor = os.open(
            candidate_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=directory,
        )
        # Only clean up a name that this invocation successfully created.
        temporary = candidate_name
        os.fchmod(descriptor, 0o600)
        written = 0
        while written < len(payload):
            count = os.write(descriptor, payload[written:])
            if count <= 0:
                raise LoaderDenied("READER_PUBLICATION_FAILED")
            written += count
        os.fsync(descriptor)
        candidate = os.fstat(descriptor)
        if (
            not _private_file(candidate, max_bytes)
            or stat.S_IMODE(candidate.st_mode) != 0o600
            or candidate.st_size != len(payload)
        ):
            raise LoaderDenied("READER_PUBLICATION_FAILED")
        os.close(descriptor)
        descriptor = None
        # Recheck the existing destination before the single atomic commit.
        _check_destination(directory, profile)
        os.replace(temporary, target_file.name, src_dir_fd=directory, dst_dir_fd=directory)
        temporary = None
        os.fsync(directory)
    except OSError:
        raise LoaderDenied("READER_PUBLICATION_FAILED") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary is not None and directory is not None:
            try:
                os.unlink(temporary, dir_fd=directory)
            except OSError:
                pass
        if directory is not None:
            os.close(directory)


def load_reader_credential() -> None:
    _guard_environment()
    payload = _read_source()
    _validate_payload(payload)
    _publish(payload)


def load_worker_attestor_key() -> None:
    _guard_environment()
    if os.environ.get(WORKER_ISSUER_FLAG) != "true":
        raise LoaderDenied("WORKER_ATTESTOR_KEY_DISABLED")
    payload = _read_source("worker-attestor-key")
    # Canonical PKCS8 Ed25519 AlgorithmIdentifier + one 32-byte private seed.
    # The API separately verifies that its derived public key matches the pin.
    if len(payload) != WORKER_KEY_BYTES or not payload.startswith(_WORKER_KEY_PREFIX):
        raise LoaderDenied("WORKER_ATTESTOR_KEY_INVALID")
    _publish(payload, "worker-attestor-key")


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    worker_key = arguments == ["--worker-attestor-key"]
    if arguments and not worker_key:
        print("GPT02_READER_LOAD=BLOCKED code=READER_LOADER_ARGUMENTS_INVALID", file=sys.stderr)
        return 1
    marker = "GPT02_WORKER_ATTESTOR_KEY_LOAD" if worker_key else "GPT02_READER_LOAD"
    try:
        if worker_key:
            load_worker_attestor_key()
        else:
            load_reader_credential()
    except LoaderDenied as error:
        print(marker + "=BLOCKED code=" + error.code, file=sys.stderr)
        return 1
    except Exception:
        print(marker + "=BLOCKED code=READER_LOADER_FAILED", file=sys.stderr)
        return 1
    print(marker + "=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
