import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'Travelintrips/Core-AI-Foundation';
const OWNER = 'Travelintrips';
const API = 'https://aicore.cstlogistic.co.id/api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY = '\n\nExecution policy: Use an isolated working branch. Preserve production approval gates. Do not bypass tests, access secrets, force-push, or directly modify production. Submit verified changes as a pull request.';

export function resolveCommand(event, env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_ACTOR !== OWNER ||
      (env.GITHUB_TRIGGERING_ACTOR && env.GITHUB_TRIGGERING_ACTOR !== OWNER)) {
    throw new Error('Only the repository owner may operate this trigger.');
  }
  let inputs = event.inputs ?? {};
  let issueNumber = null;
  if (env.GITHUB_EVENT_NAME === 'issues') {
    if (event.action !== 'labeled' || event.sender?.login !== OWNER ||
        event.issue?.user?.login !== OWNER || event.issue?.pull_request ||
        !['ai-task', 'ai-audit'].includes(event.label?.name) ||
        !Number.isSafeInteger(event.issue?.number) || event.issue.number < 1) {
      throw new Error('Issue trigger is not an owner-authorized task or audit.');
    }
    issueNumber = event.issue.number;
    inputs = {
      action: event.label.name === 'ai-audit' ? 'audit' : 'submit',
      instruction: `${event.issue.title ?? ''}\n\n${event.issue.body ?? ''}`.trim(),
      request_id: `issue-${issueNumber}`,
      max_cycles: '20',
    };
  } else if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Unsupported trigger event.');
  }
  const action = inputs.action || 'audit';
  if (!['audit', 'submit', 'status', 'stop'].includes(action)) throw new Error('Invalid action.');
  const maxCycles = Number(inputs.max_cycles || '5');
  if (!Number.isInteger(maxCycles) || maxCycles < 5 || maxCycles > 20) {
    throw new Error('max_cycles must be an integer between 5 and 20.');
  }
  const requestId = inputs.request_id || `run-${env.GITHUB_RUN_ID}`;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(requestId)) throw new Error('Invalid request_id.');
  const instruction = String(inputs.instruction ?? '').trim();
  if (action === 'submit' && (!instruction || instruction.length > 19000)) {
    throw new Error('Task instruction must contain 1 to 19000 characters.');
  }
  const taskId = String(inputs.task_id ?? '').trim();
  if (['status', 'stop'].includes(action) && !UUID.test(taskId)) throw new Error('A valid task_id is required.');
  return { action, instruction, requestId, taskId, maxCycles, issueNumber };
}

export function createApi(secret, fetchImpl = fetch) {
  if (!secret?.trim()) throw new Error('ADMIN_API_KEY is not configured.');
  return async (path, { method = 'GET', body, allowed = [] } = {}) => {
    if (!/^\/(healthz(?:\/full)?|ai\/coding\/[a-zA-Z0-9/_-]+)$/.test(path)) {
      throw new Error('API path is outside the coding trigger scope.');
    }
    const isPublicHealthProbe = path === '/healthz' || path === '/healthz/full';
    const maxAttempts = method === 'GET' ? 3 : 1;
    let response;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await fetchImpl(API + path, {
          method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 60000 : 30000),
          headers: isPublicHealthProbe
            ? { 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json', 'x-admin-api-key': secret },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        if (attempt >= maxAttempts) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }

      const transientGetStatus =
        method === 'GET' && [429, 500, 502, 503, 504].includes(response.status);
      if (transientGetStatus && attempt < maxAttempts && !allowed.includes(response.status)) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }
      break;
    }

    if (!response) throw new Error(`AI Core ${method} ${path} did not return a response.`);
    if (!response.ok && !allowed.includes(response.status)) {
      // GET probes may retry transient transport/5xx failures. Mutations are never retried.
      throw new Error(`AI Core ${method} ${path} returned HTTP ${response.status}. No mutation is automatically retried.`);
    }
    let value;
    try { value = await response.json(); } catch { throw new Error(`AI Core ${path} returned invalid JSON.`); }
    return { status: response.status, value };
  };
}

