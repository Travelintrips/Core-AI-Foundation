import { describe, expect, it } from "vitest";
import { resolveCustomerJob, type CustomerJob } from "./customerJobResolver";
const scope = { companyId: "company-a", customerId: "customer-a" };
const base: CustomerJob[] = [
  { id: "F", ...scope, title: "Desain Fashion", category: "fashion", status: "in_progress", progressPercent: 70, checkpoint: "Pola disetujui" },
  { id: "I", ...scope, title: "Desain Interior", category: "interior", status: "in_progress", progressPercent: 40 },
  { id: "L", ...scope, title: "Desain Logo", category: "logo", status: "completed", progressPercent: 100 },
];
describe("customer job matching", () => {
  it("selects fashion rather than interior or logo and reads its actual progress", () => {
    const result = resolveCustomerJob("Bagaimana fashion saya?", base, scope);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") { expect(result.job.id).toBe("F"); expect(result.reply).toContain("70%"); expect(result.reply).toContain("Pola disetujui"); }
  });
  it("recognizes synonym baju", () => {
    const result = resolveCustomerJob("Baju saya sudah sampai mana?", base, scope);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.job.id).toBe("F");
  });
  it("asks for clarification when two fashion jobs are possible", () => {
    const jobs = [...base, { id: "F2", ...scope, title: "Desain Fashion Gaun", category: "fashion", status: "queued" }];
    const result = resolveCustomerJob("Bagaimana fashion saya?", jobs, scope);
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") expect(result.candidates.map((j) => j.id)).toEqual(["F", "F2"]);
  });
  it("never leaks jobs from another customer or tenant", () => {
    const other = { id: "X", companyId: "company-b", customerId: "customer-b", title: "Fashion", category: "fashion", status: "private" };
    expect(resolveCustomerJob("fashion", [other], scope).kind).toBe("not_found");
  });
  it("does not fabricate progress percentage", () => {
    const r = resolveCustomerJob("logo saya", [{ ...base[2], progressPercent: null }], scope);
    if (r.kind === "matched") expect(r.reply).not.toContain("%");
    else throw new Error("Expected match");
  });
});
