import { describe, expect, it } from "vitest";
import { assessGpt02LifecycleE2e, requiredLifecycleGates, type GateEvidence } from "../gpt02LifecycleE2eGate.js";
const parent = "83db99f5-cbda-4e60-be71-3090fb411bbb";
const candidate = "41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const observations = (): GateEvidence[] => requiredLifecycleGates.map(gate => ({
  gate, jobId: 135, parentCommandId: parent, candidateCommandId: candidate,
  verified: true, evidenceId: "audit:" + gate, recordedAt: "2026-11-08T11:20:00.000Z",
}));
const assess = (rows: GateEvidence[] = observations()) =>
  assessGpt02LifecycleE2e({ jobId: 135, parentCommandId: parent, candidateCommandId: candidate, observations: rows });
describe("integrated GPT02 lifecycle diagnostic contract is strictly non-authorizing", () => {
  it("never issues grants even with all evidence recorded", () => {
    expect(assess()).toMatchObject({readyForHumanReview:true,reviewOnly:true,
      mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,missingOrUnverified:[]});
  });
  it.each(requiredLifecycleGates)("fails closed when %s is missing", gate => {
    const x = assess(observations().filter(o => o.gate !== gate));
    expect(x.readyForHumanReview).toBe(false);
    expect(x.missingOrUnverified).toContain(gate);
    expect(x.mayDispatchWorker).toBe(false);
  });
  it("rejects a duplicate ambiguous evidence row", () => {
    const x = assess([...observations(), observations()[0]!]);
    expect(x.gates[0]?.reason).toBe("AMBIGUOUS_EVIDENCE");
  });
  it("rejects evidence bound to another job or candidate", () => {
    const rows = observations(); rows[2] = {...rows[2]!,jobId:136};
    expect(assess(rows).missingOrUnverified).toContain("legacyAttemptsExcluded");
    rows[2] = {...rows[2]!,jobId:135,candidateCommandId:parent};
    expect(assess(rows).missingOrUnverified).toContain("legacyAttemptsExcluded");
  });
  it("rejects non-verified evidence, empty provenance and invalid time", () => {
    const rows = observations(); rows[5] = {...rows[5]!,verified:false};
    expect(assess(rows).missingOrUnverified).toContain("exclusiveFencingLease");
    rows[5] = {...rows[5]!,verified:true,evidenceId:" "};
    expect(assess(rows).missingOrUnverified).toContain("exclusiveFencingLease");
    rows[5] = {...rows[5]!,evidenceId:"proof",recordedAt:"unknown"};
    expect(assess(rows).missingOrUnverified).toContain("exclusiveFencingLease");
  });
  it("rejects invalid subjects and parent identical to candidate", () => {
    const x = assessGpt02LifecycleE2e({jobId:135,parentCommandId:parent,
      candidateCommandId:parent, observations:observations()});
    expect(x.readyForHumanReview).toBe(false);
    expect(x.mayDispatchWorker).toBe(false);
  });
  it("does not mutate evidence", () => {
    const rows = observations(); const before = JSON.stringify(rows);
    assess(rows); expect(JSON.stringify(rows)).toBe(before);
  });
});
