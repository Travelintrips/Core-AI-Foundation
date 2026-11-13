"""Opt-in DEV-only CDP listener integration. No dispatch or navigation on import."""
import json
from pathlib import Path
import time
from gpt02_ready_capture_stage import ReadyCaptureStage
from dev_chatgpt_native_transport import _Capture, NATIVE_SECONDS, LISTENER_CAPTURE_SECONDS, FINAL_PROOF_SECONDS

READY_WAIT_SECONDS = 45

def listen_reader_cdp_stage(self, request_url, message_hash, reader):
    """Runs after the existing blank-reader ownership check; no browser retries."""
    self.phase = "reader_listener_cdp_stage"
    if (self.binding.get("workerId") != "openclaw-dell-chatgpt-wake-dev"
            or self.binding.get("browserProfile") != "gpt02-dell-dev"
            or self.binding.get("accountAlias") != "GPT02"):
        raise RuntimeError("CDP_STAGE_WORKER_PROFILE_MISMATCH")
    script = Path(__file__).with_name("gpt02-cdp-capture-stage.js")
    navigator = Path(__file__).with_name("dev-chatgpt-cdp-reader-navigate.js")
    if not script.is_file() or not navigator.is_file():
        raise RuntimeError("CDP_STAGE_SCRIPT_MISSING")
    self._reserve(READY_WAIT_SECONDS + NATIVE_SECONDS + LISTENER_CAPTURE_SECONDS + FINAL_PROOF_SECONDS)
    self.authorize()
    argv = [str(getattr(self, 'cdp_node', self.node)), str(script), "--capture", str(self.context["cdpPort"]),
            self.reader_id, "about:blank", self.binding["targetConversationId"],
            str(LISTENER_CAPTURE_SECONDS * 1000)]
    listener = ReadyCaptureStage(argv, self.reader_id)
    try:
        listener.ready(self._remaining(READY_WAIT_SECONDS))
        # Only a CDP Network.enable ACK on the exact owned blank reader opens navigation.
        self.authorize()
        self._reserve(NATIVE_SECONDS + LISTENER_CAPTURE_SECONDS + FINAL_PROOF_SECONDS)
        record = self._reader_record()
        if record["status"] != "BLANK_VERIFIED":
            raise RuntimeError("CDP_STAGE_BLANK_READER_NOT_VERIFIED")
        self._reader_update(record, status="NAVIGATION_ATTEMPTING", navigationAttemptedAt=time.time())
        args = [str(getattr(self, 'cdp_node', self.node)), str(navigator), str(self.context["pid"]),
                str(self.context["cdpPort"]), self.context["rawTargetId"],
                self.reader_id, self.page_url, self.expected_user_data,
                self.binding["bindingFingerprint"]]
        try:
            navigation = json.loads(_Capture(args).finish(self._remaining(NATIVE_SECONDS)))
        except (RuntimeError, ValueError, RecursionError):
            raise RuntimeError("CDP_STAGE_NAVIGATION_UNKNOWN_NO_RETRY") from None
        if (type(navigation) is not dict or navigation.get("ok") is not True
                or navigation.get("navigationInvoked") is not True
                or navigation.get("rawTargetId") != self.reader_id
                or navigation.get("pageUrl") != self.page_url):
            raise RuntimeError("CDP_STAGE_NAVIGATION_UNVERIFIED")
        record = self._reader_record()
        self._reader_update(record, status="NAVIGATION_INVOKED", navigationInvokedAt=time.time())
        budget = self.deadline - time.monotonic() - FINAL_PROOF_SECONDS
        if budget <= 0:
            raise RuntimeError("CDP_STAGE_CAPTURE_BUDGET_EXHAUSTED")
        envelope = listener.finish(self._remaining(min(LISTENER_CAPTURE_SECONDS,budget)))
        if (type(envelope) is not dict or envelope.get("ok") is not True
                or envelope.get("targetId") != self.reader_id
                or envelope.get("url") != self.page_url):
            raise RuntimeError("CDP_STAGE_CAPTURE_INVALID")
        return envelope
    finally:
        listener.close()
