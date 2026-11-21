#!/usr/bin/env python3
"""Install dormant CST-DEV VPS signer units from pinned source, no activation.

No key generation, decryption, service start, systemd enable, DB mutation,
release approval or PROD access. Requires 8 existing encrypted role credentials.
"""
import json
import os
import pathlib
import pwd
import shutil
import stat
import subprocess
import sys

PROJECT = "xssrfshdrtdfupgqwfdw"
HOST = "srv1792369"
MANIFEST = pathlib.Path("/etc/cst-onejob-dev/staged-public/manifest.json")
RUNTIME = pathlib.Path("/opt/cst-onejob-dev/bin/cst_onejob_vps_signer.py")
ROLES = {
    "qa-evidence": ("cst1j-sig-qa-evidence", "cst1j-op-qa", "cst-onejob-qa"),
    "subscriber-ack": ("cst1j-sig-subscriber", "cst-onejob-subscriber", "cst-onejob-subscriber"),
    "core-reconciliation": ("cst1j-sig-core", "cst1j-op-core", "cst-onejob-core-reconciliation"),
    "agent-coding": ("cst1j-sig-coding", "cst1j-op-coding", "cst-onejob-hub-agent-coding"),
    "agent-infrastructure": ("cst1j-sig-infra", "cst1j-op-infra", "cst-onejob-hub-agent-infrastructure"),
    "agent-security": ("cst1j-sig-security", "cst1j-op-security", "cst-onejob-hub-agent-security"),
    "agent-qa": ("cst1j-sig-agentqa", "cst1j-op-agentqa", "cst-onejob-hub-agent-qa"),
    "reviewer": ("cst1j-sig-reviewer", "cst1j-op-reviewer", "cst-onejob-hub-reviewer"),
}
UNIT_ROOT = pathlib.Path("/etc/systemd/system")

def run(*cmd):
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

def unit_content(role, identity, operator, runtime):
    service=f"cst-onejob-signer-{role}"
    return f"""# CST-DEV signed permit + systemd encrypted credential, default DENY.
# This unit MUST NOT be enabled, started, or given approved roots until reviewed.
[Unit]
Description=CST-DEV OneJob dormant Ed25519 signer ({role})
ConditionPathExists=/etc/cst-onejob-dev/operator-trust/release-public.pem
ConditionPathExists=/etc/cst-onejob-dev/approved-public/{role}.json
ConditionPathExists=/etc/cst-onejob-dev/authorized-releases/{role}.json
ConditionPathExists=/etc/credstore.encrypted/cst-onejob-{role}-private-key.pkcs8

[Service]
Type=simple
User={identity}
Group={operator}
WorkingDirectory=/opt/cst-onejob-dev
Environment=CST_ONEJOB_LINUX_SIGNING_ENABLED=false
ExecStart=/usr/bin/python3 /opt/cst-onejob-dev/bin/cst_onejob_vps_signer.py --role {role} --socket /run/{runtime}/sign.sock
LoadCredentialEncrypted=private-key.pkcs8:/etc/credstore.encrypted/cst-onejob-{role}-private-key.pkcs8
RuntimeDirectory={runtime}
RuntimeDirectoryMode=0750
StateDirectory={service}
StateDirectoryMode=0700
UMask=0077
NoNewPrivileges=yes
PrivateNetwork=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectKernelLogs=yes
ProtectProc=invisible
ProcSubset=pid
RestrictAddressFamilies=AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
Restart=no
"""

