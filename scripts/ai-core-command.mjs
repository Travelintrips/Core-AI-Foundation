import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'Travelintrips/Core-AI-Foundation';
export const ALLOWED_TARGET_REPOSITORIES = new Set([
  REPOSITORY,
  'Travelintrips/AI-Task-Hub',
]);
const OWNER = 'Travelintrips';
const API = 'https://aicore.cstlogistic.co.id/api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY = '\n\nExecution policy: This is an owner-authorized autonomous coding task. Use an isolated working branch. Do not bypass tests, access secrets, force-push, weaken security controls, or directly modify production. Complete the implementation end-to-end: create the patch, run required verification/CI, commit, push, open a pull request, and merge it automatically only after all required checks pass. After merge, allow the normal production deployment workflow to run. Do not stop for ordinary human review; only fail closed for an actual critical security/destructive-operation safeguard.';
const AUTONOMOUS_E2E_POLICY = '\n\nExecution policy: This is an explicit owner-authorized autonomous E2E validation. Use an isolated working branch. Do not bypass tests, access secrets, force-push, or weaken security controls. Keep the change strictly within the requested canary scope. If verification is green, you may commit, push, open a pull request, merge that verified pull request, and allow the normal production deployment workflow to run. Critical security controls remain mandatory.';
const DEFAULT_ISSUE_WAIT_MS = 2 * 60 * 1000;
const DEFAULT_POLL_MS = 10_000;

function resolveTargetRepository(instruction) {
  const match = String(instruction ?? '').match(
    /^target_repository:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*$/im,
  );
  const repository = match?.[1] ?? REPOSITORY;
  if (!ALLOWED_TARGET_REPOSITORIES.has(repository)) {
    throw new Error('Target repository is not allowlisted.');
  }
  return repository;
}

export function resolveCommand(event, env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_ACTOR !== OWNER ||
      (env.GITHUB_TRIGGERING_ACTOR && env.GITHUB_TRIGGERING_ACTOR !== OWNER)) {
    throw new Error('Only the repository owner may operate this trigger.');
  }
  let inputs = event.inputs ?? {};
  let issueNumber = null;
  let autonomousE2E = false;
  if (env.GITHUB_EVENT_NAME === 'issues') {
    if (event.action !== 'labeled' || event.sender?.login !== OWNER ||
        event.issue?.user?.login !== OWNER || event.issue?.pull_request ||
        !['ai-task', 'ai-audit', 'ai-handoff-approved'].includes(event.label?.name) ||
        !Number.isSafeInteger(event.issue?.number) || event.issue.number < 1) {
      throw new Error('Issue trigger is not an owner-authorized task, audit, or handoff approval.');
    }
    issueNumber = event.issue.number;
    if (event.label.name === 'ai-handoff-approved') {
      const body = String(event.issue.body ?? '');
      const taskMatch = body.match(/^task_id:\s*([0-9a-f-]{36})\s*$/im);
      const approvalMatch = body.match(/^approval_id:\s*([0-9a-f-]{36})\s*$/im);
      inputs = {
        action: 'approve_handoff',
        task_id: taskMatch?.[1] ?? '',
        approval_id: approvalMatch?.[1] ?? '',
        request_id: `issue-${issueNumber}`,
        max_cycles: '60',
      };
    } else {
      const body = String(event.issue.body ?? '');
      autonomousE2E =
        event.label.name === 'ai-task' &&
        /^autonomous_e2e:\s*true\s*$/im.test(body);
      const issueRunId = String(env.GITHUB_RUN_ID ?? '').trim();
      if (!/^[0-9]+$/.test(issueRunId)) {
        throw new Error('GITHUB_RUN_ID is required for owner issue triggers.');
      }
      inputs = {
        action: event.label.name === 'ai-audit' ? 'audit' : 'submit',
        instruction: `${event.issue.title ?? ''}\n\n${event.issue.body ?? ''}`.trim(),
        request_id:
          event.label.name === 'ai-task'
            ? `issue-${issueNumber}-run-${issueRunId}`
            : `issue-${issueNumber}`,
        max_cycles: '60',
      };
    }
  } else if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Unsupported trigger event.');
  }
  const action = inputs.action || 'audit';
  if (!['audit', 'submit', 'status', 'stop', 'approve_handoff'].includes(action)) throw new Error('Invalid action.');
  const maxCycles = Number(inputs.max_cycles || '5');
  if (!Number.isInteger(maxCycles) || maxCycles < 5 || maxCycles > 100) {
    throw new Error('max_cycles must be an integer between 5 and 100.');
  }
  const requestId = inputs.request_id || `run-${env.GITHUB_RUN_ID}`;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(requestId)) throw new Error('Invalid request_id.');
  const instruction = String(inputs.instruction ?? '').trim();
  if (action === 'submit' && (!instruction || instruction.length > 19000)) {
    throw new Error('Task instruction must contain 1 to 19000 characters.');
  }
  const taskId = String(inputs.task_id ?? '').trim();
  if (['status', 'stop', 'approve_handoff'].includes(action) && !UUID.test(taskId)) throw new Error('A valid task_id is required.');
  const approvalId = String(inputs.approval_id ?? '').trim();
  if (action === 'approve_handoff' && !UUID.test(approvalId)) throw new Error('A valid approval_id is required.');
  const targetRepository = resolveTargetRepository(instruction);
  return { action, instruction, requestId, taskId, approvalId, maxCycles, issueNumber, autonomousE2E, targetRepository };
}

