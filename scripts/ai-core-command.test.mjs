import test from 'node:test';
import assert from 'node:assert/strict';
import { REPOSITORY, resolveCommand, createApi, execute } from './ai-core-command.mjs';

const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_ACTOR: 'Travelintrips',
  GITHUB_TRIGGERING_ACTOR: 'Travelintrips', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '1234' };
const id = 'a1234567-1234-1234-1234-123456789abc';
const resolve = inputs => resolveCommand({ inputs }, env);
const issue = { action: 'labeled', sender: { login: 'Travelintrips' }, label: { name: 'ai-audit' },
  issue: { number: 321, title: 'Audit trigger', body: 'Read-only test', user: { login: 'Travelintrips' } } };

function fakeApi({ ready = true, tasks = [], state404 = true } = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/healthz') return { status: 200, value: { status: 'ok' } };
    if (path === '/healthz/full') return { status: 200, value: { status: ready ? 'ok' : 'degraded', checks: { db: { status: ready ? 'ok' : 'fail' } } } };
    if (path.endsWith('/runtime-status')) return { status: 200, value: { ready, autonomous: { configured: true, running: true }, dependencies: { githubConfigured: true } } };
    if (path === '/ai/coding/tasks') return options.method === 'POST'
      ? { status: 201, value: { id, ...options.body } } : { status: 200, value: tasks };
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
  assert.equal(resolveCommand({ ...issue, label: { name: 'ai-task' } }, issueEnv).action, 'submit');
  for (const bad of [
    { ...issue, sender: { login: 'outsider' } },
    { ...issue, label: { name: 'random-label' } },
    { ...issue, issue: { ...issue.issue, user: { login: 'outsider' } } },
    { ...issue, issue: { ...issue.issue, pull_request: {} } },
    { ...issue, action: 'edited' },
  ]) assert.throws(() => resolveCommand(bad, issueEnv), /owner-authorized/);
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
test('failed mutations are not retried and secret bodies are not logged', async () => {
  let calls = 0;
  const api = createApi('test-secret', async () => { calls++; return { ok: false, status: 401, json: async () => ({ secret: 'never-show-this' }) }; });
  await assert.rejects(api('/ai/coding/tasks', { method: 'POST', body: {} }), error => /HTTP 401/.test(error.message) && !error.message.includes('never-show-this'));
  assert.equal(calls, 1);
});
test('missing admin credential is rejected before network use', () => {
  assert.throws(() => createApi(''), /not configured/);
});
