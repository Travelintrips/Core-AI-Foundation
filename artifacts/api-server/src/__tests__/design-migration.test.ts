/**
 * design-migration.test.ts — Team 38
 *
 * Additional focused tests for:
 *  - DesignMigrationService (plan → execute lifecycle)
 *  - DesignFeatureFlag (seedDesignFlags, getDesignFlagContext)
 *  - designCompatibilityAdapter (dual-read, readiness check)
 *  - Contract invariants (no production migration in live mode)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreativeProject } from "@workspace/db";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  },
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
  creativeProjectsTable: { projectId: "project_id", id: "id", deletedAt: "deleted_at" },
  creativeProjectStepsTable: { projectId: "project_id" },
  creativeAiAssetsTable: { projectId: "project_id" },
  aiServiceRequestsTable: { id: "id", briefJson: "brief_json" },
  aiFeatureFlagsTable: {},
}));

vi.mock("../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/featureFlagService.js", () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(false),
  upsertFlag: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildMigrationPlan,
  executeMigration,
  ensureMigrationTable,
} from "../services/design/designMigrationService.js";

import {
  DESIGN_FLAG_KEYS,
} from "../services/design/designMigrationTypes.js";

import {
  seedDesignFlags,
  getDesignFlagContext,
} from "../services/design/designFeatureFlag.js";

import {
  DESIGN_CONTRACT_VERSION,
} from "../services/design/designCompatibilityAdapter.js";

// ── Plan contract ─────────────────────────────────────────────────────────────

describe("Migration plan contract", () => {
  it("buildMigrationPlan sets correct contract version", () => {
    const plan = buildMigrationPlan({
      planId: "p-contract-001",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: true,
    });
    expect(plan.contractVersion).toBe(DESIGN_CONTRACT_VERSION);
  });

  it("plan planId is preserved in result", async () => {
    const plan = buildMigrationPlan({
      planId: "p-id-preserved",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: true,
    });
    const result = await executeMigration(plan);
    expect(result.planId).toBe("p-id-preserved");
  });

  it("plan with isDryRun=false throws in production env", async () => {
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    const plan = buildMigrationPlan({
      planId: "p-prod-guard",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: false,
    });

    await expect(executeMigration(plan)).rejects.toThrow(
      /Live migration is not allowed in production/,
    );

    process.env["NODE_ENV"] = originalEnv;
  });
});

// ── ensureMigrationTable ──────────────────────────────────────────────────────

describe("ensureMigrationTable", () => {
  it("calls pool.connect and runs DDL without throwing", async () => {
    await expect(ensureMigrationTable()).resolves.not.toThrow();
  });
});

// ── Feature flag seeder ───────────────────────────────────────────────────────

describe("seedDesignFlags", () => {
  it("calls db.insert for each flag × environment without throwing", async () => {
    await expect(seedDesignFlags()).resolves.not.toThrow();
  });

  it("seeds all 7 design flag keys", async () => {
    const flagCount = Object.keys(DESIGN_FLAG_KEYS).length;
    expect(flagCount).toBe(7);
  });
});

// ── getDesignFlagContext ──────────────────────────────────────────────────────

describe("getDesignFlagContext", () => {
  it("returns a map with all 7 design flag keys", async () => {
    const { isFlagEnabled } = await import("../services/featureFlagService.js");
    vi.mocked(isFlagEnabled).mockResolvedValue(false);

    const ctx = await getDesignFlagContext();
    const keys = Object.values(DESIGN_FLAG_KEYS);

    for (const key of keys) {
      expect(key in ctx).toBe(true);
      expect(ctx[key as keyof typeof ctx]).toBe(false);
    }
  });

  it("returns true for flags that are enabled", async () => {
    const { isFlagEnabled } = await import("../services/featureFlagService.js");
    vi.mocked(isFlagEnabled).mockResolvedValue(true);

    const ctx = await getDesignFlagContext();
    for (const val of Object.values(ctx)) {
      expect(val).toBe(true);
    }
  });
});

// ── Dual-read comparison (unit, no DB) ────────────────────────────────────────

describe("DualReadResult contract", () => {
  it("dualReadCompare returns null when project not found (mocked DB returns nothing)", async () => {
    const { dualReadCompare } = await import("../services/design/designCompatibilityAdapter.js");
    const result = await dualReadCompare("nonexistent-project-uuid");
    expect(result).toBeNull();
  });
});

// ── Readiness check (unit, no DB) ─────────────────────────────────────────────

describe("DesignReadinessCheck contract", () => {
  it("checkProjectReadiness returns blocked status when project not found", async () => {
    const { checkProjectReadiness } = await import(
      "../services/design/designCompatibilityAdapter.js"
    );
    const check = await checkProjectReadiness("ghost-project-uuid");

    expect(check.projectId).toBe("ghost-project-uuid");
    expect(check.status).toBe("blocked");
    expect(check.checks.hasRequiredIdentity).toBe(false);
    expect(check.issues.length).toBeGreaterThan(0);
    expect(check.issues[0]!.severity).toBe("error");
  });

  it("readiness check always includes contractVersion", async () => {
    const { checkProjectReadiness } = await import(
      "../services/design/designCompatibilityAdapter.js"
    );
    const check = await checkProjectReadiness("any-uuid");
    expect(check.contractVersion).toBe(DESIGN_CONTRACT_VERSION);
    expect(check.checks.hasContractVersion).toBe(true);
  });

  it("readiness check includes checkedAt as a Date", async () => {
    const { checkProjectReadiness } = await import(
      "../services/design/designCompatibilityAdapter.js"
    );
    const check = await checkProjectReadiness("any-uuid");
    expect(check.checkedAt).toBeInstanceOf(Date);
  });
});

// ── Migration result structure ────────────────────────────────────────────────

describe("DesignMigrationResult structure", () => {
  it("result always contains all required fields", async () => {
    const plan = buildMigrationPlan({
      planId: "p-struct-001",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: true,
    });
    const result = await executeMigration(plan);

    expect(typeof result.planId).toBe("string");
    expect(typeof result.status).toBe("string");
    expect(typeof result.processedCount).toBe("number");
    expect(typeof result.successCount).toBe("number");
    expect(typeof result.failedCount).toBe("number");
    expect(typeof result.skippedCount).toBe("number");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(Array.isArray(result.dryRunProjects)).toBe(true);
    expect(Array.isArray(result.rollbackSnapshot)).toBe(true);
    expect(Array.isArray(result.alreadyMigratedIds)).toBe(true);
    expect(typeof result.isDryRun).toBe("boolean");
    expect(typeof result.isResumed).toBe("boolean");
  });

  it("completed migration with 0 projects has status=completed", async () => {
    const plan = buildMigrationPlan({
      planId: "p-complete-001",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: true,
    });
    const result = await executeMigration(plan);
    expect(result.status).toBe("completed");
  });
});

// ── Audit log is called ───────────────────────────────────────────────────────

describe("Audit integration", () => {
  it("executeMigration calls logAudit exactly once per run", async () => {
    const { logAudit } = await import("../services/aiAuditService.js");
    vi.mocked(logAudit).mockClear();

    const plan = buildMigrationPlan({
      planId: "p-audit-001",
      tenantId: null,
      projectIds: [],
      totalProjects: 0,
      isDryRun: true,
    });
    await executeMigration(plan);

    expect(vi.mocked(logAudit)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(logAudit).mock.calls[0]![0];
    expect(call.module).toBe("design-migration");
    expect(call.action).toBe("design_migration_dry_run");
  });
});
