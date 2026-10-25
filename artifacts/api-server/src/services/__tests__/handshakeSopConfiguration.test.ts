import { describe, expect, it } from "vitest";
import { renderAiCoreBlockerSop } from "../aiCoreOperationalSop.js";
import {
  DEFAULT_SOP, parseEditableSop, parseRecoveryPolicy, parseReplyTemplates,
  renderReplyTemplate, parseSettingJson,
} from "../handshakeSopConfiguration.js";

describe("Handshake SOP dashboard configuration", () => {
  it("preserves the five immutable default SOP steps", () => {
    expect(DEFAULT_SOP.steps).toHaveLength(5);
    expect(DEFAULT_SOP.constraints).toHaveLength(3);
    expect(DEFAULT_SOP.canonicalCommand).toBe("/sop blocker");
  });
  it("accepts edited text only with exactly five bounded single-line steps", () => {
    const edited = { title: "SOP valid", steps: [...DEFAULT_SOP.steps] };
    expect(parseEditableSop(edited)).toEqual(edited);
    expect(parseEditableSop({ ...edited, steps: edited.steps.slice(0, 4) })).toBeNull();
    expect(parseEditableSop({ ...edited, steps: ["a\nb", ...edited.steps.slice(1)] })).toBeNull();
    expect(parseEditableSop({ ...edited, title: "a".repeat(181) })).toBeNull();
    expect(parseEditableSop({ ...edited, constraints: [] })).toEqual(edited);
  });
  it("rejects unsupported/ambiguous templates and duplicate identifiers", () => {
    const queued = { id: "queued", event: "JOB_QUEUED", enabled: true, text: "Job {{job_id}}: {{status}} oleh {{worker}}" };
    expect(parseReplyTemplates([queued])).toEqual([queued]);
    expect(parseReplyTemplates([queued, queued])).toBeNull();
    expect(parseReplyTemplates([{ ...queued, event: "INJECTED" }])).toBeNull();
    expect(parseReplyTemplates([{ ...queued, text: "{{unknown}}" }])).toBeNull();
    expect(parseReplyTemplates([{ ...queued, text: "{{unclosed" }])).toBeNull();
    expect(parseReplyTemplates([{ ...queued, text: "baris\nbaru" }])).toBeNull();
  });
  it("renders only enabled known templates, values bounded", () => {
    const templates = parseReplyTemplates([
      { id: "queued", event: "JOB_QUEUED", enabled: true, text: "Job {{job_id}} untuk {{worker}}" },
      { id: "blocked", event: "JOB_BLOCKED", enabled: false, text: "Blokir {{blocker}}" },
    ]);
    expect(renderReplyTemplate(templates, "JOB_QUEUED", { job_id: "J-1", worker: "DELL" }))
      .toBe("Job J-1 untuk DELL");
    expect(renderReplyTemplate(templates, "JOB_BLOCKED", { blocker: "X" })).toBeNull();
  });
  it("treats recovery settings as data, rejects invalid range", () => {
    const policy = { enabled: true, heartbeatGraceMinutes: 10, maxRetries: 3, requireAcknowledgement: true };
    expect(parseRecoveryPolicy(policy)).toEqual(policy);
    expect(parseRecoveryPolicy({ ...policy, maxRetries: 11 })).toBeNull();
    expect(parseRecoveryPolicy({ ...policy, heartbeatGraceMinutes: 0 })).toBeNull();
    expect(parseRecoveryPolicy({ ...policy, requireAcknowledgement: "false" })).toBeNull();
  });
  it("renders dashboard-edited SOP in AI Core Chat without changing constraints", () => {
    const edited = parseEditableSop({ title: "SOP terkonfigurasi", steps: [...DEFAULT_SOP.steps] });
    expect(edited).not.toBeNull();
    const output = renderAiCoreBlockerSop(edited!);
    expect(output).toContain("SOP terkonfigurasi:");
    expect(output).toContain("1. Catat blocker, correlation ID");
    expect(output).toContain("SOP ini hanya respons baca-saja");
  });
  it("fails closed for broken setting JSON", () => {
    expect(parseSettingJson("{broken")).toBeNull();
    expect(parseSettingJson(undefined)).toBeNull();
  });
});
