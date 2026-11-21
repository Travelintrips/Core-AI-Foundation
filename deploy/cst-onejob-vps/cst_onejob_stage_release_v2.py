#!/usr/bin/env python3
"""CST-DEV *source-only candidate* for one-Owner / per-stage signing.

An independently signed job authorization covers fixed Company-1 job and
8 pinned signer roles (NOT their unknown future payloads).  Actual payload
bytes must exist before each separate 5-minute Operations permit is signed.
This module ONLY verifies public signatures; it never signs, changes roles,
starts systemd, creates Owner approvals or connects to PostgreSQL.
"""
import datetime
import hashlib
import json
import pathlib
import re
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import install_approved_release_batch as legacy
import cst_onejob_vps_signer as signer

PROJECT=legacy.PROJECT
MANIFEST_SHA=legacy.MANIFEST_SHA
ROLES=legacy.ROLES
AUTH_DOMAIN=b"CST_DEV_ONEJOB_VPS_JOB_AUTHORIZATION_V2\n"
AUTH_SCHEMA="cst-onejob-vps-job-authorization/v2"
AUTH_KEYS=("schema","project","companyId","changeId","jobId","approvalId",
           "sourceSha","workerName","manifestSha256","issuedAt","expiresAt","roles")
# An independently approved public trust root must be pinned at a NEW
# reviewed source commit; neither root-owned JSON nor an env flag suffices.
APPROVED_OPERATIONS_ROOT_FINGERPRINT=None
AUTH_MAX_SECONDS=3600
PERMIT_MAX_SECONDS=300

# Nine technical signatures, one original Owner *business* consent.
# QA uses its same signer identity twice; the second permit is issued only
# once the first signed proof has been delivered and its nonce consumed.
STAGES={
 "qa-pre":("qa-evidence","QA_PRE_ADMISSION"),
 "subscriber-ack":("subscriber-ack","SUBSCRIBER_DELIVERY_ACK"),
 "qa-post":("qa-evidence","QA_POST_EXECUTION"),
 "core-reconciliation":("core-reconciliation","CORE_RECONCILIATION"),
 "agent-coding":("agent-coding","HUB_AGENT_CODING"),
 "agent-infrastructure":("agent-infrastructure","HUB_AGENT_INFRASTRUCTURE"),
 "agent-security":("agent-security","HUB_AGENT_SECURITY"),
 "agent-qa":("agent-qa","HUB_AGENT_QA"),
 "reviewer":("reviewer","HUB_REVIEWER_FINAL_ACK"),
}
class GateError(RuntimeError):
    pass
def require(ok,code):
    if not ok:raise GateError(code)
def exact(obj,keys):
    return type(obj) is dict and set(obj)==set(keys)
def canonical(payload):
    return AUTH_DOMAIN+json.dumps(payload,sort_keys=True,
       separators=(",",":"),ensure_ascii=False).encode()
def authority_digest(payload):
    return hashlib.sha256(canonical(payload)).hexdigest()
