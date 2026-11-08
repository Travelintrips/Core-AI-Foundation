import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
const mock=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],error:false,calls:0}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>{
  mock.calls++;if(mock.error)throw Error("permission denied");return {rows:mock.rows};
}}}));
import {interpretGpt02Job135ArchiveCensus,readGpt02Job135ArchiveCensus}
  from "../gpt02Job135ArchiveCensus.js";
const row={
 parent_present:true,parent_created_at:"2026-11-07T18:56:09.873Z",
 old_archive_total:86,legacy_command_total:12,legacy_response_total:11,
 archive_parent_tag_matches:0,archives_created_after_parent:0,
 historical_sources_covered:3,legacy_untagged_attempts_excluded:false,
 may_create_command:false,may_dispatch_worker:false,may_close_job:false,
};
describe("GPT02 Job135 archived evidence is read-only and cannot grant issuer",()=>{
 const env=process.env["APP_ENV"],node=process.env["NODE_ENV"];
 beforeEach(()=>{mock.rows=[row];mock.calls=0;mock.error=false;
  process.env["APP_ENV"]="development";process.env["NODE_ENV"]="development";});
 afterEach(()=>{if(env===undefined)delete process.env["APP_ENV"];else process.env["APP_ENV"]=env;
  if(node===undefined)delete process.env["NODE_ENV"];else process.env["NODE_ENV"]=node;});
 it("returns archival counts without claiming no external legacy attempts",async()=>{
  expect(await readGpt02Job135ArchiveCensus()).toMatchObject({
   available:true,priorDevArchiveCommands:86,legacyArchiveCommands:12,
   legacyArchiveResponses:11,explicitParentArchiveMatches:0,
   archivedAfterParentCount:0,legacyUntaggedAttemptsExcluded:false,
   mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
  expect(mock.calls).toBe(1);
 });
 it("known match never authorizes issuance",()=>{
  expect(interpretGpt02Job135ArchiveCensus({...row,archive_parent_tag_matches:1}))
   .toMatchObject({available:true,explicitParentArchiveMatches:1,
    mayCreateCommand:false,mayDispatchWorker:false});
 });
 it("rejects missing, corrupted and exaggerated evidence",()=>{
  for(const bad of [undefined,{...row,old_archive_total:-1},
   {...row,old_archive_total:"86"},
   {...row,historical_sources_covered:2},
   {...row,legacy_untagged_attempts_excluded:true},
   {...row,may_create_command:true},
   {...row,parent_present:false}])
   expect(interpretGpt02Job135ArchiveCensus(bad)).toMatchObject({
    available:false,mayCreateCommand:false,mayDispatchWorker:false});
 });
 it("unavailable SQL is not a valid count",async()=>{
  mock.error=true;
  expect(await readGpt02Job135ArchiveCensus()).toMatchObject({
   available:false,reason:"ARCHIVE_CENSUS_READBACK_UNAVAILABLE",
   mayCreateCommand:false});
 });
 it("not DEV denies before database access",async()=>{
  process.env["APP_ENV"]="production";
  expect(await readGpt02Job135ArchiveCensus()).toMatchObject({available:false,reason:"DEV_ONLY"});
  expect(mock.calls).toBe(0);
 });
});
