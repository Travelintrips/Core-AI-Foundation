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
