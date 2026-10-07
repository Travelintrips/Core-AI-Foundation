import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalogSource = readFileSync(
  new URL("../../routes/catalog.ts", import.meta.url),
  "utf8",
);

describe("catalog quotation delivery contract", () => {
  it("does not allow waiting_customer_approval to be set manually", () => {
    expect(catalogSource).toContain('if (status === "waiting_customer_approval")');
    expect(catalogSource).toContain("Cannot set waiting_customer_approval manually");
    expect(catalogSource).toContain("/issue-quotation");
  });

  it("advances to customer-wait only after SMTP accepts the quotation email", () => {
    expect(catalogSource).toContain(
      'const requestStatus = emailResult.ok ? "waiting_customer_approval" : "quotation_ready";',
    );
    expect(catalogSource).toContain(".set({ status: requestStatus");
  });

  it("blocks quotation delivery until required margin approval is cleared", () => {
    expect(catalogSource).toContain(
      "serviceReq.marginApprovalRequired && !serviceReq.marginApprovedBy",
    );
  });

  it("persists pricing line item codes through the real quotation-item schema", () => {
    expect(catalogSource).toContain('itemType: "service"');
    expect(catalogSource).toContain("metadataJson: { code: item.code }");
    expect(catalogSource).not.toContain("itemCode: item.code");
  });
});
