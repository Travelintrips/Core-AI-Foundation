#!/usr/bin/env python3
"""CST-DEV source-only candidate for signed one-job / stage-by-stage permits.

Host paths are fixed; no remote URL, caller-selected identity or private key.
CLI remains fail-closed until an independently approved root fingerprint is
pinned in source. Never activates any signer, DB LOGIN, worker or PROD.
"""
import argparse
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile

import install_approved_release_batch as legacy
import cst_onejob_stage_release_v2 as v2
from cryptography.hazmat.primitives import serialization

ROOT=legacy.ROOT
TRUST=legacy.TRUST
STAGED=legacy.STAGED
SOURCE=legacy.SOURCE
INBOX=ROOT/"inbox"/"signed-job-authorization-v2.json"
APPROVED_CHANGE=ROOT/"approved-change"
APPROVED_PUBLIC=ROOT/"approved-public"
ROLE_PERMITS=ROOT/"authorized-releases"
STAGE_LEDGER=ROOT/"stage-permit-ledger"
STAGE_INBOX=ROOT/"inbox"/"stages"
PAYLOAD_INBOX=ROOT/"inbox"/"payloads"
STATE=pathlib.Path("/var/lib/cst-onejob-signer-qa-evidence")
HOST="srv1792369"
def require(ok,code):
    if not ok:raise v2.GateError(code)
def safe_dir(path,owner=0,perm=0o022):
    st=os.lstat(path)
    require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)
      and st.st_uid==owner and not st.st_mode&perm,"UNSAFE_DIRECTORY")
def verify_host():
    require(os.geteuid()==0 and os.uname().nodename.split(".")[0]==HOST,
      "AUTHORIZED_ROOT_HOST_REQUIRED")
    require(hashlib.sha256(legacy.root_file(SOURCE,50000)).hexdigest()
       ==legacy.SOURCE_SHA,"DEPLOYED_SIGNER_SOURCE_SHA_NOT_PINNED")
    safe_dir(ROOT)
    manifest_bytes=legacy.root_file(STAGED)
    require(hashlib.sha256(manifest_bytes).hexdigest()==v2.MANIFEST_SHA,
      "MANIFEST_BYTES_NOT_PINNED")
    return json.loads(manifest_bytes)
def root_trust():
    require(type(v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT) is str and
      legacy.HEX64.fullmatch(v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT),
      "OPERATIONS_ROOT_UNAPPROVED_SOURCE_PIN_NULL")
    return legacy.load_reviewer_key(legacy.root_file(TRUST,8192))
def verified_authorization_file(path,manifest,root):
    doc=json.loads(legacy.root_file(path,200000))
    return doc,v2.verify_job_authorization(doc,manifest,root,
      approved_root_fingerprint=v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT)
def fsync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def private_write_new(path,data,mode=0o644):
    parent=path.parent
    safe_dir(parent)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        data=data if type(data) is bytes else (json.dumps(
          data,sort_keys=True,separators=(",",":"))+"\n").encode()
        require(0<len(data)<=200000,"INVALID_RELEASE_FILE")
        require(os.write(fd,data)==len(data),"SHORT_WRITE")
        os.fsync(fd)
    finally:os.close(fd)
    os.chown(path,0,0)
    os.chmod(path,mode)
    fsync_dir(parent)
def prepare_job(manifest,root):
    doc,p=verified_authorization_file(INBOX,manifest,root)
    require(not APPROVED_CHANGE.exists() and not APPROVED_CHANGE.is_symlink()
       and not APPROVED_PUBLIC.exists() and not APPROVED_PUBLIC.is_symlink()
       and not ROLE_PERMITS.exists() and not ROLE_PERMITS.is_symlink()
       and not STAGE_LEDGER.exists() and not STAGE_LEDGER.is_symlink(),
       "JOB_RELEASE_ALREADY_INSTALLED")
    for role in legacy.ROLES:
        unit="cst-onejob-signer-"+role+".service"
        run=subprocess.run(["systemctl","is-active",unit],
           capture_output=True,text=True,timeout=3)
        require(run.stdout.strip()=="inactive","SIGNER_MUST_REMAIN_INACTIVE")
    return doc,p
