import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCredentials,
  validateResult,
  main
} from '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs';

const VALID=Object.freeze({
  database:'postgres',
  host:'db.xssrfshdrtdfupgqwfdw.supabase.co',
  password:'X'.repeat(64),
  port:5432,
  projectRef:'xssrfshdrtdfupgqwfdw',
  sslMode:'verify-full',
  user:'dev_gpt02_relock_catalog_auditor'
});

test('original existing credential schema is pinned',()=>{
  assert.equal(validateCredentials({...VALID}),true);
});
test('cross-project, untrusted host, and wrong role all denied',()=>{
  for(const change of [
    {projectRef:'nzdweipzckfszczzqtuw'},
    {host:'db.example.org'},
    {user:'postgres'},
    {sslMode:'disable'},
    {port:6432},
  ])assert.throws(()=>validateCredentials({...VALID,...change}),/RELOCK_/);
});
test('extra, missing, short and malformed credential fields fail',()=>{
  for(const candidate of [
    {...VALID,debug:true},
    {...VALID,password:'short'},
    {...VALID,password:null},
    {...VALID,host:undefined},
    null,[],{}
  ])assert.throws(()=>validateCredentials(candidate),/RELOCK_/);
});
test('phase results allow bounded integer counts only',()=>{
  for(const n of [0,1,3,1000])assert.equal(validateResult(n,'PHASE_A'),n);
  for(const n of [-1,1001,2.4,NaN,Infinity, '1', null, undefined]){
    assert.throws(()=>validateResult(n,'PHASE_B'),/RELOCK_/);
  }
});
test('never connects if not in explicit DEV mode',async()=>{
  const before=process.env.APP_ENV;
  const beforeCred=process.env.CREDENTIALS_DIRECTORY;
  try{
    process.env.APP_ENV='production';
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.equal(await main(),3);
  }finally{
    if(before===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=before;
    if(beforeCred===undefined)delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY=beforeCred;
  }
});
test('no systemd credential context means NO-GO, no connection',async()=>{
  const before=process.env.APP_ENV;
  const beforeCred=process.env.CREDENTIALS_DIRECTORY;
  try{
    process.env.APP_ENV='development';
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.equal(await main(),3);
  }finally{
    if(before===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=before;
    if(beforeCred===undefined)delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY=beforeCred;
  }
});
