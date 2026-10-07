import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalogSource = readFileSync(
  new URL("../../routes/catalog.ts", import.meta.url),
  "utf8",
);
const customerPortalSource = readFileSync(
  new URL("../../routes/customer-portal.ts", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../../../customer-portal/src/pages/dashboard.tsx", import.meta.url),
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

  it("sends quotation email links through the customer dashboard handoff", () => {
    expect(catalogSource).toContain("/api/public/customer/quotation-access/");
    expect(customerPortalSource).toContain(
      'router.get("/public/customer/quotation-access/:token"',
    );
    expect(customerPortalSource).toContain(
      "issueDashboardAccessForEmail",
    );
    expect(customerPortalSource).toContain(
      "quotation_dashboard_handoff",
    );
  });

  it("surfaces the emailed quotation from inside the dashboard", () => {
    expect(dashboardSource).toContain('search.get("focusRequest")');
    expect(dashboardSource).toContain('search.get("quotationToken")');
    expect(dashboardSource).toContain("Penawaran Anda sudah siap");
    expect(dashboardSource).toContain("Lihat Penawaran");
    expect(dashboardSource).toContain("&fromDashboard=1");
  });

  it("routes legacy direct quotation links through the dashboard exactly once", () => {
    const requestQuotationSource = readFileSync(
      new URL("../../../../customer-portal/src/pages/request-quotation.tsx", import.meta.url),
      "utf8",
    );
    expect(requestQuotationSource).toContain('query.get("fromDashboard") === "1"');
    expect(requestQuotationSource).toContain(
      "/api/public/customer/quotation-access/",
    );
    expect(requestQuotationSource).toContain("window.location.replace");
  });
});