export function createApi(secret, fetchImpl = fetch) {
  if (!secret?.trim()) throw new Error('ADMIN_API_KEY is not configured.');
  return async (path, { method = 'GET', body, allowed = [] } = {}) => {
    if (!/^\/(healthz(?:\/full)?|ai\/coding\/[a-zA-Z0-9/_-]+)$/.test(path)) {
      throw new Error('API path is outside the coding trigger scope.');
    }
    const isPublicHealthProbe = path === '/healthz' || path === '/healthz/full';
    const isIdempotentBridgeCommand =
      method === 'POST' && path === '/ai/coding/bridge/commands';
    const maxAttempts = method === 'GET' ? 6 : isIdempotentBridgeCommand ? 4 : 1;
    const baseHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'CST-AI-Core-GitHub-Trigger/1.0',
    };
    let response;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await fetchImpl(API + path, {
          method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 60000 : 30000),
          headers: isPublicHealthProbe
            ? baseHeaders
            : { ...baseHeaders, 'x-admin-api-key': secret },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        if (attempt >= maxAttempts) {
          const causeCode = error?.cause?.code ? ` (${error.cause.code})` : '';
          throw new Error(`AI Core ${method} ${path} transport failed after ${maxAttempts} attempt(s): ${error instanceof Error ? error.message : String(error)}${causeCode}`);
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 1000, 5000)));
        continue;
      }

      const transientRetryStatus =
        (method === 'GET' || isIdempotentBridgeCommand) &&
        [429, 500, 502, 503, 504].includes(response.status);
      if (transientRetryStatus && attempt < maxAttempts && !allowed.includes(response.status)) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }
      break;
    }

    if (!response) throw new Error(`AI Core ${method} ${path} did not return a response.`);
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(
        `AI Core ${method} ${path} returned HTTP ${response.status}. ` +
        (isIdempotentBridgeCommand
          ? 'Idempotent bridge-command retries are exhausted.'
          : 'No non-idempotent mutation is automatically retried.'),
      );
    }
    let value;
    try {
      value = await response.json();
    } catch {
      if (allowed.includes(response.status)) {
        value = {
          status:
            isPublicHealthProbe && response.status === 403
              ? 'edge_blocked'
              : 'allowed_non_json_response',
        };
      } else {
        throw new Error(`AI Core ${path} returned invalid JSON.`);
      }
    }
    return { status: response.status, value };
  };
}

export async function audit(api) {
  // Public health probes may be blocked by the edge/WAF for GitHub-hosted runners
  // even while the authenticated control bridge is healthy. Treat HTTP 403 as
  // an edge-only probe result, but continue to require the protected runtime
  // status endpoint to report ready=true before any coding mutation is allowed.
  const health = await api('/healthz', { allowed: [403, 503] });
  const full = await api('/healthz/full', { allowed: [403, 503] });
  const runtime = await api('/ai/coding/bridge/runtime-status', { allowed: [503] });

  const probeHealthyOrEdgeBlocked = (response) =>
    response.status === 403 ||
    (response.status === 200 && response.value?.status === 'ok');

  const ready =
    probeHealthyOrEdgeBlocked(health) &&
    probeHealthyOrEdgeBlocked(full) &&
    runtime.status === 200 &&
    runtime.value.ready === true;

  return {
    action: 'audit', ready,
    health: health.status === 403 ? 'edge_blocked' : (health.value.status ?? 'unknown'),
    readiness: full.status === 403 ? 'edge_blocked' : (full.value.status ?? 'unknown'),
    database: full.status === 200 ? (full.value.checks?.db?.status ?? 'unknown') : 'edge_blocked',
    autonomousConfigured: runtime.value.autonomous?.configured === true,
    autonomousRunning: runtime.value.autonomous?.running === true,
    autonomousRecovery: runtime.value.autonomousRecovery ?? null,
    githubConfigured: runtime.value.dependencies?.githubConfigured === true,
    whatsappBaseUrlConfigured: runtime.value.dependencies?.whatsapp?.baseUrl === true,
    whatsappApiKeyConfigured: runtime.value.dependencies?.whatsapp?.apiKey === true,
    whatsappTargetConfigured: runtime.value.dependencies?.whatsapp?.to === true,
    incomingSecretConfigured: runtime.value.dependencies?.incomingSecretConfigured === true,
    allowedSendersConfigured: runtime.value.dependencies?.allowedSendersConfigured === true,
    buildCommitSha: runtime.value.buildCommitSha ?? 'unknown',
    runtimeHttpStatus: runtime.status,
    criticalApprovalDependenciesReady: runtime.value.ready === true,
    result: ready ? 'READY_FOR_BOUNDED_TASKS' : 'BLOCKED_RUNTIME_NOT_READY',
  };
}

