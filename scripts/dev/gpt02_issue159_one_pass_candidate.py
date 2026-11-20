#!/usr/bin/env python3
"""GPT02 Issue159 ONE-PASS DEV candidate acceptance gate (source/isolated only).

Run from a separate Core AI Draft PR1754 checkout:
 python3 scripts/dev/gpt02_issue159_one_pass_candidate.py \
   --hub-root /tmp/gpt02-rc-hub-pr207-20261120 \
   --pr196-root /tmp/gpt02-rc-pr196-ee0dd1-20261120 \
   --report /tmp/gpt02-one-pass-evidence.json

This coordinates ORIGINAL existing implementation/tests across Core AI and
AI Task Hub. No Supabase connection, backend API, credentials, systemd,
signer activation, live role changes, or DELL command is permitted.
Run ALL selected tests and report ALL failures together, never one at a time.
A PASS_ISOLATED result cannot authorize an actual command or Final ACK.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ENVIRONMENT = "CST-DEV"
PROJECT = "xssrfshdrtdfupgqwfdw"
PINNED_HUB_SHA = "ef50a8b5ca6c813fae1b5b0ab7c3a03884294319"
PR196_PINNED_BLOBS = {
    "gpt02-google-auth-gate.mjs": "ec7a4a2f9400ae173899420de833d720d98275ae",
    "gpt02-prepared-link.mjs": "f097f919097d89b8f73d31184bf27b6b8aed6149",
    "gpt02-issuer-store.mjs": "1254504a71592011c7e59a27c9fe84bb595d2102",
    "gpt02-operator-link.mjs": "8a2e56af8fddda611efa33c33f1891205f2a445c",
}
SQL_REQUIRED = (
    "docs/dev/gpt02-issue159-minimal-catalog-auditor-existing-role.REVIEW_ONLY.sql",
    "docs/dev/gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql",
    "docs/dev/gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql",
    "docs/dev/gpt02-issue159-reader-issuance-server-clock.PROPOSED.sql",
    "docs/dev/gpt02-issue159-canonical-approval-fence.PROPOSED.sql",
    "docs/dev/gpt02-issue159-canonical-reader-guard.PROPOSED.sql",
    "docs/dev/gpt02-issue159-owner-source-fence-binding.REVIEW_ONLY.sql",
)
CORE_COMPONENTS = (
    "deploy/ai-coding-standalone-dev/gpt02_issue159_one_shot_reader_broker.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_native_relock_attestation.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_native_one_shot_supervisor.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_systemd_native_factories.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_one_shot_native_runtime.py",
    "deploy/ai-coding-standalone-dev/gpt02-issue159-one-shot-native@.service",
    "scripts/dev/test_gpt02_issue159_systemd_native_factories.py",
    "scripts/dev/test_gpt02_issue159_one_shot_native_runtime.py",
    "scripts/dev/test_gpt02_issue159_native_one_shot_supervisor.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent_schema.sql",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_intent.py",
    "scripts/dev/gpt02_issue159_approval_intent_reader.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_approval_reader_runtime.py",
    "deploy/ai-coding-standalone-dev/gpt02_issue159_owner_source_relay_review.py",
    "scripts/dev/test_gpt02_issue159_owner_atomic_outbox.py",
    "scripts/dev/test_gpt02_issue159_owner_source_relay_review.py",
    "scripts/dev/test_gpt02_issue159_owner_source_fence_binding_pg.py",

    "deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs",
    "docs/dev/gpt02-issue159-scoped-reader-relock-add-only.REVIEW_ONLY.sql",
    "scripts/dev/test_gpt02_issue159_scoped_reader_relock_existing_service_pg.py",
    "scripts/dev/test_gpt02_issue159_relock_shared_timer.mjs",
    "scripts/dev/gpt02_issue159_scoped_policy_proposal.py",
    "scripts/dev/test_gpt02_issue159_existing_role_install_chain_pg.py",
    "scripts/dev/test_gpt02_issue159_dual_grantor_owner_custody_pg.py",
)
HUB_COMPONENTS = (
    "artifacts/api-server/src/lib/gpt02-single-owner-approval-recorder.mjs",
    "artifacts/api-server/src/lib/gpt02-preissuer-bootstrap-review.mjs",
    "artifacts/api-server/src/lib/gpt02-single-owner-trusted-facts-adapter.mjs",
    "scripts/dev/gpt02-original-final-ack-contract.test.mjs",
)
EXTERNAL_GATES = (
    "DBA/custodian-authorized live owner-held add-only migration and rollback",
    "Real one-task database RLS/credential broker (not common issuer-reader)",
    "Authenticated signed original Owner approval -> canonical DB revocation",
    "Native one-read consumption, current-approval guard and terminal relock",
    "Four independent operational signers with non-circular issuer bootstrap",
    "Single new command from Task183 -> native DELL receiver-owned Final ACK",
)


def executable(command: str) -> bool:
    return shutil.which(command) is not None


def run_checked(cmd: list[str], cwd: Path, *, timeout: int = 190, env=None):
    start = time.monotonic()
    try:
        p = subprocess.run(
            cmd, cwd=cwd, env=env, check=False, timeout=timeout,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
        )
        # Never include free-form output, passwords, or SQL in JSON report.
        return p.returncode == 0, int((time.monotonic()-start)*1000), (
            "EXIT_0" if p.returncode == 0 else "EXIT_"+str(p.returncode)
        )
    except subprocess.TimeoutExpired:
        return False, int((time.monotonic()-start)*1000), "TEST_TIMEOUT"
    except OSError:
        return False, int((time.monotonic()-start)*1000), "EXECUTION_UNAVAILABLE"


def git_head(root: Path) -> str:
    passed,_,_ = run_checked(["git","rev-parse","--is-inside-work-tree"],root,timeout=8)
    if not passed:
        return "SOURCE_TREE_UNVERIFIED"
    p = subprocess.run(
        ["git","rev-parse","HEAD"],cwd=root,text=True,capture_output=True,
        timeout=8,check=False,
    )
    return p.stdout.strip() if p.returncode==0 else "SOURCE_HEAD_UNAVAILABLE"


def git_blob_hash(file: Path) -> str:
    data=file.read_bytes()
    return hashlib.sha1(
        ("blob "+str(len(data))+"\0").encode("ascii")+data
    ).hexdigest()


def preflight(core: Path, hub: Path, pr196: Path):
    failures: list[str] = []
    heads={"core": git_head(core), "ai_task_hub":git_head(hub)}
    if heads["ai_task_hub"] != PINNED_HUB_SHA:
        failures.append("HUB_HEAD_NOT_PINNED")
    for label,root,files in (
        ("CORE",core,SQL_REQUIRED+CORE_COMPONENTS),
        ("HUB",hub,HUB_COMPONENTS),
    ):
        for rel in files:
            if not (root/rel).is_file():
                failures.append(label+"_SOURCE_MISSING:"+rel)
    for name, sha in PR196_PINNED_BLOBS.items():
        orig=pr196/"artifacts/api-server/src/lib"/name
        current=hub/"artifacts/api-server/src/lib"/name
        if not orig.is_file() or not current.is_file():
            failures.append("PR196_ORIGINAL_DEPENDENCY_MISSING:"+name)
        elif git_blob_hash(orig)!=sha or git_blob_hash(current)!=sha:
            failures.append("PR196_ORIGINAL_SOURCE_CHANGED:"+name)
    for name in (
        "verified-source-final-ack.ts","gpt02-execution-outcome.ts",
    ):
        if not (pr196/"artifacts/api-server/src/lib"/name).is_file():
            failures.append("ORIGINAL_FINAL_ACK_MODULE_MISSING:"+name)
    ref=hub/"pr196-verifier-reference"
    if not ref.is_dir() or ref.is_symlink():
        failures.append("ORIGINAL_PR196_REFERENCE_MUST_BE_LOCAL_FOR_ISOLATED_DOCKER")
    if not executable("node") or not executable("docker") or not executable("python3"):
        failures.append("SOURCE_QA_RUNTIME_TOOL_MISSING")
    # These are not release permissions; record code provenance only.
    return heads,failures


def scrubbed_env(core: Path, pr196: Path):
    # No private service secrets or hosted DB URLs should enter fixture tests.
    denied=re.compile(
        r"(?:PASSWORD|TOKEN|SECRET|DATABASE_URL|CONNECTION_STRING|DSN|"
        r"SUPABASE_KEY|PRIVATE_KEY|SERVICE_ROLE|PGHOST|PGUSER|PGPASSWORD)",
        re.I,
    )
    env={k:v for k,v in os.environ.items() if not denied.search(k)}
    env["PYTHONDONTWRITEBYTECODE"]="1"
    env["NODE_ENV"]="development"
    env["APP_ENV"]="development"
    env["GPT02_PR196_REFERENCE"]=str(pr196)
    env["PYTHONPATH"]=str(core/"deploy/ai-coding-standalone-dev")+os.pathsep+str(core/"scripts/dev")
    env["GPT02_ISSUE159_SOURCE_ONLY_QA"]="1"
    env["GPT02_TEST_NODE_IMAGE"]="node:22-alpine"
    return env


def tests(core: Path,hub: Path,pr196: Path,*, full=True):
    python=sys.executable
    stages=[
        ("CORE_FOUR_SIGNED_VERIFIER",core,
         [python,"-m","unittest","-q",
          "scripts.dev.test_gpt02_issue159_positive_permit_handoff"]),
        ("CORE_OWNER_SQLITE_SOURCE_ATOMIC",core,
         [python,"-m","unittest","-q",
          "scripts.dev.test_gpt02_issue159_owner_atomic_outbox",
          "scripts.dev.test_gpt02_issue159_owner_source_relay_review",
          "scripts.dev.test_gpt02_issue159_approval_reader_runtime",
          "scripts.dev.test_gpt02_issue159_approval_intent_reader",
          "scripts.dev.test_gpt02_issue159_approval_intent_writer"]),
        ("CORE_PINNED_ONESHOT_BROKER",core,
         [python,"-m","unittest","-q",
          "scripts.dev.test_gpt02_issue159_one_shot_reader_broker",
          "scripts.dev.test_gpt02_issue159_native_one_shot_supervisor",
          "scripts.dev.test_gpt02_issue159_systemd_native_factories",
          "scripts.dev.test_gpt02_issue159_one_shot_native_runtime"]),
        ("CORE_SHARED_RELOCK_TIMER",core,
         ["node","--test","scripts/dev/test_gpt02_issue159_relock_shared_timer.mjs"]),
        ("CORE_THREE_DOMAIN_ISSUER_STARTUP",core,
         [python,"-m","unittest","-q",
          "scripts.dev.test_gpt02_issue159_preissuer_signer_bootstrap",
          "scripts.dev.test_gpt02_issue159_issuer_reader_sysusers",
          "scripts.dev.test_gpt02_issue159_operational_signer"]),
        ("HUB_ONE_OWNER_PREISSUER",hub,
         ["node","--test",
          "scripts/dev/gpt02-single-owner-approval-recorder.test.mjs",
          "scripts/dev/gpt02-preissuer-bootstrap-review.test.mjs",
          "scripts/dev/gpt02-issue159-persisted-owner-intent-gate.test.mjs"]),
        ("HUB_GUARDED_OWNER_HTTP",hub,
         ["node","--test",
          "scripts/dev/gpt02-single-owner-approval-http-candidate.test.mjs",
          "scripts/dev/gpt02-single-owner-trusted-facts-adapter.test.mjs"]),
        ("ORIGINAL_FINAL_ACK_CONTRACT",hub,
         ["node","--experimental-strip-types","--test",
          "scripts/dev/gpt02-original-final-ack-contract.test.mjs"]),
    ]
    if full:
        stages += [
            ("HUB_NATIVE_TWO_TLS_PRESIGN",hub,
             ["bash","scripts/dev/test-gpt02-presign-native-two-tls-readers-isolated.sh"]),
            ("HUB_POSTAUTH_DUAL_DATABASE_TLS",hub,
             ["bash","scripts/dev/test-gpt02-postauth-dualdb-approval-issuer-isolated.sh"]),
            ("HUB_REAL_RESTRICTED_ATTESTOR_ISSUER",hub,
             ["bash","scripts/dev/test-gpt02-single-owner-real-attestor-isolated.sh"]),
            ("DB_SIX_MIGRATIONS_EXISTING_CATALOG",core,
             [python,"scripts/dev/test_gpt02_issue159_existing_role_install_chain_pg.py"]),
            ("DB_DUAL_GRANTOR_RESTORATION",core,
             [python,"scripts/dev/test_gpt02_issue159_dual_grantor_owner_custody_pg.py"]),
            ("DB_EXACT_FIVE_TABLE_RLS",core,
             [python,"scripts/dev/test_gpt02_issue159_five_table_task_scope_pg.py"]),
            ("DB_SIGNED_SCOPE_ISSUANCE",core,
             [python,"scripts/dev/test_gpt02_issue159_signed_scoped_issuance_pg.py"]),
            ("DB_ONE_USE_CONSUMPTION",core,
             [python,"scripts/dev/test_gpt02_issue159_independent_read_consumption_pg.py"]),
            ("DB_CANONICAL_REVOCATION_GUARD",core,
             [python,"scripts/dev/test_gpt02_issue159_canonical_approval_fence_pg.py"]),
            ("DB_OWNER_SOURCE_PG_FENCE_NATIVE",core,
             [python,"scripts/dev/test_gpt02_issue159_owner_source_fence_binding_pg.py"]),
            ("DB_CRASH_SAFE_WATCHDOG",core,
             [python,"scripts/dev/test_gpt02_issue159_independent_relock_watchdog_pg.py"]),
            ("DB_FINALLY_RELOCK",core,
             [python,"scripts/dev/test_gpt02_issue159_broker_finally_relock_pg.py"]),
            ("DB_OWNER_COLUMN_ACL_RELOCK",core,
             [python,"scripts/dev/test_gpt02_issue159_owner_column_acl_relock_pg.py"]),
            ("DB_SHARED_SCOPED_RELOCK_NATIVE",core,
             [python,"scripts/dev/test_gpt02_issue159_scoped_reader_relock_existing_service_pg.py"]),
        ]
    return stages


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hub-root",required=True,type=Path)
    parser.add_argument("--pr196-root",required=True,type=Path)
    parser.add_argument("--report",required=True,type=Path)
    parser.add_argument("--quick",action="store_true",
                        help="source/unit gates only; still NO_GO for live")
    args=parser.parse_args()
    core=Path(__file__).resolve().parents[2]
    hub=args.hub_root.resolve()
    pr196=args.pr196_root.resolve()
    heads,errors=preflight(core,hub,pr196)
    result={
        "environment":ENVIRONMENT,
        "projectRef":PROJECT,
        "mode":"SOURCE_ONLY_ONE_PASS_QA",
        "buildSourceHeads":heads,
        "fullIsolatedSuite":not args.quick,
        "preflight": "PASS" if not errors else "FAIL",
        "preflightErrors":errors,
        "stages":[],
        "externalReleaseGatesNotYetProven":list(EXTERNAL_GATES),
        "liveReleaseDecision":"NO_GO_NEVER_AUTHORIZES",
        "credentialIssuancePermitted":False,
        "signingPermitted":False,
        "dispatchPermitted":False,
        "prodTouchedByThisRunner":False,
    }
    if not errors:
        environment=scrubbed_env(core,pr196)
        for name,folder,cmd in tests(core,hub,pr196,full=not args.quick):
            passed,elapsed,reason=run_checked(
                cmd,folder,timeout=240,env=environment
            )
            result["stages"].append({
                "name":name,"status":"PASS" if passed else "FAIL",
                "durationMs":elapsed,"result":reason,
            })
            print(name+": "+("PASS" if passed else "FAIL"),flush=True)
    successful=(not errors and bool(result["stages"])
       and all(s["status"]=="PASS" for s in result["stages"]))
    result["isolatedBuildDecision"]=(
       ("PASS_QUICK_SOURCE_ONLY" if args.quick else "PASS_ISOLATED_ONLY")
       if successful else "FAIL_ISOLATED_CANDIDATE"
    )
    # Final output is deliberately ALWAYS NO_GO for actual DEV operations.
    report=args.report.expanduser().resolve()
    report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(
        json.dumps(result,indent=2,sort_keys=True)+"\n",
        encoding="utf-8",
    )
    print("ISOLATED_BUILD="+result["isolatedBuildDecision"],flush=True)
    print("LIVE_RELEASE="+result["liveReleaseDecision"],flush=True)
    print("REPORT="+str(report),flush=True)
    return 0 if successful else 2


if __name__=="__main__":
    raise SystemExit(main())
