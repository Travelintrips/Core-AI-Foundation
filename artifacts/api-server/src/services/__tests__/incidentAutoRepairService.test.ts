import { describe, expect, it } from "vitest";
import {
  classifyIncidentRisk,
  incidentRepairFailureDisposition,
  resolveIncidentRisk,
} from "../incidentAutoRepairService.js";

describe("classifyIncidentRisk", () => {
  it("blocks destructive or structural Supabase incidents behind owner approval", () => {
    expect(classifyIncidentRisk("supabase", "schema_drift")).toBe("OWNER_APPROVAL");
    expect(classifyIncidentRisk("supabase", "migration_failed")).toBe("OWNER_APPROVAL");
    expect(classifyIncidentRisk("supabase", "rls_policy_conflict")).toBe("OWNER_APPROVAL");
  });

  it("keeps GitHub and Hostinger failures guarded", () => {
    expect(classifyIncidentRisk("github", "workflow_failed")).toBe("GUARDED");
    expect(classifyIncidentRisk("hostinger", "deployment_failed")).toBe("GUARDED");
  });

  it("allows only bounded retry-like system incidents as safe", () => {
    expect(classifyIncidentRisk("system", "stale_worker_retryable")).toBe("SAFE");
  });
});

describe("resolveIncidentRisk", () => {
  it("never lets a caller downgrade a Supabase structural incident", () => {
    expect(resolveIncidentRisk("supabase", "schema_drift", "SAFE")).toBe("OWNER_APPROVAL");
  });

  it("never lets a caller downgrade a guarded GitHub incident", () => {
    expect(resolveIncidentRisk("github", "workflow_failed", "SAFE")).toBe("GUARDED");
  });

  it("allows callers to escalate risk", () => {
    expect(resolveIncidentRisk("github", "workflow_failed", "OWNER_APPROVAL")).toBe("OWNER_APPROVAL");
  });
});


describe("incidentRepairFailureDisposition", () => {
  it("keeps the first two repair failures recoverable", () => {
    expect(incidentRepairFailureDisposition(0)).toEqual({
      failures: 1,
      retryable: true,
      incidentStatus: "OPEN",
    });
    expect(incidentRepairFailureDisposition(1)).toEqual({
      failures: 2,
      retryable: true,
      incidentStatus: "OPEN",
    });
  });

  it("blocks only after bounded automatic recovery is exhausted", () => {
    expect(incidentRepairFailureDisposition(2)).toEqual({
      failures: 3,
      retryable: false,
      incidentStatus: "BLOCKED",
    });
  });
});
