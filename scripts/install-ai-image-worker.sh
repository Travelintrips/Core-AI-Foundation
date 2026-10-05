#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="${ROOT_DIR}/deploy/ai-image-worker"
ENV_FILE="${AI_IMAGE_WORKER_ENV_FILE:-/etc/ai-core/ai-image-worker.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA driver is not available (nvidia-smi missing)." >&2
  exit 1
fi
if ! docker info 2>/dev/null | grep -qiE 'nvidia|runtimes'; then
  echo "Warning: NVIDIA Container Toolkit runtime was not detected in docker info." >&2
fi

install -d -m 0750 "$(dirname "${ENV_FILE}")"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -m 0640 "${STACK_DIR}/.env.example" "${ENV_FILE}"
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

for dir in   "${COMFYUI_MODELS_PATH:-/opt/ai-image-worker/models}"   "${COMFYUI_INPUT_PATH:-/opt/ai-image-worker/input}"   "${COMFYUI_OUTPUT_PATH:-/opt/ai-image-worker/output}"   "${COMFYUI_USER_PATH:-/opt/ai-image-worker/user}"   "${COMFYUI_CUSTOM_NODES_PATH:-/opt/ai-image-worker/custom_nodes}"; do
  install -d -m 0775 "${dir}"
done

docker compose --env-file "${ENV_FILE}" -f "${STACK_DIR}/docker-compose.yml" build
docker compose --env-file "${ENV_FILE}" -f "${STACK_DIR}/docker-compose.yml" up -d

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${COMFYUI_PORT:-8188}/system_stats" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
curl -fsS "http://127.0.0.1:${COMFYUI_PORT:-8188}/system_stats" >/dev/null

if [[ "${AI_IMAGE_IDLE_SHUTDOWN_ENABLED:-true}" == "true" ]]; then
  install -m 0755 "${ROOT_DIR}/scripts/ai-image-worker-idle-shutdown.sh" /usr/local/sbin/ai-image-worker-idle-shutdown
  cat >/etc/systemd/system/ai-image-worker-idle-shutdown.service <<EOF
[Unit]
Description=Power off idle AI Core image GPU worker
After=docker.service

[Service]
Type=oneshot
Environment=AI_IMAGE_WORKER_ENV_FILE=${ENV_FILE}
ExecStart=/usr/local/sbin/ai-image-worker-idle-shutdown
EOF

  cat >/etc/systemd/system/ai-image-worker-idle-shutdown.timer <<'EOF'
[Unit]
Description=Check AI Core image worker idle state every minute

[Timer]
OnBootSec=5min
OnUnitActiveSec=1min
AccuracySec=15s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now ai-image-worker-idle-shutdown.timer
else
  systemctl disable --now ai-image-worker-idle-shutdown.timer 2>/dev/null || true
fi

echo "READY: ComfyUI image worker is healthy on 127.0.0.1:${COMFYUI_PORT:-8188}"
