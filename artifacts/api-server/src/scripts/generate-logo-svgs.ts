/**
 * Generate proper SVG logo concept images for the logo-design portfolio entries,
 * encode them as base64 data-URLs, and update the DB.
 *
 * Run: cd artifacts/api-server && npx tsx src/scripts/generate-logo-svgs.ts
 */
import { pool } from "@workspace/db";

// ── SVG logo generators ────────────────────────────────────────────────────────
// Each returns a self-contained SVG string (800×600 presentation card)

function logoCard(bg: string, accent: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bg}"/>
  ${body}
</svg>`;
}

// 1. Kopi Senja — Coffee Shop Logo  (minimalist, #3B2314 / #D9A44A)
const kopiSenja = logoCard("#FAF7F2", "#3B2314", `
  <!-- Steam wisps -->
  <path d="M360 200 Q355 185 360 170 Q365 155 360 140" stroke="#D9A44A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M380 200 Q375 182 380 165 Q385 148 380 132" stroke="#D9A44A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M400 200 Q395 183 400 166 Q405 149 400 133" stroke="#D9A44A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M420 200 Q415 185 420 170 Q425 155 420 140" stroke="#D9A44A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M440 200 Q435 182 440 165 Q445 148 440 132" stroke="#D9A44A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
  <!-- Cup body -->
  <path d="M340 210 L350 310 Q400 330 450 310 L460 210 Z" fill="#3B2314"/>
  <!-- Cup handle -->
  <path d="M458 240 Q490 240 490 270 Q490 300 458 300" stroke="#3B2314" stroke-width="14" fill="none" stroke-linecap="round"/>
  <!-- Saucer -->
  <ellipse cx="400" cy="318" rx="80" ry="14" fill="#3B2314"/>
  <!-- Wordmark -->
  <text x="400" y="385" font-family="Georgia, serif" font-size="38" font-weight="700" fill="#3B2314" text-anchor="middle" letter-spacing="4">KOPI SENJA</text>
  <!-- Rule -->
  <line x1="290" y1="400" x2="510" y2="400" stroke="#D9A44A" stroke-width="1.5"/>
  <!-- Tagline -->
  <text x="400" y="426" font-family="Georgia, serif" font-size="14" fill="#D9A44A" text-anchor="middle" letter-spacing="3">COFFEE &amp; EVENING RITUAL</text>
  <!-- Colour swatches -->
  <rect x="290" y="480" width="60" height="20" rx="4" fill="#3B2314"/>
  <rect x="360" y="480" width="60" height="20" rx="4" fill="#D9A44A"/>
  <rect x="430" y="480" width="60" height="20" rx="4" fill="#F5E6C8"/>
`);

// 2. Nusantara Freight — Logistics Mark (corporate, #0B3C5D / #F2F2F2)
const nusantaraFreight = logoCard("#0B3C5D", "#F2F2F2", `
  <!-- Arrow icon mark -->
  <polygon points="400,145 460,225 430,225 430,285 370,285 370,225 340,225" fill="#F2F2F2"/>
  <!-- Wordmark -->
  <text x="400" y="345" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#F2F2F2" text-anchor="middle" letter-spacing="3">NUSANTARA</text>
  <text x="400" y="380" font-family="Arial, sans-serif" font-size="18" font-weight="400" fill="#8AAFC7" text-anchor="middle" letter-spacing="8">FREIGHT</text>
  <!-- Rule -->
  <line x1="280" y1="400" x2="520" y2="400" stroke="#8AAFC7" stroke-width="1"/>
  <!-- Tagline -->
  <text x="400" y="425" font-family="Arial, sans-serif" font-size="11" fill="#8AAFC7" text-anchor="middle" letter-spacing="4">CONNECTING ARCHIPELAGO</text>
  <!-- Swatches -->
  <rect x="290" y="480" width="60" height="18" rx="3" fill="#F2F2F2"/>
  <rect x="360" y="480" width="60" height="18" rx="3" fill="#8AAFC7"/>
  <rect x="430" y="480" width="60" height="18" rx="3" fill="#D9A44A"/>
