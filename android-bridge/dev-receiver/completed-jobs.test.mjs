import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {completedJobPath,isCompletedJob,markCompletedJob} from './completed-jobs.mjs';

const job='e2b234b3-28bf-4f02-bb1a-9ff9126b84fc';
test('ACK-complete marker is durable and idempotent without exposing credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dev-completed-mark-'));
 try {
  assert.equal(isCompletedJob(dir,job),false);
  const file=markCompletedJob(dir,job);
  assert.equal(file,completedJobPath(dir,job));
  assert.ok(fs.statSync(file).isFile());
  assert.equal(isCompletedJob(dir,job),true);
  assert.equal(markCompletedJob(dir,job),file);
  assert.equal(fs.readdirSync(dir).length,1);
  for (const invalid of ['../../etc/passwd', '123', '',null])
   assert.throws(()=>completedJobPath(dir,invalid));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
