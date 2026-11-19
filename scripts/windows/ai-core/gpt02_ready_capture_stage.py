"""DEV-only bounded child-process handshake; never launches a browser by itself."""
import json
import queue
import subprocess
import threading

_MAX_BYTES = 12 * 1024 * 1024

class ReadyCaptureStage:
    def __init__(self, argv, target_id, context_pipe=False):
        self.target_id = target_id.upper()
        self.context_pipe = bool(context_pipe)
        self.context_sent = False
        self.first = queue.Queue(maxsize=1)
        self.output = queue.Queue(maxsize=1)
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE if self.context_pipe else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.thread = threading.Thread(target=self._drain, daemon=True)
        self.thread.start()

    def _drain(self):
        try:
            first = self.process.stdout.readline(4097)
            self.first.put_nowait(first)
            result = self.process.stdout.read(_MAX_BYTES + 1)
            self.output.put_nowait(result)
        except Exception:
            if self.first.empty(): self.first.put_nowait(b"")
            if self.output.empty(): self.output.put_nowait(b"")
        finally:
            self.process.stdout.close()

    def ready(self, timeout):
        try: line = self.first.get(timeout=timeout)
        except queue.Empty:
            self.close()
            raise RuntimeError("LISTENER_READY_TIMEOUT") from None
        if not line or len(line)>4096:
            self.close()
            raise RuntimeError("LISTENER_READY_MISSING")
        try: record = json.loads(line.decode("utf-8-sig"))
        except (UnicodeError, ValueError):
            self.close()
            raise RuntimeError("LISTENER_READY_INVALID") from None
        if (type(record) is not dict or record.get("phase")!="READY"
                or record.get("proof")!="CDP_NETWORK_ENABLE_ACK"
                or record.get("targetId")!=self.target_id):
            self.close()
            raise RuntimeError("LISTENER_READY_UNVERIFIED")
        if self.process.poll() is not None:
            self.close()
            raise RuntimeError("LISTENER_EXITED_BEFORE_NAVIGATION")
        return True

    def send_context(self, record):
        if not self.context_pipe or self.context_sent or self.process.poll() is not None:
            raise RuntimeError("LISTENER_CONTEXT_NOT_ALLOWED")
        try:
            payload = (json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
            if len(payload) > 225000 or not isinstance(record, dict):
                raise ValueError("context oversize or invalid")
            self.process.stdin.write(payload)
            self.process.stdin.flush()
            self.process.stdin.close()
            self.context_sent = True
        except (OSError, ValueError, TypeError):
            self.close()
            raise RuntimeError("LISTENER_CONTEXT_SEND_FAILED") from None

    def finish(self, timeout):
        if self.context_pipe and not self.context_sent:
            self.close()
            raise RuntimeError("LISTENER_CONTEXT_NOT_SENT")
        try:
            try: code = self.process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                raise RuntimeError("LISTENER_CAPTURE_TIMEOUT") from None
            self.thread.join(timeout=2)
            if code!=0 or self.thread.is_alive() or self.output.empty():
                raise RuntimeError("LISTENER_CAPTURE_PROCESS_FAILED")
            payload = self.output.get_nowait()
            if len(payload)>_MAX_BYTES:
                raise RuntimeError("LISTENER_CAPTURE_OVERSIZE")
            if not payload or len(payload.splitlines())!=1:
                raise RuntimeError("LISTENER_CAPTURE_NOT_SINGLE_JSON")
            try: result = json.loads(payload.decode("utf-8-sig"))
            except (UnicodeError, ValueError):
                raise RuntimeError("LISTENER_CAPTURE_INVALID_JSON") from None
            if type(result) is not dict or result.get("ok") is not True or result.get("targetId")!=self.target_id:
                raise RuntimeError("LISTENER_CAPTURE_INVALID_ENVELOPE")
            return result
        finally: self.close()

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        try: self.process.wait(timeout=5)
        except subprocess.TimeoutExpired: pass
        self.thread.join(timeout=2)
