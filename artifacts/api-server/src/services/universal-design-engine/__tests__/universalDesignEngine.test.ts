/**
 * universalDesignEngine.test.ts — Required test cases for Team 02
 *
 * All tests are deterministic — no database, no network, no AI providers.
 * Uses null adapters for all ports.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UniversalDesignEngine } from "../UniversalDesignEngine.js";
import { NullDesignProjectRepository } from "../adapters/nullDesignProjectRepository.js";
import { NullDesignPluginResolver } from "../adapters/nullDesignPluginResolver.js";
import { NullDesignWorkflowResolver } from "../adapters/nullDesignWorkflowResolver.js";
import { NullDesignArtifactRepository } from "../adapters/nullDesignArtifactRepository.js";
import { NullDesignEventPublisher } from "../adapters/nullDesignEventPublisher.js";
import { NullDesignExecutionDispatcher } from "../adapters/nullDesignExecutionDispatcher.js";
import { NullDesignClock } from "../adapters/nullDesignClock.js";
import { NullDesignIdGenerator } from "../adapters/nullDesignIdGenerator.js";
import { NullDesignAuditSink } from "../adapters/nullDesignAuditSink.js";
import type { DesignEnginePorts } from "../ports.js";
import type { DesignPluginManifest, DesignWorkflowDefinition, DesignProjectSession } from "../types.js";
import {
  UnknownPluginError,
  UnsupportedWorkflowVersionError,
  DependencyNotMetError,
  MandatoryStageSkipError,
  InvalidTransitionError,
  TerminalProjectError,
  DuplicateCommandError,
  TenantMismatchError,
} from "../errors.js";
import type { RequestContext } from "../../../security/requestContext.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PLUGIN_FASHION: DesignPluginManifest = {
  pluginId: "fashion-collection",
  version: "1.0.0",
  displayName: "Fashion Collection",
  workflowId: "universal-design-v1",
  workflowVersion: "1.0.0",
  requiredCapabilities: ["image_generation"],
};

const PLUGIN_INTERIOR: DesignPluginManifest = {
  pluginId: "interior-residential",
  version: "1.0.0",
  displayName: "Interior Residential",
  workflowId: "universal-design-v1",
  workflowVersion: "1.0.0",
  requiredCapabilities: ["image_generation"],
};

const PLUGIN_PACKAGING: DesignPluginManifest = {
  pluginId: "packaging-product",
  version: "1.0.0",
  displayName: "Packaging Product",
  workflowId: "universal-design-v1",
  workflowVersion: "1.0.0",
  requiredCapabilities: ["image_generation"],
};

const PLUGIN_BRANDING: DesignPluginManifest = {
  pluginId: "branding-identity",
  version: "1.0.0",
  displayName: "Branding Identity",
  workflowId: "universal-design-v1",
  workflowVersion: "1.0.0",
  requiredCapabilities: ["image_generation"],
};

const WORKFLOW_V1: DesignWorkflowDefinition = {
  workflowId: "universal-design-v1",
  version: "1.0.0",
  stages: [
    {
      stageKey: "brief",
      name: "Brief",
      optional: false,
      dependsOn: [],
      requiredCapability: undefined,
      maxRetries: 0,
    },
    {
      stageKey: "moodboard",
      name: "Moodboard",
      optional: true,
      dependsOn: ["brief"],
      requiredCapability: "image_generation",
      maxRetries: 2,
      artifactType: "moodboard_board",
    },
    {
      stageKey: "concept",
      name: "Concept",
      optional: false,
      dependsOn: ["brief"],
      requiredCapability: "image_generation",
      maxRetries: 1,
      artifactType: "concept_sheet",
    },
    {
      stageKey: "technical",
      name: "Technical Design",
      optional: false,
      dependsOn: ["concept"],
      requiredCapability: "image_generation",
      maxRetries: 1,
      artifactType: "technical_drawing",
    },
  ],
};

const makeCtx = (tenantId: string | null = "tenant-abc"): RequestContext => ({
  tenantId,
  actorId: "actor-1",
  actorType: "tenant_admin",
  authMode: "session",
  requestId: "req-1",
  correlationId: "corr-1",
  source: "web",
  permissions: [],
  resourceScope: null,
  isPlatformAdmin: false,
  isPlatformWide: false,
  originatingActorId: null,
  metadata: {},
} as unknown as RequestContext);

const makePlatformCtx = (): RequestContext => ({
  ...makeCtx("platform"),
  isPlatformAdmin: true,
  isPlatformWide: true,
} as unknown as RequestContext);

// ─────────────────────────────────────────────────────────────────────────────
// Setup helpers
// ─────────────────────────────────────────────────────────────────────────────

let repo: NullDesignProjectRepository;
let pluginResolver: NullDesignPluginResolver;
let workflowResolver: NullDesignWorkflowResolver;
let artifactRepo: NullDesignArtifactRepository;
let eventPublisher: NullDesignEventPublisher;
let dispatcher: NullDesignExecutionDispatcher;
let clock: NullDesignClock;
let idGen: NullDesignIdGenerator;
let auditSink: NullDesignAuditSink;
let ports: DesignEnginePorts;
let engine: UniversalDesignEngine;

beforeEach(() => {
  repo = new NullDesignProjectRepository();
  pluginResolver = new NullDesignPluginResolver();
  workflowResolver = new NullDesignWorkflowResolver();
  artifactRepo = new NullDesignArtifactRepository();
  eventPublisher = new NullDesignEventPublisher();
  dispatcher = new NullDesignExecutionDispatcher();
  clock = new NullDesignClock(new Date("2025-06-01T10:00:00.000Z"));
  idGen = new NullDesignIdGenerator();
  auditSink = new NullDesignAuditSink();

  // Register test fixtures
  [PLUGIN_FASHION, PLUGIN_INTERIOR, PLUGIN_PACKAGING, PLUGIN_BRANDING].forEach((p) =>
    pluginResolver.register(p),
  );
  workflowResolver.register(WORKFLOW_V1);

  ports = {
    projectRepository: repo,
    pluginResolver,
    workflowResolver,
    artifactRepository: artifactRepo,
    eventPublisher,
    executionDispatcher: dispatcher,
    clock,
    idGenerator: idGen,
    auditSink,
  };
  engine = new UniversalDesignEngine(ports);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function initProject(projectId = "proj-1", pluginId = "fashion-collection", ctx = makeCtx()) {
  return engine.execute(ctx, { type: "initializeProject", projectId, pluginId });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Initialize project
// ─────────────────────────────────────────────────────────────────────────────

describe("initializeProject", () => {
  it("creates a session with stages from the workflow definition", async () => {
    const result = await initProject();

    expect(result.idempotent).toBe(false);
    expect(result.session.projectId).toBe("proj-1");
    expect(result.session.pluginId).toBe("fashion-collection");
    expect(result.session.status).toBe("initialized");
    expect(result.session.stages).toHaveLength(4);
    expect(result.session.stages.map((s) => s.stageKey)).toEqual([
      "brief", "moodboard", "concept", "technical",
    ]);
    expect(result.session.stages.every((s) => s.status === "pending")).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventType).toBe("design.project.initialized");
  });

  it("works identically for Fashion, Interior, Packaging, and Branding plugins", async () => {
    const plugins = ["fashion-collection", "interior-residential", "packaging-product", "branding-identity"];
    for (const [i, pluginId] of plugins.entries()) {
      const result = await initProject(`proj-${i + 10}`, pluginId);
      expect(result.session.status).toBe("initialized");
      expect(result.session.pluginId).toBe(pluginId);
      // All share the same workflow — same stage count
      expect(result.session.stages).toHaveLength(4);
    }
  });

  it("persists the session via repository", async () => {
    await initProject();
    const saved = await repo.findById(makeCtx(), "proj-1");
    expect(saved).toBeDefined();
    expect(saved!.status).toBe("initialized");
  });

  it("publishes a project.initialized event", async () => {
    await initProject();
    expect(eventPublisher.published).toHaveLength(1);
    expect(eventPublisher.published[0]!.eventType).toBe("design.project.initialized");
    expect(eventPublisher.published[0]!.projectId).toBe("proj-1");
  });

  it("records an audit entry on success", async () => {
    await initProject();
    const entry = auditSink.entries.find((e) => e.commandType === "initializeProject");
    expect(entry).toBeDefined();
    expect(entry!.outcome).toBe("success");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — Duplicate initialize
// ─────────────────────────────────────────────────────────────────────────────

describe("duplicate initializeProject", () => {
  it("throws DuplicateCommandError if project already exists", async () => {
    await initProject();
    await expect(initProject()).rejects.toThrow(DuplicateCommandError);
  });

  it("is idempotent when same idempotency key is used", async () => {
    const ctx = makeCtx();
    const key = "idem-key-1";
    const r1 = await engine.execute(ctx, { type: "initializeProject", projectId: "proj-2", pluginId: "fashion-collection" }, key);
    const r2 = await engine.execute(ctx, { type: "initializeProject", projectId: "proj-2", pluginId: "fashion-collection" }, key);
    expect(r1.idempotent).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — Unknown plugin
// ─────────────────────────────────────────────────────────────────────────────

describe("unknown plugin", () => {
  it("throws UnknownPluginError", async () => {
    await expect(
      engine.execute(makeCtx(), { type: "initializeProject", projectId: "proj-1", pluginId: "unknown-plugin" }),
    ).rejects.toThrow(UnknownPluginError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — Unsupported workflow version
// ─────────────────────────────────────────────────────────────────────────────

describe("unsupported workflow version", () => {
  it("throws UnsupportedWorkflowVersionError", async () => {
    pluginResolver.register({
      pluginId: "bad-workflow-plugin",
      version: "1.0.0",
      displayName: "Bad",
      workflowId: "nonexistent-workflow",
      workflowVersion: "9.9.9",
      requiredCapabilities: [],
    });
    await expect(
      engine.execute(makeCtx(), { type: "initializeProject", projectId: "proj-1", pluginId: "bad-workflow-plugin" }),
    ).rejects.toThrow(UnsupportedWorkflowVersionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — Activate valid stage
// ─────────────────────────────────────────────────────────────────────────────

describe("activateStage", () => {
  it("activates a stage with no dependencies", async () => {
    await initProject();
    const result = await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });

    expect(result.session.status).toBe("active");
    const briefStage = result.session.stages.find((s) => s.stageKey === "brief");
    expect(briefStage!.status).toBe("active");
    expect(briefStage!.activatedAt).not.toBeNull();
  });

  it("publishes a stage.activated event", async () => {
    await initProject();
    eventPublisher.clear();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });

    expect(eventPublisher.published).toHaveLength(1);
    expect(eventPublisher.published[0]!.eventType).toBe("design.stage.activated");
    expect(eventPublisher.published[0]!.stageKey).toBe("brief");
  });

  it("dispatches execution when stage has requiredCapability", async () => {
    await initProject();
    // Complete brief first
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    dispatcher.clear();

    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "concept" });

    expect(dispatcher.dispatched).toHaveLength(1);
    expect(dispatcher.dispatched[0]!.stageKey).toBe("concept");
    expect(dispatcher.dispatched[0]!.requiredCapability).toBe("image_generation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — Reject unmet dependency
// ─────────────────────────────────────────────────────────────────────────────

describe("dependency enforcement", () => {
  it("throws DependencyNotMetError when deps are not completed", async () => {
    await initProject();
    // moodboard depends on brief — brief is still pending
    await expect(
      engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "moodboard" }),
    ).rejects.toThrow(DependencyNotMetError);
  });

  it("activates stage once dependency is completed", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });

    // Now moodboard can activate
    const result = await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "moodboard" });
    const stage = result.session.stages.find((s) => s.stageKey === "moodboard");
    expect(stage!.status).toBe("active");
  });

  it("lists all unmet dependencies in the error", async () => {
    // Add a plugin with multiple deps for this edge case
    const multiDep: DesignWorkflowDefinition = {
      workflowId: "multi-dep-wf",
      version: "1.0.0",
      stages: [
        { stageKey: "a", name: "A", optional: false, dependsOn: [] },
        { stageKey: "b", name: "B", optional: false, dependsOn: [] },
        { stageKey: "c", name: "C", optional: false, dependsOn: ["a", "b"] },
      ],
    };
    workflowResolver.register(multiDep);
    pluginResolver.register({
      pluginId: "multi-dep-plugin",
      version: "1.0.0",
      displayName: "Multi Dep",
      workflowId: "multi-dep-wf",
      workflowVersion: "1.0.0",
      requiredCapabilities: [],
    });

    await initProject("proj-md", "multi-dep-plugin");
    const err = await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-md", stageKey: "c" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DependencyNotMetError);
    expect((err as DependencyNotMetError).unmetDeps).toContain("a");
    expect((err as DependencyNotMetError).unmetDeps).toContain("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 — Complete stage
// ─────────────────────────────────────────────────────────────────────────────

describe("completeStage", () => {
  it("marks stage as completed", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    const result = await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });

    const brief = result.session.stages.find((s) => s.stageKey === "brief");
    expect(brief!.status).toBe("completed");
    expect(brief!.completedAt).not.toBeNull();
  });

  it("derives project status as completed when all required stages done", async () => {
    await initProject();
    // Complete brief and concept (required), skip moodboard (optional), skip technical... wait technical depends on concept
    // Complete all required: brief → concept → technical
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "skipOptionalStage", projectId: "proj-1", stageKey: "moodboard", reason: "skipped" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "concept" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "concept" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "technical" });
    const result = await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "technical" });

    expect(result.session.status).toBe("completed");
    expect(result.session.completedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8 — Skip mandatory stage is rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("skip mandatory stage", () => {
  it("throws MandatoryStageSkipError", async () => {
    await initProject();
    await expect(
      engine.execute(makeCtx(), { type: "skipOptionalStage", projectId: "proj-1", stageKey: "brief", reason: "nope" }),
    ).rejects.toThrow(MandatoryStageSkipError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9 — Skip optional stage
// ─────────────────────────────────────────────────────────────────────────────

describe("skipOptionalStage", () => {
  it("marks optional stage as skipped with reason", async () => {
    await initProject();
    // Brief must be completed first (moodboard depends on it)
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });

    const result = await engine.execute(makeCtx(), {
      type: "skipOptionalStage", projectId: "proj-1", stageKey: "moodboard", reason: "client-skipped",
    });

    const moodboard = result.session.stages.find((s) => s.stageKey === "moodboard");
    expect(moodboard!.status).toBe("skipped");
    expect(moodboard!.skipReason).toBe("client-skipped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10 — Retry failed stage
// ─────────────────────────────────────────────────────────────────────────────

describe("retryStage", () => {
  it("re-activates a failed stage within retry limit", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "concept" });
    await engine.execute(makeCtx(), { type: "failStage", projectId: "proj-1", stageKey: "concept", reason: "AI error" });

    const result = await engine.execute(makeCtx(), { type: "retryStage", projectId: "proj-1", stageKey: "concept" });

    const concept = result.session.stages.find((s) => s.stageKey === "concept");
    expect(concept!.status).toBe("active");
    expect(concept!.retryCount).toBe(1);
    expect(concept!.failureReason).toBeNull();
  });

  it("throws an error when retry limit exhausted (project enters failed terminal state)", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "concept" });

    // maxRetries is 1 for concept — exhaust all retries
    await engine.execute(makeCtx(), { type: "failStage", projectId: "proj-1", stageKey: "concept", reason: "err1" });
    await engine.execute(makeCtx(), { type: "retryStage", projectId: "proj-1", stageKey: "concept" });
    // After 2nd failure with retryCount === maxRetries, project derives to "failed" (terminal)
    const afterFail = await engine.execute(makeCtx(), { type: "failStage", projectId: "proj-1", stageKey: "concept", reason: "err2" });
    expect(afterFail.session.status).toBe("failed");

    // Now the project is terminal — any further command throws TerminalProjectError
    await expect(
      engine.execute(makeCtx(), { type: "retryStage", projectId: "proj-1", stageKey: "concept" }),
    ).rejects.toThrow(TerminalProjectError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11 — Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("second command with same idempotency key is a no-op", async () => {
    await initProject();
    const key = "activate-brief-v1";
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" }, key);
    const r2 = await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" }, key);

    expect(r2.idempotent).toBe(true);
    expect(r2.events).toHaveLength(0);
    // Stage is still active (not double-activated)
    const brief = r2.session.stages.find((s) => s.stageKey === "brief");
    expect(brief!.status).toBe("active");
  });

  it("different idempotency keys are not conflated", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" }, "key-1");
    // key-2 should not be idempotent
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" }, "key-2");
    const r = await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" }, "key-2");
    expect(r.idempotent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12 — Cross-tenant repository guard
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-tenant guard", () => {
  it("throws TenantMismatchError when context tenant differs from project tenant", async () => {
    const ownerCtx = makeCtx("tenant-owner");
    await engine.execute(ownerCtx, {
      type: "initializeProject", projectId: "proj-tenant", pluginId: "fashion-collection",
    });

    const attackerCtx = makeCtx("tenant-attacker");
    await expect(
      engine.execute(attackerCtx, { type: "activateStage", projectId: "proj-tenant", stageKey: "brief" }),
    ).rejects.toThrow(TenantMismatchError);
  });

  it("allows platform admin to bypass tenant check", async () => {
    const ownerCtx = makeCtx("tenant-owner");
    await engine.execute(ownerCtx, {
      type: "initializeProject", projectId: "proj-owned", pluginId: "fashion-collection",
    });

    const result = await engine.execute(makePlatformCtx(), {
      type: "activateStage", projectId: "proj-owned", stageKey: "brief",
    });
    expect(result.session.stages.find((s) => s.stageKey === "brief")!.status).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13 — Terminal-state project protection
// ─────────────────────────────────────────────────────────────────────────────

describe("terminal-state protection", () => {
  it("throws TerminalProjectError when project is completed", async () => {
    await initProject();
    // Drive to completed state
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "skipOptionalStage", projectId: "proj-1", stageKey: "moodboard", reason: "skip" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "concept" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "concept" });
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "technical" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "technical" });

    await expect(
      engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" }),
    ).rejects.toThrow(TerminalProjectError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14 — Attach artifact
// ─────────────────────────────────────────────────────────────────────────────

describe("attachArtifact", () => {
  it("attaches an artifact to an active stage", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });

    const result = await engine.execute(makeCtx(), {
      type: "attachArtifact", projectId: "proj-1", stageKey: "brief", artifactType: "brief_document",
    });

    const brief = result.session.stages.find((s) => s.stageKey === "brief");
    expect(brief!.artifacts).toHaveLength(1);
    expect(brief!.artifacts[0]!.artifactType).toBe("brief_document");
    expect(result.events[0]!.eventType).toBe("design.artifact.attached");
  });

  it("marks second attachment as revision", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "attachArtifact", projectId: "proj-1", stageKey: "brief", artifactType: "brief_document" });

    const result = await engine.execute(makeCtx(), {
      type: "attachArtifact", projectId: "proj-1", stageKey: "brief", artifactType: "brief_document",
    });

    const brief = result.session.stages.find((s) => s.stageKey === "brief");
    expect(brief!.artifacts).toHaveLength(2);
    expect(brief!.artifacts[1]!.isRevision).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15 — Request review
// ─────────────────────────────────────────────────────────────────────────────

describe("requestReview", () => {
  it("emits a review.requested event", async () => {
    await initProject();
    eventPublisher.clear();

    const result = await engine.execute(makeCtx(), {
      type: "requestReview", projectId: "proj-1", stageKey: "brief",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventType).toBe("design.review.requested");
    expect(result.events[0]!.stageKey).toBe("brief");
  });

  it("can request a project-level review (stageKey null)", async () => {
    await initProject();
    const result = await engine.execute(makeCtx(), {
      type: "requestReview", projectId: "proj-1", stageKey: null,
    });
    expect(result.events[0]!.stageKey).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 16 — Reopen stage
// ─────────────────────────────────────────────────────────────────────────────

describe("reopenStage", () => {
  it("reopens a completed stage back to pending", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });

    const result = await engine.execute(makeCtx(), {
      type: "reopenStage", projectId: "proj-1", stageKey: "brief", reason: "client revision",
    });

    const brief = result.session.stages.find((s) => s.stageKey === "brief");
    expect(brief!.status).toBe("pending");
    expect(brief!.completedAt).toBeNull();
    expect(result.events[0]!.eventType).toBe("design.stage.reopened");
  });

  it("cannot reopen a skipped stage", async () => {
    await initProject();
    await engine.execute(makeCtx(), { type: "activateStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "completeStage", projectId: "proj-1", stageKey: "brief" });
    await engine.execute(makeCtx(), { type: "skipOptionalStage", projectId: "proj-1", stageKey: "moodboard", reason: "skip" });

    await expect(
      engine.execute(makeCtx(), { type: "reopenStage", projectId: "proj-1", stageKey: "moodboard", reason: "try again" }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 17 — Deterministic event IDs (idempotency of event emission)
// ─────────────────────────────────────────────────────────────────────────────

describe("deterministic event IDs", () => {
  it("same inputs produce same event ID", () => {
    const gen = new NullDesignIdGenerator();
    const d = new Date("2025-01-01T00:00:00.000Z");
    const id1 = gen.eventId("proj-1", "design.stage.activated", "brief", d);
    const id2 = gen.eventId("proj-1", "design.stage.activated", "brief", d);
    expect(id1).toBe(id2);
  });

  it("different stageKeys produce different event IDs", () => {
    const gen = new NullDesignIdGenerator();
    const d = new Date("2025-01-01T00:00:00.000Z");
    const id1 = gen.eventId("proj-1", "design.stage.activated", "brief", d);
    const id2 = gen.eventId("proj-1", "design.stage.activated", "concept", d);
    expect(id1).not.toBe(id2);
  });
});
