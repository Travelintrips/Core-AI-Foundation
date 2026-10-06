import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function workspaceRoot() {
  return join(__dirname, "../../../..");
}

describe("Public Interior Design render delivery", () => {
  const routerSource = readFileSync(
    join(__dirname, "../domains/interior-design/router.ts"),
    "utf8",
  );
  const renderServiceSource = readFileSync(
    join(__dirname, "../domains/interior-design/publicInteriorRenderService.ts"),
    "utf8",
  );
  const customerPageSource = readFileSync(
    join(workspaceRoot(), "customer-portal/src/pages/interior-design/project.tsx"),
    "utf8",
  );

  it("derives public render assets from the token-owned project only", () => {
    const start = routerSource.indexOf('router.get("/public/interior-design/projects/:token/outputs"');
    const end = routerSource.indexOf("// ── Admin: list all projects", start);
    const route = routerSource.slice(start, end);

    expect(route).toContain("getProjectByToken(token)");
    expect(route).toContain("getPublicInteriorRenderAssets(project.id)");
    expect(route).not.toContain("req.body");
    expect(route).not.toContain("req.query");
    expect(route.indexOf("getProjectByToken(token)"))
      .toBeLessThan(route.indexOf("getPublicInteriorRenderAssets(project.id)"));
  });

  it("returns only sanitized customer render fields", () => {
    const selectStart = renderServiceSource.indexOf(".select({");
    const selectEnd = renderServiceSource.indexOf("})", selectStart);
    const projection = renderServiceSource.slice(selectStart, selectEnd);

    expect(projection).toContain("id:");
    expect(projection).toContain("variantIndex:");
    expect(projection).toContain("status:");
    expect(projection).toContain("imageUrl:");
    expect(projection).toContain("thumbnailUrl:");
    expect(projection).toContain("aspectRatio:");
    expect(projection).not.toContain("prompt:");
    expect(projection).not.toContain("negativePrompt:");
    expect(projection).not.toContain("cost:");
    expect(projection).not.toContain("qcNotes:");
    expect(projection).not.toContain("metadata:");
    expect(projection).not.toContain("storagePath:");
  });

  it("isolates assets by synthetic public project key and final interior render type", () => {
    expect(renderServiceSource).toContain('PUBLIC_PROJECT_PREFIX = "public-interior-"');
    expect(renderServiceSource).toContain("publicInteriorProjectAssetKey(projectId)");
    expect(renderServiceSource).toContain('assetType, "interior_render"');
    expect(renderServiceSource).toContain('renderStage, "final"');
  });

  it("keeps structured output available when image rendering fails", () => {
    expect(renderServiceSource).toContain('status: "failed"');
    expect(routerSource).toContain("Image-provider failure must not hide the structured design result.");
    expect(routerSource).toContain('updateProjectStatus(project.id, "outputs_ready")');
  });

  it("renders backend images in the customer portal and polls active renders", () => {
    expect(customerPageSource).toContain('title="Render Interior"');
    expect(customerPageSource).toContain("<img");
    expect(customerPageSource).toContain("asset.thumbnailUrl ?? asset.imageUrl");
    expect(customerPageSource).toContain('asset.status === "pending" || asset.status === "generating"');
    expect(customerPageSource).toContain("setRenderAssets(d.renderAssets ?? [])");
  });
});
