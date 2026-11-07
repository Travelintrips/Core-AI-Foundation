import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const get = path => readFileSync(new URL(path, root), 'utf8');
const routes = get('artifacts/api-server/src/routes/jobs.ts');
const middleware = get('artifacts/api-server/src/middleware/adminAuth.ts');
const dashboard = get('artifacts/ai-platform/src/pages/dashboard.tsx');
const monitor = get('artifacts/ai-platform/src/components/UnifiedJobMonitor.tsx');
function route(name) {
  const start = routes.indexOf(`router.get("${name}"`);
  assert.ok(start >= 0, `missing route ${name}`);
  const end = routes.indexOf('\n});', start);
  assert.ok(end > start, `missing route end ${name}`);
  return routes.slice(start, end + 4);
}
test('monitor is embedded in main dashboard, not a separate link', () => {
  assert.match(dashboard, /<UnifiedJobMonitor \/>/);
  assert.match(dashboard, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(dashboard, /href="\/api\/dev-center\/dashboard"/);
  assert.match(monitor, /\/api\/dev-center\/jobs/);
  assert.match(monitor, /credentials: "include"/);
});
test('legacy monitoring links redirect to the existing main UI and do not show second login', () => {
  assert.match(route('/dev-center/dashboard'), /res\.redirect\(302, "\/"\)/);
  assert.match(route('/dev-center/login'), /res\.redirect\(302, "\/login"\)/);
  assert.match(middleware, /res\.redirect\(302, "\/login"\)/);
  assert.doesNotMatch(route('/dev-center/login'), /password|<form/);
  for (const path of ['/dev-center/login.js', '/dev-center/dashboard.js', '/dev-center/dashboard.css']) {
    assert.match(route(path), /res\.sendStatus\(410\)/);
  }
});
test('monitor data endpoint stays DEV-only and authenticated', () => {
  const api = route('/dev-center/jobs');
  assert.match(api, /process\.env\["APP_ENV"\] !== "development"/);
  assert.match(api, /res\.sendStatus\(404\)/);
  assert.doesNotMatch(middleware.match(/const PUBLIC_ROUTE_RULES[\s\S]*?for \(const rule of PUBLIC_ROUTE_RULES\)/)?.[0] ?? '', /dev-center\/jobs/);
});
test('evidence-based progress, job owners, errors, and stale activity remain visible', () => {
  const api = route('/dev-center/jobs');
  assert.match(api, /progressEvidenceId/);
  assert.match(api, /final_ack_verified/);
  assert.match(api, /Promise\.allSettled/);
  for (const label of ['Penanggung jawab', 'Pelaksana', 'Hambatan', 'Progres terverifikasi']) assert.ok(monitor.includes(label));
  assert.match(monitor, /Belum terverifikasi/);
  assert.match(monitor, /3_600_000/);
});
