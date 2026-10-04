import test from 'node:test';
import assert from 'node:assert/strict';
import { REPOSITORY, resolveCommand, createApi, audit, execute } from './ai-core-command.mjs';

const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_ACTOR: 'Travelintrips',
  GITHUB_TRIGGERING_ACTOR: 'Travelintrips', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '1234' };
const id = 'a1234567-1234-1234-1234-123456789abc';
const approvalId = 'b1234567-1234-1234-1234-123456789abc';
const resolve = inputs => resolveCommand({ inputs }, env);
const issue = { action: 'labeled', sender: { login: 'Travelintrips' }, label: { name: 'ai-audit' },
  issue: { number: 321, title: 'Audit trigger', body: 'Read-only test', user: { login: 'Travelintrips' } } };

function fakeApi({ ready = true, tasks = [], state404 = true, runs = [], initialStatus = 'WAITING' } = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/healthz') return { status: 200, value: { status: 'ok' } };
    if (path === '/healthz/full') return { status: 200, value: { status: ready ? 'ok' : 'degraded', checks: { db: { status: ready ? 'ok' : 'fail' } } } };
    if (path.endsWith('/runtime-status')) return { status: 200, value: { ready, autonomous: { configured: true, running: true }, dependencies: { githubConfigured: true } } };
    if (path === '/ai/coding/tasks') return options.method === 'POST'
      ? { status: 201, value: { id, ...options.body } } : { status: 200, value: tasks };
    if (path === `/ai/coding/tasks/${id}`) return { status: 200, value: { task: { id, repository: REPOSITORY, status: 'PENDING' }, runs } };
    if (path === `/ai/coding/bridge/critical-approvals/${approvalId}`) {
      return { status: 200, value: { id: approvalId, taskId: id, actionType: 'WORKSTREAM_AI_HANDOFF', status: 'PENDING' } };
    }
    if (path === `/ai/coding/bridge/critical-approvals/${approvalId}/decision`) {
      return { status: 200, value: { accepted: true, approval: { id: approvalId, taskId: id, actionType: 'WORKSTREAM_AI_HANDOFF', status: 'EXECUTING' } } };
    }
    if (path.endsWith('/run')) return { status: 201, value: { id } };
    if (path.endsWith('/start')) return { status: 202, value: { cycle: { status: initialStatus } } };
    if (path.endsWith('/autonomous')) return { status: state404 ? 404 : 200, value: { status: 'COMPLETED', enabled: false } };
    return { status: 202, value: {} };
  };
  return { api, calls };
}

test('default dispatch audits without creating tasks', async () => {
  const f = fakeApi();
  const result = await execute(resolve({}), f.api);
  assert.equal(result.ready, true);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => !call.method));
});
test('edge-blocked public health probes do not block a ready authenticated control bridge', async () => {
  const api = async (path, options = {}) => {
    if (path === '/healthz' || path === '/healthz/full') {
      assert.deepEqual(options.allowed, [403, 503]);
      return { status: 403, value: { error: 'edge blocked' } };
    }
    if (path === '/ai/coding/bridge/runtime-status') {
      return {
        status: 200,
        value: {
          ready: true,
          autonomous: { configured: true, running: true },
          dependencies: { githubConfigured: true },
        },
      };
    }
    throw new Error('unexpected path');
  };

  const result = await audit(api);
  assert.equal(result.ready, true);
  assert.equal(result.health, 'edge_blocked');
  assert.equal(result.readiness, 'edge_blocked');
  assert.equal(result.result, 'READY_FOR_BOUNDED_TASKS');
});

