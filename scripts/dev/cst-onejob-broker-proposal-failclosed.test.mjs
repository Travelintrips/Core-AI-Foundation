import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../",import.meta.url);
const sql=(path)=>readFileSync(new URL(path,root),"utf8");
const broker=sql("docs/dev/cst-onejob-waiting-admission-broker.PROPOSED.sql");
const receipt=sql("docs/dev/cst-onejob-independent-receipts.PROPOSED.sql");

test("proposed broker remains unconditionally non-authorizing",()=>{
  assert.match(broker,/CREATE\s+ROLE\s+cst_onejob_admission_broker\s+NOLOGIN\s+NOINHERIT/i);
  assert.match(broker,/NOBYPASSRLS/i);
  assert.match(broker,/REVOKE\s+ALL\s+ON\s+FUNCTION\s+cst_onejob_private\.admit_waiting_job\(/i);
  assert.match(broker,/RAISE\s+EXCEPTION\s+'ONEJOB_ATOMIC_ADMISSION_NOT_YET_AUTHORIZED'\s*;/i);
  const deny=broker.indexOf("RAISE EXCEPTION 'ONEJOB_ATOMIC_ADMISSION_NOT_YET_AUTHORIZED'");
  const returnJob=broker.indexOf("RETURN v_job.id;");
  assert.ok(deny>=0 && returnJob>deny,"NON_AUTHORIZING_BARRIER_REMOVED_OR_MOVED");
  const beforeDeny=broker.slice(broker.indexOf("CREATE OR REPLACE FUNCTION"),deny)
    .replace(/--[^\n]*/g,"");
  assert.doesNotMatch(beforeDeny,/\bUPDATE\s+ai_platform\.ai_jobs\b/i);
  assert.doesNotMatch(beforeDeny,/\bINSERT\s+INTO\s+cst_onejob_private\.admission_receipt_consumptions\b/i);
  assert.doesNotMatch(broker,/\bGRANT\s+cst_onejob_admission_broker\s+TO\b/i);
  assert.doesNotMatch(broker,/\bALTER\s+ROLE\s+cst_onejob_admission_broker\s+LOGIN\b/i);
});

test("proposed receipt and replay tables remain protected and unpublished",()=>{
  for(const name of ["verified_admission_receipts","admission_receipt_consumptions"]){
    assert.match(receipt,new RegExp("ALTER\\s+TABLE\\s+cst_onejob_private\\."+name+"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY","i"));
    assert.match(receipt,new RegExp("ALTER\\s+TABLE\\s+cst_onejob_private\\."+name+"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY","i"));
    assert.match(receipt,new RegExp("REVOKE\\s+ALL\\s+ON\\s+cst_onejob_private\\."+name+"\\s+FROM\\s+PUBLIC","i"));
  }
  const operational=receipt.replace(/--[^\n]*/g,"");
  assert.doesNotMatch(operational,/\bGRANT\s+(?:INSERT|UPDATE|DELETE|ALL|EXECUTE)\b/i);
  assert.doesNotMatch(operational,/\bCREATE\s+POLICY\b/i);
  assert.match(receipt,/\bnonce\s+text\s+NOT\s+NULL\s+UNIQUE\b/i);
  assert.match(receipt,/\bproof_digest\s+text\s+NOT\s+NULL\s+UNIQUE\b/i);
});
