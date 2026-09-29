import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.common import RetryPolicy
from temporalio.worker import Worker

API_BASE = os.environ.get("AI_CORE_BASE_URL", "https://aicore.cstlogistic.co.id/api").rstrip("/")
TOKEN = os.environ.get("AI_CORE_TEMPORAL_CODING_TOKEN", "").strip()
TEMPORAL_ADDRESS = os.environ.get("TEMPORAL_ADDRESS", "temporal:7233").strip()
TEMPORAL_NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE", "default").strip()
TASK_QUEUE = os.environ.get("TEMPORAL_CODING_TASK_QUEUE", "ai-core-coding-orchestrator").strip()
DISCOVERY_SECONDS = max(2, min(60, int(os.environ.get("TEMPORAL_CODING_DISCOVERY_SECONDS", "5"))))
CYCLE_SECONDS = max(2, min(60, int(os.environ.get("TEMPORAL_CODING_CYCLE_SECONDS", "8"))))
LEASE_SECONDS = max(30, min(300, int(os.environ.get("TEMPORAL_CODING_LEASE_SECONDS", "90"))))
TERMINAL = {"APPROVAL_REQUIRED", "COMPLETED", "BLOCKED", "FAILED", "DISABLED"}


def _request_json(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API_BASE + path,
        data=data,
        method=method,
        headers={
            "authorization": "Bearer " + TOKEN,
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "ai-core-temporal-coding-worker/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI Core HTTP {exc.code}: {raw[:500]}") from exc


def _heartbeat() -> dict[str, Any]:
    return _request_json(
        "POST",
        "/ai/temporal-coding/presence/heartbeat",
        {
            "leaseSeconds": LEASE_SECONDS,
            "metadata": {
                "runtime": "temporal-python",
                "taskQueue": TASK_QUEUE,
                "version": "1.0",
            },
        },
    )


@activity.defn
async def run_autonomous_cycle(task_id: str) -> dict[str, Any]:
    await asyncio.to_thread(_heartbeat)
    return await asyncio.to_thread(
        _request_json,
        "POST",
        f"/ai/temporal-coding/tasks/{task_id}/run-once",
        {},
    )


@workflow.defn
class CodingTaskWorkflow:
    @workflow.run
    async def run(self, task_id: str) -> dict[str, Any]:
        retry = RetryPolicy(
            initial_interval=timedelta(seconds=2),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(seconds=20),
            maximum_attempts=4,
        )
        for _ in range(120):
            result = await workflow.execute_activity(
                run_autonomous_cycle,
                task_id,
                start_to_close_timeout=timedelta(seconds=150),
                retry_policy=retry,
            )
            if str(result.get("status", "")).upper() in TERMINAL:
                return result
            await workflow.sleep(CYCLE_SECONDS)
        return {
            "taskId": task_id,
            "status": "BLOCKED",
            "action": "TEMPORAL_MAX_ITERATIONS",
        }


async def _discover_and_start(client: Client) -> None:
    payload = await asyncio.to_thread(
        _request_json,
        "GET",
        "/ai/temporal-coding/tasks?limit=20",
        None,
    )
    tasks = payload.get("tasks")
    if not isinstance(tasks, list):
        return

    for item in tasks:
        if not isinstance(item, dict):
            continue
        task_id = str(item.get("task_id") or "").strip()
        if not task_id:
            continue
        workflow_id = "ai-core-coding-" + task_id
        try:
            await client.start_workflow(
                CodingTaskWorkflow.run,
                task_id,
                id=workflow_id,
                task_queue=TASK_QUEUE,
            )
            print(f"started Temporal workflow {workflow_id}", flush=True)
        except WorkflowAlreadyStartedError:
            pass


async def main() -> None:
    if not TOKEN:
        raise RuntimeError("AI_CORE_TEMPORAL_CODING_TOKEN is required")

    client = await Client.connect(TEMPORAL_ADDRESS, namespace=TEMPORAL_NAMESPACE)
    async with Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[CodingTaskWorkflow],
        activities=[run_autonomous_cycle],
    ):
        while True:
            try:
                await asyncio.to_thread(_heartbeat)
                await _discover_and_start(client)
            except Exception as exc:
                print(f"temporal coding discovery error: {exc}", file=sys.stderr, flush=True)
            await asyncio.sleep(DISCOVERY_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
