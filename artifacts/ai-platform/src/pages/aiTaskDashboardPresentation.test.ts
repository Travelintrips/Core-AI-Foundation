// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queue = readFileSync(new URL("./queue.tsx", import.meta.url), "utf8");
const coding = readFileSync(new URL("./aicoding-dashboard.tsx", import.meta.url), "utf8");

describe("AI Task dashboard worker pool presentation", () => {
  it("includes a lease-aware worker pool on the queue dashboard", () => {
    expect(queue).toContain("AI Task & Queue Center");
    expect(queue).toContain("AiTaskWorkerPool");
    expect(queue).toContain("selectPoolCandidate(workers, \"coding_workstream\")");
    expect(queue).toContain("Server must recheck capability, account binding,");
  });

  it("shows verified ready/busy/unverified states in AI Coding operations dashboard", () => {
    expect(coding).toContain("AI Task · Dynamic Worker Pool");
    expect(coding).toContain("assessCodingDashboardWorker(worker)");
    expect(coding).toContain("Coding GPT-02 yang sibuk dapat dialihkan ke GPT-03");
    expect(coding).toContain("Dashboard ini tidak mengeksekusi dispatch.");
  });

  it("does not claim account session activation or auto-dispatch through the UI", () => {
    expect(queue).not.toContain("travelincars01@gmail.com");
    expect(coding).not.toContain("travelincars01@gmail.com");
    expect(queue).not.toContain("dispatchCodingTask.mutate(");
  });
});
