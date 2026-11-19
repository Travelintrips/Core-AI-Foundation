"""Pure DEV validator for a passively observed ChatGPT submit request/stream response.
No browser/network/key/log operations. Unknown schemas fail closed.
"""
import hashlib,json,math,re
from datetime import datetime,timezone
from urllib.parse import urlsplit
UUID=re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}",re.I)
DIGEST=re.compile(r"[0-9a-f]{64}")
STOP=re.compile(r'\bbutton\s+"Stop(?: generating)?"',re.I)
class SubmitStreamError(ValueError):pass
def req(c,code):
    if not c: raise SubmitStreamError(code)
def unique(pairs):
    d={}
    for k,v in pairs:
        req(k not in d,"SUBMIT_JSON_DUPLICATE_KEY");d[k]=v
    return d
def parse_json(s,code):
    try:return json.loads(s,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(SubmitStreamError(code)))
    except SubmitStreamError:raise
    except (ValueError,RecursionError):raise SubmitStreamError(code) from None
def ts(v):
    req(type(v) in (int,float) and math.isfinite(v) and 0<=v<253402300800,"SUBMIT_TIMESTAMP_INVALID");return v
def text_of(m):
    c=m.get("content") if type(m) is dict else None
    p=c.get("parts") if type(c) is dict and c.get("content_type")=="text" else None
    return p[0] if isinstance(p,list) and len(p)==1 and isinstance(p[0],str) else None
def role(m):
    a=m.get("author") if type(m) is dict else None
    return a.get("role") if type(a) is dict else None
def backend_post(url):
    try:u=urlsplit(url)
    except ValueError:return False
    return u.scheme=="https" and u.netloc=="chatgpt.com" and u.path.startswith("/backend-api/")
def sse_objects(body):
    req(isinstance(body,str) and len(body)<=4_000_000,"SUBMIT_STREAM_SIZE_INVALID")
    out=[]
    for line in body.splitlines():
        if not line.startswith("data:"): continue
        raw=line[5:].lstrip()
        if not raw or raw=="[DONE]": continue
        out.append(parse_json(raw,"SUBMIT_STREAM_JSON_INVALID"))
        req(len(out)<=5000,"SUBMIT_STREAM_EVENT_LIMIT")
    req(out,"SUBMIT_STREAM_EMPTY")
    return out
def validate_submit_stream(envelope,*,page_url,raw_target_id,conversation_id,event_id,challenge,
                           visible_snapshot,expected_user_text,not_before,captured_at):
    req(type(envelope) is dict and envelope.get("ok") is True and envelope.get("captureMode")=="PASSIVE_SUBMIT_STREAM","SUBMIT_ENVELOPE_INVALID")
    req(envelope.get("targetId")==raw_target_id and envelope.get("url")==page_url,"SUBMIT_TARGET_MISMATCH")
    req(page_url=="https://chatgpt.com/c/"+conversation_id and UUID.fullmatch(conversation_id) is not None,"SUBMIT_CONVERSATION_INVALID")
    req(isinstance(raw_target_id,str) and re.fullmatch(r"[A-Fa-f0-9]{32}",raw_target_id),"SUBMIT_TARGET_INVALID")
    req(DIGEST.fullmatch(event_id or "") and DIGEST.fullmatch(challenge or ""),"SUBMIT_MARKER_CONTEXT_INVALID")
    low,high=ts(not_before),ts(captured_at);req(low<=high,"SUBMIT_CAPTURE_TIME_INVALID")
    wake="[AI_CORE_WAKE:"+event_id+"]";att="[AI_CORE_ATTEST:"+challenge+"]";ack="[AI_CORE_ATTEST_ACK:"+challenge+"]"
    req(isinstance(expected_user_text,str) and 0<len(expected_user_text)<=4096 and
        all(expected_user_text.count(x)==1 for x in (wake,att,ack)),"SUBMIT_EXPECTED_USER_INVALID")
    req(isinstance(visible_snapshot,str) and len(visible_snapshot)<=200000 and not STOP.search(visible_snapshot) and
        visible_snapshot.count(wake)==1 and visible_snapshot.count(att)==1 and visible_snapshot.count(ack)>=2,
        "SUBMIT_VISIBLE_CORRELATION_MISSING")
    rq=envelope.get("request");rs=envelope.get("response")
    req(type(rq) is dict and rq.get("method")=="POST" and backend_post(rq.get("url")),"SUBMIT_REQUEST_INVALID")
    post=rq.get("postData")
    req(isinstance(post,str) and len(post)<=262144 and wake in post and att in post,"SUBMIT_POSTDATA_INVALID")
    req(rq.get("postSha256")==hashlib.sha256(post.encode()).hexdigest(),"SUBMIT_POST_HASH_INVALID")
    pobj=parse_json(post,"SUBMIT_POST_JSON_INVALID")
    req(type(pobj) is dict and pobj.get("conversation_id")==conversation_id,"SUBMIT_POST_CONVERSATION_MISMATCH")
    msgs=pobj.get("messages")
    req(isinstance(msgs,list) and 1<=len(msgs)<=32 and all(type(x) is dict for x in msgs),"SUBMIT_POST_MESSAGES_INVALID")
    matches=[]
    for m in msgs:
        if role(m)=="user" and text_of(m)==expected_user_text:matches.append(m)
    req(len(matches)==1,"SUBMIT_USER_MISSING_OR_AMBIGUOUS")
    user=matches[0];uid=user.get("id")
    req(isinstance(uid,str) and UUID.fullmatch(uid),"SUBMIT_USER_ID_INVALID")
    ut=ts(user.get("create_time"));req(ut>=low and ut<=high,"SUBMIT_USER_TIME_INVALID")
    req(type(rs) is dict and rs.get("url")==rq.get("url") and rs.get("status")==200 and rs.get("truncated",False) is False,"SUBMIT_RESPONSE_INVALID")
    events=sse_objects(rs.get("body"))
    finals={}
    for obj in events:
        if type(obj) is not dict: continue
        cid=obj.get("conversation_id")
        if cid is not None: req(cid==conversation_id,"SUBMIT_STREAM_CONVERSATION_MISMATCH")
        m=obj.get("message")
        if type(m) is not dict or role(m)!="assistant" or m.get("channel")!="final": continue
        txt=text_of(m)
        if not isinstance(txt,str) or ack not in txt: continue
        mid=m.get("id")
        req(isinstance(mid,str) and UUID.fullmatch(mid),"SUBMIT_ASSISTANT_ID_INVALID")
        if m.get("status")=="finished_successfully" and m.get("end_turn") is True:
            mt=ts(m.get("create_time"));req(ut<=mt<=high,"SUBMIT_ASSISTANT_TIME_INVALID")
            req(txt.count(ack)==1 and 0<len(txt)<=4000,"SUBMIT_FINAL_ACK_INVALID")
            finals[mid]=(m,txt,mt)
    req(len(finals)==1,"SUBMIT_FINAL_MISSING_OR_AMBIGUOUS")
    mid,(m,txt,mt)=next(iter(finals.items()))
    return {"userFound":True,"assistantFound":True,"ackVisible":True,"responding":False,
            "assistantMessageId":mid.lower(),"assistantText":txt,
            "assistantResponseHash":hashlib.sha256(txt.encode()).hexdigest(),
            "userMessageId":uid.lower(),"source":"PASSIVE_SUBMIT_STREAM"}
