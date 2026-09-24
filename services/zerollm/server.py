#!/usr/bin/env python3
"""Narrow loopback-only ZeroLLM sidecar for Core AI."""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("ZEROLLM_HOST", "127.0.0.1").strip()
PORT = int(os.environ.get("ZEROLLM_PORT", "8765"))
MODEL = os.environ.get(
    "ZEROLLM_MODEL",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
).strip()
MAX_BODY_BYTES = int(os.environ.get("ZEROLLM_MAX_REQUEST_BYTES", "131072"))
MAX_OUTPUT_CHARS = int(os.environ.get("ZEROLLM_MAX_OUTPUT_CHARS", "262144"))
OFFLINE = os.environ.get("ZEROLLM_RUNTIME_OFFLINE", "true").lower() not in {
    "0", "false", "no"
}

if HOST not in {"127.0.0.1", "localhost", "::1"}:
    raise RuntimeError("ZeroLLM sidecar must bind to loopback only.")

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
if OFFLINE:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

_chat: Any | None = None
_chat_system_prompt: str | None = None
_chat_lock = threading.Lock()
_generation_lock = threading.Lock()
_started_at = time.time()


def _load_chat(system_prompt: str) -> Any:
    global _chat, _chat_system_prompt
    with _chat_lock:
        if _chat is not None and _chat_system_prompt == system_prompt:
            return _chat

        from zerollm import Chat

        _chat = Chat(MODEL, system_prompt=system_prompt, memory=False)
        _chat_system_prompt = system_prompt
        return _chat


def _token_estimate(value: str) -> int:
    return max(0, (len(value) + 3) // 4)


class Handler(BaseHTTPRequestHandler):
    server_version = "CoreAI-ZeroLLM/1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[zerollm-sidecar] " + (fmt % args), flush=True)

    def _json(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._json(
                200,
                {
                    "status": "ok",
                    "provider": "zerollm",
                    "model": MODEL,
                    "modelLoaded": _chat is not None,
                    "offline": OFFLINE,
                    "uptimeSeconds": int(time.time() - _started_at),
                },
            )
            return

        if self.path == "/v1/models":
            self._json(
                200,
                {
                    "object": "list",
                    "data": [{"id": MODEL, "object": "model", "owned_by": "local"}],
                },
            )
            return

        self._json(404, {"error": {"message": "Not found"}})

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self._json(404, {"error": {"message": "Not found"}})
            return

        try:
            size = int(self.headers.get("content-length", "0"))
        except ValueError:
            size = 0

        if size <= 0 or size > MAX_BODY_BYTES:
            self._json(413, {"error": {"message": "Request body limit exceeded"}})
            return

        try:
            payload = json.loads(self.rfile.read(size))
        except Exception:
            self._json(400, {"error": {"message": "Invalid JSON"}})
            return

        if not isinstance(payload, dict):
            self._json(400, {"error": {"message": "Request must be an object"}})
            return

        forbidden = {"tools", "tool_choice", "functions", "function_call", "response_format"}
        if any(key in payload for key in forbidden):
            self._json(
                400,
                {"error": {"message": "Tools/functions/structured tool calls are disabled"}},
            )
            return

        requested_model = payload.get("model")
        if requested_model not in {None, "", MODEL}:
            self._json(400, {"error": {"message": "Requested model is not allowed"}})
            return

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self._json(400, {"error": {"message": "messages must be a non-empty array"}})
            return

        system_parts: list[str] = []
        user_parts: list[str] = []
        for item in messages:
            if not isinstance(item, dict):
                self._json(400, {"error": {"message": "Invalid message"}})
                return
            role = item.get("role")
            content = item.get("content")
            if role not in {"system", "user"} or not isinstance(content, str):
                self._json(
                    400,
                    {"error": {"message": "Only plain-text system/user messages are allowed"}},
                )
                return
            if role == "system":
                system_parts.append(content)
            else:
                user_parts.append(content)

        system_prompt = "\n".join(system_parts).strip()
        prompt = "\n".join(user_parts).strip()
        if not prompt:
            self._json(400, {"error": {"message": "User prompt is required"}})
            return

        started = time.time()
        try:
            bot = _load_chat(system_prompt)
            with _generation_lock:
                output = str(bot.ask(prompt))
        except Exception as exc:
            self._json(
                503,
                {
                    "error": {
                        "message": "Local ZeroLLM inference unavailable",
                        "type": exc.__class__.__name__,
                    }
                },
            )
            return

        output = output[:MAX_OUTPUT_CHARS]
        prompt_tokens = _token_estimate(system_prompt + "\n" + prompt)
        completion_tokens = _token_estimate(output)

        self._json(
            200,
            {
                "id": "local-" + str(int(started * 1000)),
                "object": "chat.completion",
                "created": int(started),
                "model": MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": output},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                    "estimated": True,
                },
            },
        )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"[zerollm-sidecar] listening=http://{HOST}:{PORT} model={MODEL} offline={OFFLINE}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
