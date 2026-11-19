import sys,datetime,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from gpt02_passive_submit_rate_gate import evaluate_rows
now=datetime.datetime.fromisoformat("2026-11-13T13:00:00+00:00").timestamp()
base={"capturedAtUtc":"2026-11-13T12:59:30Z","eventPrefix":"0123456789abcdef","captureMode":"PASSIVE_SUBMIT_STREAM","responseStatus":429,"retryAfterSeconds":40}
cases=[
("NO_PASSIVE",[{"responseStatus":429,"capturedAtUtc":"2026-11-13T12:59:50Z","eventPrefix":"taskprobe"}],"PASSIVE_SUBMIT_RATE_GATE_CLEAR"),
("RETRY_ACTIVE",[base],"PASSIVE_PROVIDER_RETRY_AFTER_ACTIVE"),
("RETRY_AGED",[{**base,"capturedAtUtc":"2026-11-13T12:58:00Z"}],"PASSIVE_SUBMIT_RATE_GATE_CLEAR"),
("REPEAT",[base,{**base,"capturedAtUtc":"2026-11-13T12:59:20Z","eventPrefix":"fedcba9876543210"}],"PASSIVE_429_REPEAT_REMEDIATION_REQUIRED"),
("BAD_PREFIX",[{**base,"eventPrefix":"nothex"}],"PASSIVE_RATE_EVIDENCE_INVALID")]
for name,rows,expect in cases:
 r=evaluate_rows(rows,now)
 assert r["reason"]==expect,(name,r)
 print(name+"_PY_PASS")
