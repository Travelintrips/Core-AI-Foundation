/**
 * Generate SVG sample images for every non-logo-design portfolio entry.
 * Each SVG visually represents the *output* of that service type:
 *   brand-identity   → brand guideline book spread
 *   packaging-design → product packaging mockup
 *   social-media-design → Instagram post grid
 *   company-profile  → corporate document cover
 *   pitch-deck       → presentation slide mockup
 */
import { pool } from "@workspace/db";

function b64(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function rect(x:number,y:number,w:number,h:number,fill:string,rx=0,opacity=1){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}" opacity="${opacity}"/>`;
}
function txt(x:number,y:number,content:string,fill:string,size:number,weight=400,anchor="middle",font="Arial, sans-serif",letterSpacing=0){
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${content}</text>`;
}
function line(x1:number,y1:number,x2:number,y2:number,stroke:string,sw=1,opacity=1){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAND IDENTITY — brand guideline book spread
// ═══════════════════════════════════════════════════════════════════════════

function brandIdentitySVG(opts: {
  name: string; tagline: string;
  bg1: string; bg2: string; accent: string; light: string;
  initials: string;
}): string {
  const { name, tagline, bg1, bg2, accent, light, initials } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <!-- Left page: brand colour + logo -->
  ${rect(0,0,395,600,bg1)}
  <!-- Logo mark circle -->
  <circle cx="197" cy="220" r="70" fill="${accent}" opacity="0.15"/>
  <circle cx="197" cy="220" r="50" fill="${accent}" opacity="0.9"/>
  ${txt(197,232,initials,"#FFFFFF",28,800)}
  <!-- Brand name -->
  ${txt(197,310,name,light,20,700,"middle","Georgia, serif",2)}
  ${line(120,328,274,328,accent,1)}
  ${txt(197,348,tagline,accent,10,400,"middle","Arial",4)}
  <!-- Page label -->
  ${txt(30,575,"BRAND IDENTITY",light,8,400,"start","Arial",4)}
  ${txt(370,575,"01",light,8,400,"end","Arial")}

  <!-- Right page: style guide -->
  ${rect(405,0,395,600,light)}
  <!-- Section: Colours -->
  ${txt(440,50,"BRAND COLOURS",bg1,9,700,"start","Arial",4)}
  ${line(440,58,760,58,bg1,0.5)}
  ${rect(440,70,70,40,bg1,4)}  ${rect(520,70,70,40,bg2,4)}  ${rect(600,70,70,40,accent,4)}  ${rect(680,70,70,40,"#CCCCCC",4)}
  ${txt(475,126,bg1,"#888",8,400,"middle","Arial")}
  ${txt(555,126,bg2,"#888",8,400,"middle","Arial")}
  ${txt(635,126,accent,"#888",8,400,"middle","Arial")}

  <!-- Section: Typography -->
  ${txt(440,165,"TYPOGRAPHY",bg1,9,700,"start","Arial",4)}
  ${line(440,173,760,173,bg1,0.5)}
  ${txt(440,200,name,bg1,22,700,"start","Georgia, serif")}
  ${txt(440,222,"Primary Typeface · Georgia Serif",bg2,9,400,"start","Arial",2)}
  ${txt(440,248,"Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj",bg1,13,400,"start","Arial")}

  <!-- Section: Logo Variations -->
  ${txt(440,290,"LOGO APPLICATIONS",bg1,9,700,"start","Arial",4)}
  ${line(440,298,760,298,bg1,0.5)}
  <!-- dark bg swatch -->
  ${rect(440,310,150,80,bg1,4)}
  <circle cx="475" cy="342" r="18" fill="${accent}" opacity="0.9"/>
  ${txt(475,348,initials,"#FFF",10,800)}
  ${txt(505,338,name,"#FFF",10,700,"start","Arial")}
  ${txt(505,353,tagline,accent,7,400,"start","Arial")}
  <!-- light bg swatch -->
  ${rect(600,310,150,80,"#FFFFFF",4)}
  <circle cx="635" cy="342" r="18" fill="${bg1}" opacity="0.9"/>
  ${txt(635,348,initials,accent,10,800)}
  ${txt(665,338,name,bg1,10,700,"start","Arial")}
  ${txt(665,353,tagline,bg2,7,400,"start","Arial")}

  <!-- Page number -->
  ${txt(780,575,"02","#AAA",8,400,"end","Arial")}
  ${txt(440,575,"BRAND GUIDELINE","#AAA",8,400,"start","Arial",4)}
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PACKAGING DESIGN — product packaging mockup
// ═══════════════════════════════════════════════════════════════════════════

function spiceTinSVG(): string {
  // Rempah Nusantara — bold spice tin (#8C2F0B, #F4C430)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  ${rect(0,0,800,600,"#FDF6EC")}
  <!-- Can body -->
  <rect x="270" y="120" width="260" height="340" fill="#8C2F0B" rx="20"/>
  <!-- Can top ellipse -->
  <ellipse cx="400" cy="120" rx="130" ry="22" fill="#6A2208"/>
  <!-- Can bottom ellipse -->
  <ellipse cx="400" cy="460" rx="130" ry="22" fill="#6A2208"/>
  <!-- Label band -->
  <rect x="270" y="190" width="260" height="200" fill="#F4C430"/>
  <!-- Brand name on label -->
  ${txt(400,265,"REMPAH","#8C2F0B",28,900,"middle","Impact")}
  ${txt(400,292,"NUSANTARA","#8C2F0B",16,700,"middle","Impact",3)}
  ${line(295,305,505,305,"#8C2F0B",2)}
  ${txt(400,325,"AUTHENTIC SPICE BLEND","#8C2F0B",9,600,"middle","Arial",3)}
  ${txt(400,348,"NET WT 250g","#8C2F0B",8,400,"middle","Arial")}
  <!-- Decorative pattern on tin -->
  ${txt(400,170,"✦  ✦  ✦","#F4C430",10,400,"middle","Arial",4)}
  ${txt(400,440,"✦  ✦  ✦","#F4C430",10,400,"middle","Arial",4)}
  <!-- Colour swatches -->
  ${rect(295,510,60,20,"#8C2F0B",4)} ${rect(365,510,60,20,"#F4C430",4)} ${rect(435,510,60,20,"#F5E6C0",4)}
  ${txt(400,555,"Packaging Design Concept","#888",11,400)}
</svg>`;
}

