/**
 * smokeTestPitchDeck.ts — Phase 4 Presentation Engine smoke test
 *
 * Builds a pitch deck spec from a realistic Indonesian B2B fixture brief,
 * renders the real PPTX, validates it, generates the honest PDF preview
 * fallback, and generates the thumbnail — then writes all three to
 * /tmp/pitch-deck-smoke/ for manual visual inspection.
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx --tsconfig tsconfig.json src/scripts/smokeTestPitchDeck.ts
 */

import { writeFile, mkdir } from "fs/promises";
import type { CreativeProject } from "@workspace/db";
import { buildPitchDeckSpec } from "../services/presentation/mappers/pitchDeckPresentationMapper.js";
import { renderPresentation } from "../services/presentation/presentationRenderService.js";
import { validateGeneratedPresentation } from "../services/presentation/presentationValidationService.js";
import { renderSpecBasedPdfPreview } from "../services/presentation/presentationPdfPreviewService.js";
import { generatePresentationThumbnail } from "../services/presentation/presentationThumbnailService.js";

const fixtureProject: CreativeProject = {
  id: 999001,
  projectId: "smoke-test-pitchdeck-001",
  sourceType: "service_catalog",
  serviceRequestId: null,
  serviceQuotationId: null,
  brandName: "Nusantara Logistik Digital",
  businessType: "Platform Logistik B2B",
  targetMarket: "UKM manufaktur dan distributor di Jawa & Sumatra",
  productOrService: "Platform manajemen pengiriman & pergudangan berbasis AI untuk UKM",
  stylePreference: "modern, terpercaya, korporat",
  colorPreference: "biru tua dan oranye",
  referenceLinks: null,
  goal: "Meningkatkan efisiensi rantai pasok UKM melalui otomasi pengiriman dan visibilitas real-time",
  notes: "Klien ingin pitch deck untuk investor seed round, fokus pada masalah fragmentasi logistik UKM",
  deadline: null,
  status: "generating_presentation",
  paymentPolicy: "full_payment",
  depositPercentage: 50,
  paymentStatus: "paid",
  filesUnlocked: true,
  result: {
    brandStrategy: {
      positioning: "Nusantara Logistik Digital adalah tulang punggung digital rantai pasok UKM Indonesia.",
      brand_values: ["Kepercayaan", "Efisiensi", "Transparansi", "Skalabilitas"],
      brand_personality: ["Andal", "Modern", "Kolaboratif"],
      tone_of_voice: "Profesional namun mudah didekati, berorientasi pada hasil nyata bagi UKM.",
      competitive_advantage: "Satu-satunya platform yang mengintegrasikan pergudangan, armada pihak ketiga, dan pelacakan real-time dalam satu dashboard untuk UKM.",
    },
    creativeDirection: {
      creative_concept: {
        name: "Jalur Tanpa Batas",
        description: "Memvisualisasikan rantai pasok UKM yang dulunya terfragmentasi menjadi satu jalur digital yang mulus dari gudang ke pelanggan akhir.",
      },
      campaign_concept: "Setiap UKM berhak atas rantai pasok kelas dunia — tanpa investasi infrastruktur besar.",
      color_direction: { primary: "#1E3A8A", secondary: "#0F172A", accent: "#F97316" },
    },
    copy: {
      tagline: "Rantai Pasok Tanpa Batas untuk UKM Indonesia",
      headline: "Satu Platform. Semua Pengiriman Anda.",
      body_copy: {
        short: "Kelola pergudangan, pengiriman, dan pelacakan dalam satu dashboard AI.",
        long: "Nusantara Logistik Digital menyatukan pergudangan, armada mitra, dan pelacakan real-time dalam satu platform berbasis AI — memberikan UKM visibilitas dan efisiensi setara perusahaan besar tanpa investasi infrastruktur.",
      },
      call_to_action: "Bergabunglah dengan seed round kami untuk membangun infrastruktur logistik masa depan UKM Indonesia.",
    },
    qcReview: {},
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function main() {
  const { content } = (await import("../services/presentation/mappers/pitchDeckPresentationMapper.js")).normalizePitchDeckContent(fixtureProject);
  const { spec, report } = buildPitchDeckSpec(fixtureProject, content, null, []);

  console.log("── Generation report ──");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Slides built: ${spec.slides.length}`);

  const rendered = await renderPresentation(spec);
  console.log(`PPTX rendered: ${rendered.buffer.length} bytes, ${rendered.slideCount} slides, ${rendered.renderDurationMs}ms, ${rendered.continuationSlidesCreated} continuation slides`);

  const validation = await validateGeneratedPresentation(rendered.buffer, rendered.slideCount, 7);
  console.log("PPTX validation:", JSON.stringify(validation));

  const preview = await renderSpecBasedPdfPreview(spec);
  console.log(`PDF preview rendered: ${preview.buffer.length} bytes, ${preview.pageCount} pages, strategy=${preview.conversionStrategy}`);

  const thumb = await generatePresentationThumbnail(spec);
  console.log(`Thumbnail rendered: ${thumb.buffer.length} bytes, ${thumb.width}x${thumb.height}, ${thumb.mimeType}`);

  const outDir = "/tmp/pitch-deck-smoke";
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/pitch-deck.pptx`, rendered.buffer);
  await writeFile(`${outDir}/pitch-deck-preview.pdf`, preview.buffer);
  await writeFile(`${outDir}/pitch-deck-thumb.webp`, thumb.buffer);
  console.log(`Wrote fixtures to ${outDir}`);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