export async function audit(api) {
  const health = await api('/healthz', { allowed: [503] });
  const full = await api('/healthz/full', { allowed: [503] });
  const runtime = await api('/ai/coding/bridge/runtime-status', { allowed: [503] });
  const ready = health.status === 200 && health.value.status === 'ok' &&
    full.status === 200 && full.value.status === 'ok' &&
    runtime.status === 200 && runtime.value.ready === true;
  return {
    action: 'audit', ready,
    health: health.value.status ?? 'unknown',
    readiness: full.value.status ?? 'unknown',
    database: full.value.checks?.db?.status ?? 'unknown',
    autonomousConfigured: runtime.value.autonomous?.configured === true,
    autonomousRunning: runtime.value.autonomous?.running === true,
    githubConfigured: runtime.value.dependencies?.githubConfigured === true,
    criticalApprovalDependenciesReady: runtime.value.ready === true,
    result: ready ? 'READY_FOR_BOUNDED_TASKS' : 'BLOCKED_RUNTIME_NOT_READY',
  };
}

async function listTasks(api) {
  const result = await api('/ai/coding/tasks');
  if (!Array.isArray(result.value)) throw new Error('Unexpected coding tasks response.');
  return result.value.filter(task => task.repository === REPOSITORY);
}

const TERMINAL_TASK_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const TERMINAL_AUTONOMOUS_STATUSES = new Set(['COMPLETED', 'BLOCKED', 'FAILED', 'DISABLED', 'APPROVAL_REQUIRED']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTaskOutcome(command, api, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, options.waitMs) : 12 * 60 * 1000;
  const pollMs = Number.isFinite(options.pollMs) ? Math.max(0, options.pollMs) : 10_000;
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
  if (['status', 'stop'].includes(command.action)) {
    const tasks = await listTasks(api);
    if (!tasks.some(task => task.id === command.taskId)) throw new Error('Task does not belong to this repository.');
    if (command.action === 'stop') {
      await api(`/ai/coding/tasks/${command.taskId}/autonomous/stop`, { method: 'POST', body: {} });
      return { action: 'stop', taskId: command.taskId, result: 'STOP_REQUESTED' };
    }
    return waitForTaskOutcome(command, api, { waitMs: 0, ...options });
  }
  const readiness = await audit(api);
  if (!readiness.ready) throw new Error('AI Core is not ready. No coding task was created or started. Run audit for diagnostics.');
  const projectName = `GitHub Trigger ${command.requestId}`;
  const instruction = command.instruction + POLICY;
  const matches = (await listTasks(api)).filter(task => task.projectName === projectName);
  if (matches.length > 1) throw new Error('Multiple tasks share request_id; refusing a duplicate dispatch.');
  let task = matches[0];
  if (task && task.instruction !== instruction) throw new Error('request_id already belongs to a different instruction.');
  if (!task) {
    const created = await api('/ai/coding/tasks', { method: 'POST', body: {
      projectName, repository: REPOSITORY, branch: 'main', instruction, priority: 50,
    } });
    task = created.value;
  }
  if (!UUID.test(task?.id ?? '')) throw new Error('AI Core did not return a valid task ID. Inspect tasks before retrying.');
  await api('/ai/coding/bridge/commands', { method: 'POST', body: {
    externalCommandId: command.requestId, source: 'github-trigger', commandType: 'INSTRUCTION',
    taskId: task.id, instruction,
    authority: { allowCommit: true, allowPush: true, allowMerge: false, allowProductionDeploy: false },
    metadata: { repository: REPOSITORY, requestId: command.requestId, issueNumber: command.issueNumber },
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
  if (detail.value.task?.repository !== REPOSITORY || !Array.isArray(detail.value.runs)) {
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
      productionApprovalRequired: true };
  }
  if (command.issueNumber) {
    return waitForTaskOutcome({ ...command, taskId: task.id }, api, options);
  }
  return { action: 'submit', taskId: task.id, maxCycles: command.maxCycles,
    result: 'TASK_ACCEPTED_NOT_COMPLETED',
    initialStatus: started.value.cycle?.status ?? 'unknown', productionApprovalRequired: true };
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
