/**
 * cp-review-fixture.ts — V4.2C development fixture
 *
 * Creates a deterministic, idempotent fixture for smoke testing and screenshots:
 *   - 1 creative project (Company Profile)
 *   - 1 client review with known token "dev-cp-review-fixture-token-2024"
 *   - 2 document versions
 *   - 5 cp_page_comments (3 open, 1 resolved, 1 urgent reply)
 *   - 1 reply thread
 *   - Known states: watermarked (filesUnlocked=false)
 *
 * Run: pnpm tsx src/scripts/cp-review-fixture.ts
 * Remove:  set FIXTURE_DELETE=1 before running to clean up.
 */

import { db } from "@workspace/db";
import { creativeProjectsTable, creativeAiClientReviewsTable, cpPageCommentsTable, cpDocumentVersionsTable, creativeAiAssetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

// ── Known fixture values ───────────────────────────────────────────────────────

const FIXTURE_TOKEN = "dev-cp-review-fixture-token-2024";
const FIXTURE_PROJECT_ID = "fixture-cp-review-project-001";
const FIXTURE_BRAND = "Fixture Corp — V4.2C Dev";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const TOKEN_HASH = sha256(FIXTURE_TOKEN);

async function deleteFixture() {
  console.log("🗑  Deleting fixture…");

  // Delete review (cascades to cp_page_comments)
  const [review] = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, TOKEN_HASH))
    .limit(1);

  if (review) {
    await db.delete(cpPageCommentsTable).where(eq(cpPageCommentsTable.reviewId, review.id));
    await db.delete(creativeAiClientReviewsTable).where(eq(creativeAiClientReviewsTable.id, review.id));
  }

  await db.delete(cpDocumentVersionsTable).where(eq(cpDocumentVersionsTable.projectId, FIXTURE_PROJECT_ID));
  await db.delete(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.projectId, FIXTURE_PROJECT_ID));
  await db.delete(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, FIXTURE_PROJECT_ID));

  console.log("✅ Fixture deleted.");
  process.exit(0);
}

