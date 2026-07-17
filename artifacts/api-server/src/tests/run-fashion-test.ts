/**
 * Ad-hoc test: fashion design matching
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
  brief: "Kami adalah brand fashion lokal premium dari Jakarta yang menjual pakaian wanita modern dengan sentuhan budaya Indonesia. Target market kami adalah wanita urban 25-35 tahun yang sadar merek dan peduli lingkungan. Kami ingin tampilan yang elegan, modern, dan sustainable.",
  brandDna: {
    personalities: ["elegant", "innovative", "sustainable"],
    voice: "sophisticated",
    writingStyle: "formal",
    primaryColorHex: "#1a1a2e",
  },
  audience: ["B2C", "women", "urban"],
  style: ["elegant", "modern", "minimalist"],
  output: ["pdf"],
  limit: 5,
};

console.log("=== Universal Template Matching — Fashion Design Test ===\n");
console.log("INPUT:", JSON.stringify(input, null, 2));
console.log("\n--- Running match... ---\n");

const result = await matcher.match(input);
console.log(JSON.stringify(result, null, 2));
