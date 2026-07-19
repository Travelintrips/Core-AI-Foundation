/**
 * One-off script: replace logo-design portfolio cover images with
 * design-focused photos (brand mockups, stationery, identity work)
 * instead of industry-context stock photos.
 *
 * Run: pnpm --filter @workspace/api-server tsx src/scripts/fix-portfolio-cover-images.ts
 */
import { pool } from "@workspace/db";

const UPDATES: { title: string; url: string }[] = [
  {
    title: "Kopi Senja — Coffee Shop Logo",
    url: "https://images.unsplash.com/photo-1626785774573-4b799315345d?w=1200&q=80",
  },
  {
    title: "Nusantara Freight — Logistics Mark",
    url: "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=1200&q=80",
  },
  {
    title: "Bloom & Co — Fashion Boutique Logo",
    url: "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=1200&q=80",
  },
  {
    title: "Warung Pagi — Street Food Logo",
    url: "https://images.unsplash.com/photo-1634942537034-2531766767d1?w=1200&q=80",
  },
  {
    title: "Batubara Prima — Mining Corporation Mark",
    url: "https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=1200&q=80",
  },
  {
    title: "Lestari Properti — Real Estate Logo",
    url: "https://images.unsplash.com/photo-1586717799252-bd134ad00e26?w=1200&q=80",
  },
  {
    title: "Cerdas.AI — Tech Startup Logo",
    url: "https://images.unsplash.com/photo-1613909207039-6b173b755cc1?w=1200&q=80",
  },
  {
    title: "Sinar Dagang — Export-Import Mark",
    url: "https://images.unsplash.com/photo-1572044162444-ad60f128bdea?w=1200&q=80",
  },
];

async function main() {
  const client = await pool.connect();
  try {
    let updated = 0;
    for (const { title, url } of UPDATES) {
      const res = await client.query(
        `UPDATE ai_service_portfolios
         SET cover_image = $1::text,
             gallery_json = jsonb_build_array(
               jsonb_build_object('type','image','url',$1::text,'caption',$2::text)
             )
         WHERE title = $2::text
         RETURNING id, title`,
        [url, title],
      );
      if (res.rowCount && res.rowCount > 0) {
        console.log(`✓ Updated: ${title}`);
        updated++;
      } else {
        console.log(`⚠ Not found: ${title}`);
      }
    }
    console.log(`\nDone — ${updated}/${UPDATES.length} rows updated.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
