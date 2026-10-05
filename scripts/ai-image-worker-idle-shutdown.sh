#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${AI_IMAGE_WORKER_ENV_FILE:-/etc/ai-core/ai-image-worker.env}"
[[ -f "${ENV_FILE}" ]] || exit 0
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

[[ "${AI_IMAGE_IDLE_SHUTDOWN_ENABLED:-true}" == "true" ]] || exit 0

PORT="${COMFYUI_PORT:-8188}"
IDLE_MINUTES="${AI_IMAGE_IDLE_MINUTES:-10}"
OUTPUT_PATH="${COMFYUI_OUTPUT_PATH:-/opt/ai-image-worker/output}"
STATE_DIR=/var/lib/ai-image-worker
LAST_BUSY_FILE="${STATE_DIR}/last-busy"
mkdir -p "${STATE_DIR}"

now="$(date +%s)"
queue_json="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/queue" 2>/dev/null || true)"

# If ComfyUI is unavailable, do not power the machine off from this guard.
[[ -n "${queue_json}" ]] || exit 0

if python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("queue_running") or d.get("queue_pending") else 1)' <<<"${queue_json}"; then
  printf '%s\n' "${now}" >"${LAST_BUSY_FILE}"
  exit 0
fi

latest_output=0
if [[ -d "${OUTPUT_PATH}" ]]; then
  latest_output="$(find "${OUTPUT_PATH}" -type f -printf '%T@\n' 2>/dev/null | sort -nr | head -n1 | cut -d. -f1 || true)"
  latest_output="${latest_output:-0}"
fi

if [[ -f "${LAST_BUSY_FILE}" ]]; then
  last_busy="$(cat "${LAST_BUSY_FILE}" 2>/dev/null || echo 0)"
else
  boot_epoch="$(( now - $(cut -d. -f1 /proc/uptime) ))"
  last_busy="${boot_epoch}"
fi

if (( latest_output > last_busy )); then
  last_busy="${latest_output}"
fi

idle_seconds="$(( now - last_busy ))"
threshold="$(( IDLE_MINUTES * 60 ))"
if (( idle_seconds >= threshold )); then
  logger -t ai-image-worker "ComfyUI idle for ${idle_seconds}s; powering off GPU VM"
  systemctl poweroff
fi
