#!/bin/sh
set -eu

namespace="${DEFAULT_NAMESPACE:-default}"
address="${TEMPORAL_ADDRESS:-temporal:7233}"
max_attempts="${TEMPORAL_HEALTH_CHECK_MAX_ATTEMPTS:-30}"
sleep_seconds="${TEMPORAL_HEALTH_CHECK_SLEEP_SECONDS:-5}"

attempt=1
while ! temporal operator cluster health --address "$address" >/dev/null 2>&1; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Temporal did not become healthy"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

if temporal operator namespace describe -n "$namespace" --address "$address" >/dev/null 2>&1; then
  echo "Namespace $namespace already exists"
  exit 0
fi

temporal operator namespace create -n "$namespace" --address "$address"
echo "Namespace $namespace created"
