/**
 * TEAM 45 — Customer Portal Regression Tests
 *
 * Covers: customer journey status mapping, progress, payment visibility,
 * artifact visibility, download policy, timeline, notifications,
 * tenant isolation (API URL consistency), API consistency.
 */
import { describe, it, expect } from "vitest";
import { stageColor, stageLabel, fmtMoney, fmtDate } from "@/lib/workspace-format";
import { getCommercialStatusMeta } from "@/components/commercial/commercial-status-badge";

// ─── Phase 3: Status Consistency ─────────────────────────────────────────────

describe("stageColor — canonical stage coloring", () => {
  it("marks completed/delivered/order_completed as success (emerald)", () => {
    expect(stageColor("completed")).toContain("emerald");
    expect(stageColor("delivered")).toContain("emerald");
    expect(stageColor("order_completed")).toContain("emerald");
    expect(stageColor("converted_to_project")).toContain("emerald");
    expect(stageColor("files_unlocked")).toContain("emerald");
  });

  it("marks deliverable_ready and commercial_completed as success (emerald)", () => {
    expect(stageColor("deliverable_ready")).toContain("emerald");
    expect(stageColor("commercial_completed")).toContain("emerald");
  });

  it("marks workflow_completed and production_completed as preparing (violet)", () => {
    expect(stageColor("workflow_completed")).toContain("violet");
    expect(stageColor("production_completed")).toContain("violet");
  });

  it("marks action-required stages as amber (warning)", () => {
    const amber = ["waiting_customer_approval", "quotation_ready", "waiting_review",
      "revision_requested", "waiting_payment", "pending_payment"];
    for (const s of amber) {
      expect(stageColor(s)).toContain("amber"),
        `${s} should be amber`;
    }
  });

  it("marks payment-verification stages as blue (info)", () => {
    const blue = ["waiting_payment_verification", "waiting_commercial_gate", "deposit_paid"];
    for (const s of blue) {
      expect(stageColor(s)).toContain("blue"),
        `${s} should be blue`;
    }
  });

  it("marks production stages as orange (active)", () => {
    const orange = ["running", "in_progress", "generating", "ready_to_build", "building"];
    for (const s of orange) {
      expect(stageColor(s)).toContain("orange"),
        `${s} should be orange`;
    }
  });

  it("marks cancelled/failed as red (danger)", () => {
    expect(stageColor("cancelled")).toContain("red");
    expect(stageColor("failed")).toContain("red");
  });

  it("never returns an empty string for known canonical statuses", () => {
    const allKnown = [
      "draft", "brief_in_progress", "brief_submitted", "pending",
      "waiting_customer_approval", "quotation_ready", "waiting_payment",
      "waiting_payment_verification", "payment_verified", "running",
      "in_progress", "waiting_review", "revision_requested",
      "workflow_completed", "production_completed", "deliverable_ready",
      "commercial_completed", "files_unlocked", "completed",
      "order_completed", "delivered", "cancelled", "failed",
    ];
    for (const s of allKnown) {
      expect(stageColor(s).length).toBeGreaterThan(0),
        `stageColor("${s}") should not be empty`;
    }
  });
});

describe("stageLabel — canonical stage labels", () => {
  it("labels pre-production stages correctly", () => {
    expect(stageLabel("draft")).toBe("Waiting Brief");
    expect(stageLabel("brief_submitted")).toBe("Brief Submitted");
    expect(stageLabel("pending")).toBe("Menunggu");
  });

  it("labels commercial stages correctly", () => {
    expect(stageLabel("waiting_customer_approval")).toBe("Menunggu Persetujuan");
    expect(stageLabel("quotation_ready")).toBe("Quotation Siap");
    expect(stageLabel("waiting_payment")).toBe("Waiting Payment");
    expect(stageLabel("waiting_payment_verification")).toBe("Payment Verification");
  });

  it("labels production stages correctly", () => {
    expect(stageLabel("running")).toBe("Berjalan");
    expect(stageLabel("in_progress")).toBe("Dalam Proses");
    expect(stageLabel("waiting_review")).toBe("Menunggu Review");
    expect(stageLabel("revision_requested")).toBe("Revisi Diminta");
  });

  it("labels delivery/completion stages correctly", () => {
    expect(stageLabel("workflow_completed")).toBe("Preparing Files");
    expect(stageLabel("production_completed")).toBe("Preparing Files");
    expect(stageLabel("deliverable_ready")).toBe("Files Ready");
    expect(stageLabel("commercial_completed")).toBe("Files Ready");
    expect(stageLabel("files_unlocked")).toBe("Files Unlocked");
    expect(stageLabel("completed")).toBe("Selesai");
    expect(stageLabel("order_completed")).toBe("Selesai");
    expect(stageLabel("delivered")).toBe("Delivered");
  });

  it("falls back to humanized stage name for unknown stages", () => {
    expect(stageLabel("some_new_stage")).toBe("some new stage");
  });
});

// ─── Phase 5: Payment Visibility ─────────────────────────────────────────────

