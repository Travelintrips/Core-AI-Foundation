"""Real HTTP/SSE regression: idle means no job polling, events wake execution."""
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


class Stream(io.BytesIO):
    headers = {"Content-Type": "text/event-stream"}


class EventTransportTests(unittest.TestCase):
    def test_python_consumers_ignore_keepalive_and_reject_wrong_worker(self):
        root = Path(__file__).resolve().parents[2]
        for path in [Path(__file__).with_name("external-agent-supervisor.py"), root / "scripts/windows/openclaw-pc-work-consumer.py"]:
            spec = importlib.util.spec_from_file_location("event_test_" + path.stem, path)
            worker = importlib.util.module_from_spec(spec)
            with patch.dict(os.environ, {"AI_CORE_EXTERNAL_AGENT_CLIENT_ID":"test", "AI_CORE_EXTERNAL_AGENT_RUNTIME":"openclaw", "AI_CORE_BASE_URL":"https://dev.invalid/api"}):
                spec.loader.exec_module(worker)
            data = (': keepalive\n\nevent: ready\ndata: '+json.dumps({"clientId":worker.CLIENT_ID})+'\n\n').encode()
            with patch.object(worker.urllib.request,"urlopen",return_value=Stream(data)):
                events = worker.work_events()
                self.assertEqual(next(events), {"clientId":worker.CLIENT_ID})
                events.close()
            with patch.object(worker.urllib.request,"urlopen",return_value=Stream(b'event: ready\ndata: {"clientId":"wrong-worker"}\n\n')):
                with self.assertRaisesRegex(RuntimeError,"worker mismatch"):
                    next(worker.work_events())

    def test_idle_keepalives_do_not_poll_and_one_event_executes_once(self):
        state = {"claims":0,"executions":0,"accepted":0,"queued":False}
        connected = threading.Event()
        release = threading.Event()
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
                self.wfile.write(b'event: ready\ndata: {"clientId":"test-event-worker"}\n\n'); self.wfile.flush()
                connected.set()
                try:
                    while not release.wait(.1):
                        self.wfile.write(b': keepalive\n\n'); self.wfile.flush()
                    self.wfile.write(b'event: work_available\ndata: {"clientId":"test-event-worker","commandId":"test-job"}\n\n'); self.wfile.flush()
                    while state["accepted"] == 0:
                        time.sleep(.05)
                    time.sleep(.2)
                except (BrokenPipeError,ConnectionResetError): pass
            def do_POST(self):
                json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))))
                status=200
                if self.path.endswith("/claim"):
                    state["claims"]+=1
                    if state["queued"]:
                        state["queued"]=False
                        body={"commandId":"test-job","claimToken":"private-test-claim","instruction":"read-only"}
                    else: status,body=204,{}
                elif self.path=="/v1/responses":
                    state["executions"]+=1
                    body={"id":"resp-test","status":"completed","output_text":"real probe"}
                elif self.path.endswith("/result"):
                    state["accepted"]+=1; body={"status":"COMPLETED"}
                else: status,body=404,{}
                self.send_response(status); self.end_headers()
                if status != 204:self.wfile.write(json.dumps(body).encode())
        server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
        server.daemon_threads=True
        threading.Thread(target=server.serve_forever,daemon=True).start()
        url="http://127.0.0.1:"+str(server.server_port)
        process=None
        try:
            with tempfile.TemporaryDirectory() as directory:
                env={**os.environ,"AI_CORE_BASE_URL":url+"/api","OPENCLAW_INTERNAL_URL":url,
                     "AI_CORE_EXTERNAL_AGENT_CLIENT_ID":"test-event-worker","AI_CORE_EXTERNAL_AGENT_RUNTIME":"openclaw",
                     "AI_CORE_SCOPED_AGENT_TOKEN":"test","OPENCLAW_GATEWAY_TOKEN":"test","AI_CORE_AGENT_STATE_DIR":directory}
                process=subprocess.Popen([sys.executable,str(Path(__file__).with_name("external-agent-supervisor.py"))],
                                         env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                self.assertTrue(connected.wait(5))
                deadline=time.time()+3
                while state["claims"] < 1 and time.time()<deadline: time.sleep(.02)
                time.sleep(6)
                self.assertEqual(state["claims"],1,"Keepalives must never trigger empty claims")
                state["queued"]=True; release.set()
                deadline=time.time()+5
                while (state["accepted"] < 1 or Path(directory,"pending-result.json").exists()) and time.time()<deadline: time.sleep(.02)
                self.assertEqual(state["executions"],1)
                self.assertEqual(state["accepted"],1)
                process.terminate(); process.wait(timeout=5); process=None
                self.assertFalse(Path(directory,"pending-result.json").exists())
        finally:
            release.set()
            if process is not None:process.terminate();process.wait(timeout=5)
            server.shutdown();server.server_close()


if __name__=="__main__":unittest.main()
