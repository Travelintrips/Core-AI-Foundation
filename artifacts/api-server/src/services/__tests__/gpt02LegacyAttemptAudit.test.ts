import {describe,expect,it,vi,beforeEach,afterEach} from "vitest";
const mock=vi.hoisted(()=>({rows:[] as Array<Record<string,unknown>>}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:mock.rows})}}));
import {assessGpt02LegacyAttemptCensus,readGpt02LegacyAttemptCensus} from "../gpt02LegacyAttemptAudit.js";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const child="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const obs=()=>({commandId:child,hasExplicitParentTag:false,hasDurableLink:false,
  sameJobEvidence:false,temporalOverlap:false});
describe("legacy command census never claims proof of no untagged attempts",()=>{
  beforeEach(()=>{process.env["APP_ENV"]="development";mock.rows=[];});
  afterEach(()=>{delete process.env["APP_ENV"];});
  it("empty inventory cannot exclude legacy",()=>{
    expect(assessGpt02LegacyAttemptCensus({parentCommandId:parent,scannedCommandCount:0,
      totalCommandCount:0,observations:[]})).toMatchObject({
        reason:"UNLINKED_LEGACY_HISTORY_NOT_EXCLUDED",
        legacyUntaggedAttemptsExcluded:false,mayDispatchWorker:false});
  });
  it("partial scan denies",()=>{
    expect(assessGpt02LegacyAttemptCensus({parentCommandId:parent,scannedCommandCount:0,
      totalCommandCount:1,observations:[]}).reason).toBe("INCOMPLETE_COMMAND_CENSUS");
  });
  it("duplicate identity denies",()=>{
    expect(assessGpt02LegacyAttemptCensus({parentCommandId:parent,scannedCommandCount:2,
      totalCommandCount:2,observations:[obs(),obs()]}).reason).toBe("AMBIGUOUS_COMMAND_IDENTITY");
  });
  it.each(["hasExplicitParentTag","hasDurableLink","sameJobEvidence","temporalOverlap"] as const)(
    "marks %s as potential legacy child",key=>{
      const item={...obs(),[key]:true};
      expect(assessGpt02LegacyAttemptCensus({parentCommandId:parent,scannedCommandCount:1,
        totalCommandCount:1,observations:[item]})).toMatchObject({
          reason:"POSSIBLE_LEGACY_CHILD_ATTEMPTS",suspectedCommandIds:[child],
          mayCreateCommand:false});
    });
  it("complete but apparently clean scan still denies exclusion",()=>{
    expect(assessGpt02LegacyAttemptCensus({parentCommandId:parent,scannedCommandCount:1,
      totalCommandCount:1,observations:[obs()]}).legacyUntaggedAttemptsExcluded).toBe(false);
  });
  it("rejects production read before DB access",async()=>{
    process.env["APP_ENV"]="production";
    expect(await readGpt02LegacyAttemptCensus({parentCommandId:parent})).toMatchObject({
      reason:"NOT_DEV",mayDispatchWorker:false});
  });
  it("missing parent fails closed",async()=>{
    expect(await readGpt02LegacyAttemptCensus({parentCommandId:parent})).toMatchObject({
      reason:"PARENT_COMMAND_NOT_FOUND",legacyUntaggedAttemptsExcluded:false});
  });
  it("source rows with counts never authorize",async()=>{
    mock.rows=[{total_count:3,tagged_count:0,same_job_count:1,overlapping_count:3}];
    expect(await readGpt02LegacyAttemptCensus({parentCommandId:parent})).toMatchObject({
      reason:"POSSIBLE_LEGACY_CHILD_ATTEMPTS",mayCreateCommand:false,mayDispatchWorker:false});
  });
});
