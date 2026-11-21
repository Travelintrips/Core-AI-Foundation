#!/usr/bin/env python3
"""CST-DEV authorized external release importer. Default read-only NO_GO.

Only a signed, immutable single-job batch from an independently controlled
Operations key may create public pins and one-use role permits. This tool never
generates or reads a private signing key, changes PostgreSQL, starts services,
or creates Owner approvals. Do not run --install until independently reviewed.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT=pathlib.Path("/etc/cst-onejob-dev")
STAGED=ROOT/"staged-public"/"manifest.json"
TRUST=ROOT/"operator-trust"/"release-public.pem"
INBOX=ROOT/"inbox"/"signed-release-batch.json"
APPROVED=ROOT/"approved-public"
RELEASES=ROOT/"authorized-releases"
SOURCE=pathlib.Path("/opt/cst-onejob-dev/bin/cst_onejob_vps_signer.py")
PROJECT="xssrfshdrtdfupgqwfdw"
HOST="srv1792369"
MANIFEST_SHA="c6fcd5a41e3ac64b10ce88d05385e7d7f2fbb0cee9ed7ab4a60bc723a01bc315"
SOURCE_SHA="cb24077b4ae31c1de24f365046a274d74e7249a3b05ab46dcb2d5880cef31702"
BATCH_DOMAIN=b"CST_DEV_ONEJOB_VPS_APPROVED_BATCH_V1\n"
HEX64=re.compile(r"^[a-f0-9]{64}$")
HEX40=re.compile(r"^[a-f0-9]{40}$")
UUID=re.compile(r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$")
CHANGE=re.compile(r"^CST-DEV-[A-Z0-9-]{6,50}$")
WORKER=re.compile(r"^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$")
ROLES={
"qa-evidence":("cst1j-sig-qa-evidence","cst1j-op-qa",("QA_PRE_ADMISSION","QA_POST_EXECUTION")),
"subscriber-ack":("cst1j-sig-subscriber","cst-onejob-subscriber",("SUBSCRIBER_DELIVERY_ACK",)),
"core-reconciliation":("cst1j-sig-core","cst1j-op-core",("CORE_RECONCILIATION",)),
"agent-coding":("cst1j-sig-coding","cst1j-op-coding",("HUB_AGENT_CODING",)),
"agent-infrastructure":("cst1j-sig-infra","cst1j-op-infra",("HUB_AGENT_INFRASTRUCTURE",)),
"agent-security":("cst1j-sig-security","cst1j-op-security",("HUB_AGENT_SECURITY",)),
"agent-qa":("cst1j-sig-agentqa","cst1j-op-agentqa",("HUB_AGENT_QA",)),
"reviewer":("cst1j-sig-reviewer","cst1j-op-reviewer",("HUB_REVIEWER_FINAL_ACK",))
}
CLAIMS=("v","project","companyId","role","purpose","jobId","sourceSha",
"approvalId","workerName","payloadSha256","nonce","operatorUid",
"signerUid","publicKeyFingerprint","issuedAt","expiresAt")
BATCH_FIELDS=("schema","project","companyId","changeId","jobId",
"approvalId","sourceSha","workerName","manifestSha256","issuedAt",
"expiresAt","permits")

class GateError(Exception):
 pass
def require(ok,code):
 if not ok:raise GateError(code)
def root_file(path,maximum=250000):
 path=pathlib.Path(path)
 require(path.is_absolute(),"NON_ABSOLUTE_ROOT_PATH")
 for parent in [pathlib.Path("/"),*list(reversed(path.parents[:-1]))]:
  st=os.lstat(parent)
  require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022
    and not stat.S_ISLNK(st.st_mode),"UNTRUSTED_PARENT_DIRECTORY")
 st=os.lstat(path)
 require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1
  and not st.st_mode&0o022 and 0<st.st_size<=maximum,"ROOT_FILE_METADATA_INVALID")
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  data=os.read(fd,maximum+1)
 finally:os.close(fd)
 require(len(data)<=maximum,"ROOT_FILE_TOO_LARGE")
 return data
def parse_dt(value):
 require(isinstance(value,str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",value),
    "INVALID_UTC_TIMESTAMP")
 dt=datetime.datetime.strptime(value,"%Y-%m-%dT%H:%M:%S.%fZ")
 return dt.replace(tzinfo=datetime.timezone.utc).timestamp()
def decode_signature(s):
 require(isinstance(s,str),"SIGNATURE_REQUIRED")
 try:b=base64.b64decode(s,validate=True)
 except Exception:raise GateError("SIGNATURE_BASE64_INVALID")
 require(len(b)==64 and base64.b64encode(b).decode()==s,"ED25519_SIGNATURE_LENGTH_INVALID")
 return b
def load_reviewer_key(data):
 key=serialization.load_pem_public_key(data)
 require(isinstance(key,Ed25519PublicKey),"OPERATIONS_ROOT_NOT_ED25519")
 return key
def canonical_batch(payload):
 return BATCH_DOMAIN+json.dumps(payload,sort_keys=True,
     separators=(",",":"),ensure_ascii=False).encode()
def canonical_permit(claims):
 return b"CST_DEV_ONEJOB_VPS_ONE_SIGNATURE_PERMIT_V1\n"+json.dumps(
     {k:claims[k] for k in CLAIMS},separators=(",",":"),ensure_ascii=False).encode()
def verify(root,signature,data):
 try:root.verify(decode_signature(signature),data)
 except Exception:raise GateError("INDEPENDENT_OPERATIONS_SIGNATURE_INVALID")

def verify_batch(batch,manifest,ops_key,now=None):
 if now is None:now=datetime.datetime.now(datetime.timezone.utc).timestamp()
 require(type(batch) is dict and set(batch)=={"payload","signatureBase64"},
         "SIGNED_BATCH_SHAPE_INVALID")
 p=batch["payload"]
 require(type(p) is dict and set(p)==set(BATCH_FIELDS),"BATCH_FIELDS_INVALID")
 require(p["schema"]=="cst-onejob-vps-approved-release-batch/v1"
   and p["project"]==PROJECT and p["companyId"]=="1"
   and isinstance(p["changeId"],str) and CHANGE.fullmatch(p["changeId"])
   and type(p["jobId"]) is int and p["jobId"]>482
   and isinstance(p["approvalId"],str) and UUID.fullmatch(p["approvalId"])
   and isinstance(p["sourceSha"],str) and HEX40.fullmatch(p["sourceSha"])
   and isinstance(p["workerName"],str) and WORKER.fullmatch(p["workerName"])
   and p["manifestSha256"]==MANIFEST_SHA,"BATCH_SCOPE_INVALID")
 start,end=parse_dt(p["issuedAt"]),parse_dt(p["expiresAt"])
 require(start<=now<end and 0<end-start<=300 and now-start<=300,
         "BATCH_TIME_INVALID_OR_EXPIRED")
 require(type(p["permits"]) is dict and set(p["permits"])==set(ROLES),
         "EIGHT_DISTINCT_PERMITS_REQUIRED")
 require(manifest["project"]==PROJECT and manifest["environment"]=="DEV"
   and manifest["approvalStatus"]=="CANDIDATE_NOT_RELEASED"
   and len(manifest["roles"])==8,"PUBLIC_CANDIDATE_MANIFEST_UNAPPROVED")
 public={r["role"]:r for r in manifest["roles"]}
 require(set(public)==set(ROLES),"PUBLIC_ROLE_SET_INVALID")
 verify(ops_key,batch["signatureBase64"],canonical_batch(p))
 nonces=set()
 for role,permit in p["permits"].items():
  require(type(permit) is dict and set(permit)=={"claims","signatureBase64"},
          "PERMIT_ENVELOPE_INVALID")
  c=permit["claims"]
  require(type(c) is dict and set(c)==set(CLAIMS),
          "PERMIT_CLAIMS_INVALID")
  signer,operator,allowed=ROLES[role]
  pub=public[role]
  require(pub["role"]==role and pub["osIdentity"]==signer
    and pub["activated"] is False and pub["trustedForRelease"] is False,
    "UNAPPROVED_PUBLIC_PIN_CUSTODY")
  require(c["v"]==1 and c["project"]==PROJECT and c["companyId"]=="1"
    and c["role"]==role and c["purpose"] in allowed
    and c["jobId"]==p["jobId"] and c["approvalId"]==p["approvalId"]
    and c["sourceSha"]==p["sourceSha"] and c["workerName"]==p["workerName"]
    and c["publicKeyFingerprint"]==pub["fingerprint"]
    and c["issuedAt"]==p["issuedAt"] and c["expiresAt"]==p["expiresAt"]
    and isinstance(c["payloadSha256"],str) and HEX64.fullmatch(c["payloadSha256"])
    and isinstance(c["nonce"],str) and HEX64.fullmatch(c["nonce"])
    and type(c["signerUid"]) is int and
      c["signerUid"]==pwd.getpwnam(signer).pw_uid
    and type(c["operatorUid"]) is int and
      c["operatorUid"]==pwd.getpwnam(operator).pw_uid
    and c["signerUid"]!=c["operatorUid"],"PERMIT_BOUNDARY_MISMATCH")
  require(c["nonce"] not in nonces,"DUPLICATE_NONCE_ACROSS_ROLES")
  nonces.add(c["nonce"])
  verify(ops_key,permit["signatureBase64"],canonical_permit(c))
 return p

def runtime_safe():
 require(os.geteuid()==0 and os.uname().nodename.split(".")[0]==HOST,
         "ROOT_ON_AUTHORIZED_VPS_REQUIRED")
 require(hashlib.sha256(root_file(SOURCE,50000)).hexdigest()==SOURCE_SHA,
         "SOURCE_SHA_NOT_PINNED")
 manifest=json.loads(root_file(STAGED))
 require(hashlib.sha256(root_file(STAGED)).hexdigest()==MANIFEST_SHA,
         "STAGED_PUBLIC_MANIFEST_HASH_MISMATCH")
 require(not APPROVED.exists() and not APPROVED.is_symlink()
   and not RELEASES.exists() and not RELEASES.is_symlink(),
   "RELEASE_FILES_ALREADY_INSTALLED_OR_UNSAFE")
 for role in ROLES:
  unit="cst-onejob-signer-"+role+".service"
  proc=subprocess.run(["systemctl","is-active",unit],text=True,capture_output=True)
  require(proc.stdout.strip()=="inactive","SIGNER_ALREADY_RUNNING")
 return manifest
def write_new(path,obj):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 try:
  os.write(fd,json.dumps(obj,sort_keys=True,indent=2).encode()+b"\n")
  os.fsync(fd)
 finally:os.close(fd)
 os.chown(path,0,0)
 os.chmod(path,0o644)

def install(batch,manifest,ops_key):
 p=verify_batch(batch,manifest,ops_key)
 pending=tempfile.mkdtemp(prefix=".cst-onejob-approved-",dir=str(ROOT))
 os.chmod(pending,0o700)
 base=pathlib.Path(pending)
 signed=base/"authorized-releases"
 pins=base/"approved-public"
 signed.mkdir(mode=0o700)
 pins.mkdir(mode=0o700)
 moved=[]
 try:
  inventory={r["role"]:r for r in manifest["roles"]}
  for role,permit in p["permits"].items():
   row=inventory[role]
   write_new(pins/(role+".json"),{
     "project":PROJECT,"role":role,
     "publicKeyPem":row["publicKeyPem"],
     "fingerprint":row["fingerprint"],
     "approvedChangeId":p["changeId"]
   })
   write_new(signed/(role+".json"),permit)
  os.chmod(pins,0o755)
  os.chmod(signed,0o755)
  for src,dst in ((pins,APPROVED),(signed,RELEASES)):
   require(not dst.exists() and not dst.is_symlink(),"RELEASE_INSTALL_CONFLICT")
   os.rename(src,dst);moved.append(dst)
  print("SIGNED_DEV_RELEASE_BUNDLE=INSTALLED_PUBLIC_AND_SIGNED_ONLY")
  print("BATCH_BINDING=EIGHT_ROLES_SINGLE_JOB_SINGLE_CHANGE")
  print("JOB_ID="+str(p["jobId"]))
  print("SIGNER_SERVICE_ACTIVATED=FALSE")
  print("DATABASE_OR_PROD_CHANGED=FALSE")
  print("RELEASE_DECISION=NO_GO_PENDING_AUTHORITATIVE_OWNER_DB_CHECK_AND_REVIEW")
 except Exception:
  for path in reversed(moved):shutil.rmtree(path,ignore_errors=True)
  raise
 finally:shutil.rmtree(pending,ignore_errors=True)

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--read-only",action="store_true")
 ap.add_argument("--install-after-signed-approval",action="store_true")
 arg=ap.parse_args()
 if arg.read_only == arg.install_after_signed_approval:
  raise GateError("CHOOSE_ONE_EXPLICIT_MODE")
 # V1 requires future subscriber/POST/Final-ACK payload hashes up front,
 # which are unknowable before the previous stages finish. Never install
 # this obsolete all-at-once variant; retain verification for regression QA.
 if arg.install_after_signed_approval:
  raise GateError("V1_FUTURE_PAYLOAD_BATCH_DEPRECATED_USE_STAGE_V2")
 manifest=runtime_safe()
 if not TRUST.is_file() or not INBOX.is_file():
  print(json.dumps({"project":PROJECT,"status":"AWAITING_INDEPENDENT_SIGNED_RELEASE",
    "roleCount":len(ROLES),"publicRootReady":TRUST.is_file(),
    "signedBatchReady":INBOX.is_file(),
    "releaseDecision":"NO_GO","signaturesIssued":0}))
  return 0 if arg.read_only else 2
 root=load_reviewer_key(root_file(TRUST,8192))
 batch=json.loads(root_file(INBOX,200000))
 result=verify_batch(batch,manifest,root)
 if arg.read_only:
  print(json.dumps({"project":PROJECT,
    "status":"INDEPENDENT_SIGNATURE_VERIFIED_NOT_INSTALLED",
    "jobId":result["jobId"],"roleCount":8,"releaseDecision":"NO_GO",
    "ownerReadbackVerified":False,"signaturesIssued":0}))
 else:install(batch,manifest,root)
 return 0
if __name__=="__main__":
 try:sys.exit(main())
 except (GateError,ValueError,OSError,KeyError) as exc:
  print("CST_DEV_EXTERNAL_RELEASE_IMPORT=DENIED:"+type(exc).__name__,file=sys.stderr)
  sys.exit(3)
