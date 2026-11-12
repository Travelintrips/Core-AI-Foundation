import { describe, expect, it } from "vitest";
import { externalJobStatusLabel, externalWorkRouteLabel, isExternalJobTerminal } from "../aiCoreExternalWorkState";

describe("external AI Task job presentation", () => {
  it("distinguishes queued, active, verified success, failure, and unknown", () => {
    expect(externalJobStatusLabel("QUEUED")).toBe("Menunggu worker");
    expect(externalJobStatusLabel("PROCESSING")).toBe("Sedang dikerjakan");
    expect(externalJobStatusLabel("COMPLETED")).toBe("Selesai");
    expect(externalJobStatusLabel("FAILED")).toBe("Gagal");
    expect(externalJobStatusLabel("UNKNOWN")).toBe("Perlu diperiksa");
  });

  it("does not mislabel an ordinary OpenClaw job as a browser wake", () => {
    expect(externalWorkRouteLabel("EXTERNAL_AGENT")).toBe("OpenClaw · job");
    expect(externalWorkRouteLabel("CHATGPT_DEV_WAKE")).toBe("OpenClaw · browser wake");
    expect(externalWorkRouteLabel("DATA_TOOL")).toBeNull();
  });

  it("does not treat queued or processing jobs as completed", () => {
    expect(isExternalJobTerminal("QUEUED")).toBe(false);
    expect(isExternalJobTerminal("PROCESSING")).toBe(false);
    expect(isExternalJobTerminal("COMPLETED")).toBe(true);
    expect(isExternalJobTerminal("FAILED")).toBe(true);
    expect(isExternalJobTerminal("UNKNOWN")).toBe(false);
  });
});
