import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateOneJobImage} from "./cst-team-onejob-image-provenance.mjs";
const sha="a".repeat(40);
const ready={expectedSha:sha,sourceLabel:sha,marker:sha,
 scope:"DEV_ONEJOB_IMAGE_PROVENANCE_ONLY",prodDeploy:"false",
 imageId:"sha256:"+"b".repeat(64)};
const denies=(v,reason)=>{
 const report=evaluateOneJobImage({...ready,...v});
 assert.equal(report.verified,false);
 assert.ok(report.blockers.includes(reason),report.blockers.join(","));
};
test("only identical exact SHA and explicit DEV-only image is eligible",()=>{
 const v=evaluateOneJobImage(ready);
 assert.equal(v.verified,true);assert.equal(v.sideEffects,"NO_DB_NO_CREDENTIALS_NO_DEPLOY");
});
test("old embedded SHA and forged or missing image metadata fail closed",()=>{
 denies({marker:"c".repeat(40)},"EMBEDDED_BUILD_SHA_MISMATCH");
 denies({marker:""},"EMBEDDED_BUILD_SHA_MISMATCH");
 denies({sourceLabel:"c".repeat(40)},"IMAGE_SOURCE_LABEL_MISMATCH");
 denies({scope:"PRODUCTION"},"NOT_DEV_ONEJOB_IMAGE");
 denies({prodDeploy:"true"},"PROD_DEPLOY_FLAG_NOT_FALSE");
 denies({imageId:"no-image"},"IMAGE_ID_MISSING");
 denies({expectedSha:"short"},"EXPECTED_SOURCE_SHA_INVALID");
});
test("probe only reads provenance from an ephemeral network-none cat container",()=>{
 const s=readFileSync(new URL("./cst-team-onejob-image-provenance.mjs",import.meta.url),"utf8");
 assert.match(s,/--network","none"/);
 assert.match(s,/--entrypoint","cat"/);
 assert.match(s,/\.cst-build-sha/);
 assert.doesNotMatch(s,/docker.*\b(?:push|build|start|stop|rm\s+-f)\b/i);
 assert.doesNotMatch(s,/CREATE ROLE|ALTER ROLE|INSERT INTO|SUPABASE.*PASSWORD|execute_sql/);
});
