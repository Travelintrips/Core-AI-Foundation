import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
const routeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("GPT02 Owner approval dedicated DEV authentication boundary", () => {
  it("mounts before generic admin API guard without exempting other routes", () => {
    const mount = appSource.indexOf('app.use("/api/gpt02-owner-approval", createGpt02RelockOwnerApprovalRouter(');
    const adminGuard = appSource.indexOf('app.use("/api", adminAuthWithExceptions, router)');
    expect(mount).toBeGreaterThan(0);
    expect(adminGuard).toBeGreaterThan(mount);
    expect(appSource).toContain('process.env.GPT02_RELOCK_OWNER_APPROVAL_ENABLED === "true"');
    expect(appSource).toContain('process.env.APP_ENV === "development"');
    expect(appSource).toContain('process.env.NODE_ENV !== "production"');
  });

  it("does not mount the Owner router again behind the generic guard", () => {
    expect(routeIndex).not.toContain('router.use("/gpt02-owner-approval"');
    expect(appSource.match(/app\.use\("\/api\/gpt02-owner-approval"/g)).toHaveLength(1);
  });
});
