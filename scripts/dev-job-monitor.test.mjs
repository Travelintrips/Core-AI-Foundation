import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const routes = readFileSync(new URL('../artifacts/api-server/src/routes/jobs.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../artifacts/ai-platform/src/pages/dashboard.tsx', import.meta.url), 'utf8');

function route(name) {
  const start = routes.indexOf(`router.get("${name}"`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = routes.indexOf('\n});', start);
  assert.ok(end > start, `${name} route termination missing`);
  return routes.slice(start, end + 4);
}

test('DEV monitor stays restricted to development and behind /api auth', () => {
  for (const path of ['/dev-center/dashboard', '/dev-center/dashboard.css', '/dev-center/dashboard.js', '/dev-center/jobs']) {
    assert.match(route(path), /process\.env\["APP_ENV"\] !== "development"/);
    assert.match(route(path), /res\.sendStatus\(404\)/);
  }
});

test('monitor JavaScript compiles and mounts all visible controls', () => {
  const js = route('/dev-center/dashboard.js').match(/res\.type\("javascript"\)\.send\(`([\s\S]*?)`\);/);
  assert.ok(js?.[1], 'monitor script missing');
  assert.doesNotThrow(() => new Script(js[1]));
  const html = route('/dev-center/dashboard');
  for (const id of ['connection', 'totals', 'jobs', 'filter', 'search']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('unverified progress is never synthesized from a job status', () => {
  const api = route('/dev-center/jobs');
  assert.match(api, /progressEvidenceId/);
  assert.match(api, /final_ack_verified/);
  assert.match(api, /verifiedProgress/);
  assert.match(api, /FAILED/);
  assert.doesNotMatch(api, /progress:\s*100/);
  assert.match(api, /Promise\.allSettled/);
});

test('dashboard includes authenticated DEV monitoring entry point', () => {
  assert.match(dashboard, /href="\/api\/dev-center\/dashboard"/);
  assert.match(dashboard, /import\.meta\.env\.DEV/);
});