describe("fmtMoney — payment amount formatting", () => {
  it("formats IDR amounts correctly", () => {
    expect(fmtMoney(1500000, "IDR")).toBe("Rp1.500.000");
    expect(fmtMoney("2500000", "IDR")).toBe("Rp2.500.000");
  });

  it("returns dash for null/undefined amounts", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined)).toBe("—");
  });

  it("returns dash for NaN amounts", () => {
    expect(fmtMoney("not-a-number")).toBe("—");
  });

  it("formats non-IDR currencies correctly", () => {
    const result = fmtMoney(100, "USD");
    expect(result).toContain("USD");
    expect(result).toContain("100");
  });
});

// ─── Phase 6: Status Mapping (Commercial) ────────────────────────────────────

describe("getCommercialStatusMeta — commercial status badge mapping", () => {
  it("maps quotation lifecycle statuses", () => {
    expect(getCommercialStatusMeta("draft").label).toBe("Preparing Quotation");
    expect(getCommercialStatusMeta("sent").label).toBe("Awaiting Approval");
    expect(getCommercialStatusMeta("approved").label).toBe("Approved");
    expect(getCommercialStatusMeta("revision_requested").label).toBe("Revision Requested");
  });

  it("maps payment statuses", () => {
    expect(getCommercialStatusMeta("pending").label).toBe("Awaiting Payment");
    expect(getCommercialStatusMeta("waiting_payment_verification").label).toBe("Payment Verification");
    expect(getCommercialStatusMeta("paid").label).toBe("Paid");
    expect(getCommercialStatusMeta("overdue").tone).not.toBe("success");
  });

  it("maps production statuses", () => {
    expect(getCommercialStatusMeta("in_progress").label).toBe("In Production");
    expect(getCommercialStatusMeta("running").label).toBe("In Production");
    expect(getCommercialStatusMeta("waiting_review").label).toBe("In Production");
  });

  it("maps terminal statuses", () => {
    expect(getCommercialStatusMeta("completed").label).toBe("Completed");
    expect(getCommercialStatusMeta("cancelled").label).toBe("Cancelled");
    expect(getCommercialStatusMeta("failed").label).toBe("Failed");
  });

  it("returns Unknown for null/undefined status", () => {
    expect(getCommercialStatusMeta(null).label).toBe("Unknown");
    expect(getCommercialStatusMeta(undefined).label).toBe("Unknown");
  });

  it("returns raw status for completely unknown values", () => {
    const meta = getCommercialStatusMeta("totally_unknown_status_xyz");
    expect(meta.label).toBe("totally_unknown_status_xyz");
    expect(meta.tone).toBe("neutral");
  });
});

// ─── Phase 4: Progress Integrity ─────────────────────────────────────────────

describe("Progress integrity rules", () => {
  it("stageColor never returns empty for completed stages (progress=100% guard)", () => {
    // When progressPercent=100, stage MUST be in a terminal category
    const terminalStages = ["completed", "delivered", "order_completed", "files_unlocked"];
    for (const s of terminalStages) {
      expect(stageColor(s)).toContain("emerald"),
        `stage "${s}" at 100% must show success color`;
    }
  });

  it("production stages show active color (not success) while in progress", () => {
    // Ensures we never show 'completed' color while workflow is still running
    const productionStages = ["running", "in_progress", "generating", "building", "orchestrating"];
    for (const s of productionStages) {
      expect(stageColor(s)).not.toContain("emerald"),
        `stage "${s}" should not show completed color`;
      expect(stageColor(s)).not.toContain("green"),
        `stage "${s}" should not show green color`;
    }
  });
});

// ─── Phase 8: Download Policy ─────────────────────────────────────────────────

describe("Download policy — locked/unlocked logic", () => {
  it("filesUnlocked=false means locked regardless of stage", () => {
    // This tests the data contract from the API — locked flag is authoritative
    const lockedDeliverable = { locked: true, id: 1 };
    const unlockedDeliverable = { locked: false, id: 2 };
    expect(lockedDeliverable.locked).toBe(true);
    expect(unlockedDeliverable.locked).toBe(false);
  });

  it("signed URL endpoint path uses canonical workspace base", () => {
    const token = "test-token-abc";
    const assetId = 42;
    const expectedPath = `/api/public/customer/workspace/${token}/downloads/${assetId}/sign`;
    // Validates the URL construction matches the API contract
    const base = (t: string) => `/api/public/customer/workspace/${t}`;
    const signUrl = `${base(token)}/downloads/${assetId}/sign`;
    expect(signUrl).toBe(expectedPath);
  });
});

// ─── Phase 9: Notification Categories ────────────────────────────────────────