test('degraded readiness remains visible and prevents submission', async () => {
  const f = fakeApi({ ready: false });
  const audit = await execute(resolve({}), f.api);
  assert.equal(audit.ready, false);
  assert.equal(audit.result, 'BLOCKED_RUNTIME_NOT_READY');
  await assert.rejects(execute(resolve({ action: 'submit', instruction: 'Add a unit test' }), f.api), /not ready/);
  assert.ok(f.calls.every(call => !call.method));
});
test('non-owner and unauthorized rerun are rejected', () => {
  for (const patch of [{ GITHUB_ACTOR: 'outsider' }, { GITHUB_TRIGGERING_ACTOR: 'outsider' }, { GITHUB_REPOSITORY: 'other/repo' }]) {
    assert.throws(() => resolveCommand({}, { ...env, ...patch }), /owner/);
  }
});
test('only owner-authored labeled issues are accepted', () => {
  const issueEnv = { ...env, GITHUB_EVENT_NAME: 'issues' };
  assert.equal(resolveCommand(issue, issueEnv).action, 'audit');
  const taskCommand = resolveCommand({ ...issue, label: { name: 'ai-task' } }, issueEnv);
  assert.equal(taskCommand.action, 'submit');
  assert.equal(taskCommand.maxCycles, 20);
  for (const bad of [
    { ...issue, sender: { login: 'outsider' } },
    { ...issue, label: { name: 'random-label' } },
    { ...issue, issue: { ...issue.issue, user: { login: 'outsider' } } },
    { ...issue, issue: { ...issue.issue, pull_request: {} } },
    { ...issue, action: 'edited' },
  ]) assert.throws(() => resolveCommand(bad, issueEnv), /owner-authorized/);
});
test('owner handoff approval label is strictly bound to task and approval IDs', async () => {
  const issueEnv = { ...env, GITHUB_EVENT_NAME: 'issues' };
  const approvalIssue = {
    ...issue,
    label: { name: 'ai-handoff-approved' },
    issue: {
      ...issue.issue,
      number: 654,
      title: 'Approve bounded handoff',
      body: `task_id: ${id}\napproval_id: ${approvalId}`,
    },
  };
  const command = resolveCommand(approvalIssue, issueEnv);
  assert.equal(command.action, 'approve_handoff');
  assert.equal(command.taskId, id);
  assert.equal(command.approvalId, approvalId);

  const f = fakeApi({ tasks: [{ id, repository: REPOSITORY }] });
  const result = await execute(command, f.api);
  assert.equal(result.result, 'HANDOFF_APPROVED');
  assert.equal(result.accepted, true);
  const decision = f.calls.find(call => call.path.endsWith('/decision'));
  assert.equal(decision.method, 'POST');
  assert.deepEqual(decision.body, { decision: 'APPROVE', actor: 'github-owner' });
});

test('handoff approval issue rejects malformed identifiers', () => {
  const issueEnv = { ...env, GITHUB_EVENT_NAME: 'issues' };
  assert.throws(() => resolveCommand({
    ...issue,
    label: { name: 'ai-handoff-approved' },
    issue: { ...issue.issue, body: 'task_id: nope\napproval_id: also-nope' },
  }, issueEnv), /task_id/);
});

test('input budgets, IDs, instruction limits, and actions are validated', () => {
  for (const max_cycles of ['0', '4', '21', '5.5', 'NaN']) assert.throws(() => resolve({ max_cycles }), /max_cycles/);
  for (const request_id of ['../secret', 'a b', '${{secrets.ADMIN_API_KEY}}']) assert.throws(() => resolve({ request_id }), /request_id/);
  assert.throws(() => resolve({ action: 'deploy' }), /Invalid action/);
  assert.throws(() => resolve({ action: 'submit', instruction: '' }), /instruction/);
  assert.throws(() => resolve({ action: 'submit', instruction: 'x'.repeat(19001) }), /instruction/);
  assert.throws(() => resolve({ action: 'stop', task_id: '../main' }), /task_id/);
});
test('submission is bounded and accepted is not reported as completed', async () => {
  const f = fakeApi();
  const result = await execute(resolve({ action: 'submit', instruction: 'Add unit test', request_id: 'test-123' }), f.api);
  assert.equal(result.result, 'TASK_ACCEPTED_NOT_COMPLETED');
  assert.equal(result.productionApprovalRequired, true);
  const create = f.calls.find(call => call.path === '/ai/coding/tasks' && call.method === 'POST');
  assert.equal(create.body.repository, REPOSITORY);
  assert.match(create.body.instruction, /Preserve production approval gates/);
  assert.equal(f.calls.find(call => call.path.endsWith('/start')).body.maxCycles, 5);
  assert.ok(!f.calls.some(call => /approve-merge|deploy/.test(call.path)));
});
test('owner issue reruns surface a completed AI Core task as TASK_COMPLETED', async () => {
  const issueEnv = { ...env, GITHUB_EVENT_NAME: 'issues' };
  const command = resolveCommand({ ...issue, label: { name: 'ai-task' } }, issueEnv);
  const instruction = command.instruction + '\n\nExecution policy: Use an isolated working branch. Preserve production approval gates. Do not bypass tests, access secrets, force-push, or directly modify production. Submit verified changes as a pull request.';
  const f = fakeApi({
    tasks: [{ id, repository: REPOSITORY, projectName: 'GitHub Trigger issue-321', instruction }],
    state404: false,
  });
  const result = await execute(command, f.api, { waitMs: 0 });
  assert.equal(result.result, 'TASK_COMPLETED');
  assert.equal(result.autonomousStatus, 'COMPLETED');
  assert.ok(!f.calls.some(call => call.path.endsWith('/start')));
});