function beautyBottleSVG(): string {
  // Kecantikan Alam — natural beauty (#D4B483, #F5F5F0, #4A3728)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  ${rect(0,0,800,600,"#F9F5F0")}
  <!-- Bottle body (rounded rectangle) -->
  <rect x="330" y="160" width="140" height="280" fill="#D4B483" rx="30"/>
  <!-- Bottle neck -->
  <rect x="367" y="100" width="66" height="70" fill="#D4B483" rx="8"/>
  <!-- Cap -->
  <rect x="358" y="72" width="84" height="38" fill="#4A3728" rx="6"/>
  <!-- Label -->
  <rect x="338" y="200" width="124" height="180" fill="#F5F5F0" rx="6"/>
  <!-- Brand on label -->
  ${txt(400,238,"KECANTIKAN","#4A3728",13,700,"middle","Georgia, serif",1)}
  ${txt(400,258,"ALAM","#4A3728",11,400,"middle","Georgia, serif",6)}
  ${line(348,268,452,268,"#D4B483",1)}
  <!-- Leaf icon -->
  <ellipse cx="400" cy="295" rx="16" ry="24" fill="#4A3728" opacity="0.15" transform="rotate(-20 400 295)"/>
  <ellipse cx="400" cy="295" rx="10" ry="20" fill="#4A3728" opacity="0.2" transform="rotate(20 400 295)"/>
  <line x1="400" y1="275" x2="400" y2="315" stroke="#4A3728" stroke-width="1" opacity="0.4"/>
  ${txt(400,340,"NATURAL SKINCARE","#4A3728",7,400,"middle","Arial",4)}
  ${txt(400,356,"100ml","#888",8,400,"middle","Arial")}
  <!-- Second bottle (smaller, background) -->
  <rect x="490" y="200" width="90" height="210" fill="#C9A870" rx="20" opacity="0.6"/>
  <rect x="517" y="150" width="36" height="58" fill="#C9A870" rx="6" opacity="0.6"/>
  <rect x="508" y="126" width="54" height="30" fill="#4A3728" rx="4" opacity="0.6"/>
  <!-- Swatches -->
  ${rect(295,525,60,18,"#D4B483",4)} ${rect(365,525,60,18,"#F5F5F0",4)} ${rect(435,525,60,18,"#4A3728",4)}
  ${txt(400,565,"Packaging Design Concept","#888",11,400)}
</svg>`;
}

function coffeeBagSVG(): string {
  // Bumi Coffee — flat-bottom bag (#1C0F08, #C8923A, #F0EAE0)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  ${rect(0,0,800,600,"#F0EAE0")}
  <!-- Bag body -->
  <path d="M290 150 L310 480 Q400 510 490 480 L510 150 Z" fill="#1C0F08"/>
  <!-- Bag top fold -->
  <path d="M290 150 Q310 120 400 115 Q490 120 510 150 L490 170 Q400 140 310 170 Z" fill="#2A1A0E"/>
  <!-- Tin tie / valve -->
  <ellipse cx="400" cy="135" rx="20" ry="6" fill="#C8923A"/>
  <!-- Label area -->
  <path d="M316 220 L318 410 Q400 430 482 410 L484 220 Q400 205 316 220 Z" fill="#C8923A"/>
  <!-- Label content -->
  ${txt(400,265,"BUMI","#F0EAE0",30,900,"middle","Georgia, serif",4)}
  ${txt(400,290,"COFFEE","#1C0F08",16,700,"middle","Arial",6)}
  ${line(330,302,470,302,"#1C0F08",1.5)}
  ${txt(400,318,"SPECIALTY SINGLE ORIGIN","#1C0F08",8,600,"middle","Arial",2)}
  ${txt(400,338,"Sumatra · Medium Roast","#1C0F08",9,400,"middle","Georgia, serif")}
  ${txt(400,360,"250g","#1C0F08",10,700,"middle","Arial")}
  <!-- Coffee beans decoration -->
  <ellipse cx="355" cy="388" rx="10" ry="14" fill="#1C0F08" transform="rotate(-20 355 388)"/>
  <line x1="355" y1="374" x2="355" y2="402" stroke="#C8923A" stroke-width="1"/>
  <ellipse cx="445" cy="388" rx="10" ry="14" fill="#1C0F08" transform="rotate(20 445 388)"/>
  <line x1="445" y1="374" x2="445" y2="402" stroke="#C8923A" stroke-width="1"/>
  <!-- Foil sheen -->
  <path d="M290 150 L310 480" stroke="#3A2010" stroke-width="2" opacity="0.4"/>
  <!-- Swatches -->
  ${rect(295,520,60,18,"#1C0F08",4)} ${rect(365,520,60,18,"#C8923A",4)} ${rect(435,520,60,18,"#F0EAE0",4)}
  ${txt(400,560,"Packaging Design Concept","#888",11,400)}
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCIAL MEDIA DESIGN — Instagram post grid
// ═══════════════════════════════════════════════════════════════════════════

function socialGridSVG(opts: {
  brand: string; handle: string;
  c1: string; c2: string; c3: string; bg: string;
  postTexts: string[];
}): string {
  const { brand, handle, c1, c2, c3, bg, postTexts } = opts;
  const posts = [
    { x: 60, y: 80, fill: c1, textFill: bg === "#FFFFFF" ? c1 : "#FFFFFF" },
    { x: 300, y: 80, fill: c2, textFill: "#FFFFFF" },
    { x: 540, y: 80, fill: c3, textFill: "#FFFFFF" },
    { x: 60, y: 330, fill: c2, textFill: "#FFFFFF" },
    { x: 300, y: 330, fill: c3, textFill: "#FFFFFF" },
    { x: 540, y: 330, fill: c1, textFill: bg === "#FFFFFF" ? c1 : "#FFFFFF" },
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  ${rect(0,0,800,600,"#F0F2F5")}
  <!-- Phone frame mock -->
  <rect x="20" y="20" width="760" height="560" fill="#FFFFFF" rx="12"/>
  <!-- Profile row -->
  <circle cx="60" cy="45" r="18" fill="${c1}"/>
  ${txt(60,50,brand[0],"#FFFFFF",14,700)}
  ${txt(85,40,brand,"#111",13,700,"start","Arial")}
  ${txt(85,55,handle,"#888",10,400,"start","Arial")}
  <rect x="680" y="32" width="80" height="26" fill="${c1}" rx="13"/>
  ${txt(720,49,"Follow","#FFF",10,600)}
`;
  for (let i = 0; i < 6; i++) {
    const p = posts[i];
    const text = postTexts[i] || brand;
    svg += `  ${rect(p.x, p.y, 200, 200, p.fill, 4)}
  ${txt(p.x+100, p.y+90, text, "#FFFFFF", 13, 700)}
  ${txt(p.x+100, p.y+110, "●●●", "rgba(255,255,255,0.4)", 8, 400)}
  `;
  }
  // Bottom caption
  svg += `${txt(400,565,"Social Media Design · Template Kit","#888",11,400)}</svg>`;
  return svg;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY PROFILE — corporate document cover + spread
// ═══════════════════════════════════════════════════════════════════════════

function companyProfileSVG(opts: {
  company: string; tagline: string; industry: string;
  bg: string; accent: string; light: string;
  initials: string;
}): string {
  const { company, tagline, industry, bg, accent, light, initials } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <!-- Left page: cover -->
  ${rect(0,0,390,600,bg)}
  <!-- Decorative shape top-right of cover -->
  <rect x="260" y="0" width="130" height="130" fill="${accent}" opacity="0.2"/>
  <rect x="320" y="0" width="70" height="70" fill="${accent}" opacity="0.3"/>
  <!-- Logo block -->
  ${rect(40,80,70,70,accent,4)}
  ${txt(75,122,initials,"#FFFFFF",22,800)}
  ${txt(122,104,company,light,16,700,"start","Georgia, serif")}
  ${txt(122,124,industry,accent,10,400,"start","Arial",3)}
  <!-- Cover title block -->
  ${txt(40,240,"COMPANY","#FFFFFF",38,900,"start","Arial",-2)}
  ${txt(40,285,"PROFILE","#FFFFFF",38,300,"start","Arial",8)}
  ${line(40,300,200,300,accent,2)}
  ${txt(40,325,tagline,light,11,400,"start","Arial")}
  <!-- Bottom bar -->
  ${rect(0,555,390,45,accent)}
  ${txt(40,582,"www."+company.toLowerCase().replace(/[^a-z]/g,"")+".co.id",light,10,400,"start","Arial")}
  ${txt(355,582,"2025","#FFFFFF",10,400,"end","Arial")}

  <!-- Right page: inner spread -->
  ${rect(410,0,390,600,light)}
  <!-- Chapter title -->
  ${rect(410,0,5,600,accent)}
  ${txt(435,60,"ABOUT US",bg,11,700,"start","Arial",5)}
  ${line(435,70,775,70,bg,0.3)}
  <!-- Fake body text lines -->
  ${[85,100,115,130,145].map(y=>`<rect x="435" y="${y}" width="${[280,250,265,230,200][Math.floor((y-85)/15)]}" height="8" fill="${bg}" rx="2" opacity="0.15"/>`).join("\n  ")}
  <!-- Stats row -->
  ${rect(435,180,100,80,bg,6,0.08)}
  ${txt(485,215,"12+",bg,24,800,"middle","Arial")}
  ${txt(485,232,"Years",bg,9,400,"middle","Arial")}
  ${rect(545,180,100,80,bg,6,0.08)}
  ${txt(595,215,"500+",bg,24,800,"middle","Arial")}
  ${txt(595,232,"Projects",bg,9,400,"middle","Arial")}
  ${rect(655,180,100,80,bg,6,0.08)}
  ${txt(705,215,"98%",bg,24,800,"middle","Arial")}
  ${txt(705,232,"Satisfied",bg,9,400,"middle","Arial")}
  <!-- Section 2 -->
  ${txt(435,295,"OUR SERVICES",bg,11,700,"start","Arial",5)}
  ${line(435,305,775,305,bg,0.3)}
  ${[320,345,370,395].map((y,i)=>`<rect x="435" y="${y}" width="12" height="12" fill="${accent}" rx="2"/><rect x="455" y="${y+1}" width="${[200,180,220,160][i]}" height="8" fill="${bg}" rx="2" opacity="0.2"/>`).join("\n  ")}
  <!-- Page number -->
  ${txt(775,580,"02","#AAA",9,400,"end","Arial")}
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PITCH DECK — slides mockup
// ═══════════════════════════════════════════════════════════════════════════

function pitchDeckSVG(opts: {
  company: string; tagline: string; round: string;
  bg: string; accent: string; light: string;
}): string {
  const { company, tagline, round, bg, accent, light } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  ${rect(0,0,800,600,"#E8ECF0")}

  <!-- Slide 1: Title cover (large) -->
  ${rect(40,40,430,300,bg,8)}
  <!-- Gradient bar left -->
  ${rect(40,40,8,300,accent,0)}
  <!-- Title content -->
  ${txt(70,110,company,light,22,800,"start","Arial")}
  ${rect(70,122,180,3,accent)}
  ${txt(70,150,tagline,accent,11,400,"start","Arial")}
  ${txt(70,180,round,light,13,600,"start","Arial")}
  <!-- Decorative circle -->
  <circle cx="400" cy="190" r="80" fill="${accent}" opacity="0.08"/>
  <circle cx="400" cy="190" r="55" fill="${accent}" opacity="0.10"/>
  <!-- Stats preview -->
  ${rect(70,220,100,60,accent,4,0.15)}
  ${txt(120,248,"$2.5M",light,18,800,"middle","Arial")}
  ${txt(120,265,"Raising",accent,9,400,"middle","Arial")}
  ${rect(180,220,100,60,accent,4,0.15)}
  ${txt(230,248,"18%",light,18,800,"middle","Arial")}
  ${txt(230,265,"MoM Growth",accent,9,400,"middle","Arial")}
  ${rect(290,220,100,60,accent,4,0.15)}
  ${txt(340,248,"12K",light,18,800,"middle","Arial")}
  ${txt(340,265,"Active Users",accent,9,400,"middle","Arial")}
  <!-- Slide label -->
  ${txt(250,330,"01 / Cover",light,8,400,"middle","Arial")}

  <!-- Slide 2: Market Opportunity -->
  ${rect(490,40,270,140,bg,6)}
  ${txt(510,75,"Market Opportunity",light,11,700,"start","Arial")}
  ${line(510,82,745,82,accent,1,0.4)}
  <!-- Donut chart rough -->
  <circle cx="620" cy="115" r="35" fill="none" stroke="${accent}" stroke-width="14" stroke-dasharray="110 110" transform="rotate(-90 620 115)" opacity="0.8"/>
  <circle cx="620" cy="115" r="35" fill="none" stroke="${light}" stroke-width="14" stroke-dasharray="40 110" transform="rotate(-90 620 115)" opacity="0.3"/>
  ${txt(620,120,"65%",light,10,700,"middle","Arial")}
  ${txt(700,100,"TAM: $4.2B",light,8,400,"start","Arial")}
  ${txt(700,115,"SAM: $850M",accent,8,400,"start","Arial")}
  ${txt(700,130,"SOM: $120M",light,8,400,"start","Arial")}
  ${txt(620,168,"02 / Market","#AAA",7,400,"middle","Arial")}

  <!-- Slide 3: Traction -->
  ${rect(490,200,270,140,bg,6)}
  ${txt(510,230,"Traction & Revenue",light,11,700,"start","Arial")}
  ${line(510,238,745,238,accent,1,0.4)}
  <!-- Bar chart -->
  ${[["Q1","30",510],["Q2","50",560],["Q3","80",610],["Q4","110",660]].map(([q,h,x])=>
    `${rect(Number(x),340-Number(h),40,Number(h),accent,2,0.7)}${txt(Number(x)+20,352,q,light,7,400,"middle","Arial")}`
  ).join("\n  ")}
  ${txt(620,368,"03 / Traction","#AAA",7,400,"middle","Arial")}

  <!-- Slide 4: Team -->
  ${rect(490,360,270,140,bg,6)}
  ${txt(510,390,"The Team",light,11,700,"start","Arial")}
  ${line(510,398,745,398,accent,1,0.4)}
  <circle cx="545" cy="430" r="22" fill="${accent}" opacity="0.3"/>
  ${txt(545,435,"CEO",light,7,700,"middle","Arial")}
  <circle cx="610" cy="430" r="22" fill="${accent}" opacity="0.3"/>
  ${txt(610,435,"CTO",light,7,700,"middle","Arial")}
  <circle cx="675" cy="430" r="22" fill="${accent}" opacity="0.3"/>
  ${txt(675,435,"CFO",light,7,700,"middle","Arial")}
  ${txt(620,488,"04 / Team","#AAA",7,400,"middle","Arial")}

  <!-- Bottom caption -->
  ${txt(400,575,"Pitch Deck · ${round}","#888",11,400)}
</svg>`.replace("${round}", round);
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

const ENTRIES: { title: string; svg: string }[] = [

  // ── brand-identity ─────────────────────────────────────────────────────
  {
    title: "Java Roastery — Full Identity System",
    svg: brandIdentitySVG({
      name:"JAVA ROASTERY", tagline:"SPECIALTY COFFEE · EST. 2019",
      bg1:"#2E1503", bg2:"#6B3A1F", accent:"#E8B84B", light:"#F5F0E6", initials:"JR"
    }),
  },
  {
    title: "MedFirst Clinic — Healthcare Brand System",
    svg: brandIdentitySVG({
      name:"MEDFIRST CLINIC", tagline:"TRUSTED HEALTHCARE · CARE FIRST",
      bg1:"#155E75", bg2:"#0E7490", accent:"#22D3EE", light:"#F0FDFF", initials:"M+"
    }),
  },
  {
    title: "Sawit Hijau — Agribusiness Brand",
    svg: brandIdentitySVG({
      name:"SAWIT HIJAU", tagline:"SUSTAINABLE AGRIBUSINESS · EXPORT READY",
      bg1:"#2D6A4F", bg2:"#1B4332", accent:"#F4A261", light:"#F0FDF4", initials:"SH"
    }),
  },
  {
    title: "Nuansa Bali — Boutique Hotel Identity",
    svg: brandIdentitySVG({
      name:"NUANSA BALI", tagline:"BOUTIQUE HOTEL · BALINESE SPIRIT",
      bg1:"#4A2C2A", bg2:"#6B3E3C", accent:"#C9A75A", light:"#FDF8F0", initials:"NB"
    }),
  },
  {
    title: "Mega Konstruksi — Construction Brand",
    svg: brandIdentitySVG({
      name:"MEGA KONSTRUKSI", tagline:"BUILDING THE FUTURE · SINCE 2005",
      bg1:"#212121", bg2:"#333333", accent:"#FFC107", light:"#F9FAFB", initials:"MK"
    }),
  },

  // ── packaging-design ───────────────────────────────────────────────────
  { title: "Rempah Nusantara — Spice Packaging",    svg: spiceTinSVG() },
  { title: "Kecantikan Alam — Natural Beauty Packaging", svg: beautyBottleSVG() },
  { title: "Bumi Coffee — Specialty Bag Packaging", svg: coffeeBagSVG() },

  // ── social-media-design ────────────────────────────────────────────────
  {
    title: "Warung Sedap — Restaurant Content Set",
    svg: socialGridSVG({
      brand:"Warung Sedap", handle:"@warungs edap",
      c1:"#B3261E", c2:"#8B1A14", c3:"#D4493E", bg:"#FFF7E8",
      postTexts:["Menu\nHari Ini","Promo\nSiang","Spesial\nMinggu","Catering","Delivery\n24 Jam","Chef's\nChoice"],
    }),
  },
  {
    title: "TechStart ID — Social Media Kit",
    svg: socialGridSVG({
      brand:"TechStart ID", handle:"@techstartid",
      c1:"#6C63FF", c2:"#00D9A6", c3:"#4A42CC", bg:"#F8F8FF",
      postTexts:["Product\nLaunch","New\nFeature","Event\nAnnounce","Case\nStudy","Tips &\nTricks","Hiring\nNow"],
    }),
  },
  {
    title: "Lestari Hotel — Travel Content Series",
    svg: socialGridSVG({
      brand:"Lestari Hotel", handle:"@lestarihotel",
      c1:"#4A2C2A", c2:"#C9A75A", c3:"#6B3E3C", bg:"#FDF8F0",
      postTexts:["Pool\nViews","Room\nTour","Dining\nExperience","Spa &\nWellness","Book\nNow","Local\nExplore"],
    }),
  },

  // ── company-profile ────────────────────────────────────────────────────
  {
    title: "Cendana Construction — Company Profile",
    svg: companyProfileSVG({
      company:"CENDANA CONSTRUCTION", tagline:"Building Excellence, Delivering Trust",
      industry:"CONSTRUCTION & ENGINEERING",
      bg:"#1F2A44", accent:"#C9A227", light:"#FAFAF8", initials:"CC"
    }),
  },
  {
    title: "Sawit Makmur Group — Palm Oil Corporate Profile",
    svg: companyProfileSVG({
      company:"SAWIT MAKMUR GROUP", tagline:"Sustainable Palm Oil for Global Markets",
      industry:"AGRIBUSINESS · PALM OIL",
      bg:"#1A4731", accent:"#F5A623", light:"#FAFDF8", initials:"SM"
    }),
  },
  {
    title: "Maju Bersama Trading — Export-Import Profile",
    svg: companyProfileSVG({
      company:"MAJU BERSAMA TRADING", tagline:"Connecting Indonesian Products to the World",
      industry:"EXPORT · IMPORT · TRADING",
      bg:"#1B4F72", accent:"#F0B27A", light:"#F8FBFF", initials:"MB"
    }),
  },

  // ── pitch-deck ─────────────────────────────────────────────────────────
  {
    title: "Lumina EdTech — Seed Round Pitch Deck",
    svg: pitchDeckSVG({
      company:"LUMINA EdTech", tagline:"AI-Powered Learning for Indonesia",
      round:"Seed Round · $2.5M", bg:"#1E1B4B", accent:"#818CF8", light:"#E0E7FF",
    }),
  },
  {
    title: "GreenMine — Mining Startup Series A",
    svg: pitchDeckSVG({
      company:"GREENMINE", tagline:"Clean Technology for Responsible Mining",
      round:"Series A · $8M", bg:"#0F2D1F", accent:"#27AE60", light:"#D1FAE5",
    }),
  },
  {
    title: "Properti Digital — PropTech Pitch",
    svg: pitchDeckSVG({
      company:"PROPERTI DIGITAL", tagline:"Disrupting the Secondary Property Market",
      round:"Pre-Series A · $3M", bg:"#1A1A2E", accent:"#E74C3C", light:"#FFE4E1",
    }),
  },
];

// ── Update DB ─────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    let ok = 0;
    for (const { title, svg } of ENTRIES) {
      const url = b64(svg);
      const res = await client.query(
        `UPDATE ai_service_portfolios
         SET cover_image = $1::text,
             gallery_json = jsonb_build_array(
               jsonb_build_object('type','image','url',$1::text,'caption',$2::text)
             )
         WHERE title = $2::text
         RETURNING id`,
        [url, title],
      );
      const found = res.rowCount && res.rowCount > 0;
      console.log(found ? `✓  ${title}` : `⚠  NOT FOUND: ${title}`);
      if (found) ok++;
    }
    console.log(`\nDone — ${ok}/${ENTRIES.length} entries updated.`);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
