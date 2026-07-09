/**
 * packageManagerService — Phase 8 AI Skills Marketplace & Tool Ecosystem
 *
 * Manages the lifecycle of installable AI Skill / AI Tool packages per tenant:
 *   install()              — install a package for a tenant (validates dependencies first)
 *   upgrade()               — bump installed_version for an already-installed package
 *   enable() / disable()    — toggle without uninstalling
 *   uninstall()             — remove the installation row
 *   validateDependencies()  — check requiredTools / requiredCapabilities are installed+enabled
 *   healthCheck()           — ping a tool package's connector, update health_status
 *
 * All mutating actions publish events via aiEventBusService (publishSafe — never
 * blocks the caller) and are recorded in the audit log.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  aiSkillPackagesTable,
  aiToolPackagesTable,
  aiInstalledPackagesTable,
  type AiSkillPackage,
  type AiToolPackage,
  type AiInstalledPackage,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { logAudit } from "./aiAuditService.js";

export type PackageType = "skill" | "tool";

export class PackageManagerError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "ALREADY_INSTALLED" | "NOT_INSTALLED" | "MISSING_DEPENDENCIES",
    public details?: unknown,
  ) {
    super(message);
    this.name = "PackageManagerError";
  }
}

function packageDisplayCode(pkg: AiSkillPackage | AiToolPackage): string {
  return "skillCode" in pkg ? pkg.skillCode : pkg.toolCode;
}

async function getCatalogPackage(packageType: PackageType, packageId: number): Promise<AiSkillPackage | AiToolPackage> {
  if (packageType === "skill") {
    const [row] = await db.select().from(aiSkillPackagesTable).where(eq(aiSkillPackagesTable.id, packageId));
    if (!row) throw new PackageManagerError(`Skill package ${packageId} not found`, "NOT_FOUND");
    return row;
  }
  const [row] = await db.select().from(aiToolPackagesTable).where(eq(aiToolPackagesTable.id, packageId));
  if (!row) throw new PackageManagerError(`Tool package ${packageId} not found`, "NOT_FOUND");
  return row;
}

async function findInstallation(tenantId: string, packageType: PackageType, packageId: number): Promise<AiInstalledPackage | undefined> {
  const [row] = await db
    .select()
    .from(aiInstalledPackagesTable)
    .where(
      and(
        eq(aiInstalledPackagesTable.tenantId, tenantId),
        eq(aiInstalledPackagesTable.packageType, packageType),
        eq(aiInstalledPackagesTable.packageId, packageId),
      ),
    );
  return row;
}

/**
 * A skill package declares requiredTools (tool_code[]) and requiredCapabilities
 * (skill_code[] of other skill packages it depends on). Both must already be
 * installed + enabled for this tenant, or install() is rejected.
 */
export async function validateDependencies(
  tenantId: string,
  pkg: AiSkillPackage | AiToolPackage,
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];

  const requiredTools = "requiredTools" in pkg ? ((pkg.requiredTools as string[] | null) ?? []) : [];
  const requiredCapabilities = "requiredCapabilities" in pkg ? ((pkg.requiredCapabilities as string[] | null) ?? []) : [];

  if (requiredTools.length > 0) {
    const allTools = await db.select().from(aiToolPackagesTable);
    const installed = await db
      .select()
      .from(aiInstalledPackagesTable)
      .where(and(eq(aiInstalledPackagesTable.tenantId, tenantId), eq(aiInstalledPackagesTable.packageType, "tool"), eq(aiInstalledPackagesTable.enabled, true)));
    const installedIds = new Set(installed.map((i) => i.packageId));
    for (const toolCode of requiredTools) {
      const tool = allTools.find((t) => t.toolCode === toolCode);
      if (!tool || !installedIds.has(tool.id)) missing.push(`tool:${toolCode}`);
    }
  }

  if (requiredCapabilities.length > 0) {
    const allSkills = await db.select().from(aiSkillPackagesTable);
    const installed = await db
      .select()
      .from(aiInstalledPackagesTable)
      .where(and(eq(aiInstalledPackagesTable.tenantId, tenantId), eq(aiInstalledPackagesTable.packageType, "skill"), eq(aiInstalledPackagesTable.enabled, true)));
    const installedIds = new Set(installed.map((i) => i.packageId));
    for (const skillCode of requiredCapabilities) {
      const skill = allSkills.find((s) => s.skillCode === skillCode);
      if (!skill || !installedIds.has(skill.id)) missing.push(`skill:${skillCode}`);
    }
  }

  return { ok: missing.length === 0, missing };
}

