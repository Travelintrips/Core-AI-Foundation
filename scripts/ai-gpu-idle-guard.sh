#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${AI_GPU_STATE_DIR:-/var/lib/ai-gpu-runtime}"
LAST_BUSY_FILE="${AI_GPU_LAST_BUSY_FILE:-$STATE_DIR/last-busy}"
IMAGE_REQUEST_FILE="${AI_GPU_IMAGE_REQUEST_FILE:-$STATE_DIR/image-requested}"
IDLE_SECONDS="${AI_GPU_IDLE_SECONDS:-300}"
COMFYUI_BASE_URL="${COMFYUI_BASE_URL:-http://127.0.0.1:8188}"
mkdir -p "$STATE_DIR"

now="$(date +%s)"
mark_busy() { printf '%s\n' "$now" > "$LAST_BUSY_FILE"; }

if [[ -f "$IMAGE_REQUEST_FILE" ]]; then
  mark_busy
  exit 0
fi

queue="$(curl -fsS --max-time 4 "$COMFYUI_BASE_URL/queue" 2>/dev/null || true)"
if [[ -n "$queue" ]] && python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("queue_running") or d.get("queue_pending") else 1)' <<<"$queue"; then
  mark_busy
  exit 0
fi

if command -v ollama >/dev/null 2>&1 && ollama ps 2>/dev/null | awk 'NR>1 && NF {found=1} END{exit found?0:1}'; then
  mark_busy
  exit 0
fi

if [[ ! -f "$LAST_BUSY_FILE" ]]; then
  boot_epoch="$(( now - ${SECONDS:-0} ))"
  printf '%s\n' "$boot_epoch" > "$LAST_BUSY_FILE"
fi

last_busy="$(cat "$LAST_BUSY_FILE" 2>/dev/null || echo "$now")"
[[ "$last_busy" =~ ^[0-9]+$ ]] || last_busy="$now"
idle="$(( now - last_busy ))"

if (( idle >= IDLE_SECONDS )); then
  logger -t ai-gpu-idle-guard "Shared GPU VM idle for ${idle}s; powering off"
  systemctl poweroff
fi