async function seedFixture() {
  console.log("🌱 Seeding cp-review fixture…");

  // ── 1. Project ──────────────────────────────────────────────────────────────
  const [existingProject] = await db
    .select({ projectId: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, FIXTURE_PROJECT_ID))
    .limit(1);

  let project = existingProject;
  if (!project) {
    [project] = await db.insert(creativeProjectsTable).values({
      projectId:        FIXTURE_PROJECT_ID,
      brandName:        FIXTURE_BRAND,
      businessType:     "Technology Consulting",
      targetMarket:     "Enterprise B2B clients in Southeast Asia",
      productOrService: "Company Profile document design",
      goal:             "Present a polished company profile for enterprise pitches",
      status:           "in_progress",
      sourceType:       "direct",
      paymentStatus:    "pending",
      filesUnlocked:    false,
    }).returning({ projectId: creativeProjectsTable.projectId });
    console.log("  ✅ Project created:", FIXTURE_PROJECT_ID);
  } else {
    console.log("  ↩ Project already exists");
  }

  // ── 2. Asset (PDF document) ─────────────────────────────────────────────────
  const [existingAsset] = await db
    .select({ id: creativeAiAssetsTable.id })
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, FIXTURE_PROJECT_ID))
    .limit(1);

  let assetId: number;
  if (!existingAsset) {
    const [asset] = await db.insert(creativeAiAssetsTable).values({
      projectId:  FIXTURE_PROJECT_ID,
      provider:   "fixture",
      model:      "fixture-static-pdf",
      assetType:  "document",
      prompt:     "Fixture Company Profile document (static PDF for dev/testing)",
      category:   "company_profile",
      // Use a publicly accessible, stable PDF for testing (watermark fetch source)
      imageUrl:   "https://pdfobject.com/pdf/sample.pdf",
      status:     "completed",
      version:    2,
      metadata: {
        pageCount: 8,
        generationReport: {
          sectionsIncluded: ["executive_summary", "company_overview", "services", "team", "contact"],
          sectionsSkipped: [{ sectionId: "case_studies" }],
          packageLevel: "professional",
          pageTarget: 8,
        },
        qcScore: 82,
        qcPassed: true,
        qcDimensions: { content: 85, design: 80, branding: 78 },
        qcWarnings: ["Logo resolution could be improved"],
      },
    }).returning({ id: creativeAiAssetsTable.id });
    assetId = asset.id;
    console.log("  ✅ Asset created:", assetId);
  } else {
    assetId = existingAsset.id;
    console.log("  ↩ Asset already exists:", assetId);
  }

  // ── 3. Review ───────────────────────────────────────────────────────────────
  const [existingReview] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, TOKEN_HASH))
    .limit(1);

  let reviewId: number;
  if (!existingReview) {
    const [review] = await db.insert(creativeAiClientReviewsTable).values({
      projectId:        FIXTURE_PROJECT_ID,
      clientName:       "Alex Fixture",
      clientEmail:      "fixture@dev.local",
      reviewTokenHash:  TOKEN_HASH,
      reviewTokenPlain: null,
      status:           "viewed",
      sharedAt:         new Date("2024-06-01T09:00:00Z"),
      viewedAt:         new Date("2024-06-01T10:15:00Z"),
      tokenExpiresAt:   new Date("2030-12-31T23:59:59Z"), // far future so fixture is always valid
    }).returning({ id: creativeAiClientReviewsTable.id });
    reviewId = review.id;
    console.log("  ✅ Review created:", reviewId, "token:", FIXTURE_TOKEN);
  } else {
    reviewId = existingReview.id;
    console.log("  ↩ Review already exists:", reviewId);
  }

  // ── 4. Document versions ─────────────────────────────────────────────────────
  const existingVersions = await db
    .select({ version: cpDocumentVersionsTable.version })
    .from(cpDocumentVersionsTable)
    .where(eq(cpDocumentVersionsTable.projectId, FIXTURE_PROJECT_ID));

  if (existingVersions.length === 0) {
    await db.insert(cpDocumentVersionsTable).values([
      {
        projectId:       FIXTURE_PROJECT_ID,
        reviewId:        reviewId,
        assetId:         assetId,
        version:         1,
        versionLabel:    "v1",
        reason:          "Initial submission",
        revisionNotes:   null,
        sectionsJson:    ["executive_summary", "company_overview", "services"],
        qcScore:         74,
        qcPassed:        false,
        qcDimensionsJson: { content: 78, design: 70, branding: 72 },
        approved:        false,
        createdBy:       "admin@studio.com",
      },
      {
        projectId:       FIXTURE_PROJECT_ID,
        reviewId:        reviewId,
        assetId:         assetId,
        version:         2,
        versionLabel:    "v2 (Revised)",
        reason:          "Client revision cycle 1",
        revisionNotes:   "Added team section, improved logo, fixed layout on pages 3-4",
        sectionsJson:    ["executive_summary", "company_overview", "services", "team", "contact"],
        qcScore:         82,
        qcPassed:        true,
        qcDimensionsJson: { content: 85, design: 80, branding: 78 },
        approved:        false,
        sentForReviewAt: new Date("2024-06-01T09:00:00Z"),
        createdBy:       "admin@studio.com",
      },
    ]);
    console.log("  ✅ 2 document versions created");
  } else {
    console.log("  ↩ Versions already exist:", existingVersions.map((v) => v.version).join(", "));
  }

  // ── 5. Comments ─────────────────────────────────────────────────────────────
  const existingComments = await db
    .select({ id: cpPageCommentsTable.id })
    .from(cpPageCommentsTable)
    .where(eq(cpPageCommentsTable.reviewId, reviewId));

  if (existingComments.length === 0) {
    // Root comments
    const [c1] = await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId: FIXTURE_PROJECT_ID,
      comment:   "Please make the logo on the cover page larger — it looks too small on mobile.",
      authorName: "Alex Fixture",
      authorType: "client",
      pageNumber: 1,
      positionX:  50,
      positionY:  20,
      priority:   "high",
      status:     "open",
    }).returning({ id: cpPageCommentsTable.id });

    const [c2] = await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId: FIXTURE_PROJECT_ID,
      comment:   "The executive summary section reads well, but the font feels too light. Can we try a bolder weight?",
      authorName: "Alex Fixture",
      authorType: "client",
      sectionId: "executive_summary",
      priority:  "normal",
      status:    "open",
    }).returning({ id: cpPageCommentsTable.id });

    await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId: FIXTURE_PROJECT_ID,
      comment:   "Overall layout looks great. Colors match our brand guidelines perfectly.",
      authorName: "Alex Fixture",
      authorType: "client",
      pageNumber: 2,
      priority:  "low",
      status:    "resolved",
      resolvedBy: "Alex Fixture",
      resolvedAt: new Date("2024-06-01T14:30:00Z"),
    });

    await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId: FIXTURE_PROJECT_ID,
      comment:   "Page 6 is missing the contact details we provided. This is urgent!",
      authorName: "Alex Fixture",
      authorType: "client",
      pageNumber: 6,
      priority:  "urgent",
      status:    "open",
    });

    // Reply thread on c1
    await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId:      FIXTURE_PROJECT_ID,
      parentCommentId: c1.id,
      comment:         "Acknowledged — we'll increase the logo size by 40% and resend a preview by EOD.",
      authorName:      "Studio Team",
      authorType:      "admin",
      priority:        "normal",
      status:          "open",
    });

    // Reply from client on c2
    await db.insert(cpPageCommentsTable).values({
      reviewId,
      projectId:      FIXTURE_PROJECT_ID,
      parentCommentId: c2.id,
      comment:         "We suggest using font-weight 600 for headers and 400 for body. Does that work?",
      authorName:      "Studio Team",
      authorType:      "admin",
      priority:        "normal",
      status:          "open",
    });

    console.log("  ✅ 5 comments + 2 replies created");
  } else {
    console.log("  ↩ Comments already exist:", existingComments.length);
  }

  console.log(`
✅ Fixture seeding complete!

TOKEN:       ${FIXTURE_TOKEN}
PROJECT_ID:  ${FIXTURE_PROJECT_ID}
REVIEW URL:  /cp-review/${FIXTURE_TOKEN}
API URL:     /api/public/cp-review/${FIXTURE_TOKEN}

Test the fixture:
  curl http://localhost:8080/api/public/cp-review/${FIXTURE_TOKEN} | jq .reviewStatus
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (process.env["FIXTURE_DELETE"] === "1") {
  await deleteFixture();
} else {
  await seedFixture();
  process.exit(0);
}
