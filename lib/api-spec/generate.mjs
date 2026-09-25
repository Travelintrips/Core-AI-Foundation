#!/usr/bin/env node
/**
 * Custom orval generation script.
 *
 * Orval's bundled dist imports @scalar/json-magic which cannot resolve the
 * local openapi.yaml via its file-loader plugin in this pnpm workspace setup.
 * The workaround: pre-parse the YAML ourselves (using js-yaml which is
 * already installed) and pass the parsed object directly as `input.target`.
 * When the target is already an object, @scalar/json-magic skips its
 * file-resolution step entirely and proceeds straight to bundling.
 */
import { generate } from "orval";
import { parse as parseYaml } from "yaml";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = __dirname; // api-spec dir is the orval workspace

const openapiYaml = path.resolve(__dirname, "openapi.yaml");
const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

console.log("📖 Reading openapi.yaml…");
const specContent = fs.readFileSync(openapiYaml, "utf8");
const spec = parseYaml(specContent, { maxAliasCount: 10000, merge: true });
// Force title so generated file is named api.ts (orval derives filename from title)
spec.info = { ...spec.info, title: "Api" };

console.log("⚙️  Generating api-client-react…");
await generate(
  {
    input: { target: spec },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        query: { version: 5 },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  workspace
);

console.log("⚙️  Generating zod schemas…");
await generate(
  {
    input: { target: spec },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
  workspace
);

// Orval 8 emits Zod 4 top-level helpers (z.uuid(), z.int()) even though this
// workspace intentionally remains on Zod 3. Normalize generated output to the
// equivalent Zod 3 schema methods at the generator boundary rather than
// hand-editing generated files.
const generatedZodDir = path.resolve(apiZodSrc, "generated");
for (const entry of fs.readdirSync(generatedZodDir, { recursive: true })) {
  if (typeof entry !== "string" || !entry.endsWith(".ts")) continue;
  const file = path.join(generatedZodDir, entry);
  const source = fs.readFileSync(file, "utf8");
  const compatible = source
    .replace(/\b(z|zod)\.uuid\(\)/g, "$1.string().uuid()")
    .replace(/\b(z|zod)\.int\(\)/g, "$1.number().int()")
    .replace(/\b(z|zod)\.email\(\)/g, "$1.string().email()")
    .replace(/\b(z|zod)\.url\(\)/g, "$1.string().url()")
    .replace(/\b(z|zod)\.datetime\(\)/g, "$1.string().datetime()")
    .replace(/\b(z|zod)\.date\(\)/g, "$1.string().date()")
    .replace(/\b(z|zod)\.time\(\)/g, "$1.string().time()")
    .replace(/\b(z|zod)\.float(?:32|64)\(\)/g, "$1.number()")
    .replace(/\b(z|zod)\.looseObject\(([^)]*)\)/g, "$1.object($2).passthrough()");
  if (compatible !== source) fs.writeFileSync(file, compatible);
}

console.log("✅ Code generation complete.");
