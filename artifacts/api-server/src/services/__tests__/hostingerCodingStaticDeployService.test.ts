import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractAiPlatformStaticArchive } from "../hostingerCodingStaticDeployService.js";

describe("Hostinger coding static deployment", () => {
  it("extracts only ai-platform dist and adds SPA metadata", async () => {
    const source = new JSZip();
    source.file("ai-platform/dist/index.html", "<html>coding</html>");
    source.file("ai-platform/dist/assets/app.js", "console.log('coding')");
    source.file("customer-portal/dist/index.html", "<html>customer</html>");
    source.file("api-server/dist/index.mjs", "export {};");

    const artifact = await source.generateAsync({ type: "nodebuffer" });
    const output = await extractAiPlatformStaticArchive(
      artifact,
      "0123456789abcdef0123456789abcdef01234567",
    );
    const zip = await JSZip.loadAsync(output);

    expect(await zip.file("index.html")?.async("string")).toContain("coding");
    expect(await zip.file("assets/app.js")?.async("string")).toContain("coding");
    expect(zip.file("customer-portal/dist/index.html")).toBeNull();
    expect(await zip.file("cst-build-sha.txt")?.async("string")).toBe(
      "0123456789abcdef0123456789abcdef01234567\n",
    );
    expect(await zip.file(".htaccess")?.async("string")).toContain(
      "RewriteRule . /index.html [L]",
    );
  });

  it("keeps legacy coding-alias cleanup exact and bounded", () => {
    const serviceSource = readFileSync(
      new URL("../hostingerCodingStaticDeployService.ts", import.meta.url),
      "utf8",
    );
    const start = serviceSource.indexOf(
      "export async function removeLegacyCodingParkedDomain",
    );
    const end = serviceSource.indexOf("async function ensureCodingWebsite", start);
    const cleanupSource = serviceSource.slice(start, end);

    expect(cleanupSource).toContain("SOURCE_DOMAIN");
    expect(cleanupSource).toContain("CODING_DOMAIN");
    expect(cleanupSource).toContain("parked-domains");
    expect(cleanupSource).toContain("domain.toLowerCase() === CODING_DOMAIN.toLowerCase()");
  });
});
