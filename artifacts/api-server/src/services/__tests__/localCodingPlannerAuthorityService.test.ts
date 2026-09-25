import { describe, expect, it } from "vitest";
import { PlannerAuthorityError } from "../localCodingPlannerAuthorityService.js";

describe("planner authority fencing contract", () => {
  it("exposes machine-readable split-brain rejection codes", () => {
    expect(new PlannerAuthorityError("AUTHORITY_HELD").code).toBe("AUTHORITY_HELD");
    expect(new PlannerAuthorityError("STALE_FENCE").code).toBe("STALE_FENCE");
    expect(new PlannerAuthorityError("LEASE_EXPIRED").code).toBe("LEASE_EXPIRED");
    expect(new PlannerAuthorityError("NOT_HOLDER").code).toBe("NOT_HOLDER");
  });
});