test('matching request reruns do not recreate or restart completed tasks', async () => {
  const command = resolve({ action: 'submit', instruction: 'Add unit test', request_id: 'stable' });
  const first = fakeApi();
  await execute(command, first.api);
  const created = first.calls.find(call => call.path === '/ai/coding/tasks' && call.method === 'POST').body;
  const second = fakeApi({ tasks: [{ id, ...created }], state404: false });
  const result = await execute(command, second.api);
  assert.equal(result.result, 'EXISTING_TASK_NOT_RESTARTED');
  assert.ok(!second.calls.some(call => call.path.endsWith('/start')));
  assert.ok(!second.calls.some(call => call.path === '/ai/coding/tasks' && call.method === 'POST'));
});
test('request IDs cannot silently change an instruction', async () => {
  const f = fakeApi({ tasks: [{ id, repository: REPOSITORY, projectName: 'GitHub Trigger stable', instruction: 'old instruction' }] });
  await assert.rejects(execute(resolve({ action: 'submit', instruction: 'new', request_id: 'stable' }), f.api), /different instruction/);
  assert.ok(f.calls.every(call => !call.method));
});
test('status and stop require a task from the allowlisted repository', async () => {
  const f = fakeApi({ tasks: [{ id, repository: 'other/repo' }] });
  await assert.rejects(execute(resolve({ action: 'stop', task_id: id }), f.api), /does not belong/);
  assert.ok(f.calls.every(call => !call.method));
  const valid = fakeApi({ tasks: [{ id, repository: REPOSITORY }] });
  assert.equal((await execute(resolve({ action: 'stop', task_id: id }), valid.api)).result, 'STOP_REQUESTED');
});
test('public health probes omit the admin header used on protected coding routes', async () => {
  const calls = [];
  const api = createApi('secret', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await api('/healthz');
  await api('/healthz/full');
  await api('/ai/coding/tasks');

  assert.equal(calls[0].options.headers['x-admin-api-key'], undefined);
  assert.equal(calls[1].options.headers['x-admin-api-key'], undefined);
  assert.equal(calls[2].options.headers['x-admin-api-key'], 'secret');
  for (const call of calls) {
    assert.equal(call.options.headers.Accept, 'application/json');
    assert.equal(call.options.headers['User-Agent'], 'CST-AI-Core-GitHub-Trigger/1.0');
  }
});

test('API fixes the destination, disallows redirects, and JSON-encodes instructions', async () => {
  const seen = [];
  const api = createApi('test-secret', async (url, options) => { seen.push({ url, options }); return { ok: true, status: 201, json: async () => ({ id }) }; });
  const instruction = '$(touch /tmp/unsafe); `echo unsafe` ${{ secrets.X }}';
  await api('/ai/coding/tasks', { method: 'POST', body: { instruction } });
  assert.equal(seen[0].url, 'https://aicore.cstlogistic.co.id/api/ai/coding/tasks');
  assert.equal(seen[0].options.redirect, 'error');
  assert.equal(JSON.parse(seen[0].options.body).instruction, instruction);
  await assert.rejects(api('//attacker.example'), /scope/);
  await assert.rejects(api('/ai/coding/../../secrets'), /scope/);
});
test('GET probes retry transient transport failures but protected mutations stay single-shot', async () => {
  let getCalls = 0;
  const getApi = createApi('test-secret', async () => {
    getCalls++;
    if (getCalls === 1) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
  });
  const result = await getApi('/healthz');
  assert.equal(result.status, 200);
  assert.equal(getCalls, 2);

  let postCalls = 0;
  const postApi = createApi('test-secret', async () => {
    postCalls++;
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    postApi('/ai/coding/tasks', { method: 'POST', body: {} }),
    /fetch failed/,
  );
  assert.equal(postCalls, 1);
});

test('idempotent bridge command retries transient transport and 5xx failures', async () => {
  let transportCalls = 0;
  const transportApi = createApi('test-secret', async () => {
    transportCalls++;
    if (transportCalls < 3) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ created: false }) };
  });
  const transportResult = await transportApi('/ai/coding/bridge/commands', {
    method: 'POST',
    body: { externalCommandId: 'issue-528' },
  });
  assert.equal(transportResult.status, 200);
  assert.equal(transportCalls, 3);

  let statusCalls = 0;
  const statusApi = createApi('test-secret', async () => {
    statusCalls++;
    if (statusCalls === 1) {
      return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) };
    }
    return { ok: true, status: 200, json: async () => ({ created: false }) };
  });
  const statusResult = await statusApi('/ai/coding/bridge/commands', {
    method: 'POST',
    body: { externalCommandId: 'issue-528' },
  });
  assert.equal(statusResult.status, 200);
  assert.equal(statusCalls, 2);
});