def main():
    if os.geteuid()!=0 or os.uname().nodename.split(".")[0]!=HOST:
        raise RuntimeError("WRONG_HOST_OR_UID")
    if not RUNTIME.is_file() or RUNTIME.is_symlink() or RUNTIME.stat().st_uid!=0 or (RUNTIME.stat().st_mode & 0o022):
        raise RuntimeError("RUNTIME_NOT_ROOT_OWNED")
    data=json.loads(MANIFEST.read_text())
    if data.get("project")!=PROJECT or data.get("approvalStatus")!="CANDIDATE_NOT_RELEASED":
        raise RuntimeError("MANIFEST_NOT_STAGED_CST_DEV")
    available={x["role"]:x for x in data["roles"]}
    if set(available)!=set(ROLES):
        raise RuntimeError("WRONG_SIGNER_ROLE_SET")
    for role,(signer,operator,dir_name) in ROLES.items():
        if pwd.getpwnam(signer).pw_shell!="/usr/sbin/nologin":
            raise RuntimeError("EXISTING_SIGNER_NOT_LOCKED")
        ciphertext=pathlib.Path("/etc/credstore.encrypted")/f"cst-onejob-{role}-private-key.pkcs8"
        st=ciphertext.stat()
        if ciphertext.is_symlink() or not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600:
            raise RuntimeError("ENCRYPTED_CREDENTIAL_PERMISSION_INVALID")
        if available[role]["osIdentity"]!=signer or available[role].get("trustedForRelease")!=False:
            raise RuntimeError("STAGING_CUSTODY_NOT_DEFAULT_DENY")
        unit=UNIT_ROOT/f"cst-onejob-signer-{role}.service"
        if unit.exists() or unit.is_symlink():
            raise RuntimeError("NO_OVERWRITE_OF_EXISTING_UNIT")
        if operator!= "cst-onejob-subscriber":
            try:pwd.getpwnam(operator)
            except KeyError:pass
            else:raise RuntimeError("OPERATOR_ACCOUNT_COLLISION")
        else:
            if pwd.getpwnam(operator).pw_shell!="/usr/sbin/nologin":
                raise RuntimeError("EXISTING_SUBSCRIBER_OPERATOR_NOT_LOCKED")
    created_accounts=[]
    created_units=[]
    try:
        for role,(_,operator,_) in ROLES.items():
            if operator=="cst-onejob-subscriber":
                continue
            run("/usr/sbin/useradd","--system","--user-group","--no-create-home",
                "--home-dir","/nonexistent","--shell","/usr/sbin/nologin",operator)
            created_accounts.append(operator)
            run("/usr/bin/passwd","--lock",operator)
        for role,(signer,operator,rundir) in ROLES.items():
            unit=UNIT_ROOT/f"cst-onejob-signer-{role}.service"
            flags=os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW
            fd=os.open(str(unit),flags,0o644)
            created_units.append(unit)
            try:
                os.write(fd,unit_content(role,signer,operator,rundir).encode())
                os.fsync(fd)
            finally:os.close(fd)
            os.chown(unit,0,0)
            os.chmod(unit,0o644)
        run("systemctl","daemon-reload")
        for unit in created_units:
            check=subprocess.run(["systemctl","is-enabled",unit.name],capture_output=True,text=True)
            if check.stdout.strip() not in ("static","disabled"):
                raise RuntimeError("SERVICE_WAS_ENABLED")
            active=subprocess.run(["systemctl","is-active",unit.name],capture_output=True,text=True)
            if active.stdout.strip()!="inactive":
                raise RuntimeError("SERVICE_WAS_ACTIVATED")
        print("VPS_SIGNER_UNITS_INSTALLED_DORMANT=8")
        print("NEW_LOCKED_OPERATOR_IDENTITIES=7")
        print("EXISTING_SUBSCRIBER_OPERATOR_REUSED=TRUE")
        print("SERVICE_ENABLED=FALSE")
        print("SERVICE_STARTED=FALSE")
        print("NO_NEW_APPROVED_RELEASE_OR_SIGNING_ROOT=TRUE")
        print("NO_DB_OR_PROD_CHANGE=TRUE")
        print("RELEASE_DECISION=NO_GO")
    except Exception:
        for path in created_units:
            try:path.unlink()
            except OSError:pass
        for account in reversed(created_accounts):
            subprocess.run(["/usr/sbin/userdel",account],capture_output=True)
        subprocess.run(["systemctl","daemon-reload"],capture_output=True)
        raise

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("CST_DEV_DORMANT_UNIT_INSTALL_DENIED:"+type(exc).__name__,file=sys.stderr)
        sys.exit(3)
