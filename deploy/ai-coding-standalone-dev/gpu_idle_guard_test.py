"""Offline safety tests for the shared GPU idle guard; no VM shutdown."""
import os
import pathlib
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).parent
SCRIPT = ROOT / "ai-gpu-idle-guard-safe.sh"

def case(name, queue, model_loaded, expected_shutdown, curl_exit=0):
    with tempfile.TemporaryDirectory(prefix="gpu-guard-test-") as d:
        p = pathlib.Path(d)
        bin_dir = p / "bin"
        bin_dir.mkdir()
        (p / "last-busy").write_text(str(int(time.time()) - 400))
        curl = bin_dir / "curl"
        curl.write_text("#!/bin/sh\n" + ("exit 7\n" if curl_exit else "printf '%s' " + repr(queue) + "\n"))
        ollama = bin_dir / "ollama"
        ollama.write_text("#!/bin/sh\nprintf 'NAME ID SIZE PROCESSOR UNTIL\\n'\n" + ("printf 'qwen2.5-coder:7b x 5GiB GPU 5m\\n'\n" if model_loaded else ""))
        curl.chmod(0o755)
        ollama.chmod(0o755)
        env = dict(os.environ, AI_GPU_STATE_DIR=d, AI_GPU_IDLE_DRY_RUN="true",
                   AI_GPU_IDLE_SECONDS="300", PATH=str(bin_dir) + ":" + os.environ["PATH"])
        result = subprocess.run(["bash", str(SCRIPT)], capture_output=True, text=True, env=env, timeout=10, check=True)
        shutdown = "would_poweroff" in result.stdout
        assert shutdown is expected_shutdown, (name, result.stdout, result.stderr)
        if not expected_shutdown:
            assert int((p / "last-busy").read_text()) > int(time.time()) - 15, name
        print("PASS", name)

case("idle_poweroff_after_5_min", '{"queue_running":[],"queue_pending":[]}', False, True)
case("active_comfyui_queue", '{"queue_running":[1],"queue_pending":[]}', False, False)
case("active_ollama_model", '{"queue_running":[],"queue_pending":[]}', True, False)
case("malformed_comfyui_queue", '{"queue_running":', False, False)
case("unreachable_comfyui_queue", "", False, False, curl_exit=7)
print("PASS all GPU idle safety cases")
