#!/usr/bin/env bash
# Shared GPU VM idle guard. Only shuts down when both ComfyUI and Ollama
# are observable and idle. On any uncertainty, keep the VM running.
set -euo pipefail

STATE_DIR="${AI_GPU_STATE_DIR:-/var/lib/ai-gpu-runtime}"
LAST_BUSY_FILE="${AI_GPU_LAST_BUSY_FILE:-$STATE_DIR/last-busy}"
IMAGE_REQUEST_FILE="${AI_GPU_IMAGE_REQUEST_FILE:-$STATE_DIR/image-requested}"
IDLE_SECONDS="${AI_GPU_IDLE_SECONDS:-300}"
COMFYUI_BASE_URL="${COMFYUI_BASE_URL:-http://127.0.0.1:8188}"
DRY_RUN="${AI_GPU_IDLE_DRY_RUN:-false}"
mkdir -p "$STATE_DIR"
now="$(date +%s)"
mark_busy() { printf '%s\n' "$now" > "$LAST_BUSY_FILE"; }

# The image gateway marks a request before ComfyUI queues it.
if [[ -f "$IMAGE_REQUEST_FILE" ]]; then
  mark_busy
  exit 0
fi

# A failed or unparseable ComfyUI queue is UNKNOWN, never idle.
queue="$(curl -fsS --max-time 5 "$COMFYUI_BASE_URL/queue" 2>/dev/null)" || {
  mark_busy
  exit 0
}
queue_state="$(python3 -c 'import json,sys; d=json.load(sys.stdin); a=d["queue_running"]; b=d["queue_pending"]; assert isinstance(a,list) and isinstance(b,list); print("busy" if a or b else "idle")' <<< "$queue" 2>/dev/null)" || {
  mark_busy
  exit 0
}
if [[ "$queue_state" != "idle" ]]; then
  mark_busy
  exit 0
fi

# If Ollama cannot be queried, its job state is UNKNOWN.
ollama_state="$(ollama ps 2>/dev/null)" || {
  mark_busy
  exit 0
}
if awk 'NR>1 && NF {found=1} END{exit found?0:1}' <<< "$ollama_state"; then
  mark_busy
  exit 0
fi

if [[ ! -f "$LAST_BUSY_FILE" ]]; then
  uptime_seconds="$(cut -d. -f1 /proc/uptime)"
  printf '%s\n' "$(( now - uptime_seconds ))" > "$LAST_BUSY_FILE"
fi
last_busy="$(cat "$LAST_BUSY_FILE" 2>/dev/null || echo "$now")"
[[ "$last_busy" =~ ^[0-9]+$ ]] || last_busy="$now"

# A recently generated image also counts as activity.
if [[ -d /opt/comfyui/output ]]; then
  latest_output="$(find /opt/comfyui/output -type f -printf '%T@\n' 2>/dev/null | sort -nr | head -n1 | cut -d. -f1 || true)"
  latest_output="${latest_output:-0}"
  if [[ "$latest_output" =~ ^[0-9]+$ ]] && (( latest_output > last_busy )); then
    last_busy="$latest_output"
    printf '%s\n' "$last_busy" > "$LAST_BUSY_FILE"
  fi
fi

idle="$(( now - last_busy ))"
if (( idle >= IDLE_SECONDS )); then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "DRY_RUN would_poweroff idle_seconds=$idle"
    exit 0
  fi
  logger -t ai-gpu-idle-guard "Shared GPU VM idle for ${idle}s; powering off"
  systemctl poweroff
fi
