import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mocks.execute,
  },
}));

import {
  detectAiCoreDataTool,
  tryRunAiCoreDataTool,
} from "../aiCoreDataToolService.js";

describe("AI Core read-only data tools", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it("detects Sport Center booking lookup with normalized booking code", () => {
    expect(detectAiCoreDataTool("cek booking sc 0992")).toEqual({
      tool: "SPORT_CENTER_BOOKING_LOOKUP",
      bookingNumber: "SC-0992",
    });
  });

  it("detects tenant outstanding summary", () => {
    expect(detectAiCoreDataTool("berapa outstanding tenant sekarang?")).toEqual({
      tool: "TENANT_OUTSTANDING_SUMMARY",
    });
  });

  it("refuses mutation requests even when they contain a supported entity", () => {
    expect(detectAiCoreDataTool("hapus booking SC-0992")).toBeNull();
    expect(detectAiCoreDataTool("batalkan invoice tenant yang outstanding")).toBeNull();
  });

  it("returns booking and payment data without invoking an LLM", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: 992,
            booking_number: "SC-0992",
            customer_name: "Test Customer",
            facility_name: "Lapangan",
            booking_date: "2026-09-27",
            start_time: "19:00:00",
            end_time: "21:00:00",
            total_price: "200000",
            payment_status: "paid",
            status: "confirmed",
            payment_method: "qris",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            payment_number: "SCPAY-SC-0992",
            amount: "200000",
            payment_method: "qris",
            status: "paid",
            paid_at: "2026-09-27T12:00:00.000Z",
          },
        ],
      });

    const result = await tryRunAiCoreDataTool("periksa booking SC-0992");

    expect(result).toMatchObject({
      matched: true,
      tool: "SPORT_CENTER_BOOKING_LOOKUP",
      data: {
        found: true,
        totalPaid: 200000,
      },
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("excludes LLM fallback semantics when a recognized data query fails", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("relation unavailable"));

    const result = await tryRunAiCoreDataTool("cek outstanding tenant");

    expect(result).toMatchObject({
      matched: true,
      tool: "TENANT_OUTSTANDING_SUMMARY",
      data: { failed: true },
      warning: "relation unavailable",
    });
  });
});
