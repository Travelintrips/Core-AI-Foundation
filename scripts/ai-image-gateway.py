#!/usr/bin/env python3
import base64
import hmac
import json
import os
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

COMFY = os.environ.get("COMFYUI_BASE_URL", "http://127.0.0.1:8188").rstrip("/")
CHECKPOINT = os.environ.get("AI_IMAGE_CHECKPOINT", "sd_xl_base_1.0.safetensors")
HOST = os.environ.get("AI_IMAGE_GATEWAY_HOST", "0.0.0.0")
PORT = int(os.environ.get("AI_IMAGE_GATEWAY_PORT", "9191"))
GATEWAY_TOKEN = os.environ.get("AI_IMAGE_GATEWAY_TOKEN", "").strip()
REQUEST_FILE = Path(os.environ.get("AI_GPU_IMAGE_REQUEST_FILE", "/var/lib/ai-gpu-runtime/image-requested"))
LAST_BUSY_FILE = Path(os.environ.get("AI_GPU_LAST_BUSY_FILE", "/var/lib/ai-gpu-runtime/last-busy"))
GPU_LOCK = threading.Lock()

if not GATEWAY_TOKEN:
    raise SystemExit("AI_IMAGE_GATEWAY_TOKEN is required")

def mark_busy():
    LAST_BUSY_FILE.parent.mkdir(parents=True, exist_ok=True)
    LAST_BUSY_FILE.write_text(str(int(time.time())), encoding="utf-8")

def request_json(url, method="GET", payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
        return json.loads(raw.decode()) if raw else {}

def comfy_ready():
    try:
        request_json(COMFY + "/system_stats", timeout=5)
        return True
    except Exception:
        return False

def ollama_loaded():
    proc = subprocess.run(["ollama", "ps"], capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError("ollama ps failed")
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return len(lines) > 1

def wait_for_ollama_idle(timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not ollama_loaded():
            return
        mark_busy()
        time.sleep(2)
    raise TimeoutError("GPU is still busy with Ollama")

def rounded_dimension(value, default):
    try:
        n = int(value)
    except Exception:
        n = default
    n = max(512, min(1024, n))
    return max(512, min(1024, (n // 64) * 64))

def make_workflow(body):
    prompt = str(body.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("prompt is required")
    if len(prompt) > 4000:
        raise ValueError("prompt is too long")
    negative = str(body.get("negativePrompt") or "blurry, low quality, distorted, deformed, artifacts, watermark").strip()
    width = rounded_dimension(body.get("width"), 1024)
    height = rounded_dimension(body.get("height"), 1024)
    steps = max(4, min(30, int(body.get("steps") or 20)))
    cfg = max(1.0, min(15.0, float(body.get("cfg") or 7.0)))
    seed = int(body.get("seed") or (time.time_ns() % 2147483647))
    prefix = "".join(c if c.isalnum() or c in "_-" else "-" for c in str(body.get("filenamePrefix") or "ai-core"))[:80] or "ai-core"
    return {
      "1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":CHECKPOINT}},
      "2":{"class_type":"CLIPTextEncode","inputs":{"text":prompt,"clip":["1",1]}},
      "3":{"class_type":"CLIPTextEncode","inputs":{"text":negative,"clip":["1",1]}},
      "4":{"class_type":"EmptyLatentImage","inputs":{"width":width,"height":height,"batch_size":1}},
      "5":{"class_type":"KSampler","inputs":{"seed":seed,"steps":steps,"cfg":cfg,"sampler_name":"euler","scheduler":"normal","denoise":1.0,"model":["1",0],"positive":["2",0],"negative":["3",0],"latent_image":["4",0]}},
      "6":{"class_type":"VAEDecode","inputs":{"samples":["5",0],"vae":["1",2]}},
      "7":{"class_type":"SaveImage","inputs":{"filename_prefix":prefix,"images":["6",0]}}
    }

def render(body):
    started = time.time()
    REQUEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    REQUEST_FILE.write_text(str(int(started)), encoding="utf-8")
    mark_busy()
    try:
        wait_for_ollama_idle()
        if not comfy_ready():
            raise RuntimeError("ComfyUI is not healthy")
        queued = request_json(COMFY + "/prompt", "POST", {"prompt": make_workflow(body), "client_id": "ai-core-image-router"}, 30)
        prompt_id = str(queued.get("prompt_id") or "")
        if not prompt_id:
            raise RuntimeError("ComfyUI did not return prompt_id")
        deadline = time.time() + int(body.get("timeoutSeconds") or 420)
        image = None
        while time.time() < deadline:
            history = request_json(COMFY + "/history/" + urllib.parse.quote(prompt_id), timeout=15)
            entry = history.get(prompt_id) or {}
            outputs = entry.get("outputs") or {}
            for node in outputs.values():
                images = node.get("images") if isinstance(node, dict) else None
                if images:
                    image = images[0]
                    break
            if image:
                break
            mark_busy()
            time.sleep(1.5)
        if not image:
            raise TimeoutError("ComfyUI render timed out")
        query = urllib.parse.urlencode({
            "filename": image.get("filename", ""),
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        })
        with urllib.request.urlopen(COMFY + "/view?" + query, timeout=60) as res:
            payload = res.read()
            content_type = res.headers.get("content-type") or "image/png"
        return {
            "ok": True,
            "provider": "gcp-comfyui",
            "model": CHECKPOINT,
            "promptId": prompt_id,
            "filename": image.get("filename"),
            "contentType": content_type.split(";")[0],
            "imageBase64": base64.b64encode(payload).decode(),
            "latencyMs": int((time.time() - started) * 1000),
        }
    finally:
        try:
            request_json(COMFY + "/free", "POST", {"unload_models": True, "free_memory": True}, 15)
        except Exception:
            pass
        mark_busy()
        try:
            REQUEST_FILE.unlink(missing_ok=True)
        except Exception:
            pass

class Handler(BaseHTTPRequestHandler):
    server_version = "AICoreImageGateway/1.1"

    def authorized(self):
        supplied = (self.headers.get("x-api-key") or "").strip()
        auth = (self.headers.get("Authorization") or "").strip()
        if not supplied and auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
        return bool(supplied) and hmac.compare_digest(supplied, GATEWAY_TOKEN)

    def require_auth(self):
        if self.authorized():
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def send_json(self, status, value):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self.require_auth():
            return
        if self.path == "/health":
            self.send_json(200 if comfy_ready() else 503, {"ok": comfy_ready(), "comfyui": COMFY})
            return
        self.send_json(404, {"error":"not_found"})

    def do_POST(self):
        if not self.require_auth():
            return
        if self.path != "/generate":
            self.send_json(404, {"error":"not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 65536:
                raise ValueError("invalid request size")
            body = json.loads(self.rfile.read(length))
            with GPU_LOCK:
                result = render(body)
            self.send_json(200, result)
        except ValueError as exc:
            self.send_json(400, {"ok":False,"error":str(exc)})
        except Exception as exc:
            self.send_json(503, {"ok":False,"error":str(exc)})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

if __name__ == "__main__":
    mark_busy()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
