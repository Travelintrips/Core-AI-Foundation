#!/usr/bin/env python3
"""Fail-closed VPS DEV deployment; PROD stays on its current image and database."""
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

REPO = "https://github.com/Travelintrips/Core-AI-Foundation.git"
SRC = Path("/opt/cst-vps-dev-release/source")
ENV = Path("/opt/core-ai-dev/.env.dev")
STATIC = Path("/var/www/dev-aicore")
DOMAIN = "dev-aicore.cstlogistic.co.id"
PROD = "ai-core-prod-api"
DEV = "core-ai-dev"
DEV_NETWORK = "ai-core-workers_control"
EXPECTED_DEV_PROJECT = "xssrfshdrtdfupgqwfdw"


def command(*args, output=False, cwd=None):
    p = subprocess.run([str(x) for x in args], cwd=cwd, check=True,
                       text=True, capture_output=output)
    return p.stdout.strip() if output else None


def inspect(name):
    return json.loads(command("docker", "inspect", name, output=True))[0]


def endpoint(port, path="/api/healthz", timeout=7):
    try:
        with urlopen("http://127.0.0.1:" + str(port) + path, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(4 * 1024 * 1024)
    except HTTPError as err:
        return err.code, dict(err.headers), err.read(4 * 1024 * 1024)
    except Exception:
        return 0, {}, b""


def check(port, sha):
    code, headers, data = endpoint(port)
    try:
        return code == 200 and headers.get("X-CST-Commit-SHA", "") == sha and json.loads(data).get("status") == "ok"
    except Exception:
        return False


def wait(port, sha):
    for i in range(45):
        if check(port, sha):
            return
        time.sleep(2)
    raise RuntimeError("DEV candidate failed exact-sha health check on port " + str(port))


def smoke(port):
    status, _, html = endpoint(port, "/")
    if status != 200 or b"<html" not in html.lower():
        raise RuntimeError("DEV frontend HTML is not available")
    status, _, _ = endpoint(port, "/api/dev-center/jobs")
    if status not in (401, 403):
        raise RuntimeError("DEV anonymous authorization boundary failed with status " + str(status))


def env_guard():
    if not ENV.is_file():
        raise RuntimeError("Dedicated DEV credentials missing")
    keys = {}
    for line in ENV.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip().strip('"').strip("'")
    if keys.get("SUPABASE_URL_DEV", "").rstrip("/") != "https://" + EXPECTED_DEV_PROJECT + ".supabase.co":
        raise RuntimeError("Unexpected DEV database project reference")
    for k in ("SUPABASE_DATABASE_URL_DEV", "SUPABASE_SERVICE_ROLE_KEY_DEV", "SESSION_SECRET"):
        if not keys.get(k):
            raise RuntimeError("DEV credential absent: " + k)
    if keys.get("SUPABASE_URL", "") or keys.get("SUPABASE_SERVICE_ROLE_KEY", ""):
        raise RuntimeError("Production-style Supabase variables present in DEV environment")


def start(name, port, image, sha):
    command("docker", "run", "-d", "--name", name,
            "--restart", "unless-stopped",
            "--network", DEV_NETWORK,
            "--publish", "127.0.0.1:" + str(port) + ":3000",
            "--memory", "1536m", "--memory-swap", "1536m",
            "--cpus", "0.8", "--pids-limit", "256",
            "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
            "--env-file", ENV,
            "-e", "APP_ENV=development", "-e", "NODE_ENV=development",
            "-e", "PORT=3000", "-e", "SERVE_STATIC_FRONTEND=true",
            "-e", "PUBLIC_APP_URL=https://" + DOMAIN,
            "-e", "ALLOWED_ORIGINS=https://" + DOMAIN,
            "-e", "AI_PRODUCTION_WORKERS_ALLOWED=false",
            "-e", "AI_DEV_SAFE_WORKERS_ENABLED=true",
            "-e", "AI_DISPATCHER_ENABLED=true",
            "-e", "AI_SCHEDULER_ENABLED=false",
            "-e", "AI_INCIDENT_WATCHER_ENABLED=false",
            "-e", "AI_PROVIDER_BILLING_MONITOR_ENABLED=false",
            "-e", "GCP_OLLAMA_AUTOSTART_ENABLED=false",
            "-e", "GCP_CODING_WORKER_AUTOSTART_ENABLED=false",
            "-e", "OLLAMA_WORKER_RUNTIME_ENABLED=false",
            "--label", "cst.dev.commit=" + sha, image)


def remove(name):
    subprocess.run(["docker", "rm", "-f", name], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def verify_https_local(sha):
    # Pin a local TLS connection to nginx without altering public DNS.
    header = tempfile.NamedTemporaryFile(delete=False)
    header.close()
    try:
        command("curl", "--fail", "--silent", "--show-error", "--max-time", "10",
                "--resolve", DOMAIN + ":443:127.0.0.1",
                "-D", header.name, "-o", "/dev/null",
                "https://" + DOMAIN + "/api/healthz")
        text = Path(header.name).read_text()
        match = re.search(r"(?im)^x-cst-commit-sha:\s*([0-9a-f]{40})\s*$", text)
        if not match or match.group(1) != sha:
            raise RuntimeError("Local nginx DEV exact-SHA verification failed")
        html = command("curl", "--fail", "--silent", "--show-error", "--max-time", "10",
                       "--resolve", DOMAIN + ":443:127.0.0.1",
                       "https://" + DOMAIN + "/", output=True)
        if "<html" not in html.lower():
            raise RuntimeError("Local nginx DEV frontend HTML not served")
        asset = re.search(r'/assets/[^" ]+\.js', html)
        if not asset:
            raise RuntimeError("Local nginx DEV frontend JS path missing")
        command("curl", "--fail", "--silent", "--show-error", "--max-time", "10",
                "--resolve", DOMAIN + ":443:127.0.0.1",
                "-o", "/dev/null", "https://" + DOMAIN + asset.group(0))
    finally:
        Path(header.name).unlink(missing_ok=True)


def main(sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Invalid immutable SHA")
    with open("/run/lock/cst-vps-dev-release.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env_guard()
        before_prod = inspect(PROD)
        before_task = inspect("ai-task-production")
        if not before_prod["State"]["Running"] or not check_prod():
            raise RuntimeError("PROD is not healthy before deployment")
        if not before_task["State"]["Running"]:
            raise RuntimeError("AI Task PROD is not running")
        command("docker", "inspect", DEV, output=True)
        upstream = command("git", "ls-remote", REPO, "refs/heads/develop", output=True).split()[0]
        if upstream != sha:
            raise RuntimeError("Requested SHA is not the latest develop HEAD")
        SRC.parent.mkdir(parents=True, exist_ok=True)
        if not (SRC / ".git").is_dir():
            command("git", "clone", "--depth", "1", "--branch", "develop", REPO, SRC)
        else:
            command("git", "-C", SRC, "fetch", "--depth", "1", "origin", "develop")
        command("git", "-C", SRC, "checkout", "-f", "--detach", sha)
        if command("git", "-C", SRC, "rev-parse", "HEAD", output=True) != sha:
            raise RuntimeError("Downloaded DEV source SHA mismatch")
        image = "core-ai-dev:vps-" + sha[:12]
        if subprocess.run(["docker", "image", "inspect", image],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
            command("docker", "buildx", "build", "--builder", "cst-dev-build-limited",
                    "--progress", "plain", "--load",
                    "--build-arg", "GITHUB_SHA=" + sha,
                    "-t", image, "-f", "deploy/hostinger-dev/Dockerfile", ".", cwd=SRC)
        embedded = command("docker", "run", "--rm", "--network", "none",
                           "--entrypoint", "cat", image, "/app/.cst-build-sha", output=True)
        if embedded != sha:
            raise RuntimeError("Image provenance SHA mismatch")
        canary = "cst-dev-canary-" + sha[:12]
        remove(canary)
        tempstatic = Path(tempfile.mkdtemp(prefix=".dev-aicore-next-", dir="/var/www"))
        rollback = None
        prevstatic = None
        complete = False
        try:
            start(canary, 18084, image, sha)
            wait(18084, sha)
            smoke(18084)
            command("docker", "cp", canary + ":/app/artifacts/api-server/dist/public/.", str(tempstatic) + "/")
            if not (tempstatic / "index.html").is_file() or not (tempstatic / "assets").is_dir():
                raise RuntimeError("Frontend artifacts missing from verified image")
            # tempfile.mkdtemp creates 0700 directories. Nginx serves this
            # directory as www-data, so make the vetted static tree readable.
            tempstatic.chmod(0o755)
            for entry in tempstatic.rglob("*"):
                if entry.is_dir():
                    entry.chmod(0o755)
                elif entry.is_file():
                    entry.chmod(0o644)
            rollback = "core-ai-dev-prev-" + time.strftime("%Y%m%d%H%M%S", time.gmtime())
            command("docker", "rename", DEV, rollback)
            command("docker", "stop", "--time", "15", rollback)
            start(DEV, 18082, image, sha)
            wait(18082, sha)
            smoke(18082)
            prevstatic = Path("/var/www/.dev-aicore-prev-" + time.strftime("%Y%m%d%H%M%S", time.gmtime()))
            STATIC.rename(prevstatic)
            tempstatic.rename(STATIC)
            verify_https_local(sha)
            if inspect(PROD)["Id"] != before_prod["Id"] or not check_prod():
                raise RuntimeError("PROD identity or health changed during DEV deploy")
            if inspect("ai-task-production")["Id"] != before_task["Id"]:
                raise RuntimeError("AI Task PROD identity changed")
            complete = True
            print("VPS_DEV_RELEASE=PASS sha=" + sha + " nginx_sha=PASS prod_unchanged=PASS")
        finally:
            remove(canary)
            if not complete and rollback:
                remove(DEV)
                if subprocess.run(["docker", "inspect", rollback],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                    command("docker", "rename", rollback, DEV)
                    command("docker", "start", DEV)
                if prevstatic and prevstatic.exists():
                    if STATIC.exists():
                        shutil.rmtree(STATIC)
                    prevstatic.rename(STATIC)
                print("VPS_DEV_RELEASE=ROLLED_BACK")
            if tempstatic.exists():
                shutil.rmtree(tempstatic)


def check_prod():
    status, _, data = endpoint(18088)
    try:
        return status == 200 and json.loads(data).get("status") == "ok"
    except Exception:
        return False


if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) == 2 else "")
    except Exception as exc:
        print("VPS_DEV_RELEASE=BLOCKED " + str(exc), file=sys.stderr)
        sys.exit(1)