def public_fingerprint(key):
    return hashlib.sha256(key.public_bytes(
       serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
def now_timestamp():
    return datetime.datetime.now(datetime.timezone.utc).timestamp()
def time(value):
    require(type(value) is str and legacy.parse_dt(value)>=0,"INVALID_TIME")
    return legacy.parse_dt(value)
def signature(text):
    return legacy.decode_signature(text)
def verify_job_authorization(envelope,manifest,ops_key,now=None,
                             approved_root_fingerprint=None):
    """Only source test may pass synthetic expected fingerprint. Runtime pin is null."""
    now=now_timestamp() if now is None else now
    require(type(now) in (float,int),"INVALID_NOW")
    require(type(approved_root_fingerprint) is str and
       legacy.HEX64.fullmatch(approved_root_fingerprint),"INDEPENDENT_ROOT_PIN_MISSING")
    require(isinstance(ops_key,Ed25519PublicKey) and
       public_fingerprint(ops_key)==approved_root_fingerprint,"UNTRUSTED_OPERATIONS_ROOT")
    require(exact(envelope,("payload","signatureBase64")),"AUTH_ENVELOPE_INVALID")
    p=envelope["payload"]
    require(exact(p,AUTH_KEYS),"AUTH_FIELDS_INVALID")
    require(p["schema"]==AUTH_SCHEMA and p["project"]==PROJECT
       and p["companyId"]=="1" and type(p["jobId"]) is int
       and 482<p["jobId"]<2147483648
       and type(p["approvalId"]) is str and legacy.UUID.fullmatch(p["approvalId"])
       and type(p["changeId"]) is str and legacy.CHANGE.fullmatch(p["changeId"])
       and type(p["sourceSha"]) is str and legacy.HEX40.fullmatch(p["sourceSha"])
       and type(p["workerName"]) is str and legacy.WORKER.fullmatch(p["workerName"])
       and p["manifestSha256"]==MANIFEST_SHA,"AUTH_SCOPE_INVALID")
    begin,end=time(p["issuedAt"]),time(p["expiresAt"])
    require(begin<=now<end and 0<end-begin<=AUTH_MAX_SECONDS and
      now-begin<=AUTH_MAX_SECONDS,"AUTH_EXPIRED_OR_UNBOUNDED")
    require(exact(manifest,("project","environment","approvalStatus","roles")) or
       (type(manifest) is dict and
        {"project","environment","approvalStatus","roles"}.issubset(manifest)),
        "MANIFEST_SHAPE_INVALID")
    require(manifest["project"]==PROJECT and manifest["environment"]=="DEV"
      and manifest["approvalStatus"]=="CANDIDATE_NOT_RELEASED"
      and type(manifest["roles"]) is list and len(manifest["roles"])==len(ROLES),
      "MANIFEST_NOT_PINNED")
    pins={r["role"]:r for r in manifest["roles"]}
    require(set(pins)==set(ROLES),"MANIFEST_ROLE_SET_INVALID")
    require(exact(p["roles"],ROLES),"AUTH_ROLES_INVALID")
    for role,(signer_name,operator,purposes) in ROLES.items():
        row=pins[role]
        require(type(row) is dict and row.get("role")==role and
          row.get("osIdentity")==signer_name and row.get("activated") is False
          and row.get("trustedForRelease") is False
          and row.get("fingerprint")==p["roles"][role] and
          type(row.get("fingerprint")) is str and
          legacy.HEX64.fullmatch(row["fingerprint"]),"ROLE_FINGERPRINT_MISMATCH")
    try:ops_key.verify(signature(envelope["signatureBase64"]),canonical(p))
    except Exception:raise GateError("AUTH_SIGNATURE_INVALID")
    return p

def verify_stage_permit(envelope,permit,manifest,ops_key,stage,payload,
                        now=None,approved_root_fingerprint=None,uid_lookup=None):
    """Verify independent job authorization + real payload-specific signed permit.

    For synthetic tests, uid_lookup may be supplied. Real deployments must
    use host OS pwd.getpwnam and SO_PEERCRED (inside the existing signer).
    """
    now=now_timestamp() if now is None else now
    p=verify_job_authorization(envelope,manifest,ops_key,now,
      approved_root_fingerprint)
    require(stage in STAGES,"STAGE_NOT_ALLOWED")
    require(type(payload) is bytes and 0<len(payload)<=8192,"REAL_PAYLOAD_REQUIRED")
    role,purpose=STAGES[stage]
    require(exact(permit,("claims","signatureBase64")),"PERMIT_ENVELOPE_INVALID")
    c=permit["claims"]
    require(exact(c,legacy.CLAIMS),"PERMIT_FIELDS_INVALID")
    require(c["role"]==role and c["purpose"]==purpose and c["jobId"]==p["jobId"]
      and c["approvalId"]==p["approvalId"] and c["workerName"]==p["workerName"]
      and c["sourceSha"]==p["sourceSha"] and c["companyId"]==p["companyId"]
      and c["project"]==p["project"],"STAGE_NOT_BOUND_TO_APPROVED_JOB")
    start,end=time(c["issuedAt"]),time(c["expiresAt"])
    require(start>=time(p["issuedAt"]) and end<=time(p["expiresAt"])
      and start<=now<end and 0<end-start<=PERMIT_MAX_SECONDS,
      "STAGE_OUTSIDE_AUTH_WINDOW")
    assert_pin=p["roles"][role]
    require(c["publicKeyFingerprint"]==assert_pin,"SIGNER_PIN_MISMATCH")
    signer_name,operator,_=ROLES[role]
    if uid_lookup is None:
        import pwd
        uid_lookup=lambda s: pwd.getpwnam(s).pw_uid
    signer_uid=uid_lookup(signer_name)
    operator_uid=uid_lookup(operator)
    require(type(signer_uid) is int and type(operator_uid) is int
      and signer_uid>0 and operator_uid>0 and signer_uid!=operator_uid,
      "STAGE_OS_IDENTITY_UNSAFE")
    try:
        nonce=signer.validate_permit(permit,ops_key,assert_pin,role,
          signer_uid,operator_uid,payload,now)
    except Exception as e:
        raise GateError("STAGE_SIGNER_CONTRACT_DENIED") from e
    return {"changeId":p["changeId"],"jobId":p["jobId"],
      "approvalId":p["approvalId"],"role":role,"purpose":purpose,
      "stage":stage,"nonce":nonce,"payloadDigest":c["payloadSha256"],
      "authorizationDigest":authority_digest(p),
      "signerActivated":False,"ownerApprovalVerified":False,
      "finalAckVerified":False}

def previous_qa_consumed_marker(marker,old_permit):
    """Directory state check alone never proves independent QA E2E."""
    require(old_permit is not None and
      type(old_permit) is dict and type(old_permit.get("claims")) is dict
      and old_permit["claims"].get("purpose")=="QA_PRE_ADMISSION",
      "QA_PRE_PERMIT_REQUIRED_FOR_POST")
    require(type(marker) is bytes and marker==b"consumed\n",
      "QA_PRE_DURABLE_NONCE_CONSUMPTION_REQUIRED")
    return True
