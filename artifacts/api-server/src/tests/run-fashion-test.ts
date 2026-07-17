/**
 * Ad-hoc test: order design baju wanita elegan
 * Run: npx tsx src/tests/run-fashion-test.ts
 */

import { UniversalTemplateMatcher } from "../services/universal-template-matching/index.js";
import { DbBlueprintPort, StaticComponentPort, StaticPatternPort, StaticTokenLibraryPort } from "../services/universal-template-matching/adapters.js";

const matcher = new UniversalTemplateMatcher({
  blueprints: new DbBlueprintPort(),
  components: new StaticComponentPort(),
  patterns: new StaticPatternPort(),
  tokenLibrary: new StaticTokenLibraryPort(),
});

const input = {
  serviceType: "BRANDING",
  industry: "fashion",
  category: "Company Profile",
  brief: "Saya ingin order design untuk brand baju wanita elegan. Brand kami bernama VELLURA, menjual koleksi dress dan kebaya modern untuk wanita dewasa. Kesan yang ingin ditonjolkan adalah mewah, elegan, dan feminin. Warna utama gold dan hitam. Target pembeli wanita 28-45 tahun kelas menengah atas.",
  brandDna: {
    personalities: ["elegant", "luxurious", "feminine", "sophisticated"],
    voice: "refined",
    writingStyle: "formal",
    primaryColorHex: "#c8a84b",
  },
  audience: ["B2C", "women", "premium", "adult"],
  style: ["elegant", "luxury", "feminine", "classic"],
  output: ["pdf", "png"],
  package: "professional",
  constraints: [],
  limit: 5,
};

console.log("========================================================");
console.log("  ORDER: Design Baju Wanita Elegan — VELLURA Brand");
console.log("========================================================\n");

const result = await matcher.match(input);

// ── Ringkasan Eksekutif ───────────────────────────────────────────────────────
console.log("📋 RINGKASAN HASIL MATCHING");
console.log("─────────────────────────────────────────────────────");
console.log(`Kandidat dievaluasi : ${result.candidatesEvaluated}`);
console.log(`Confidence global   : ${(result.confidence * 100).toFixed(1)}%`);
console.log(`Sinyal digunakan    : ${result.signalsUsed.length} (${result.signalsUsed.join(", ")})`);
console.log(`Sinyal belum diisi  : ${result.signalsMissing.join(", ") || "-"}`);
console.log();

// ── Top Recommendation ────────────────────────────────────────────────────────
if (result.topRecommendation) {
  const rec = result.topRecommendation;
  console.log("🏆 REKOMENDASI UTAMA");
  console.log("─────────────────────────────────────────────────────");
  console.log(`Template   : ${rec.blueprintName}`);
  console.log(`ID         : ${rec.blueprintId}`);
  console.log(`Kategori   : ${rec.category}`);
  console.log(`Style      : ${rec.styles.join(", ")}`);
  console.log(`Format     : ${rec.outputFormats.join(", ")}`);
  console.log(`Score      : ${rec.score}/100`);
  console.log(`Confidence : ${(rec.confidence * 100).toFixed(1)}%`);
  console.log(`Featured   : ${rec.featured ? "✅ Ya" : "❌ Tidak"}`);
  console.log();
  console.log("Alasan Rekomendasi:");
  rec.reasons.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  console.log();

  console.log("📊 BREAKDOWN SKOR PER DIMENSI");
  console.log("─────────────────────────────────────────────────────");
  const sorted = [...rec.breakdown.dimensions].sort((a, b) => b.awarded - a.awarded);
  for (const d of sorted) {
    const bar = "█".repeat(Math.round((d.awarded / d.maximum) * 10)) + "░".repeat(10 - Math.round((d.awarded / d.maximum) * 10));
    const icon = d.matched ? "✅" : "❌";
    console.log(`${icon} ${d.dimension.padEnd(20)} [${bar}] ${d.awarded}/${d.maximum}`);
    console.log(`   → ${d.explanation}`);
  }
  console.log();
  console.log(`   Total: ${rec.breakdown.totalScore} / ${rec.breakdown.maxPossibleScore} raw pts → normalized ${rec.score}/100`);
} else {
  console.log("⚠️  TIDAK ADA TEMPLATE YANG COCOK");
  console.log("   Coba lengkapi sinyal input atau tambahkan template fashion ke database.");
}

// ── Alternatives ──────────────────────────────────────────────────────────────
if (result.alternatives.length > 0) {
  console.log();
  console.log("🔵 ALTERNATIF TEMPLATE");
  console.log("─────────────────────────────────────────────────────");
  result.alternatives.forEach((alt, i) => {
    console.log(`  ${i + 1}. ${alt.blueprintName} — score ${alt.score}/100 (confidence ${(alt.confidence * 100).toFixed(0)}%)`);
  });
}

// ── Rejected ──────────────────────────────────────────────────────────────────
if (result.rejected.length > 0) {
  console.log();
  console.log("🔴 TEMPLATE DITOLAK (constraint violation)");
  console.log("─────────────────────────────────────────────────────");
  result.rejected.forEach((r) => {
    console.log(`  ✗ ${r.blueprintId} — ${r.rejectionReason}`);
  });
}

// ── Explanation ───────────────────────────────────────────────────────────────
console.log();
console.log("💬 PENJELASAN SISTEM");
console.log("─────────────────────────────────────────────────────");
console.log(result.explanation);
console.log();
console.log("========================================================");
console.log("  Raw JSON (full result)");
console.log("========================================================");
console.log(JSON.stringify(result, null, 2));
