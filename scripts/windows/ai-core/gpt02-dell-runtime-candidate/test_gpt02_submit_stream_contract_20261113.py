"""Pure in-memory synthetic passive submit SSE contract tests. Zero browser/network/secret access."""
import copy,hashlib,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from gpt02_submit_stream_reader import validate_submit_stream,SubmitStreamError
uuid="12345678-1234-4123-8123-123456789abc"
user_id="12345678-1234-4123-8123-123456789abd"
assistant_id="12345678-1234-4123-8123-123456789abe"
target_id="A"*32
event="a"*64
challenge="b"*64
wake="[AI_CORE_WAKE:"+event+"]"
att="[AI_CORE_ATTEST:"+challenge+"]"
ack="[AI_CORE_ATTEST_ACK:"+challenge+"]"
user_text="DEV test "+wake+" "+att+" "+ack
page="https://chatgpt.com/c/"+uuid
backend="https://chatgpt.com/backend-api/conversation"
not_before=1794570000.0
captured_at=1794570030.0
post={"conversation_id":uuid,"messages":[{"id":user_id,"author":{"role":"user"},
      "content":{"content_type":"text","parts":[user_text]},"create_time":1794570001.0}]}
post_text=json.dumps(post,separators=(",",":"))
assistant={"id":assistant_id,"author":{"role":"assistant"},"channel":"final",
 "content":{"content_type":"text","parts":["Original test reply "+ack]},
 "status":"finished_successfully","end_turn":True,"create_time":1794570002.0}
sse='data: '+json.dumps({"conversation_id":uuid,"message":assistant},separators=(",",":"))+'\n\ndata: [DONE]\n'
envelope={"ok":True,"captureMode":"PASSIVE_SUBMIT_STREAM","targetId":target_id,"url":page,
 "request":{"url":backend,"method":"POST","postData":post_text,
            "postSha256":hashlib.sha256(post_text.encode()).hexdigest()},
 "response":{"url":backend,"status":200,"truncated":False,"body":sse}}
def run(env):
 return validate_submit_stream(env,page_url=page,raw_target_id=target_id,
  conversation_id=uuid,event_id=event,challenge=challenge,
  visible_snapshot=user_text+" "+ack,expected_user_text=user_text,
  not_before=not_before,captured_at=captured_at)
result=run(envelope)
assert result["assistantMessageId"]==assistant_id and result["ackVisible"] is True
print("VALID_SYNTHETIC_SUBMIT_STREAM_PASS")
cases=[
 ("POST_HASH_TAMPER",lambda e:e["request"].update({"postSha256":"0"*64})),
 ("WRONG_RESPONSE_CODE",lambda e:e["response"].update({"status":429})),
 ("WRONG_CONVERSATION",lambda e:e["request"].update({"postData":e["request"]["postData"].replace(uuid,"11111111-1111-4111-8111-111111111111")})),
 ("MISSING_FINAL_ACK",lambda e:e["response"].update({"body":e["response"]["body"].replace("Original test reply "+ack,"Original test reply without marker")})),
 ("WRONG_TARGET",lambda e:e.update({"targetId":"B"*32})),
 ("MISMATCH_RESPONSE_URL",lambda e:e["response"].update({"url":"https://chatgpt.com/backend-api/other"})),
]
for label,mut in cases:
 e=copy.deepcopy(envelope);mut(e)
 try:run(e)
 except SubmitStreamError:print("FAIL_CLOSED_PASS",label)
 else:raise AssertionError("INVALID_CASE_ACCEPTED:"+label)
print("NO_BROWSER_NETWORK_OR_RUNTIME_CHANGES")
