import test from "node:test";
import assert from "node:assert/strict";
import { statusForBoundAnswer } from "./dell-wake-executor.mjs";

const data = {
  kind: "SOP_CHECKPOINT", status: "PAUSED",
  jobId: "job-1", commandId: "cmd-1", correlationId: "corr-1",
  checkpointId: "cp-1", sopVersion: "sop-v1", nextStepId: "step-2",
};
const message = JSON.stringify(data);
const work = { commandId: "cmd-1", metadata: { correlationId: "corr-1" } };
const verifiedAnswer = {
  ok: true, message,
  details: { verifiedAssistantReply: true, assistantResponseText: message },
};
test("verified bound pause reports FAILED to parent command", () => {
  assert.equal(statusForBoundAnswer(work, verifiedAnswer), "FAILED");
});
test("cross-command and unverified answers never trigger SOP resume", () => {
  assert.equal(statusForBoundAnswer({ ...work, commandId: "cmd-2" }, verifiedAnswer), "COMPLETED");
  assert.equal(statusForBoundAnswer({ ...work, metadata: { correlationId: "corr-2" } }, verifiedAnswer), "COMPLETED");
  assert.equal(statusForBoundAnswer(work, { ...verifiedAnswer,
    details: { ...verifiedAnswer.details, verifiedAssistantReply: false } }), "COMPLETED");
});
test("ordinary replies retain existing status", () => {
  assert.equal(statusForBoundAnswer(work, {
    ...verifiedAnswer, message: "Task completed.",
    details: { ...verifiedAnswer.details, assistantResponseText: "Task completed." },
  }), "COMPLETED");
});
