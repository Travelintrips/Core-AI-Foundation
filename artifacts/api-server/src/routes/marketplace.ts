/**
 * marketplace.ts — Phase 8 AI Skills Marketplace & Tool Ecosystem
 *
 * GET    /ai/marketplace/skills                — catalog of skill packages
 * GET    /ai/marketplace/tools                 — catalog of tool packages
 * GET    /ai/marketplace/installed             — installed packages for a tenant
 * POST   /ai/marketplace/install                — install a package
 * PATCH  /ai/marketplace/:packageType/:id/upgrade  — bump to catalog version
 * PATCH  /ai/marketplace/:packageType/:id/enable   — enable
 * PATCH  /ai/marketplace/:packageType/:id/disable  — disable
 * DELETE /ai/marketplace/:packageType/:id           — uninstall
 * POST   /ai/marketplace/tools/:id/health-check     — run connector health check
 * GET    /ai/marketplace/analytics                  — marketplace dashboard stats
 */

import { Router, type Request, type Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  aiSkillPackagesTable,
  aiToolPackagesTable,
  aiInstalledPackagesTable,
} from "@workspace/db";
import {
  InstallPackageBody,
  ListInstalledQuery,
  PackageRouteParams,
  ToolIdParam,
} from "@workspace/api-zod";
import * as packageManagerService from "../services/packageManagerService.js";
import { PackageManagerError } from "../services/packageManagerService.js";
import { assertClientTenantNotSpoofed, resolveAuthenticatedTenantContext, TenantMismatchError } from "../security/tenantResolution.js";

const router = Router();

/**
 * Parses & validates {packageType, id} route params. Returns null (and has
 * already sent a 400) when invalid, so callers can `if (!p) return;`.
 */
function parsePackageParams(req: Request, res: Response): { packageType: "skill" | "tool"; id: number } | null {
  const parsed = PackageRouteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return null;
  }
  return parsed.data;
}

/**
 * WP-00 fix (was: `parseTenantId`, which trusted whatever string the client
 * sent). Tenant is now always resolved server-side from the authenticated
 * request (session or ADMIN_API_KEY — both already verified by
 * adminAuthWithExceptions). Any client-supplied `tenantId` that disagrees
 * with the resolved tenant is treated as a spoofing attempt: rejected with
 * 403 and logged, never used. Returns null (and has already sent the
 * response) when the request must be rejected, so callers can
 * `if (tenantId === null) return;`.
 */
function resolveTenantOrReject(req: Request, res: Response, clientSupplied: unknown, routeLabel: string): string | null {
  const ctx = resolveAuthenticatedTenantContext(req);
  try {
    assertClientTenantNotSpoofed(clientSupplied, ctx.tenantId, req, routeLabel);
  } catch (err) {
    if (err instanceof TenantMismatchError) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }
    throw err;
  }
  return ctx.tenantId;
}

function handlePmError(err: unknown, res: Response): boolean {
  if (err instanceof PackageManagerError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      ALREADY_INSTALLED: 409,
      NOT_INSTALLED: 409,
      MISSING_DEPENDENCIES: 422,
    };
    res.status(statusMap[err.code] ?? 400).json({ error: err.message, code: err.code, details: err.details });
    return true;
  }
  // Postgres unique_violation (e.g. a concurrent request won the install race)
  if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
    res.status(409).json({ error: "Package is already installed for this tenant", code: "ALREADY_INSTALLED" });
    return true;
  }
  return false;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

router.get("/ai/marketplace/skills", async (_req, res): Promise<void> => {
  const rows = await db.select().from(aiSkillPackagesTable).orderBy(aiSkillPackagesTable.category, aiSkillPackagesTable.skillName);
  res.json(rows);
});

router.get("/ai/marketplace/tools", async (_req, res): Promise<void> => {
  const rows = await db.select().from(aiToolPackagesTable).orderBy(aiToolPackagesTable.category, aiToolPackagesTable.toolName);
  res.json(rows);
});

// ── Installed ─────────────────────────────────────────────────────────────────

