"""Read-only GPT02 DELL DEV canonical-vs-runtime source custody check.

No network, credentials, browser, subprocess, database or file mutations.
A source checkout normalizes Git CRLF-pinned files; runtime mode requires
exact installed bytes for the three pinned critical modules.
"""
import argparse
import hashlib
import json
from pathlib import Path

MANIFEST = "gpt02-dell-canonical-source-manifest.json"
RUNTIME_PINNED = frozenset((
    "dev_chatgpt_native_transport.py",
    "dell-wake-executor-once.mjs",
    "gpt02-local-cache-readback.js",
))
PINNED_CRLF = frozenset((
    "dev_chatgpt_native_transport.py",
    "dell-wake-executor-once.mjs",
))
RUNTIME_NAMES_EXCLUDE_PREFIXES = ("test_",)
RUNTIME_NAMES_EXCLUDE = frozenset(("package.json",))


class ParityFailure(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(data):
    if b"\r\r\n" in data:
        raise ParityFailure("invalid nested CRLF sequence")
    return data.replace(b"\r\n", b"\n")


def secure_file(directory, name):
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise ParityFailure("invalid manifest filename")
    f = directory / name
    if f.is_symlink() or not f.is_file():
        raise ParityFailure("missing or symlinked source file: " + name)
    return f.read_bytes()


def verify(source_root: Path, runtime_root: Path, mode: str, manifest_path=None):
    source_root = Path(source_root).resolve()
    runtime_root = Path(runtime_root).resolve()
    if mode not in ("source", "runtime"):
        raise ParityFailure("invalid verification mode")
    if manifest_path is None:
        manifest_bytes = secure_file(source_root, MANIFEST)
    else:
        manifest = Path(manifest_path)
        if manifest.is_symlink() or not manifest.is_file():
            raise ParityFailure("missing or symlinked external manifest")
        manifest_bytes = manifest.read_bytes()
    doc = json.loads(manifest_bytes.decode("utf-8"))
    if doc.get("scope") != "GPT02_DELL_DEV_CANONICAL_DRAFT_NO_DEPLOY":
        raise ParityFailure("unexpected release scope")
    rows = doc.get("files")
    pins = doc.get("expected_windows_runtime_sha256")
    if not isinstance(rows, list) or len(rows) < 20 or not isinstance(pins, dict):
        raise ParityFailure("missing manifest evidence")
    if set(pins) != RUNTIME_PINNED:
        raise ParityFailure("unexpected Windows runtime pin set")
    if any(not isinstance(x, str) or len(x) != 64 or
           any(c not in "0123456789abcdef" for c in x) for x in pins.values()):
        raise ParityFailure("invalid pinned SHA-256")

    source_seen = set()
    runtime_seen = set()
    for item in rows:
        if not isinstance(item, dict):
            raise ParityFailure("invalid manifest row")
        name = item.get("name")
        if not isinstance(name, str) or name.lower() in source_seen:
            raise ParityFailure("duplicate or invalid source name")
        source_seen.add(name.lower())
        expected = item.get("sha256_lf")
        count = item.get("bytes")
        if not isinstance(expected, str) or len(expected) != 64:
            raise ParityFailure("invalid source hash")
        if type(count) is not int or count <= 0:
            raise ParityFailure("invalid source size")
        # CI checks tests in source mode. DELL runtime installs code modules,
        # not Git-only tests. Never treat missing runtime test files as drift.
        if mode == "runtime" and (name.startswith(RUNTIME_NAMES_EXCLUDE_PREFIXES)
                                  or name in RUNTIME_NAMES_EXCLUDE):
            continue
        data = normalized(secure_file(source_root, name))
        if len(data) != count or digest(data) != expected:
            raise ParityFailure("source drift: " + name)
        if name.startswith(RUNTIME_NAMES_EXCLUDE_PREFIXES) or name in RUNTIME_NAMES_EXCLUDE:
            continue
        runtime_seen.add(name)
        installed = secure_file(runtime_root, name)
        if normalized(installed) != data:
            raise ParityFailure("runtime source content drift: " + name)

    if not RUNTIME_PINNED.issubset(runtime_seen):
        raise ParityFailure("missing one or more critical runtime files")
    for name, expected in pins.items():
        installed = secure_file(runtime_root, name)
        if mode == "source" and name in PINNED_CRLF:
            actual = digest(normalized(installed).replace(b"\n", b"\r\n"))
        else:
            actual = digest(installed)
        if actual != expected:
            raise ParityFailure("Windows installed byte hash mismatch: " + name)
    return {"scope": "GPT02_DELL_DEV_SOURCE_PARITY_READONLY",
            "mode": mode, "source_files": len(source_seen),
            "runtime_files": len(runtime_seen), "critical_hashes": len(pins),
            "result": "PASS", "changes_made": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=Path(__file__).parent)
    parser.add_argument("--runtime-root", type=Path, default=Path(__file__).parent)
    parser.add_argument("--mode", choices=("source", "runtime"), required=True)
    parser.add_argument("--manifest-path", type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.source_root, args.runtime_root, args.mode, args.manifest_path)
    except (ParityFailure, OSError, ValueError, TypeError) as exc:
        print(json.dumps({"scope": "GPT02_DELL_DEV_SOURCE_PARITY_READONLY",
                          "result": "NO_GO", "reason": str(exc)[:110],
                          "changes_made": False}))
        raise SystemExit(1)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
