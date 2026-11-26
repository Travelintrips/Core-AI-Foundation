#!/usr/bin/env python3
"""Read-only preflight for GPT02-1782 CST-DEV Owner Ledger.

No credential reads, role updates, HTTP requests or Nginx changes.
A valid receipt's *metadata* is NOT signature verification or E2E PASS.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
from pathlib import Path

PROJECT = "xssrfshdrtdfupgqwfdw"
PRINCIPAL = "openclaw-vps-main"
READER = "gpt02_owner_ledger_reader_1782_dev"
GATE = """return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';"""
LOCATION = "location ^~ /api/gpt02-owner-ledger/ {"


def receipt_metadata(path: Path, now_ms: int, kind: str) -> dict:
    output = {"present": False, "current": False, "signature_verified": False}
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 8192:
            return output
        envelope = json.loads(path.read_text(encoding="utf-8"))
        receipt = envelope["receipt"]
        if not isinstance(receipt, dict) or not isinstance(envelope.get("signature"), str):
            return output
        output["present"] = True
        start, end = receipt.get("notBefore"), receipt.get("expiresAt")
        output["current"] = (
            type(start) is int and type(end) is int and start <= now_ms < end
            and receipt.get("project") == PROJECT
            and receipt.get("principal") == PRINCIPAL
            and (kind != "dba" or receipt.get("readerRole") == READER)
        )
        if type(end) is int:
            output["expires_utc"] = dt.datetime.fromtimestamp(
                end / 1000, dt.timezone.utc
            ).isoformat()
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, OverflowError):
        pass
    return output


def inspect(nginx: Path, enabled: Path, worker: Path, dba: Path, now_ms: int) -> dict:
    result = {
        "scope": "GPT02-1782 CST-DEV",
        "ready_for_positive_e2e": False,
        "reader_login_verified": False,
        "owner_session_verified": False,
        "positive_http_200_json_verified": False,
        "action": "RETAIN_NGINX_503_GATE",
    }
    try:
        data = nginx.read_text(encoding="utf-8")
        result["gate_exactly_once"] = data.count(GATE) == 1
        result["location_exactly_once"] = data.count(LOCATION) == 1
        result["dedicated_proxy_present"] = "proxy_pass http://127.0.0.1:18082;" in data
        result["duplicate_vhost_files"] = sorted(
            p.name for p in enabled.iterdir()
            if p.is_file() and not p.is_symlink()
            and p.name.startswith("dev-ai-task.cstlogistic.co.id")
        )
    except (OSError, UnicodeError):
        result.update(gate_exactly_once=False, location_exactly_once=False,
                      dedicated_proxy_present=False,
                      duplicate_vhost_files=["CONFIG_UNAVAILABLE"])
    result["worker"] = receipt_metadata(worker, now_ms, "worker")
    result["dba"] = receipt_metadata(dba, now_ms, "dba")
    return result


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--nginx", type=Path, default=Path("/etc/nginx/sites-available/dev-ai-task.cstlogistic.co.id"))
    p.add_argument("--enabled", type=Path, default=Path("/etc/nginx/sites-enabled"))
    p.add_argument("--worker", type=Path, default=Path("/run/credentials/gpt02-reader-custody/worker-attestation.json"))
    p.add_argument("--dba", type=Path, default=Path("/run/credentials/gpt02-reader-custody/issuer-receipt.json"))
    p.add_argument("--now-ms", type=int, default=None)
    args = p.parse_args()
    now_ms = args.now_ms if args.now_ms is not None else int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    print(json.dumps(inspect(args.nginx, args.enabled, args.worker, args.dba, now_ms), sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
