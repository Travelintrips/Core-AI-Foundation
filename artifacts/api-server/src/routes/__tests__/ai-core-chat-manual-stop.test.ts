import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI Core Chat manual stop lifecycle", () => {
  it("closes active resources without creating another coding task", () => {
    const source = readFileSync(
      new URL("../ai-core-chat.ts", import.meta.url),
      "utf8",
    );

    const stopBlockStart = source.indexOf("if (wantsStop)");
    const resumeBlockStart = source.indexOf(
      "const current = await getAutonomousCodingTaskStatus",
      stopBlockStart,
    );
    expect(stopBlockStart).toBeGreaterThan(-1);
    expect(resumeBlockStart).toBeGreaterThan(stopBlockStart);

    const stopBlock = source.slice(stopBlockStart, resumeBlockStart);
    expect(stopBlock).toContain("disableAutonomousCodingTask(task.id)");
    expect(stopBlock).toContain('eq(aiCodingRunsTable.status, "RUNNING")');
    expect(stopBlock).toContain('status: "COMPLETED"');
    expect(stopBlock).toContain("payload_json->>'codingTaskId'");
    expect(stopBlock).toContain("payload_json->>'taskId'");
    expect(stopBlock).toContain("status = 'cancelled'");
    expect(stopBlock).toContain("releaseCodingFileReservations(task.id)");
    expect(stopBlock).toContain('status: "BLOCKED"');
    expect(stopBlock).toContain('source: "ai-core-chat-manual-stop"');
    expect(stopBlock).not.toContain("startAgentTask(");
  });
});