`);

// 3. Bloom & Co — Fashion Boutique Logo (elegant, #C9A6A6 / #1A1A1A)
const bloomCo = logoCard("#FDFAF8", "#1A1A1A", `
  <!-- Petal bloom mark -->
  <ellipse cx="400" cy="170" rx="18" ry="36" fill="#C9A6A6"/>
  <ellipse cx="400" cy="170" rx="18" ry="36" fill="#C9A6A6" transform="rotate(45 400 170)"/>
  <ellipse cx="400" cy="170" rx="18" ry="36" fill="#C9A6A6" transform="rotate(90 400 170)"/>
  <ellipse cx="400" cy="170" rx="18" ry="36" fill="#C9A6A6" transform="rotate(135 400 170)"/>
  <circle cx="400" cy="170" r="12" fill="#FDFAF8"/>
  <!-- Wordmark - elegant serif -->
  <text x="400" y="270" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="700" fill="#1A1A1A" text-anchor="middle" letter-spacing="6">BLOOM</text>
  <!-- Ampersand accent -->
  <text x="400" y="305" font-family="Georgia, serif" font-size="16" fill="#C9A6A6" text-anchor="middle" letter-spacing="8">&amp; C O M P A N Y</text>
  <!-- Rule pair -->
  <line x1="260" y1="322" x2="360" y2="322" stroke="#C9A6A6" stroke-width="0.8"/>
  <text x="400" y="326" font-family="Georgia, serif" font-size="9" fill="#C9A6A6" text-anchor="middle">✦</text>
  <line x1="440" y1="322" x2="540" y2="322" stroke="#C9A6A6" stroke-width="0.8"/>
  <!-- Tagline -->
  <text x="400" y="355" font-family="Georgia, serif" font-size="11" fill="#888" text-anchor="middle" letter-spacing="4">FASHION BOUTIQUE · EST. 2024</text>
  <!-- Swatches -->
  <rect x="310" y="460" width="50" height="16" rx="3" fill="#1A1A1A"/>
  <rect x="370" y="460" width="50" height="16" rx="3" fill="#C9A6A6"/>
  <rect x="430" y="460" width="50" height="16" rx="3" fill="#F3E8E8"/>
`);

// 4. Warung Pagi — Street Food Logo (bold, #C0392B / #F7DC6F)
const warungPagi = logoCard("#C0392B", "#F7DC6F", `
  <!-- Sun burst -->
  <circle cx="400" cy="185" r="45" fill="#F7DC6F"/>
  <g stroke="#F7DC6F" stroke-width="4" stroke-linecap="round">
    <line x1="400" y1="120" x2="400" y2="108"/>
    <line x1="400" y1="250" x2="400" y2="262"/>
    <line x1="335" y1="185" x2="323" y2="185"/>
    <line x1="465" y1="185" x2="477" y2="185"/>
    <line x1="354" y1="139" x2="346" y2="131"/>
    <line x1="446" y1="231" x2="454" y2="239"/>
    <line x1="354" y1="231" x2="346" y2="239"/>
    <line x1="446" y1="139" x2="454" y2="131"/>
  </g>
  <!-- Wordmark -->
  <text x="400" y="300" font-family="Impact, Arial Black, sans-serif" font-size="50" font-weight="900" fill="#F7DC6F" text-anchor="middle" letter-spacing="2">WARUNG</text>
  <text x="400" y="345" font-family="Impact, Arial Black, sans-serif" font-size="50" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="2">PAGI</text>
  <!-- Tagline banner -->
  <rect x="240" y="360" width="320" height="28" fill="#F7DC6F"/>
  <text x="400" y="379" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#C0392B" text-anchor="middle" letter-spacing="5">AUTHENTIC STREET FOOD</text>
  <!-- Swatches -->
  <rect x="300" y="470" width="50" height="18" rx="3" fill="#F7DC6F"/>
  <rect x="360" y="470" width="50" height="18" rx="3" fill="#FFFFFF"/>
  <rect x="420" y="470" width="50" height="18" rx="3" fill="#8B1A10"/>
`);

// 5. Batubara Prima — Mining Corporation Mark (industrial, #2C3E50 / #F39C12)
const batubaraPrima = logoCard("#F4F4F4", "#2C3E50", `
  <!-- Hexagon mark -->
  <polygon points="400,130 448,157 448,213 400,240 352,213 352,157" fill="#2C3E50"/>
  <!-- Inner BP monogram -->
  <text x="400" y="204" font-family="Arial, sans-serif" font-size="42" font-weight="900" fill="#F39C12" text-anchor="middle">BP</text>
  <!-- Horizontal rule with icon -->
  <line x1="240" y1="268" x2="360" y2="268" stroke="#2C3E50" stroke-width="2"/>
  <rect x="370" y="258" width="60" height="20" rx="3" fill="#F39C12"/>
  <line x1="440" y1="268" x2="560" y2="268" stroke="#2C3E50" stroke-width="2"/>
  <!-- Company name -->
  <text x="400" y="315" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#2C3E50" text-anchor="middle" letter-spacing="2">BATUBARA PRIMA</text>
  <text x="400" y="345" font-family="Arial, sans-serif" font-size="12" fill="#666" text-anchor="middle" letter-spacing="6">CORPORATION</text>
  <!-- Tagline -->
  <text x="400" y="385" font-family="Arial, sans-serif" font-size="10" fill="#999" text-anchor="middle" letter-spacing="3">ENERGY · INTEGRITY · SCALE</text>
  <!-- Swatches -->
  <rect x="300" y="465" width="50" height="18" rx="3" fill="#2C3E50"/>
  <rect x="360" y="465" width="50" height="18" rx="3" fill="#F39C12"/>
  <rect x="420" y="465" width="50" height="18" rx="3" fill="#95A5A6"/>
