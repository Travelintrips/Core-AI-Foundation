"""DEV-only rate gate for PASSIVE_SUBMIT_STREAM captures."""
import datetime,json,math
from pathlib import Path
DAY=86400;HOUR=3600
def evaluate_rows(rows,now):
    deny=lambda reason:{"allowed":False,"reason":reason,"scope":"GPT02_PASSIVE_SUBMIT_RATE_GATE"}
    if not isinstance(rows,list) or not math.isfinite(now):return deny("PASSIVE_RATE_INPUT_INVALID")
    incidents=[]
    for row in rows:
        if not isinstance(row,dict) or isinstance(row.get("responseStatus"),bool) or not isinstance(row.get("responseStatus"),int) or not 100<=row["responseStatus"]<=599:
            return deny("PASSIVE_RATE_LOG_MALFORMED")
        if row.get("captureMode")!="PASSIVE_SUBMIT_STREAM":continue
        prefix=row.get("eventPrefix");stamp=row.get("capturedAtUtc")
        if not isinstance(prefix,str) or len(prefix)!=16 or any(c not in "0123456789abcdef" for c in prefix) or not isinstance(stamp,str):
            return deny("PASSIVE_RATE_EVIDENCE_INVALID")
        try:t=datetime.datetime.fromisoformat(stamp.replace("Z","+00:00")).timestamp()
        except (ValueError,TypeError):return deny("PASSIVE_RATE_TIMESTAMP_INVALID")
        if t>now:return deny("PASSIVE_RATE_TIMESTAMP_INVALID")
        if row["responseStatus"]!=429:continue
        if row.get("retryAfterInvalid") is True:return deny("PASSIVE_RETRY_AFTER_INVALID")
        retry=0
        if "retryAfterSeconds" in row:
            r=row["retryAfterSeconds"]
            if isinstance(r,bool) or not isinstance(r,int) or not 0<=r<=86400:return deny("PASSIVE_RETRY_AFTER_INVALID")
            retry=t+r
        if "retryAfterUtc" in row:
            try:u=datetime.datetime.fromisoformat(row["retryAfterUtc"].replace("Z","+00:00")).timestamp()
            except (ValueError,TypeError,AttributeError):return deny("PASSIVE_RETRY_AFTER_INVALID")
            if u<t:return deny("PASSIVE_RETRY_AFTER_INVALID")
            retry=max(retry,u)
        incidents.append((t,retry,min(t+HOUR,retry+5) if retry>t else t+HOUR))
    recent=[x for x in incidents if now-x[0]<DAY]
    if len({x[0] for x in recent})!=len(recent):return deny("PASSIVE_429_IDENTITY_AMBIGUOUS")
    if len(recent)>=2:return deny("PASSIVE_429_REPEAT_REMEDIATION_REQUIRED")
    if any(now<x[1] for x in recent):return deny("PASSIVE_PROVIDER_RETRY_AFTER_ACTIVE")
    if any(now<x[2] for x in recent):return deny("PASSIVE_429_COOLDOWN")
    return {"allowed":True,"reason":"PASSIVE_SUBMIT_RATE_GATE_CLEAR","scope":"GPT02_PASSIVE_SUBMIT_RATE_GATE","passive429Last24h":len(recent)}
def evaluate_files(root,now):
    try:
        p=Path(root)/"native-response-metadata.jsonl"
        if not p.is_file() or p.stat().st_size>4_000_000:return {"allowed":False,"reason":"PASSIVE_RATE_LOG_UNAVAILABLE","scope":"GPT02_PASSIVE_SUBMIT_RATE_GATE"}
        rows=[]
        for line in p.read_text(encoding="utf-8").rstrip().splitlines():
            obj=json.loads(line)
            if not isinstance(obj,dict):raise ValueError
            rows.append(obj)
        return evaluate_rows(rows,now)
    except (OSError,ValueError,TypeError):
        return {"allowed":False,"reason":"PASSIVE_RATE_LOG_UNVERIFIED","scope":"GPT02_PASSIVE_SUBMIT_RATE_GATE"}
