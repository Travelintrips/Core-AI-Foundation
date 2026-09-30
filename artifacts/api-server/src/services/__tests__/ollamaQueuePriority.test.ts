import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("remote Ollama queue priority contracts", () => {
  it("keeps interactive AI Core chat ahead of long-running planner work", () => {
    const chat = readFileSync(
      new URL("../../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );
    const planner = readFileSync(
      new URL("../localCodingAutomatedMultiTaskPlannerService.ts", import.meta.url),
      "utf8",
    );

    expect(chat).toContain("queuePriority: 95");
    expect(planner).toContain("queuePriority: 60");
  });

  it("keeps a bounded default priority for other Ollama work", () => {
    const queue = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(queue).toContain("Math.floor(options.priority ?? 70)");
    expect(queue).toContain("Math.min(100");
    expect(queue).toContain("Math.max(");
    expect(queue).toContain("priorityScore: String(priority)");
  });
});
