/**
 * Full prod fix:
 * 1. Set all categories visibility = 'public'
 * 2. Update delivery times (AI-only → 30-60 menit, human_review → 1-2 hari)
 * 3. Ensure deleted_at, archived_at exist on ai_service_requests
 */
import { pool } from "@workspace/db";

const client = await pool.connect();

try {
  // 1. Fix visibility
  const vis = await client.query(
    `UPDATE ai_platform.ai_service_categories
     SET visibility = 'public'
     WHERE visibility != 'public'
     RETURNING name`
  );
  console.log(`✅ Updated ${vis.rowCount} categories → visibility='public'`);

  // 2. Fix delivery times — AI-only
  const aiOnly = await client.query(
    `UPDATE ai_platform.ai_services
     SET estimated_delivery = '30-60 menit'
     WHERE (human_review = false OR human_review IS NULL)
       AND subscription_supported = false
     RETURNING service_code`
  );
  console.log(`✅ Updated ${aiOnly.rowCount} AI-only services → '30-60 menit'`);

  // 3. Fix delivery times — human review
  const humanReview = await client.query(
    `UPDATE ai_platform.ai_services
     SET estimated_delivery = '1-2 hari'
     WHERE human_review = true
       AND subscription_supported = false
     RETURNING service_code`
  );
  console.log(`✅ Updated ${humanReview.rowCount} human-review services → '1-2 hari'`);

  // 4. Ensure soft-delete columns
  await client.query(`
    ALTER TABLE ai_platform.ai_service_requests
      ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
  `);
  console.log(`✅ Ensured deleted_at, archived_at on ai_service_requests`);

  // 5. Verify categories
  const cats = await client.query(
    `SELECT name, visibility FROM ai_platform.ai_service_categories ORDER BY name`
  );
  console.log(`\n=== Categories (${cats.rows.length}) ===`);
  for (const r of cats.rows) {
    console.log(`  [${r.visibility}] ${r.name}`);
  }

  // 6. Verify services summary
  const svcSummary = await client.query(
    `SELECT
       CASE WHEN human_review = true THEN 'human_review'
            WHEN subscription_supported = true THEN 'subscription'
            ELSE 'ai_only' END as type,
       estimated_delivery,
       count(*) as cnt
     FROM ai_platform.ai_services
     GROUP BY 1, 2
     ORDER BY 1, 2`
  );
  console.log(`\n=== Services by type & delivery ===`);
  for (const r of svcSummary.rows) {
    console.log(`  [${r.type}] "${r.estimated_delivery}" → ${r.cnt} services`);
  }

} finally {
  client.release();
  await pool.end();
}