`);

// 6. Lestari Properti — Real Estate Logo (premium, #1A1A2E / #C9A75A)
const lestariProperti = logoCard("#1A1A2E", "#C9A75A", `
  <!-- Roof / house mark -->
  <polygon points="400,130 460,185 460,240 340,240 340,185" fill="none" stroke="#C9A75A" stroke-width="3"/>
  <line x1="370" y1="240" x2="370" y2="195" stroke="#C9A75A" stroke-width="2.5"/>
  <line x1="430" y1="240" x2="430" y2="195" stroke="#C9A75A" stroke-width="2.5"/>
  <rect x="385" y="205" width="30" height="35" stroke="#C9A75A" stroke-width="2" fill="none"/>
  <!-- Gold divider -->
  <line x1="300" y1="262" x2="500" y2="262" stroke="#C9A75A" stroke-width="1"/>
  <!-- Wordmark -->
  <text x="400" y="308" font-family="Georgia, serif" font-size="34" font-weight="700" fill="#C9A75A" text-anchor="middle" letter-spacing="4">LESTARI</text>
  <text x="400" y="340" font-family="Georgia, serif" font-size="14" fill="#F2F2F2" text-anchor="middle" letter-spacing="10">PROPERTI</text>
  <!-- Tagline -->
  <line x1="290" y1="360" x2="510" y2="360" stroke="#333B5A" stroke-width="1"/>
  <text x="400" y="385" font-family="Georgia, serif" font-size="10" fill="#C9A75A" text-anchor="middle" letter-spacing="4">PREMIUM LIVING · TRUSTED QUALITY</text>
  <!-- Swatches -->
  <rect x="300" y="470" width="50" height="18" rx="3" fill="#C9A75A"/>
  <rect x="360" y="470" width="50" height="18" rx="3" fill="#F2F2F2" stroke="#333" stroke-width="0.5"/>
  <rect x="420" y="470" width="50" height="18" rx="3" fill="#333B5A"/>
`);

// 7. Cerdas.AI — Tech Startup Logo (modern, #6C63FF / #F5F5F7)
const cerdasAI = logoCard("#0D0D1A", "#6C63FF", `
  <!-- Geometric AI circuit mark -->
  <circle cx="400" cy="185" r="55" fill="none" stroke="#6C63FF" stroke-width="2.5" opacity="0.4"/>
  <circle cx="400" cy="185" r="38" fill="#6C63FF" opacity="0.15"/>
  <!-- Neural node pattern -->
  <circle cx="400" cy="185" r="10" fill="#6C63FF"/>
  <circle cx="360" cy="160" r="5" fill="#8B85FF"/>
  <circle cx="440" cy="160" r="5" fill="#8B85FF"/>
  <circle cx="360" cy="210" r="5" fill="#8B85FF"/>
  <circle cx="440" cy="210" r="5" fill="#8B85FF"/>
  <circle cx="400" cy="145" r="5" fill="#6C63FF" opacity="0.6"/>
  <circle cx="400" cy="225" r="5" fill="#6C63FF" opacity="0.6"/>
  <line x1="400" y1="185" x2="360" y2="160" stroke="#6C63FF" stroke-width="1.5" opacity="0.6"/>
  <line x1="400" y1="185" x2="440" y2="160" stroke="#6C63FF" stroke-width="1.5" opacity="0.6"/>
  <line x1="400" y1="185" x2="360" y2="210" stroke="#6C63FF" stroke-width="1.5" opacity="0.6"/>
  <line x1="400" y1="185" x2="440" y2="210" stroke="#6C63FF" stroke-width="1.5" opacity="0.6"/>
  <line x1="400" y1="185" x2="400" y2="145" stroke="#6C63FF" stroke-width="1.5" opacity="0.4"/>
  <line x1="400" y1="185" x2="400" y2="225" stroke="#6C63FF" stroke-width="1.5" opacity="0.4"/>
  <!-- Wordmark -->
  <text x="400" y="300" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#F5F5F7" text-anchor="middle" letter-spacing="-1">CERDAS</text>
  <text x="400" y="333" font-family="Arial, sans-serif" font-size="22" font-weight="300" fill="#6C63FF" text-anchor="middle" letter-spacing="12">.AI</text>
  <!-- Tagline -->
  <line x1="290" y1="355" x2="510" y2="355" stroke="#2A2A40" stroke-width="1"/>
  <text x="400" y="380" font-family="Arial, sans-serif" font-size="10" fill="#888" text-anchor="middle" letter-spacing="4">INTELLIGENT BY DESIGN</text>
  <!-- Swatches -->
  <rect x="300" y="465" width="50" height="18" rx="3" fill="#6C63FF"/>
  <rect x="360" y="465" width="50" height="18" rx="3" fill="#F5F5F7" opacity="0.9"/>
  <rect x="420" y="465" width="50" height="18" rx="3" fill="#2A2A40"/>
