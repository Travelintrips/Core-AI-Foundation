#!/usr/bin/env bash
# Installs a fail-closed scheduled sweeper. Never deletes images on install.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "install must run as root" >&2
  exit 1
fi
test "$(uname -s)" = Linux
command -v docker >/dev/null
command -v python3 >/dev/null
command -v systemctl >/dev/null
docker info >/dev/null

python3 "$ROOT/scripts/vps/test_docker_image_retention.py" -q
python3 "$ROOT/scripts/vps/test_active_app_image_cleanup.py" -q

install -d -m 700 /var/lib/cst-docker-image-retention
install -d -m 755 /usr/local/libexec
install -m 755 "$ROOT/scripts/vps/docker_image_retention.py" /usr/local/libexec/cst-docker-image-retention.py
install -m 755 "$ROOT/scripts/vps/active_app_image_cleanup.py" /usr/local/libexec/cst-docker-active-only.py
install -m 644 "$HERE/cst-docker-image-retention.service" /etc/systemd/system/
install -m 644 "$HERE/cst-docker-image-retention.timer" /etc/systemd/system/

systemd-analyze verify /etc/systemd/system/cst-docker-image-retention.service /etc/systemd/system/cst-docker-image-retention.timer
systemctl daemon-reload
systemctl enable --now cst-docker-image-retention.timer

echo "image_retention_install=PASS action=scheduler_only"
echo "No image/container/volume has been deleted by the installer."
systemctl list-timers cst-docker-image-retention.timer --no-pager