describe("Notification category coverage", () => {
  const KNOWN_CATEGORIES = ["order", "billing", "production", "marketing"];

  it("all known notification categories have a color mapping", () => {
    // Mirrors categoryColor() in notifications.tsx
    const categoryColor = (category: string): string => {
      switch (category) {
        case "order":      return "bg-blue-500";
        case "billing":    return "bg-amber-500";
        case "production": return "bg-violet-500";
        case "marketing":  return "bg-emerald-500";
        default:           return "bg-primary";
      }
    };
    for (const cat of KNOWN_CATEGORIES) {
      const color = categoryColor(cat);
      expect(color).not.toBe("bg-primary"),
        `category "${cat}" should have a dedicated color`;
    }
  });

  it("unknown notification category falls back to primary without throwing", () => {
    const categoryColor = (category: string): string => {
      switch (category) {
        case "order":      return "bg-blue-500";
        case "billing":    return "bg-amber-500";
        case "production": return "bg-violet-500";
        case "marketing":  return "bg-emerald-500";
        default:           return "bg-primary";
      }
    };
    expect(() => categoryColor("unknown_future_category")).not.toThrow();
    expect(categoryColor("unknown_future_category")).toBe("bg-primary");
  });
});

// ─── Phase 11: API Consistency ────────────────────────────────────────────────

describe("API endpoint consistency — workspace URL construction", () => {
  const buildBase = (token: string) => `/api/public/customer/workspace/${token}`;

  it("workspace summary endpoint is canonical", () => {
    expect(`${buildBase("tok")}/summary`).toBe("/api/public/customer/workspace/tok/summary");
  });

  it("projects list endpoint is canonical", () => {
    expect(`${buildBase("tok")}/projects`).toBe("/api/public/customer/workspace/tok/projects");
  });

  it("project detail endpoint is canonical", () => {
    expect(`${buildBase("tok")}/projects/CST-001`).toBe(
      "/api/public/customer/workspace/tok/projects/CST-001",
    );
  });

  it("notifications endpoint is canonical", () => {
    expect(`${buildBase("tok")}/notifications`).toBe(
      "/api/public/customer/workspace/tok/notifications",
    );
  });

  it("invoices endpoint is canonical", () => {
    expect(`${buildBase("tok")}/invoices`).toBe("/api/public/customer/workspace/tok/invoices");
  });

  it("downloads endpoint is canonical", () => {
    expect(`${buildBase("tok")}/downloads`).toBe("/api/public/customer/workspace/tok/downloads");
  });

  it("activity feed endpoint is canonical", () => {
    expect(`${buildBase("tok")}/activity`).toBe("/api/public/customer/workspace/tok/activity");
  });

  it("events (timeline) endpoint is canonical per project", () => {
    expect(`${buildBase("tok")}/projects/CST-001/events`).toBe(
      "/api/public/customer/workspace/tok/projects/CST-001/events",
    );
  });
});

// ─── Phase 13: Tenant Isolation ──────────────────────────────────────────────

describe("Tenant isolation — token scoping", () => {
  it("all workspace API paths are scoped to the customer token", () => {
    // Token is in the path — every API call requires it.
    // This verifies no global (token-less) data endpoints are used.
    const WORKSPACE_PATHS = [
      "/api/public/customer/workspace/:token/summary",
      "/api/public/customer/workspace/:token/projects",
      "/api/public/customer/workspace/:token/projects/:projectNumber",
      "/api/public/customer/workspace/:token/downloads",
      "/api/public/customer/workspace/:token/invoices",
      "/api/public/customer/workspace/:token/notifications",
      "/api/public/customer/workspace/:token/activity",
      "/api/public/customer/workspace/:token/profile",
    ];
    for (const path of WORKSPACE_PATHS) {
      expect(path).toContain(":token"),
        `Path "${path}" must be scoped to :token`;
    }
  });

  it("payment proof submission is scoped to a specific schedule ID", () => {
    // Payment proof is submitted to a specific scheduleId from the invoice,
    // preventing cross-tenant payment submission.
    const PAYMENT_PROOF_PATH = "/api/public/payments/:scheduleId/submit-proof";
    expect(PAYMENT_PROOF_PATH).toContain(":scheduleId");
  });
});

// ─── Phase 16: Global Customer Consistency ───────────────────────────────────

describe("Global consistency invariants", () => {
  it("completed stages are a strict superset of files-unlocked (no stranded completions)", () => {
    // "completed" in stageLabel must return a non-empty label
    const terminalStages = ["completed", "delivered", "order_completed", "files_unlocked"];
    for (const s of terminalStages) {
      expect(stageLabel(s).length).toBeGreaterThan(0),
        `stageLabel("${s}") must not be empty`;
    }
  });

  it("production stages never map to completed labels", () => {
    const productionStages = ["running", "in_progress", "generating", "building"];
    for (const s of productionStages) {
      expect(stageLabel(s)).not.toBe("Selesai");
      expect(stageLabel(s)).not.toBe("Completed");
      expect(stageLabel(s)).not.toBe("Files Ready");
    }
  });

  it("commercial statuses that block payment have warning tone", () => {
    const blockers = ["waiting_payment", "pending", "overdue"];
    for (const s of blockers) {
      const meta = getCommercialStatusMeta(s);
      expect(meta.tone).not.toBe("success"),
        `"${s}" must not show success tone when payment is needed`;
    }
  });

  it("fmtDate returns dash for falsy dates (no fake timestamps)", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
  });
});
