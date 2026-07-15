/**
 * Design Renderer — Benchmark Script
 *
 * Run: pnpm --filter @workspace/api-server exec ts-node --esm src/tests/designRendererBenchmark.ts
 * Or:  pnpm --filter @workspace/api-server exec tsx src/tests/designRendererBenchmark.ts
 *
 * Uses local assets only — no internet required.
 */

import { buildSvg } from "../services/design-renderer/svgBuilder.js";
import { encodeSvg } from "../services/design-renderer/outputEncoder.js";
import { WarningAccumulator } from "../services/design-renderer/renderWarnings.js";
import { AssetCache } from "../services/design-renderer/assetCache.js";
import type { DesignTemplate, ShapeElement, TextElement, RenderDataRow } from "../types/designTemplate.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";

function makeTemplate(): DesignTemplate {
  const bg: ShapeElement = {
    id: "bg", type: "shape", x: 0, y: 0, width: 1080, height: 1080, zIndex: 0, shape: "rectangle", fill: "#f0f0f0",
  };
  const title: TextElement = {
    id: "title", type: "text", x: 40, y: 80, width: 1000, height: 120, zIndex: 1,
    content: { binding: { variableKey: "productName", fallback: "Product" } },
    fontSize: 64, fontWeight: "bold", color: "#111111", overflow: "auto-shrink", minFontSize: 24,
  };
  const price: TextElement = {
    id: "price", type: "text", x: 40, y: 220, width: 500, height: 80, zIndex: 2,
    content: { binding: { variableKey: "price", fallback: "—", formatter: "currency" } },
    fontSize: 48, color: "#e63946",
  };
  const desc: TextElement = {
    id: "desc", type: "text", x: 40, y: 320, width: 1000, height: 200, zIndex: 3,
    content: { binding: { variableKey: "description", fallback: "No description" } },
    fontSize: 28, color: "#444444", overflow: "auto-shrink", minFontSize: 14, lineHeight: 1.4,
  };

  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: "bench-1",
    tenantId: "bench",
    name: "Benchmark Template",
    canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
    elements: [bg, title, price, desc],
    variables: [
      { key: "productName", label: "Product Name", type: "text", required: true },
      { key: "price",       label: "Price",        type: "currency" },
      { key: "description", label: "Description",  type: "text" },
    ],
    metadata: { createdBy: "bench", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
  };
}

function makeData(i: number): RenderDataRow {
  return {
    productName:  `Product #${i} — Premium Edition`,
    price:        (i * 12.5 + 99).toFixed(2),
    description:  `This is the description for product ${i}. It may be longer or shorter depending on the variant. Lorem ipsum dolor sit amet, consectetur adipiscing.`,
  };
}

type BenchResult = {
  scenario: string;
  n: number;
  concurrency: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  peakRssMb: number;
  outputAvgBytes: number;
  errors: number;
};

async function benchScenario(
  label: string,
  n: number,
  concurrency: number,
  template: DesignTemplate,
): Promise<BenchResult> {
  const durations: number[] = [];
  const sizes:     number[] = [];
  let errors = 0;
  const cache = new AssetCache();

  const rssStart = process.memoryUsage().rss;
  const totalStart = Date.now();

  const queue = Array.from({ length: n }, (_, i) => i);

  async function runOne(i: number): Promise<void> {
    const start = Date.now();
    try {
      const warnings = new WarningAccumulator();
      const svg = await buildSvg(template, makeData(i), warnings, { cache });
      const encoded = await encodeSvg(svg, "png", template.canvas.width, template.canvas.height);
      durations.push(Date.now() - start);
      sizes.push(encoded.fileSizeBytes);
    } catch (err) {
      errors++;
      durations.push(Date.now() - start);
    }
  }

  // Process in batches of `concurrency`
  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(runOne));
  }

  const totalMs = Date.now() - totalStart;
  const peakRss = (process.memoryUsage().rss - rssStart) / 1024 / 1024;

  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(n * 0.5)] ?? 0;
  const p95 = durations[Math.floor(n * 0.95)] ?? 0;
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  const avgBytes = sizes.length > 0 ? Math.round(sizes.reduce((s, x) => s + x, 0) / sizes.length) : 0;

  return {
    scenario:       label,
    n,
    concurrency,
    totalMs,
    avgMs:          Math.round(avg),
    p50Ms:          p50,
    p95Ms:          p95,
    peakRssMb:      Math.round(peakRss * 10) / 10,
    outputAvgBytes: avgBytes,
    errors,
  };
}

async function main() {
  const template = makeTemplate();

  console.log("\n=== Design Renderer Benchmark ===\n");
  console.log("Template: 4 elements (2 shapes, 2 text), 1080×1080 PNG\n");

  const scenarios: Array<[string, number, number]> = [
    ["10 renders, concurrency=1",  10, 1],
    ["10 renders, concurrency=2",  10, 2],
    ["100 renders, concurrency=1", 100, 1],
    ["100 renders, concurrency=2", 100, 2],
    ["100 renders, concurrency=4", 100, 4],
  ];

  const results: BenchResult[] = [];

  for (const [label, n, c] of scenarios) {
    process.stdout.write(`  Running: ${label}...`);
    const r = await benchScenario(label, n, c, template);
    results.push(r);
    console.log(` done (${r.totalMs}ms total, ${r.errors} errors)`);
  }

  console.log("\n" + "─".repeat(100));
  console.log(
    "Scenario".padEnd(35),
    "N".padStart(5),
    "C".padStart(4),
    "Total(ms)".padStart(10),
    "Avg(ms)".padStart(9),
    "P50(ms)".padStart(9),
    "P95(ms)".padStart(9),
    "PeakRSS(MB)".padStart(13),
    "AvgSize(KB)".padStart(13),
    "Errors".padStart(8),
  );
  console.log("─".repeat(100));

  for (const r of results) {
    console.log(
      r.scenario.padEnd(35),
      String(r.n).padStart(5),
      String(r.concurrency).padStart(4),
      String(r.totalMs).padStart(10),
      String(r.avgMs).padStart(9),
      String(r.p50Ms).padStart(9),
      String(r.p95Ms).padStart(9),
      String(r.peakRssMb).padStart(13),
      String(Math.round(r.outputAvgBytes / 1024)).padStart(13),
      String(r.errors).padStart(8),
    );
  }
  console.log("─".repeat(100));
  console.log("\nNote: Benchmark uses local SVG→PNG only (no network, no storage upload).");
  console.log("Font measurement: character-width estimator (not pixel-exact; ±15% margin).");
  console.log("PDF timing not included in benchmark (depends on pdf-lib embed overhead).\n");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
