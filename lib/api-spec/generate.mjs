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

console.log("✅ Code generation complete.");
