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

test('old failed/review-required records are display-only history, not active alerts', () => {
  assert.match(monitor, /HISTORY_CUTOFF_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(monitor, /isCurrentAttention = \(job: Job, now = Date\.now\(\)\) => attention\.has\(job\.status\) && !isStale\(job, now\)/);
  assert.match(monitor, /summary\.history/);
  assert.match(monitor, /value="history"/);
  assert.match(monitor, /value="attention"/);
  assert.match(monitor, /Ini pengelompokan tampilan, bukan perubahan status database/);
});

test('terminal FAILED is separate from actionable blocked/review and verified PASS', () => {
  assert.match(monitor, /const attention = new Set\(\["BLOCKED", "REVIEW_REQUIRED"\]\)/);
  assert.match(monitor, /failed: jobs\.filter\(job => job\.status === "FAILED"\)\.length/);
  assert.match(monitor, /value="failed"/);
  assert.match(monitor, /value="verifying"/);
  assert.match(monitor, /Status selesai \(bukan PASS\)/);
  assert.doesNotMatch(monitor, /attention = new Set\(\["FAILED"/);
});

test('all six stat cards are real filter controls and support single-click selection', () => {
  assert.match(monitor, /<button type="button" key=\{item.label\} aria-pressed=\{filter === item.filter\}/);
  for (const f of ['running','waiting','attention','verifying','failed','completed']) assert.ok(monitor.includes(`filter: "${f}"`));
  assert.match(monitor, /setFilter\(item.filter as JobFilter\)/);
});

test('checkbox, select all and removal are limited to terminal jobs', () => {
  assert.match(monitor, /const eligible = shown.filter\(job => Boolean\(job.deleteKey\) && terminal.has\(job.status\)\)/);
  assert.match(monitor, /const allChecked = eligible.length > 0/);
  assert.match(monitor, /aria-label="Pilih semua pekerjaan terminal yang tampil"/);
  assert.match(monitor, /disabled=\{!actionsAvailable \|\| !terminal.has\(job.status\) \|\| !job.deleteKey\}/);
  assert.match(monitor, /\/api\/dev-center\/jobs\/dismiss/);
  assert.match(monitor, /window.confirm/);
});

test('dismiss endpoint requires user session and checks live source terminal status before saving', () => {
  const api=routes.slice(routes.indexOf('router.post("/dev-center/jobs/dismiss"'),routes.indexOf('// ── List Jobs ──'));
  assert.match(api, /process.env\["APP_ENV"\] !== "development"/);
  assert.match(api, /!req.internalUser/);
  assert.match(api, /CROSS_ORIGIN_NOT_ALLOWED/);
  assert.match(api, /keys.length>100/);
  assert.match(api, /status IN \('FAILED','COMPLETED','CANCELLED'\)/);
  assert.match(api, /status IN \('failed','completed','cancelled'\)/);
  assert.match(api, /ai_platform.dev_monitor_dismissed_jobs/);
  assert.doesNotMatch(api, /DELETE FROM|UPDATE ai_task_bridge.jobs|UPDATE public.ai_execution_jobs/);
});

test('statcard counts match visible filters and hidden selections cannot be removed', () => {
  assert.match(monitor, /filter === "running" && \(!running.has\(job.status\) \|\| isStale\(job, now\)\)/);
  assert.match(monitor, /filter === "waiting" && \(!waiting.has\(job.status\) \|\| isStale\(job, now\)\)/);
  assert.match(monitor, /filter === "verifying" && \(!verifying.has\(job.status\) \|\| isStale\(job, now\)\)/);
  assert.match(monitor, /const keys = shown.filter/);
  assert.match(monitor, /const visibleChecked = eligible.filter/);
  assert.match(monitor, /setFilter\(item.filter as JobFilter\); setSelected\(null\); setChecked\(\[\]\)/);
});

test('DEV Human escalation requires authenticated internal user and explicit OpenClaw evidence', () => {
  const api = routes.slice(routes.indexOf('router.post("/dev-center/jobs/human-assistance"'), routes.indexOf('router.get("/dev-center/jobs/human-assistance"'));
  assert.match(api, /process.env\["APP_ENV"\] !== "development"/);
  assert.match(api, /!actor \|\| actor.status !== "active"/);
  assert.match(api, /CROSS_ORIGIN_NOT_ALLOWED/);
  assert.match(api, /reason.trim\(\).length<20/);
  assert.match(api, /openClawEvidence.trim\(\).length<20/);
  assert.match(api, /ASSIGNEE_NOT_ACTIVE_INTERNAL_USER/);
});

test('Human escalation verifies live blocked status, deduplicates and never resumes worker', () => {
  const api = routes.slice(routes.indexOf('router.post("/dev-center/jobs/human-assistance"'), routes.indexOf('router.get("/dev-center/jobs/human-assistance"'));
  assert.match(api, /pg_advisory_xact_lock/);
  assert.doesNotMatch(api, /FOR UPDATE/); // runtime role has read-only source permissions
  assert.match(api, /"BLOCKED","REVIEW_REQUIRED","FAILED"/);
  assert.match(api, /ai_platform.ai_human_tasks/);
  assert.match(api, /ai_platform.ai_human_task_history/);
  assert.match(api, /ON CONFLICT DO NOTHING/);
  assert.match(api, /resumeAllowed:false/);
  assert.doesNotMatch(api, /UPDATE ai_task_bridge.jobs|UPDATE public.ai_execution_jobs|UPDATE ai_platform.ai_jobs|SUSPEND_USER|RESUME_USER|dispatchCommand/);
});

test('Dashboard shows Human Task assignment, blocker evidence and locked resume', () => {
  assert.match(monitor, /Minta Bantuan Human/);
  assert.match(monitor, /\/api\/dev-center\/jobs\/human-assistance/);
  assert.match(monitor, /\/human-tasks/);
  assert.match(monitor, /resume GPT02 MASIH DIKUNCI/);
  assert.match(monitor, /openClawEvidence/);
  assert.match(monitor, /"BLOCKED","REVIEW_REQUIRED","FAILED"/);
});


test('monitor distinguishes unavailable or partial data from an observed zero and blocks unsafe actions', () => {
  assert.match(monitor, /jobMonitorCount\(item.count, availability\)/);
  assert.match(monitor, /Jumlah pekerjaan belum diketahui/);
  assert.match(monitor, /setJobs\(\[\]\)/);
  assert.match(monitor, /setAssistance\(\{\}\)/);
  assert.match(monitor, /setChecked\(\[\]\)/);
  assert.match(monitor, /if \(!actionsAvailable \|\| !keys.length \|\| deleting\) return/);
  assert.match(monitor, /assistanceUsable \? <HumanAssistancePanel/);
  assert.match(monitor, /parseHumanAssistanceSnapshot<Assistance>/);
  assert.match(monitor, /await gate.run\(async/);
  assert.match(monitor, /window.setTimeout\(\(\) => request.abort\(\), 12_000\)/);
  assert.match(monitor, /controller\?\.abort\(\)/);
  assert.match(monitor, /setActionError\(/);
});

test('ordinary polling does not reset an open assistance form', () => {
  const poll = monitor.slice(monitor.indexOf('useEffect(() => {'),monitor.indexOf('const availability = jobMonitorAvailability'));
  assert.ok(poll.includes('setAssistanceAvailability("ready")'));
  assert.ok(poll.includes('setAssistanceAvailability("unavailable")'));
  assert.ok(!poll.includes('setAssistanceAvailability("loading")'));
});

test('monitor search includes existing blocker, stage, evidence and parent status without changing job actions', () => {
  assert.match(monitor, /const text = \[job.title, job.id, job.source, job.worker, job.accountable, job.status, job.stage, job.blocker, job.evidence, job.parentTaskStatus\]/);
  assert.match(monitor, /text.includes\(query.trim\(\).toLowerCase\(\)\)/);
  assert.match(monitor, /placeholder="Cari job, hambatan, tahap, bukti"/);
});

test('blocked and failed jobs show reported blocker or explicit missing evidence in the list', () => {
  assert.ok(monitor.includes('(attention.has(job.status) || job.status === "FAILED")'));
  assert.ok(monitor.includes('data-testid="job-blocker-summary"'));
  assert.ok(monitor.includes('job.blocker?.trim() || "Tidak tercatat"'));
});

test('next action is guidance only and handles missing assistance, unsupported job keys and completed human work', () => {
  const guide = monitor.split('data-testid="job-next-action"')[1].split('</div>}')[0];
  for (const marker of ['!assistanceUsable', '!job.deleteKey', 'assistance?.status === "completed"', 'Resume tetap terkunci', 'Tidak ada eksekusi ulang otomatis']) assert.ok(guide.includes(marker));
  assert.doesNotMatch(guide, /fetch\(|onClick=|dispatchCommand/);
});
