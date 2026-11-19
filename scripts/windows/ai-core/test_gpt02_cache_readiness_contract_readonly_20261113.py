"""Pure synthetic tests of the installed GPT02 native readiness guard; no browser or auth."""
import pathlib,sys
root=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(root))
from dev_chatgpt_native_transport import NativeTransport
obj=NativeTransport.__new__(NativeTransport)
obj.event='a'*64
obj.challenge='b'*64
wake="[AI_CORE_WAKE:"+obj.event+"]"
att="[AI_CORE_ATTEST:"+obj.challenge+"]"
ack="[AI_CORE_ATTEST_ACK:"+obj.challenge+"]"
msg="DEV GPT02 "+wake+" "+att+" "+ack
snap=msg
assert obj._ready(snap,msg,require_visible_assistant_ack=False) is True
print("CACHE_READINESS_EXACT_INPUT_WITH_NO_VISIBLE_ASSISTANT_ACK_PASS")
assert obj._ready(snap,msg,require_visible_assistant_ack=True) is False
print("LEGACY_VISIBLE_ACK_REQUIRED_PASS")
assert obj._ready(snap+'\nbutton "Stop"',msg,False) is False
print("STILL_RESPONDING_STOP_INDICATOR_REJECTED_PASS")
assert obj._ready(snap+"\n"+msg,msg,False) is False
print("DUPLICATE_INPUT_REJECTED_PASS")
assert obj._ready(snap.replace(wake,"[AI_CORE_WAKE:"+"c"*64+"]"),msg,False) is False
print("WRONG_EVENT_REJECTED_PASS")
assert obj._ready(snap.replace(att,"[AI_CORE_ATTEST:"+"d"*64+"]"),msg,False) is False
print("WRONG_CHALLENGE_REJECTED_PASS")
assert obj._ready(snap+"\n"+ack,msg,True) is True
print("VISIBLE_ASSISTANT_ACK_NORMAL_MODE_PASS")
print("READINESS_TESTS_7_OF_7_PASS_NO_EXTERNAL_SIDE_EFFECTS")
