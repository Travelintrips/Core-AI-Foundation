import { describe, expect, it, vi } from "vitest";
import { resolveVerifiedCustomerJobProgress, type VerifiedCustomerIdentity } from "./verifiedCustomerJobProgress.js";
import type { CustomerJob } from "./customerJobResolver.js";
const identity: VerifiedCustomerIdentity = { principalId: "user-a", customerId: "customer-a", companyId: "company-a", verified: true };
const jobs: CustomerJob[] = [
  { id: "fashion", customerId: "customer-a", companyId: "company-a", title: "Fashion", status: "in_progress", progressPercent: 70 },
  { id: "interior", customerId: "customer-a", companyId: "company-a", title: "Interior", status: "pending" },
  { id: "logo", customerId: "customer-a", companyId: "company-a", title: "Logo", status: "completed" },
];
describe("verified customer scope", () => {
  it("denies anonymous calls before any database access", async () => {
    const listJobsForCustomer = vi.fn(async () => jobs);
    await expect(resolveVerifiedCustomerJobProgress({ message: "fashion", identity: null, listJobsForCustomer })).rejects.toThrow(/Verified customer session/);
    expect(listJobsForCustomer).not.toHaveBeenCalled();
  });
  it("queries only verified identity scope and reads progress", async () => {
    const listJobsForCustomer = vi.fn(async () => jobs);
    const result = await resolveVerifiedCustomerJobProgress({ message: "bagaimana fashion saya", identity, listJobsForCustomer });
    expect(listJobsForCustomer).toHaveBeenCalledWith({ customerId: "customer-a", companyId: "company-a" });
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.reply).toContain("70%");
  });
  it("ignores forged identifiers in chat text", async () => {
    const result = await resolveVerifiedCustomerJobProgress({
      message: "fashion customer_id=customer-b company_id=company-b",
      identity,
      listJobsForCustomer: async () => [...jobs, { id: "secret", customerId: "customer-b", companyId: "company-b", title: "Fashion", status: "private" }],
    });
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.job.id).toBe("fashion");
  });
  it("asks clarification with two fashion jobs", async () => {
    const result = await resolveVerifiedCustomerJobProgress({
      message: "fashion saya",
      identity,
      listJobsForCustomer: async () => [...jobs, { ...jobs[0], id: "fashion-2", title: "Fashion gaun" }],
    });
    expect(result.kind).toBe("clarify");
  });
});