`);

// 8. Sinar Dagang — Export-Import Mark (corporate, #1B4F72 / #F0B27A)
const sinarDagang = logoCard("#FAFCFF", "#1B4F72", `
  <!-- Globe / compass mark -->
  <circle cx="400" cy="178" r="55" fill="none" stroke="#1B4F72" stroke-width="2.5"/>
  <ellipse cx="400" cy="178" rx="28" ry="55" fill="none" stroke="#1B4F72" stroke-width="1.5"/>
  <line x1="345" y1="178" x2="455" y2="178" stroke="#1B4F72" stroke-width="1.5"/>
  <line x1="345" y1="155" x2="455" y2="155" stroke="#1B4F72" stroke-width="1" opacity="0.5"/>
  <line x1="345" y1="201" x2="455" y2="201" stroke="#1B4F72" stroke-width="1" opacity="0.5"/>
  <!-- Sun / compass rose centre -->
  <circle cx="400" cy="178" r="8" fill="#F0B27A"/>
  <!-- Cardinal marks -->
  <polygon points="400,127 405,140 395,140" fill="#F0B27A"/>
  <!-- Wordmark -->
  <text x="400" y="282" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#1B4F72" text-anchor="middle" letter-spacing="2">SINAR DAGANG</text>
  <!-- Subtitle -->
  <text x="400" y="312" font-family="Arial, sans-serif" font-size="12" fill="#F0B27A" text-anchor="middle" letter-spacing="6">EXPORT · IMPORT</text>
  <!-- Rule -->
  <line x1="270" y1="330" x2="530" y2="330" stroke="#BDD0E0" stroke-width="1"/>
  <!-- Tagline -->
  <text x="400" y="355" font-family="Arial, sans-serif" font-size="10" fill="#999" text-anchor="middle" letter-spacing="3">CONNECTING SOUTHEAST ASIA</text>
  <!-- Swatches -->
  <rect x="300" y="460" width="50" height="18" rx="3" fill="#1B4F72"/>
  <rect x="360" y="460" width="50" height="18" rx="3" fill="#F0B27A"/>
  <rect x="420" y="460" width="50" height="18" rx="3" fill="#BDD0E0"/>
`);

// ── Encode SVG → data URL ─────────────────────────────────────────────────────

function toDataUrl(svg: string): string {
  const encoded = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

// ── Update DB ─────────────────────────────────────────────────────────────────

const LOGO_DESIGNS: { title: string; svg: string }[] = [
  { title: "Kopi Senja — Coffee Shop Logo",         svg: kopiSenja },
  { title: "Nusantara Freight — Logistics Mark",    svg: nusantaraFreight },
  { title: "Bloom & Co — Fashion Boutique Logo",    svg: bloomCo },
  { title: "Warung Pagi — Street Food Logo",        svg: warungPagi },
  { title: "Batubara Prima — Mining Corporation Mark", svg: batubaraPrima },
  { title: "Lestari Properti — Real Estate Logo",   svg: lestariProperti },
  { title: "Cerdas.AI — Tech Startup Logo",         svg: cerdasAI },
  { title: "Sinar Dagang — Export-Import Mark",     svg: sinarDagang },
];

async function main() {
  const client = await pool.connect();
  try {
    let updated = 0;
    for (const { title, svg } of LOGO_DESIGNS) {
      const dataUrl = toDataUrl(svg);
      const res = await client.query(
        `UPDATE ai_service_portfolios
         SET cover_image = $1::text,
             gallery_json = jsonb_build_array(
               jsonb_build_object('type','image','url',$1::text,'caption',$2::text)
             )
         WHERE title = $2::text
         RETURNING id, title`,
        [dataUrl, title],
      );
      if (res.rowCount && res.rowCount > 0) {
        console.log(`✓  ${title}`);
        updated++;
      } else {
        console.log(`⚠  Not found: ${title}`);
      }
    }
    console.log(`\nDone — ${updated}/${LOGO_DESIGNS.length} logos applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
