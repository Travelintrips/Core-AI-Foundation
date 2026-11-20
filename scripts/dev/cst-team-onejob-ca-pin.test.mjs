import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,writeFileSync,symlinkSync,chmodSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { X509Certificate } from "node:crypto";
import {
  CST_ONEJOB_DEV_CA_PATH,
  CST_ONEJOB_SUPABASE_CA_FINGERPRINT,
  loadPinnedCstDevSupabaseRootCa,
  createPinnedCstOneJobPgConnection,
} from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";

const FIXTURE=fileURLToPath(new URL("./fixtures/supabase-root-2021-public-qa.crt",import.meta.url));
test("only public Supabase Root 2021 CA with expected fingerprint is trusted",()=>{
  assert.equal(CST_ONEJOB_DEV_CA_PATH,"/run/cst-onejob-dev-db/ca/prod-ca-2021.crt");
  const pem=loadPinnedCstDevSupabaseRootCa(FIXTURE);
  const cert=new X509Certificate(pem);
  assert.equal(cert.ca,true);
  assert.equal(cert.fingerprint256.replace(/:/g,"").toUpperCase(),
    CST_ONEJOB_SUPABASE_CA_FINGERPRINT);
  assert.equal(cert.verify(cert.publicKey),true);
});
test("missing, writable, symlink or corrupted CA blocks client initialization",()=>{
  const dir=mkdtempSync(join(tmpdir(),"cst-pinned-ca-"));
  try {
    const missing=join(dir,"missing.crt");
    assert.throws(()=>loadPinnedCstDevSupabaseRootCa(missing),/CA_NOT_AVAILABLE/);
    const ca=join(dir,"copy.crt");
    writeFileSync(ca,readFileSync(FIXTURE),{mode:0o644});
    chmodSync(ca,0o666);
    assert.throws(()=>loadPinnedCstDevSupabaseRootCa(ca),/CA_FILE_NOT_TRUSTED/);
    chmodSync(ca,0o644);
    const symlink=join(dir,"link.crt");
    symlinkSync(ca,symlink);
    assert.throws(()=>loadPinnedCstDevSupabaseRootCa(symlink),/CA_FILE_NOT_TRUSTED/);
    writeFileSync(ca,"NOT_A_CERTIFICATE");
    assert.throws(()=>loadPinnedCstDevSupabaseRootCa(ca),/CA_FILE_NOT_TRUSTED|CA_INVALID_PEM/);
    writeFileSync(ca,readFileSync(FIXTURE).toString().replace("MIIDxD","MIIDxE"));
    assert.throws(()=>loadPinnedCstDevSupabaseRootCa(ca),/CA_INVALID_PEM|CA_FINGERPRINT_MISMATCH/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("the live one-job adapter may not trust an arbitrary system root",()=>{
  const source=readFileSync(new URL("../../lib/db/src/cstOneJobDevSocketTransport.ts",import.meta.url),"utf8");
  assert.match(source,/loadPinnedCstDevSupabaseRootCa\(pinnedCaFile\)/);
  assert.match(source,/rejectUnauthorized: true, ca: trustedCa/);
  assert.doesNotMatch(source,/rejectUnauthorized:\s*false/);
  assert.match(source,/CST_ONEJOB_DEV_CA_PATH/);
});

test("both one-job dedicated logins use exact DEV host and pinned CA",()=>{
  for(const role of ["cst_team_model_pilot_stage_login","cst_onejob_broker_login"]){
    const url="postgresql://"+role+".xssrfshdrtdfupgqwfdw:"+
      "synthetic-password-only-123@aws-1-ap-southeast-2.pooler.supabase.com"+
      ":6543/postgres?sslmode=verify-full";
    const config=createPinnedCstOneJobPgConnection(url,role,FIXTURE);
    assert.equal(config.host,"aws-1-ap-southeast-2.pooler.supabase.com");
    assert.equal(config.port,6543);
    assert.equal(config.database,"postgres");
    assert.equal(config.user,role+".xssrfshdrtdfupgqwfdw");
    assert.equal(config.ssl.rejectUnauthorized,true);
    assert.equal(config.ssl.servername,config.host);
    assert.equal(new X509Certificate(config.ssl.ca).fingerprint256.replace(/:/g,"").toUpperCase(),
      CST_ONEJOB_SUPABASE_CA_FINGERPRINT);
    assert.equal(Object.hasOwn(config,"connectionString"),false);
    for(const bad of [
      url.replace("aws-1-ap-southeast-2","aws-0-ap-southeast-1"),
      url.replace(":6543/postgres",":5432/postgres"),
      url.replace("verify-full","no-verify"),
      url+"&sslrootcert=/tmp/fake",
      url.replace(role+".xssrfshdrtdfupgqwfdw",
        "aicore_dev_runtime.xssrfshdrtdfupgqwfdw")
    ])assert.throws(()=>createPinnedCstOneJobPgConnection(bad,role,FIXTURE),
      /DATABASE_SCOPE_OR_TLS_DENIED/);
    assert.throws(()=>createPinnedCstOneJobPgConnection(url,role,"/not/installed/ca"),
      /CA_NOT_AVAILABLE/);
  }
});
test("direct staging and broker paths cannot lose CA via connectionString",()=>{
  const stage=readFileSync(new URL(
    "../../artifacts/api-server/src/lib/cstOneJobStagingDatabase.ts",import.meta.url),"utf8");
  const broker=readFileSync(new URL(
    "./cst-onejob-trusted-admission-bridge.mjs",import.meta.url),"utf8");
  assert.match(stage,/createPinnedCstOneJobPgConnection\(url,CST_ONEJOB_STAGE_LOGIN\)/);
  assert.match(broker,/createPinnedCstOneJobPgConnection\(env\[KEY\],LOGIN\)/);
  assert.doesNotMatch(stage,/connectionString\s*:\s*url/);
  assert.doesNotMatch(broker,/connectionString\s*:\s*env\[KEY\]/);
});