export async function install(
  tenantId: string,
  packageType: PackageType,
  packageId: number,
  configuration: Record<string, unknown> = {},
): Promise<AiInstalledPackage> {
  const pkg = await getCatalogPackage(packageType, packageId);

  // Run the existence check, dependency validation, and insert inside a single
  // transaction to shrink the TOCTOU window between concurrent install calls.
  // The DB-level unique constraint on (tenantId, packageId, packageType) is the
  // final backstop; its violation is translated to ALREADY_INSTALLED by the
  // route layer (Postgres error code 23505).
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(aiInstalledPackagesTable)
      .where(
        and(
          eq(aiInstalledPackagesTable.tenantId, tenantId),
          eq(aiInstalledPackagesTable.packageType, packageType),
          eq(aiInstalledPackagesTable.packageId, packageId),
        ),
      )
      .for("update");
    if (existing) throw new PackageManagerError(`${packageType} ${packageId} already installed for tenant ${tenantId}`, "ALREADY_INSTALLED");

    const dep = await validateDependencies(tenantId, pkg);
    if (!dep.ok) {
      throw new PackageManagerError(
        `Cannot install ${packageDisplayCode(pkg)}: missing dependencies`,
        "MISSING_DEPENDENCIES",
        { missing: dep.missing },
      );
    }

    const [inserted] = await tx
      .insert(aiInstalledPackagesTable)
      .values({
        tenantId,
        packageId,
        packageType,
        installedVersion: pkg.version,
        enabled: true,
        configurationJson: configuration,
      })
      .returning();
    return inserted;
  });
  if (!row) throw new Error("Failed to install package");

  await logAudit("marketplace", "package_installed", String(packageId), packageType, "success", { tenantId, version: pkg.version });
  publishSafe({ eventType: "package.installed", sourceModule: "marketplace", sourceId: String(row.id), payload: { tenantId, packageType, packageId, version: pkg.version } });

  return row;
}

export async function upgrade(tenantId: string, packageType: PackageType, packageId: number): Promise<AiInstalledPackage> {
  const pkg = await getCatalogPackage(packageType, packageId);
  const existing = await findInstallation(tenantId, packageType, packageId);
  if (!existing) throw new PackageManagerError(`${packageType} ${packageId} is not installed for tenant ${tenantId}`, "NOT_INSTALLED");

  const [row] = await db
    .update(aiInstalledPackagesTable)
    .set({ installedVersion: pkg.version })
    .where(eq(aiInstalledPackagesTable.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to upgrade package");

  await logAudit("marketplace", "package_upgraded", String(packageId), packageType, "success", { tenantId, version: pkg.version, from: existing.installedVersion });
  publishSafe({ eventType: "package.updated", sourceModule: "marketplace", sourceId: String(row.id), payload: { tenantId, packageType, packageId, from: existing.installedVersion, to: pkg.version } });

  return row;
}

async function setEnabled(tenantId: string, packageType: PackageType, packageId: number, enabled: boolean): Promise<AiInstalledPackage> {
  const existing = await findInstallation(tenantId, packageType, packageId);
  if (!existing) throw new PackageManagerError(`${packageType} ${packageId} is not installed for tenant ${tenantId}`, "NOT_INSTALLED");

  const [row] = await db
    .update(aiInstalledPackagesTable)
    .set({ enabled })
    .where(eq(aiInstalledPackagesTable.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update package");

  await logAudit("marketplace", enabled ? "package_enabled" : "package_disabled", String(packageId), packageType, "success", { tenantId });
  if (packageType === "tool") {
    publishSafe({ eventType: enabled ? "tool.connected" : "tool.disconnected", sourceModule: "marketplace", sourceId: String(row.id), payload: { tenantId, packageId } });
  }

  return row;
}

export const enable = (tenantId: string, packageType: PackageType, packageId: number) => setEnabled(tenantId, packageType, packageId, true);
export const disable = (tenantId: string, packageType: PackageType, packageId: number) => setEnabled(tenantId, packageType, packageId, false);

export async function uninstall(tenantId: string, packageType: PackageType, packageId: number): Promise<void> {
  const existing = await findInstallation(tenantId, packageType, packageId);
  if (!existing) throw new PackageManagerError(`${packageType} ${packageId} is not installed for tenant ${tenantId}`, "NOT_INSTALLED");

  await db.delete(aiInstalledPackagesTable).where(eq(aiInstalledPackagesTable.id, existing.id));

  await logAudit("marketplace", "package_removed", String(packageId), packageType, "success", { tenantId });
  publishSafe({ eventType: "package.removed", sourceModule: "marketplace", sourceId: String(existing.id), payload: { tenantId, packageType, packageId } });
}

/**
 * Simulated connector health check for a tool package — a real implementation
 * would ping the provider's API. Updates health_status + last_health_check_at.
 */
export async function healthCheck(toolPackageId: number): Promise<AiToolPackage> {
  const [tool] = await db.select().from(aiToolPackagesTable).where(eq(aiToolPackagesTable.id, toolPackageId));
  if (!tool) throw new PackageManagerError(`Tool package ${toolPackageId} not found`, "NOT_FOUND");

  // Placeholder heuristic: status is healthy unless the tool has been explicitly deprecated.
  const healthStatus = tool.status === "deprecated" ? "down" : "healthy";

  const [row] = await db
    .update(aiToolPackagesTable)
    .set({ healthStatus, lastHealthCheckAt: new Date() })
    .where(eq(aiToolPackagesTable.id, toolPackageId))
    .returning();
  if (!row) throw new Error("Failed to update health status");

  await logAudit("marketplace", "connector_health_check", String(toolPackageId), "tool", "success", { healthStatus });
  publishSafe({
    eventType: healthStatus === "healthy" ? "connector.recovered" : "connector.failed",
    sourceModule: "marketplace",
    sourceId: String(toolPackageId),
    payload: { toolCode: tool.toolCode, healthStatus },
  });

  return row;
}
