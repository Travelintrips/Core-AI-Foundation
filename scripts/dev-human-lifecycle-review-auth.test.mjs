import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../artifacts/api-server/src/routes/human-tasks.ts',import.meta.url),'utf8');
const scoped=api.slice(api.indexOf('// Fail-closed for AI Core lifecycle reviews only.'),api.indexOf('// ── Stats'));
test('only lifecycle review uses extra authentication without changing other Human Tasks',()=>{
 assert.match(scoped,/task\.sourceModule !== "ai_core_lifecycle"/);
 assert.match(scoped,/NODE_ENV !== "development"/);
 assert.match(scoped,/requireAuth\(req,res/);
 assert.match(scoped,/requireInternalRole\("owner", "admin"\)/);
 assert.match(scoped,/requirePasswordChanged/);
 assert.match(scoped,/router\.use\("\/ai\/human-tasks\/:id", guardLifecycleReview\)/);
});
test('client cannot impersonate assigned reviewer or bypass origin protection',()=>{
 assert.match(scoped,/assigned!==actor\.email\.trim\(\)\.toLowerCase\(\)/);
 assert.match(scoped,/performedBy:actor\.email/);
 assert.match(scoped,/LIFECYCLE_REVIEW_ORIGIN_REQUIRED/);
 assert.match(scoped,/LIFECYCLE_REVIEW_CROSS_ORIGIN/);
 assert.match(scoped,/if \(req\.method !== "GET"\)/);
});
test('does not create resume, dispatch, completion or approve on behalf of reviewer',()=>{
 for(const marker of ['submitCodingBridgeCommand','dispatchExternalAgentWork','resumeAuthorized:true','acceptTask(','completeTask('])assert.ok(!scoped.includes(marker));
});