router.get("/ai/marketplace/installed", async (req, res): Promise<void> => {
  const q = ListInstalledQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const tenantId = resolveTenantOrReject(req, res, q.data.tenantId, "GET /ai/marketplace/installed");
  if (tenantId === null) return;

  const whereClause = q.data.packageType
    ? and(eq(aiInstalledPackagesTable.tenantId, tenantId), eq(aiInstalledPackagesTable.packageType, q.data.packageType))
    : eq(aiInstalledPackagesTable.tenantId, tenantId);

  const installed = await db
    .select()
    .from(aiInstalledPackagesTable)
    .where(whereClause);

  // Enrich with catalog metadata
  const skillIds = installed.filter((i) => i.packageType === "skill").map((i) => i.packageId);
  const toolIds = installed.filter((i) => i.packageType === "tool").map((i) => i.packageId);

  const [skills, tools] = await Promise.all([
    skillIds.length
      ? db.select().from(aiSkillPackagesTable).where(inArray(aiSkillPackagesTable.id, skillIds))
      : Promise.resolve([] as (typeof aiSkillPackagesTable.$inferSelect)[]),
    toolIds.length
      ? db.select().from(aiToolPackagesTable).where(inArray(aiToolPackagesTable.id, toolIds))
      : Promise.resolve([] as (typeof aiToolPackagesTable.$inferSelect)[]),
  ]);

  const enriched = installed.map((i) => {
    const catalog = i.packageType === "skill" ? skills.find((s) => s.id === i.packageId) : tools.find((t) => t.id === i.packageId);
    return { ...i, catalog: catalog ?? null };
  });

  res.json(enriched);
});

router.post("/ai/marketplace/install", async (req, res): Promise<void> => {
  const body = InstallPackageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const tenantId = resolveTenantOrReject(req, res, body.data.tenantId, "POST /ai/marketplace/install");
  if (tenantId === null) return;
  try {
    const row = await packageManagerService.install(tenantId, body.data.packageType, body.data.packageId, body.data.configuration ?? {});
    res.status(201).json(row);
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

router.patch("/ai/marketplace/:packageType/:id/upgrade", async (req, res): Promise<void> => {
  const params = parsePackageParams(req, res);
  if (!params) return;
  const tenantId = resolveTenantOrReject(req, res, req.body?.tenantId, "PATCH /ai/marketplace/:packageType/:id/upgrade");
  if (tenantId === null) return;
  try {
    const row = await packageManagerService.upgrade(tenantId, params.packageType, params.id);
    res.json(row);
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

router.patch("/ai/marketplace/:packageType/:id/enable", async (req, res): Promise<void> => {
  const params = parsePackageParams(req, res);
  if (!params) return;
  const tenantId = resolveTenantOrReject(req, res, req.body?.tenantId, "PATCH /ai/marketplace/:packageType/:id/enable");
  if (tenantId === null) return;
  try {
    const row = await packageManagerService.enable(tenantId, params.packageType, params.id);
    res.json(row);
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

router.patch("/ai/marketplace/:packageType/:id/disable", async (req, res): Promise<void> => {
  const params = parsePackageParams(req, res);
  if (!params) return;
  const tenantId = resolveTenantOrReject(req, res, req.body?.tenantId, "PATCH /ai/marketplace/:packageType/:id/disable");
  if (tenantId === null) return;
  try {
    const row = await packageManagerService.disable(tenantId, params.packageType, params.id);
    res.json(row);
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

router.delete("/ai/marketplace/:packageType/:id", async (req, res): Promise<void> => {
  const params = parsePackageParams(req, res);
  if (!params) return;
  const tenantId = resolveTenantOrReject(req, res, req.query?.tenantId, "DELETE /ai/marketplace/:packageType/:id");
  if (tenantId === null) return;
  try {
    await packageManagerService.uninstall(tenantId, params.packageType, params.id);
    res.status(204).send();
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

router.post("/ai/marketplace/tools/:id/health-check", async (req, res): Promise<void> => {
  const idParsed = ToolIdParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  try {
    const row = await packageManagerService.healthCheck(idParsed.data);
    res.json(row);
  } catch (err) {
    if (!handlePmError(err, res)) throw err;
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/ai/marketplace/analytics", async (req, res): Promise<void> => {
  const tenantId = resolveTenantOrReject(req, res, req.query.tenantId, "GET /ai/marketplace/analytics");
  if (tenantId === null) return;

  const [skills, tools, installed] = await Promise.all([
    db.select().from(aiSkillPackagesTable),
    db.select().from(aiToolPackagesTable),
    db.select().from(aiInstalledPackagesTable).where(eq(aiInstalledPackagesTable.tenantId, tenantId)),
  ]);

  const installedSkills = installed.filter((i) => i.packageType === "skill");
  const installedTools = installed.filter((i) => i.packageType === "tool");

  const connectorHealth = tools.reduce<Record<string, number>>((acc, t) => {
    acc[t.healthStatus] = (acc[t.healthStatus] ?? 0) + 1;
    return acc;
  }, {});

  const versionDistribution = [...skills, ...tools].reduce<Record<string, number>>((acc, p) => {
    acc[p.version] = (acc[p.version] ?? 0) + 1;
    return acc;
  }, {});

  res.json({
    totalSkillPackages: skills.length,
    totalToolPackages: tools.length,
    installedSkills: installedSkills.length,
    installedTools: installedTools.length,
    enabledSkills: installedSkills.filter((i) => i.enabled).length,
    enabledTools: installedTools.filter((i) => i.enabled).length,
    connectorHealth,
    versionDistribution,
  });
});

export default router;