async function listTasks(api, repository = null) {
  const result = await api('/ai/coding/tasks');
  if (!Array.isArray(result.value)) throw new Error('Unexpected coding tasks response.');
  return result.value.filter((task) => {
    if (!ALLOWED_TARGET_REPOSITORIES.has(task.repository)) return false;
    return repository ? task.repository === repository : true;
  });
}

const TERMINAL_TASK_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const TERMINAL_AUTONOMOUS_STATUSES = new Set(['COMPLETED', 'BLOCKED', 'FAILED', 'DISABLED', 'APPROVAL_REQUIRED']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTaskOutcome(command, api, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : DEFAULT_ISSUE_WAIT_MS;
  const pollMs = Number.isFinite(options.pollMs) ? Math.max(0, options.pollMs) : DEFAULT_POLL_MS;
  const sleepImpl = options.sleepImpl ?? sleep;
  const deadline = Date.now() + waitMs;

  for (;;) {
    const [state, detail] = await Promise.all([
      api(`/ai/coding/tasks/${command.taskId}/autonomous`, { allowed: [404] }),
      api(`/ai/coding/tasks/${command.taskId}`),
    ]);
    const task = detail.value?.task ?? {};
    const autonomousStatus = state.status === 404 ? 'NOT_ENABLED' : String(state.value?.status ?? 'unknown');
    const taskStatus = String(task.status ?? 'unknown');

    if (taskStatus === 'COMPLETED' || autonomousStatus === 'COMPLETED') {
      return {
        action: command.action,
        taskId: command.taskId,
        result: 'TASK_COMPLETED',
        status: taskStatus,
        autonomousStatus,
        resultSummary: task.resultSummary ?? null,
        commitSha: task.commitSha ?? null,
      };
    }

    if (['FAILED', 'CANCELLED'].includes(taskStatus) || ['BLOCKED', 'FAILED', 'DISABLED'].includes(autonomousStatus)) {
      return {
        action: command.action,
        taskId: command.taskId,
        result: 'TASK_BLOCKED',
        status: taskStatus,
        autonomousStatus,
        resultSummary: task.resultSummary ?? null,
      };
    }

    if (autonomousStatus === 'APPROVAL_REQUIRED') {
      return {
        action: command.action,
        taskId: command.taskId,
        result: 'TASK_APPROVAL_REQUIRED',
        status: taskStatus,
        autonomousStatus,
        resultSummary: task.resultSummary ?? null,
      };
    }

    if (Date.now() >= deadline) {
      return {
        action: command.action,
        taskId: command.taskId,
        result: 'TASK_ACCEPTED_NOT_COMPLETED',
        status: taskStatus,
        autonomousStatus,
        resultSummary: task.resultSummary ?? null,
      };
    }

    await sleepImpl(pollMs);
  }
}

export async function execute(command, api, options = {}) {
  if (command.action === 'audit') return audit(api);
  if (command.action === 'approve_handoff') {
    const tasks = await listTasks(api);
    if (!tasks.some(task => task.id === command.taskId)) {
      throw new Error('Task does not belong to this repository.');
    }
    const current = await api(`/ai/coding/bridge/critical-approvals/${command.approvalId}`);
    const approval = current.value ?? {};
    if (approval.taskId !== command.taskId) throw new Error('Critical approval is bound to a different task.');
    if (approval.actionType !== 'WORKSTREAM_AI_HANDOFF') throw new Error('Critical approval is not a workstream AI handoff.');
    if (approval.status !== 'PENDING') throw new Error(`Critical approval is not pending (status=${String(approval.status ?? 'unknown')}).`);
    const decided = await api(`/ai/coding/bridge/critical-approvals/${command.approvalId}/decision`, {
      method: 'POST',
      body: { decision: 'APPROVE', actor: 'github-owner' },
    });
    return {
      action: command.action,
      taskId: command.taskId,
      approvalId: command.approvalId,
      result: 'HANDOFF_APPROVED',
      accepted: decided.value?.accepted === true,
      approvalStatus: decided.value?.approval?.status ?? null,
    };
  }
  if (['status', 'stop'].includes(command.action)) {
    const tasks = await listTasks(api);
    if (!tasks.some(task => task.id === command.taskId)) throw new Error('Task does not belong to this repository.');
    if (command.action === 'stop') {
      await api(`/ai/coding/tasks/${command.taskId}/autonomous/stop`, { method: 'POST', body: {} });
      return { action: 'stop', taskId: command.taskId, result: 'STOP_REQUESTED' };
    }
    if (command.instruction === 'RUN_AUTONOMOUS_CYCLE') {
      const cycle = await api(`/ai/coding/tasks/${command.taskId}/autonomous/run-once`, {
        method: 'POST',
        body: {},
      });
      return {
        action: 'status',
        taskId: command.taskId,
        result: 'CYCLE_EXECUTED',
        cycle: cycle.value,
      };
    }
    if (command.instruction === 'INSPECT_TASK_GRAPH') {
      const graphResponse = await api(
        `/ai/coding/tasks/${command.taskId}/task-graph`,
        { allowed: [404] },
      );
      if (graphResponse.status === 404) {
        return {
          action: 'status',
          taskId: command.taskId,
          result: 'TASK_GRAPH_NOT_FOUND',
        };
      }
      const snapshot = graphResponse.value ?? {};
      const workstreams = Array.isArray(snapshot.workstreams)
        ? snapshot.workstreams.map((item) => {
            const ai =
              item?.resultJson && typeof item.resultJson === 'object'
                ? item.resultJson.workstreamAiExecution
                : null;
            return {
              id: item?.id ?? null,
              key: item?.key ?? null,
              status: item?.status ?? null,
              attemptCount: item?.attemptCount ?? null,
              errorMessage:
                typeof item?.errorMessage === 'string'
                  ? item.errorMessage.slice(0, 1000)
                  : null,
              baseSha: item?.baseSha ?? null,
              dependencies: Array.isArray(item?.dependencies)
                ? item.dependencies
                : [],
              aiExecution:
                ai && typeof ai === 'object'
                  ? {
                      status: ai.status ?? null,
                      reviewStatus: ai.reviewStatus ?? null,
                      nextAction: ai.nextAction ?? null,
                      jobId: ai.jobId ?? null,
                      errorMessage:
                        typeof ai.errorMessage === 'string'
                          ? ai.errorMessage.slice(0, 1000)
                          : null,
                    }
                  : null,
            };
          })
        : [];
      return {
        action: 'status',
        taskId: command.taskId,
        result: 'TASK_GRAPH_INSPECTED',
        graph: {
          id: snapshot.graph?.id ?? null,
          status: snapshot.graph?.status ?? null,
          taskId: snapshot.graph?.taskId ?? null,
        },
        workstreams,
      };
    }
    return waitForTaskOutcome(command, api, { waitMs: 0, ...options });
  }
  const readiness = await audit(api);
  if (!readiness.ready) throw new Error('AI Core is not ready. No coding task was created or started. Run audit for diagnostics.');
  const projectName = `GitHub Trigger ${command.requestId}`;
  const instruction = command.instruction + (command.autonomousE2E ? AUTONOMOUS_E2E_POLICY : POLICY);
  const matches = (await listTasks(api, command.targetRepository))
    .filter(task => task.projectName === projectName);
  if (matches.length > 1) throw new Error('Multiple tasks share request_id; refusing a duplicate dispatch.');
  let task = matches[0];
  if (task && task.instruction !== instruction) throw new Error('request_id already belongs to a different instruction.');
  if (!task) {
    const created = await api('/ai/coding/tasks', { method: 'POST', body: {
      projectName, repository: command.targetRepository, branch: 'main', instruction, priority: 50,
    } });
    task = created.value;
  }
  if (!UUID.test(task?.id ?? '')) throw new Error('AI Core did not return a valid task ID. Inspect tasks before retrying.');
  await api('/ai/coding/bridge/commands', { method: 'POST', body: {
    externalCommandId: command.requestId, source: 'github-trigger', commandType: 'INSTRUCTION',
    taskId: task.id, instruction,
    authority: {
      allowCommit: true,
      allowPush: true,
      allowMerge: true,
      allowProductionDeploy: true,
    },
    metadata: {
      repository: command.targetRepository,
      requestId: command.requestId,
      issueNumber: command.issueNumber,
      autonomousE2E: command.autonomousE2E === true,
      ownerAuthorizedAutonomous: true,
    },
  } });
  const state = await api(`/ai/coding/tasks/${task.id}/autonomous`, { allowed: [404] });
  if (state.status !== 404) {
    // Reruns must not reset cycle budgets or restart completed/stopped tasks.
    if (command.issueNumber) {
      return waitForTaskOutcome({ ...command, taskId: task.id }, api, options);
    }
    return { action: 'submit', taskId: task.id, result: 'EXISTING_TASK_NOT_RESTARTED', status: state.value.status };
  }
  const detail = await api(`/ai/coding/tasks/${task.id}`);
  if (detail.value.task?.repository !== command.targetRepository || !Array.isArray(detail.value.runs)) {
    throw new Error('Unexpected task detail; refusing to initialize execution.');
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(detail.value.task.status)) {
    return { action: 'submit', taskId: task.id, result: 'TERMINAL_TASK_NOT_RESTARTED', status: detail.value.task.status };
  }
  // The autonomous runtime advances an existing analysis, but cannot bootstrap
  // a fresh PENDING task. Start the analyzer first. Inspect persisted runs before
  // retrying so an interrupted submission cannot blindly create another run.
  if (detail.value.runs.length === 0) {
    const run = await api(`/ai/coding/tasks/${task.id}/run`, { method: 'POST', body: {} });
    if (!UUID.test(run.value?.id ?? '')) throw new Error('Analyzer did not return a run ID. Inspect task status before retrying.');
  } else if (!detail.value.runs.some(run => run.status === 'RUNNING' ||
      (run.agentName === 'Coding Orchestrator' && run.status === 'COMPLETED'))) {
    throw new Error('Existing task has no active analysis or completed orchestration; refusing an automatic restart.');
  }
  const started = await api(`/ai/coding/tasks/${task.id}/autonomous/start`, { method: 'POST', body: { maxCycles: command.maxCycles } });
  const blocked = ['BLOCKED', 'FAILED', 'DISABLED'].includes(started.value.cycle?.status);
  if (blocked) {
    return { action: 'submit', taskId: task.id, maxCycles: command.maxCycles,
      result: 'TASK_BLOCKED', initialStatus: started.value.cycle?.status ?? 'unknown',
      productionApprovalRequired: false };
  }
  if (command.issueNumber) {
    return waitForTaskOutcome({ ...command, taskId: task.id }, api, options);
  }
  return { action: 'submit', taskId: task.id, maxCycles: command.maxCycles,
    result: 'TASK_ACCEPTED_NOT_COMPLETED',
    initialStatus: started.value.cycle?.status ?? 'unknown', productionApprovalRequired: false };
}

export async function main(env = process.env, fetchImpl = fetch) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const command = resolveCommand(event, env);
  const result = await execute(command, createApi(env.ADMIN_API_KEY, fetchImpl));
  const output = JSON.stringify(result, null, 2);
  console.log(output);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `## AI Core command trigger\n\n\`\`\`json\n${output}\n\`\`\`\n\n${result.result === 'TASK_COMPLETED' ? 'Task completed and is eligible for issue auto-close.' : 'Task is not complete yet; any required critical approval remains visible.'}\n`);
  if (command.issueNumber && env.GH_TOKEN) {
    const completed = result.result === 'TASK_COMPLETED';
    const body = completed
      ? `AI Core final result:\n\n\`\`\`json\n${output}\n\`\`\`\n\nTask reached a verified terminal COMPLETED state. No additional human review is required for this completed task.`
      : `AI Core current result:\n\n\`\`\`json\n${output}\n\`\`\`\n\nThe issue remains open until AI Core reaches COMPLETED. Critical approval gates such as merge/deploy/security remain visible when required.`;
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/issues/${command.issueNumber}/comments`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) throw new Error(`Could not publish trigger result: GitHub HTTP ${response.status}. Do not resubmit the task blindly.`);

    if (completed) {
      const close = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/issues/${command.issueNumber}`, {
        method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
      if (!close.ok) throw new Error(`Could not close completed issue: GitHub HTTP ${close.status}.`);
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
