import { describe, it, expect } from "vitest";
import { listScopedCustomerJobs } from "./scopedCustomerJobs.js";
describe("scoped query identity validation", () => {
  it("rejects customer ID supplied as a non-numeric value before querying", async () => {
    await expect(listScopedCustomerJobs({ customerId: "customer-b", companyId: "company-a" })).rejects.toThrow(/Valid verified customer/);
  });
  it("rejects missing tenant before querying", async () => {
    await expect(listScopedCustomerJobs({ customerId: "12", companyId: "" })).rejects.toThrow(/Valid verified customer/);
  });
});
