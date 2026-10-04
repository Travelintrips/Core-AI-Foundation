// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dispatcherSource = readFileSync(
  new URL("../jobDispatcherService.ts", import.meta.url),
  "utf8",
);
const workspaceRouteSource = readFileSync(
  new URL("../../routes/coding-workspace.ts", import.meta.url),
  "utf8",
);

describe("worker monitor metadata", () => {
  it("registers dispatcher workers with explicit routing/runtime metadata", () => {
    expect(dispatcherSource).toContain('providerSlug:       "dynamic"');
    expect(dispatcherSource).toContain('providerSlug:       "internal"');
    expect(dispatcherSource).toContain('modelId:            "per-job"');
    expect(dispatcherSource).toContain('runtimeKind:        "dispatcher"');
    expect(dispatcherSource).toContain("providerSlug: cfg.providerSlug");
    expect(dispatcherSource).toContain("modelId: cfg.modelId");
    expect(dispatcherSource).toContain("runtimeKind: cfg.runtimeKind");
  });

  it("does not count retired alpha beta gamma placeholders as live unavailable workers", () => {
    expect(workspaceRouteSource).toContain(
      "const legacyPlaceholder = /^worker-(alpha|beta|gamma)$/i.test(worker.workerName)",
    );
    expect(workspaceRouteSource).toContain(
      "const operationalWorkerDetails = workerDetails.filter(",
    );
    expect(workspaceRouteSource).toContain(
      "retiredLegacy: retiredLegacyWorkers",
    );
    expect(workspaceRouteSource).toContain(
      "details: operationalWorkerDetails",
    );
  });
});