test('failed mutations are not retried and secret bodies are not logged', async () => {
  let calls = 0;
  const api = createApi('test-secret', async () => { calls++; return { ok: false, status: 401, json: async () => ({ secret: 'never-show-this' }) }; });
  await assert.rejects(api('/ai/coding/tasks', { method: 'POST', body: {} }), error => /HTTP 401/.test(error.message) && !error.message.includes('never-show-this'));
  assert.equal(calls, 1);
});
test('missing admin credential is rejected before network use', () => {
  assert.throws(() => createApi(''), /not configured/);
});

test('a fresh task starts analysis before enabling the autonomous runtime', async () => {
  const f = fakeApi();
  await execute(resolve({ action: 'submit', instruction: 'Add test' }), f.api);
  const analyzer = f.calls.findIndex(call => call.path.endsWith('/run'));
  const autonomous = f.calls.findIndex(call => call.path.endsWith('/start'));
  assert.ok(analyzer >= 0 && analyzer < autonomous);
});
test('interrupted submissions reuse running analysis instead of starting it again', async () => {
  const f = fakeApi({ runs: [{ id, status: 'RUNNING', agentName: 'Repository Analyzer' }] });
  await execute(resolve({ action: 'submit', instruction: 'Add test' }), f.api);
  assert.ok(!f.calls.some(call => call.path.endsWith('/run')));
  assert.ok(f.calls.some(call => call.path.endsWith('/start')));
});
test('failed analysis is not silently restarted', async () => {
  const f = fakeApi({ runs: [{ id, status: 'FAILED', agentName: 'Repository Analyzer' }] });
  await assert.rejects(execute(resolve({ action: 'submit', instruction: 'Add test' }), f.api), /no active analysis/);
  assert.ok(!f.calls.some(call => call.path.endsWith('/run') || call.path.endsWith('/start')));
});
test('an immediately blocked autonomous cycle is not reported as accepted', async () => {
  const f = fakeApi({ initialStatus: 'BLOCKED' });
  const result = await execute(resolve({ action: 'submit', instruction: 'Add test' }), f.api);
  assert.equal(result.result, 'TASK_BLOCKED');
  assert.equal(result.initialStatus, 'BLOCKED');
});
