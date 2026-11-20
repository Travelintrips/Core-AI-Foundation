import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {
  validateCredentials, validateResult, main
} from '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs';

const dir=dirname(fileURLToPath(import.meta.url));
const deploy=resolve(dir,'../../deploy/ai-coding-standalone-dev');
const credential={
  host:'db.xssrfshdrtdfupgqwfdw.supabase.co',
  port:5432,database:'postgres',
  user:'dev_gpt02_relock_catalog_auditor',
  password:'SYNTHETIC_FIXTURE_PASSWORD_WITH_MORE_THAN_FORTY_FIVE_CHARACTERS',
  sslMode:'verify-full',projectRef:'xssrfshdrtdfupgqwfdw'
};

test('exact project, role and TLS are pinned',()=>{
  assert.equal(validateCredentials(credential),true);
  for(const [key,value] of [
    ['user','postgres'],['port',6543],['sslMode','disable'],
    ['host','another.supabase.co'],['projectRef','prod'],
    ['database','other'],['password','too-short']
  ]){
    assert.throws(()=>validateCredentials({...credential,[key]:value}),/RELOCK_/);
  }
  assert.throws(()=>validateCredentials({...credential,extra:true}),/FIELDS/);
  assert.throws(()=>validateCredentials(null),/SHAPE/);
});

test('only bounded nonnegative integer cleanup counts are acceptable',()=>{
  for(const n of [0,1,1000])assert.equal(validateResult(n,'A'),n);
  for(const invalid of [-1,1001,1.5,NaN,'1',null,Infinity]){
    assert.throws(()=>validateResult(invalid,'B'),/NOT_BOUNDED_INTEGER/);
  }
});

test('service is isolated and cannot start without encrypted credential',()=>{
  const unit=readFileSync(resolve(deploy,'gpt02-issue159-relock-catalog-auditor.service'),'utf8');
  const timer=readFileSync(resolve(deploy,'gpt02-issue159-relock-catalog-auditor.timer'),'utf8');
  assert.match(unit,/^DynamicUser=yes$/m);
  assert.match(unit,/^User=gpt02-relock-auditor$/m);
  assert.match(unit,/^ProtectSystem=strict$/m);
  assert.match(unit,/^NoNewPrivileges=yes$/m);
  assert.match(unit,/^PrivateTmp=yes$/m);
  assert.match(unit,/^ConditionPathExists=\/etc\/credstore\.encrypted\/gpt02-issue159-relock-catalog-dsn$/m);
  assert.match(unit,/^LoadCredentialEncrypted=relock-catalog-dsn:\/etc\/credstore\.encrypted\/gpt02-issue159-relock-catalog-dsn$/m);
  assert.match(unit,/^ExecStart=\/usr\/bin\/node \/opt\/ai-coding-standalone-dev\/gpt02_issue159_relock_catalog_supervisor\.mjs$/m);
  assert.doesNotMatch(unit,/^ExecStartPre=|^ExecStartPost=|^EnvironmentFile=|^PassEnvironment=/m);
  assert.doesNotMatch(unit,/^\[Install\]/m);
  assert.match(timer,/^OnUnitInactiveSec=5s$/m);
  assert.doesNotMatch(unit,/gpt02-issue159-issuer-reader-dsn/);
});

test('without explicit DEV mode the supervisor denies before any connection',async()=>{
  const prior=process.env.APP_ENV;
  try{
    delete process.env.APP_ENV;
    const result=await main();
    assert.equal(result,3);
  }finally{
    if(prior===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=prior;
  }
});