def install_job(manifest,root):
    doc,p=prepare_job(manifest,root)
    pending=pathlib.Path(tempfile.mkdtemp(prefix=".cst-onejob-v2-",dir=str(ROOT)))
    pending.chmod(0o700)
    moved=[]
    try:
        pins=pending/"approved-public"
        approved=pending/"approved-change"
        roles={r["role"]:r for r in manifest["roles"]}
        for item in (pins,approved):item.mkdir(mode=0o700)
        for role in legacy.ROLES:
            row=roles[role]
            private_write_new(pins/(role+".json"),{
              "project":v2.PROJECT,"role":role,
              "publicKeyPem":row["publicKeyPem"],
              "fingerprint":row["fingerprint"],
              "approvedChangeId":p["changeId"]})
        private_write_new(approved/"job-authorization-v2.json",doc)
        for path in (pins,approved):path.chmod(0o755)
        for src,dst in ((pins,APPROVED_PUBLIC),(approved,APPROVED_CHANGE)):
            require(not dst.exists() and not dst.is_symlink(),
              "JOB_RELEASE_ATOMIC_INSTALL_CONFLICT")
            os.rename(src,dst);moved.append(dst)
            fsync_dir(ROOT)
        # No authorized-releases/role.json is generated here.
        # Stage permit can only follow actual payload bytes + new signature.
        return {"status":"AUTHORIZED_JOB_METADATA_ONLY",
          "changeId":p["changeId"],"jobId":p["jobId"],
          "stagePermitsInstalled":0,"signerActivated":False,
          "databaseOrProdChanged":False,"releaseDecision":"NO_GO"}
    except Exception:
        for path in reversed(moved):shutil.rmtree(path,ignore_errors=True)
        raise
    finally:shutil.rmtree(pending,ignore_errors=True)
def check_prior_qa_consumed(existing,prior_marker,job_id):
    require(type(existing) is dict and "claims" in existing,
      "QA_PREVIOUS_PERMIT_MISSING")
    c=existing["claims"]
    require(c.get("purpose")=="QA_PRE_ADMISSION"
       and c.get("jobId")==job_id and type(c.get("nonce")) is str
       and legacy.HEX64.fullmatch(c["nonce"]),"QA_PRE_MISMATCH")
    # This is the actual per-signer persistent nonce ledger.
    # It proves one prior signature was used; not the correctness of QA.
    safe_dir(STATE,pwd.getpwnam(legacy.ROLES["qa-evidence"][0]).pw_uid,0o077)
    marker=STATE/(c["nonce"]+".used")
    st=os.lstat(marker)
    require(stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode)
      and st.st_uid==pwd.getpwnam(legacy.ROLES["qa-evidence"][0]).pw_uid
      and stat.S_IMODE(st.st_mode)==0o600,"QA_PRE_NONCE_MARKER_UNSAFE")
    fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        blob=os.read(fd,64)
    finally:os.close(fd)
    v2.previous_qa_consumed_marker(blob,existing)
    require(prior_marker.get("nonce")==c["nonce"] and
      prior_marker.get("stage")=="qa-pre","QA_PRE_STAGE_LEDGER_MISSING")
def atomic_stage_write(dest,permit):
    safe_dir(dest.parent)
    blob=(json.dumps(permit,sort_keys=True,separators=(",",":"))+"\n").encode()
    require(len(blob)<=8192,"PERMIT_FILE_TOO_LARGE")
    temp=dest.parent/(".staged-release-v2-"+str(os.getpid()))
    private_write_new(temp,blob)
    try:
        if dest.exists() or dest.is_symlink():
            st=os.lstat(dest)
            require(stat.S_ISREG(st.st_mode) and st.st_uid==0
              and st.st_nlink==1 and not st.st_mode&0o022,
              "EXISTING_RELEASE_FILE_UNSAFE")
        os.replace(temp,dest)
        fsync_dir(dest.parent)
    finally:
        if temp.exists():temp.unlink()
def install_stage(stage,manifest,root):
    require(stage in v2.STAGES,"UNRECOGNIZED_STAGE")
    require(APPROVED_CHANGE.is_dir() and APPROVED_PUBLIC.is_dir(),
       "APPROVED_JOB_METADATA_REQUIRED")
    doc,p=verified_authorization_file(
       APPROVED_CHANGE/"job-authorization-v2.json",manifest,root)
    role,purpose=v2.STAGES[stage]
    permit=json.loads(legacy.root_file(STAGE_INBOX/(stage+".json"),8192))
    payload=legacy.root_file(PAYLOAD_INBOX/(stage+".bin"),8192)
    result=v2.verify_stage_permit(doc,permit,manifest,root,stage,payload,
       approved_root_fingerprint=v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT)
    # Root-owned ledger allows just ONE issued permit per stage.
    if STAGE_LEDGER.exists():safe_dir(STAGE_LEDGER)
    else:STAGE_LEDGER.mkdir(mode=0o700)
    marker=STAGE_LEDGER/(stage+".json")
    require(not marker.exists() and not marker.is_symlink(),
      "STAGE_PERMIT_ALREADY_INSTALLED")
    if ROLE_PERMITS.exists():safe_dir(ROLE_PERMITS)
    else:ROLE_PERMITS.mkdir(mode=0o755)
    dest=ROLE_PERMITS/(role+".json")
    if dest.exists() or dest.is_symlink():
        require(stage=="qa-post" and role=="qa-evidence",
          "ROLE_PERMIT_CANNOT_BE_REPLACED")
        old=json.loads(legacy.root_file(dest,8192))
        prior=json.loads(legacy.root_file(STAGE_LEDGER/"qa-pre.json",8192))
        check_prior_qa_consumed(old,prior,p["jobId"])
    # Marker FIRST: if release replace fails, attempt is denied until
    # independent manual recovery. No false successful signing on crash.
    private_write_new(marker,{"stage":stage,"role":role,
      "changeId":result["changeId"],"jobId":p["jobId"],
      "nonce":result["nonce"],"payloadDigest":result["payloadDigest"]},
      mode=0o600)
    atomic_stage_write(dest,permit)
    return {"status":"ONE_STAGE_PERMIT_INSTALLED",
      "stage":stage,"role":role,"jobId":p["jobId"],
      "signerActivated":False,"databaseOrProdChanged":False,
      "releaseDecision":"NO_GO"}
def main():
    a=argparse.ArgumentParser()
    modes=a.add_mutually_exclusive_group(required=True)
    modes.add_argument("--read-only",action="store_true")
    modes.add_argument("--install-approved-job",action="store_true")
    modes.add_argument("--install-stage",choices=v2.STAGES)
    args=a.parse_args()
    manifest=verify_host()
    if args.read_only:
        return {"status":"AWAITING_INDEPENDENT_AUTHORITY",
          "rootPinned":bool(v2.APPROVED_OPERATIONS_ROOT_FINGERPRINT),
          "ownerApproved":False,"stagePermitsIssued":0,"releaseDecision":"NO_GO"}
    root=root_trust()
    if args.install_approved_job:return install_job(manifest,root)
    return install_stage(args.install_stage,manifest,root)
if __name__=="__main__":
    try:
        result=main()
        print(json.dumps(result,sort_keys=True))
    except Exception:
        # Do not log signed payloads, credentials or trust root bytes.
        print("CST_DEV_STAGE_RELEASE_V2_DENIED",file=sys.stderr)
        sys.exit(3)
