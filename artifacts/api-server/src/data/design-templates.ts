/**
 * Built-in Design Templates — render sekali, pakai selamanya.
 *
 * Setiap template berisi:
 * - metadata  : nama, kategori, industri, style, ukuran
 * - canvasState: CanvasState lengkap siap render di editor
 *
 * Cara menambah template baru:
 *   1. Tambahkan objek BuiltinTemplate di array BUILTIN_TEMPLATES di bawah.
 *   2. Gunakan templateCode unik, e.g. LOGO-FOOD-BOLD-002.
 *   3. Tidak perlu migration DB — templates ini di-serve langsung dari kode.
 */

export interface BuiltinCanvasElement {
  id: string;
  name: string;
  type: "text" | "image" | "rect" | "circle" | "line" | "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  color?: string;
  src?: string;
  objectFit?: string;
}

export interface BuiltinCanvasState {
  width: number;
  height: number;
  background: string;
  elements: BuiltinCanvasElement[];
}

export interface BuiltinTemplate {
  templateCode: string;          // e.g. LOGO-TECH-MODERN-001
  name: string;
  description: string;
  category: string;              // Logo, Social Media, Banner, Poster, …
  style: string;                 // Modern, Minimalist, Bold, Elegant, …
  industry: string | null;       // null = lintas industri
  tags: string[];
  canvasWidth: number;
  canvasHeight: number;
  canvasState: BuiltinCanvasState;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [

  // ── IG-POST-ELEGANT-001 ───────────────────────────────────────────────────
  {
    templateCode: "IG-POST-ELEGANT-001",
    name: "Elegant Gold",
    description: "Instagram post mewah dengan aksen emas di atas hitam. Cocok untuk brand fashion, jewelry, dan luxury lifestyle.",
    category: "Instagram Post",
    style: "Elegant",
    industry: null,
    tags: ["instagram", "post", "elegant", "gold", "luxury", "fashion", "dark"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#0A0A0A",
      elements: [
        // Top gold border line
        { id: "border-top", name: "Border Top", type: "line", x: 60, y: 60, width: 960, height: 2, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 2 },
        // Left gold border
        { id: "border-left", name: "Border Left", type: "line", x: 60, y: 60, width: 2, height: 960, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 2 },
        // Right gold border
        { id: "border-right", name: "Border Right", type: "line", x: 1018, y: 60, width: 2, height: 960, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 2 },
        // Bottom gold border
        { id: "border-bottom", name: "Border Bottom", type: "line", x: 60, y: 1018, width: 960, height: 2, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 2 },
        // Corner ornament TL
        { id: "corner-tl", name: "Corner TL", type: "rect", x: 55, y: 55, width: 20, height: 20, rotation: 45, opacity: 1, zIndex: 2, locked: true, visible: true, fill: "#C9A84C" },
        // Corner ornament TR
        { id: "corner-tr", name: "Corner TR", type: "rect", x: 1005, y: 55, width: 20, height: 20, rotation: 45, opacity: 1, zIndex: 2, locked: true, visible: true, fill: "#C9A84C" },
        // Gold divider center top
        { id: "divider-top", name: "Divider Top", type: "line", x: 340, y: 320, width: 400, height: 1, rotation: 0, opacity: 0.6, zIndex: 3, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 1 },
        // Diamond ornament
        { id: "diamond", name: "Diamond", type: "rect", x: 518, y: 312, width: 16, height: 16, rotation: 45, opacity: 1, zIndex: 4, locked: true, visible: true, fill: "#C9A84C" },
        // Main tagline — EDITABLE
        { id: "tagline", name: "Tagline", type: "text", x: 80, y: 350, width: 920, height: 120, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "TAGLINE ANDA\nDI SINI", fontSize: 64, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#C9A84C" },
        // Gold divider center bottom
        { id: "divider-bot", name: "Divider Bottom", type: "line", x: 340, y: 590, width: 400, height: 1, rotation: 0, opacity: 0.6, zIndex: 6, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 1 },
        // Sub text — EDITABLE
        { id: "subtext", name: "Subtext", type: "text", x: 80, y: 620, width: 920, height: 50, rotation: 0, opacity: 0.8, zIndex: 7, locked: false, visible: true, text: "Kualitas Tanpa Kompromi", fontSize: 22, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        // Brand name — EDITABLE
        { id: "brand-name", name: "Nama Brand", type: "text", x: 80, y: 920, width: 920, height: 60, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "NAMA BRAND", fontSize: 28, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#C9A84C" },
      ],
    },
  },

  // ── IG-POST-VIBRANT-001 ───────────────────────────────────────────────────
  {
    templateCode: "IG-POST-VIBRANT-001",
    name: "Vibrant Gradient",
    description: "Instagram post energik dengan gradasi warna cerah. Cocok untuk brand F&B, fitness, dan youth lifestyle.",
    category: "Instagram Post",
    style: "Bold",
    industry: null,
    tags: ["instagram", "post", "vibrant", "gradient", "colorful", "bold", "youth"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#FF6B35",
      elements: [
        // Gradient overlay top
        { id: "grad-top", name: "Gradient Top", type: "rect", x: 0, y: 0, width: 1080, height: 540, rotation: 0, opacity: 0.7, zIndex: 1, locked: true, visible: true, fill: "#FF006E", borderRadius: 0 },
        // Gradient overlay bottom
        { id: "grad-bot", name: "Gradient Bottom", type: "rect", x: 0, y: 540, width: 1080, height: 540, rotation: 0, opacity: 0.7, zIndex: 1, locked: true, visible: true, fill: "#8338EC", borderRadius: 0 },
        // Large circle decoration BG
        { id: "circle-bg", name: "Circle BG", type: "rect", x: -100, y: -100, width: 700, height: 700, rotation: 0, opacity: 0.15, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 350 },
        // Small circle accent right
        { id: "circle-sm", name: "Circle SM", type: "rect", x: 880, y: 700, width: 280, height: 280, rotation: 0, opacity: 0.1, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 140 },
        // White pill badge
        { id: "badge", name: "Badge", type: "rect", x: 340, y: 140, width: 400, height: 56, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 28 },
        // Badge text — EDITABLE
        { id: "badge-text", name: "Badge Text", type: "text", x: 340, y: 152, width: 400, height: 32, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "✨ NEW ARRIVAL", fontSize: 18, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FF006E" },
        // Main headline — EDITABLE
        { id: "headline", name: "Headline", type: "text", x: 60, y: 340, width: 960, height: 240, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "JUDUL\nBERANI\nATTENTION", fontSize: 120, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#FFFFFF" },
        // Sub description — EDITABLE
        { id: "sub-desc", name: "Sub Deskripsi", type: "text", x: 60, y: 720, width: 600, height: 60, rotation: 0, opacity: 0.9, zIndex: 6, locked: false, visible: true, text: "Deskripsi singkat yang menarik perhatian audiens Anda.", fontSize: 24, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        // CTA button shape
        { id: "cta-btn", name: "CTA Button", type: "rect", x: 60, y: 860, width: 280, height: 64, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 32 },
        // CTA text — EDITABLE
        { id: "cta-text", name: "CTA Text", type: "text", x: 60, y: 876, width: 280, height: 32, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "Pelajari Lebih Lanjut", fontSize: 18, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FF006E" },
        // Brand name bottom right — EDITABLE
        { id: "brand", name: "Nama Brand", type: "text", x: 700, y: 1000, width: 320, height: 40, rotation: 0, opacity: 0.9, zIndex: 9, locked: false, visible: true, text: "@namabrand", fontSize: 22, fontFamily: "Inter", fontWeight: "600", textAlign: "right", color: "#FFFFFF" },
      ],
    },
  },

  // ── IG-POST-MINIMAL-001 ───────────────────────────────────────────────────
  {
    templateCode: "IG-POST-MINIMAL-001",
    name: "Minimal White",
    description: "Instagram post bersih dan minimalis dengan latar putih. Cocok untuk skincare, lifestyle, dan brand premium.",
    category: "Instagram Post",
    style: "Minimalist",
    industry: null,
    tags: ["instagram", "post", "minimal", "white", "clean", "skincare", "lifestyle"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#FAFAFA",
      elements: [
        // Top accent bar
        { id: "accent-bar", name: "Accent Bar", type: "rect", x: 60, y: 60, width: 80, height: 6, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1A1A1A", borderRadius: 3 },
        // Image placeholder (main visual area)
        { id: "img-placeholder", name: "Gambar Produk", type: "rect", x: 60, y: 110, width: 960, height: 600, rotation: 0, opacity: 1, zIndex: 2, locked: false, visible: true, fill: "#E8E8E8", borderRadius: 8 },
        // Placeholder label
        { id: "img-label", name: "Label Gambar", type: "text", x: 60, y: 360, width: 960, height: 100, rotation: 0, opacity: 0.4, zIndex: 3, locked: true, visible: true, text: "Gambar Produk / Visual", fontSize: 28, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#888888" },
        // Thin horizontal rule
        { id: "rule", name: "Rule", type: "line", x: 60, y: 760, width: 960, height: 1, rotation: 0, opacity: 0.2, zIndex: 4, locked: true, visible: true, fill: "#000000", stroke: "#000000", strokeWidth: 1 },
        // Product/post name — EDITABLE
        { id: "product-name", name: "Nama Produk / Post", type: "text", x: 60, y: 790, width: 700, height: 80, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "Nama Produk Anda", fontSize: 44, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#1A1A1A" },
        // Price or category — EDITABLE
        { id: "price-cat", name: "Harga / Kategori", type: "text", x: 60, y: 885, width: 500, height: 40, rotation: 0, opacity: 0.6, zIndex: 6, locked: false, visible: true, text: "Kategori Produk", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#555555" },
        // Brand name top right — EDITABLE
        { id: "brand-name", name: "Nama Brand", type: "text", x: 800, y: 68, width: 220, height: 40, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "BRAND", fontSize: 20, fontFamily: "Inter", fontWeight: "800", textAlign: "right", color: "#1A1A1A" },
        // Small accent dot
        { id: "dot", name: "Dot Aksen", type: "rect", x: 760, y: 904, width: 10, height: 10, rotation: 0, opacity: 1, zIndex: 8, locked: true, visible: true, fill: "#1A1A1A", borderRadius: 5 },
        // Website/CTA text — EDITABLE
        { id: "website", name: "Website / CTA", type: "text", x: 780, y: 898, width: 240, height: 36, rotation: 0, opacity: 0.7, zIndex: 9, locked: false, visible: true, text: "www.brand.com", fontSize: 18, fontFamily: "Inter", fontWeight: "400", textAlign: "right", color: "#333333" },
      ],
    },
  },

  // ── IG-POST-CORPORATE-001 ─────────────────────────────────────────────────
  {
    templateCode: "IG-POST-CORPORATE-001",
    name: "Professional Blue",
    description: "Instagram post profesional bernuansa biru tua. Cocok untuk perusahaan B2B, konsultan, dan jasa keuangan.",
    category: "Instagram Post",
    style: "Professional",
    industry: null,
    tags: ["instagram", "post", "corporate", "blue", "professional", "b2b", "finance"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#0D1B3E",
      elements: [
        // Top colored strip
        { id: "top-strip", name: "Top Strip", type: "rect", x: 0, y: 0, width: 1080, height: 8, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1E90FF" },
        // Left sidebar accent
        { id: "sidebar", name: "Sidebar Aksen", type: "rect", x: 0, y: 8, width: 8, height: 1072, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1E90FF" },
        // Large geometric shape background
        { id: "geo-bg", name: "Geometric BG", type: "rect", x: 600, y: -200, width: 700, height: 700, rotation: 30, opacity: 0.06, zIndex: 2, locked: true, visible: true, fill: "#1E90FF" },
        // Second geometric shape
        { id: "geo-bg2", name: "Geometric BG2", type: "rect", x: 500, y: 400, width: 600, height: 600, rotation: 15, opacity: 0.04, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF" },
        // Company logo area (placeholder)
        { id: "logo-area", name: "Area Logo", type: "rect", x: 60, y: 80, width: 160, height: 60, rotation: 0, opacity: 0.15, zIndex: 3, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 8 },
        // Logo text — EDITABLE
        { id: "logo-text", name: "Logo / Brand", type: "text", x: 60, y: 92, width: 160, height: 36, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "BRAND", fontSize: 22, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        // Blue accent line left
        { id: "accent-line", name: "Accent Line", type: "rect", x: 60, y: 280, width: 60, height: 6, rotation: 0, opacity: 1, zIndex: 5, locked: true, visible: true, fill: "#1E90FF", borderRadius: 3 },
        // Pre-headline small text — EDITABLE
        { id: "pre-head", name: "Pre-Headline", type: "text", x: 60, y: 310, width: 700, height: 40, rotation: 0, opacity: 0.7, zIndex: 6, locked: false, visible: true, text: "SOLUSI BISNIS TERPERCAYA", fontSize: 18, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#1E90FF" },
        // Main headline — EDITABLE
        { id: "headline", name: "Headline Utama", type: "text", x: 60, y: 360, width: 820, height: 220, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "Tingkatkan\nPerforma\nBisnis Anda", fontSize: 80, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        // Horizontal divider
        { id: "divider", name: "Divider", type: "line", x: 60, y: 620, width: 400, height: 2, rotation: 0, opacity: 0.3, zIndex: 8, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 2 },
        // Description — EDITABLE
        { id: "description", name: "Deskripsi", type: "text", x: 60, y: 650, width: 700, height: 100, rotation: 0, opacity: 0.8, zIndex: 9, locked: false, visible: true, text: "Kami membantu perusahaan Anda tumbuh dengan strategi yang terukur dan hasil yang nyata.", fontSize: 26, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#94A3B8" },
        // Stats box 1
        { id: "stat-box1", name: "Stat Box 1", type: "rect", x: 60, y: 800, width: 200, height: 120, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, fill: "#1E2D5A", borderRadius: 12 },
        // Stat number 1 — EDITABLE
        { id: "stat-num1", name: "Angka Statistik 1", type: "text", x: 60, y: 820, width: 200, height: 60, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "500+", fontSize: 40, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#1E90FF" },
        { id: "stat-lab1", name: "Label Statistik 1", type: "text", x: 60, y: 876, width: 200, height: 30, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Klien Puas", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        // Stats box 2
        { id: "stat-box2", name: "Stat Box 2", type: "rect", x: 280, y: 800, width: 200, height: 120, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, fill: "#1E2D5A", borderRadius: 12 },
        { id: "stat-num2", name: "Angka Statistik 2", type: "text", x: 280, y: 820, width: 200, height: 60, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "10T+", fontSize: 40, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#1E90FF" },
        { id: "stat-lab2", name: "Label Statistik 2", type: "text", x: 280, y: 876, width: 200, height: 30, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Aset Dikelola", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        // Stats box 3
        { id: "stat-box3", name: "Stat Box 3", type: "rect", x: 500, y: 800, width: 200, height: 120, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, fill: "#1E2D5A", borderRadius: 12 },
        { id: "stat-num3", name: "Angka Statistik 3", type: "text", x: 500, y: 820, width: 200, height: 60, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "15Th", fontSize: 40, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#1E90FF" },
        { id: "stat-lab3", name: "Label Statistik 3", type: "text", x: 500, y: 876, width: 200, height: 30, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Pengalaman", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        // CTA — EDITABLE
        { id: "cta", name: "CTA / Website", type: "text", x: 750, y: 1020, width: 280, height: 36, rotation: 0, opacity: 0.6, zIndex: 13, locked: false, visible: true, text: "www.brand.co.id", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "right", color: "#94A3B8" },
      ],
    },
  },

  // ── IG-POST-NATURE-001 ────────────────────────────────────────────────────
  {
    templateCode: "IG-POST-NATURE-001",
    name: "Natural Green",
    description: "Instagram post hangat bernuansa alam dengan palet hijau dan krem. Cocok untuk produk organik, kuliner sehat, dan eco-brand.",
    category: "Instagram Post",
    style: "Natural",
    industry: null,
    tags: ["instagram", "post", "nature", "green", "organic", "food", "eco", "warm"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#F5F0E8",
      elements: [
        // Large green circle top-left (organic shape)
        { id: "circle-tl", name: "Circle TL", type: "rect", x: -180, y: -180, width: 600, height: 600, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#4A7C59", borderRadius: 300 },
        // Medium green circle bottom-right
        { id: "circle-br", name: "Circle BR", type: "rect", x: 700, y: 700, width: 500, height: 500, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#6B9E78", borderRadius: 250 },
        // Cream card overlay center
        { id: "card", name: "Card Tengah", type: "rect", x: 100, y: 200, width: 880, height: 680, rotation: 0, opacity: 0.95, zIndex: 2, locked: true, visible: true, fill: "#FDFAF4", borderRadius: 24 },
        // Leaf ornament top of card (small circle cluster)
        { id: "leaf1", name: "Daun 1", type: "rect", x: 480, y: 185, width: 40, height: 40, rotation: 20, opacity: 0.7, zIndex: 3, locked: true, visible: true, fill: "#4A7C59", borderRadius: 20 },
        { id: "leaf2", name: "Daun 2", type: "rect", x: 520, y: 170, width: 30, height: 30, rotation: -15, opacity: 0.5, zIndex: 3, locked: true, visible: true, fill: "#6B9E78", borderRadius: 15 },
        { id: "leaf3", name: "Daun 3", type: "rect", x: 560, y: 182, width: 35, height: 35, rotation: 35, opacity: 0.6, zIndex: 3, locked: true, visible: true, fill: "#4A7C59", borderRadius: 18 },
        // Green label badge
        { id: "badge", name: "Badge Kategori", type: "rect", x: 380, y: 280, width: 320, height: 44, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, fill: "#4A7C59", borderRadius: 22 },
        // Badge text — EDITABLE
        { id: "badge-text", name: "Text Badge", type: "text", x: 380, y: 290, width: 320, height: 24, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "100% ORGANIK & ALAMI", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        // Main product/headline — EDITABLE
        { id: "headline", name: "Nama Produk", type: "text", x: 120, y: 360, width: 840, height: 200, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "Nama Produk\nAnda Disini", fontSize: 72, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#2D4A35" },
        // Thin green divider
        { id: "divider", name: "Divider", type: "line", x: 380, y: 590, width: 320, height: 1, rotation: 0, opacity: 0.4, zIndex: 7, locked: true, visible: true, fill: "#4A7C59", stroke: "#4A7C59", strokeWidth: 1 },
        // Description — EDITABLE
        { id: "description", name: "Deskripsi", type: "text", x: 120, y: 620, width: 840, height: 80, rotation: 0, opacity: 0.8, zIndex: 8, locked: false, visible: true, text: "Dibuat dari bahan pilihan terbaik, tanpa pengawet, untuk hidup yang lebih sehat dan berkelanjutan.", fontSize: 22, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#5A6E61" },
        // Price — EDITABLE
        { id: "price", name: "Harga", type: "text", x: 120, y: 730, width: 840, height: 60, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, text: "Rp 00.000", fontSize: 36, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#4A7C59" },
        // Brand name — EDITABLE
        { id: "brand-name", name: "Nama Brand", type: "text", x: 60, y: 1020, width: 960, height: 40, rotation: 0, opacity: 0.8, zIndex: 10, locked: false, visible: true, text: "@namabrand  ·  www.brand.com", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#4A7C59" },
      ],
    },
  },

  // ── IG-POST-PROMO-001 ─────────────────────────────────────────────────────
  {
    templateCode: "IG-POST-PROMO-001",
    name: "Flash Sale Promo",
    description: "Instagram post promosi dengan desain yang eye-catching. Cocok untuk diskon, flash sale, dan campaign pemasaran.",
    category: "Instagram Post",
    style: "Promotional",
    industry: null,
    tags: ["instagram", "post", "promo", "sale", "discount", "marketing", "campaign"],
    canvasWidth: 1080,
    canvasHeight: 1080,
    canvasState: {
      width: 1080,
      height: 1080,
      background: "#1A0A00",
      elements: [
        // Red dramatic background gradient
        { id: "bg-overlay", name: "BG Overlay", type: "rect", x: 0, y: 0, width: 1080, height: 1080, rotation: 0, opacity: 0.8, zIndex: 1, locked: true, visible: true, fill: "#CC0000" },
        // Large starburst circle
        { id: "starburst1", name: "Starburst 1", type: "rect", x: 190, y: 190, width: 700, height: 700, rotation: 22.5, opacity: 0.15, zIndex: 2, locked: true, visible: true, fill: "#FFD700" },
        { id: "starburst2", name: "Starburst 2", type: "rect", x: 190, y: 190, width: 700, height: 700, rotation: 0, opacity: 0.1, zIndex: 2, locked: true, visible: true, fill: "#FFD700" },
        // Black ribbon top
        { id: "ribbon-top", name: "Ribbon Top", type: "rect", x: 0, y: 0, width: 1080, height: 120, rotation: 0, opacity: 0.85, zIndex: 3, locked: true, visible: true, fill: "#000000" },
        // Brand name in ribbon — EDITABLE
        { id: "brand-ribbon", name: "Brand di Ribbon", type: "text", x: 0, y: 32, width: 1080, height: 56, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "NAMA TOKO / BRAND", fontSize: 32, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFD700" },
        // SALE headline — EDITABLE
        { id: "sale-label", name: "Label Sale", type: "text", x: 60, y: 160, width: 960, height: 100, rotation: -3, opacity: 1, zIndex: 5, locked: false, visible: true, text: "FLASH SALE", fontSize: 110, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#FFD700" },
        // Discount circle
        { id: "disc-circle", name: "Lingkaran Diskon", type: "rect", x: 340, y: 320, width: 400, height: 400, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#FFD700", borderRadius: 200 },
        // Discount percent — EDITABLE
        { id: "disc-pct", name: "Persen Diskon", type: "text", x: 340, y: 350, width: 400, height: 220, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "50%", fontSize: 160, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#CC0000" },
        // OFF text — EDITABLE
        { id: "disc-off", name: "Text OFF", type: "text", x: 340, y: 560, width: 400, height: 80, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "DISKON", fontSize: 52, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#CC0000" },
        // Black ribbon bottom
        { id: "ribbon-bot", name: "Ribbon Bawah", type: "rect", x: 0, y: 870, width: 1080, height: 210, rotation: 0, opacity: 0.9, zIndex: 9, locked: true, visible: true, fill: "#000000" },
        // Product/promo name — EDITABLE
        { id: "product-name", name: "Nama Produk / Promo", type: "text", x: 60, y: 890, width: 960, height: 60, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "Untuk Semua Produk Pilihan", fontSize: 34, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        // Validity — EDITABLE
        { id: "validity", name: "Masa Berlaku", type: "text", x: 60, y: 960, width: 960, height: 40, rotation: 0, opacity: 0.7, zIndex: 11, locked: false, visible: true, text: "Berlaku 1–7 Agustus 2025  ·  Syarat & Ketentuan Berlaku", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFD700" },
        // CTA / link — EDITABLE
        { id: "cta", name: "Link / CTA", type: "text", x: 60, y: 1010, width: 960, height: 36, rotation: 0, opacity: 0.6, zIndex: 12, locked: false, visible: true, text: "www.brand.com  |  @namabrand", fontSize: 18, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#AAAAAA" },
      ],
    },
  },

  // ── LOGO-TECH-MODERN-001 ──────────────────────────────────────────────────
  {
    templateCode: "LOGO-TECH-MODERN-001",
    name: "Modern Tech Logo",
    description: "Logo modern dengan palet gelap dan aksen ungu. Cocok untuk startup teknologi, SaaS, dan AI.",
    category: "Logo",
    style: "Modern",
    industry: "Teknologi",
    tags: ["logo", "dark", "tech", "startup", "ai", "saas"],
    canvasWidth: 800,
    canvasHeight: 800,
    canvasState: {
      width: 800,
      height: 800,
      background: "#0F172A",
      elements: [
        // Outer glow circle
        {
          id: "glow-outer", name: "Glow Outer", type: "rect",
          x: 80, y: 80, width: 640, height: 640,
          rotation: 0, opacity: 0.12, zIndex: 1, locked: true, visible: true,
          fill: "#6366F1", borderRadius: 320,
        },
        // Mid accent circle
        {
          id: "glow-mid", name: "Glow Mid", type: "rect",
          x: 180, y: 140, width: 440, height: 440,
          rotation: 0, opacity: 0.25, zIndex: 2, locked: true, visible: true,
          fill: "#8B5CF6", borderRadius: 220,
        },
        // Logo mark background circle
        {
          id: "logo-bg", name: "Logo Background", type: "rect",
          x: 260, y: 220, width: 280, height: 280,
          rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true,
          fill: "#4F46E5", borderRadius: 140,
        },
        // Inner white hexagon-like shape (icon placeholder)
        {
          id: "icon-inner", name: "Icon Placeholder", type: "rect",
          x: 320, y: 280, width: 160, height: 160,
          rotation: 45, opacity: 0.9, zIndex: 4, locked: false, visible: true,
          fill: "#FFFFFF", borderRadius: 16,
        },
        // Accent dot top-right
        {
          id: "dot-accent", name: "Accent Dot", type: "rect",
          x: 500, y: 260, width: 24, height: 24,
          rotation: 0, opacity: 0.8, zIndex: 5, locked: false, visible: true,
          fill: "#A5F3FC", borderRadius: 12,
        },
        // Thin accent line
        {
          id: "divider", name: "Divider", type: "line",
          x: 280, y: 570, width: 240, height: 2,
          rotation: 0, opacity: 0.4, zIndex: 6, locked: false, visible: true,
          fill: "#6366F1", stroke: "#6366F1", strokeWidth: 2,
        },
        // Company name — EDITABLE
        {
          id: "company-name", name: "Nama Perusahaan", type: "text",
          x: 40, y: 590, width: 720, height: 90,
          rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true,
          text: "NAMA PERUSAHAAN",
          fontSize: 48, fontFamily: "Inter", fontWeight: "800",
          textAlign: "center", color: "#FFFFFF",
        },
        // Tagline — EDITABLE
        {
          id: "tagline", name: "Tagline", type: "text",
          x: 40, y: 688, width: 720, height: 40,
          rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true,
          text: "Inovasi · Kualitas · Kepercayaan",
          fontSize: 18, fontFamily: "Inter", fontWeight: "400",
          textAlign: "center", color: "#94A3B8",
        },
      ],
    },
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getBuiltinTemplate(code: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.templateCode === code);
}

export function listBuiltinTemplates(opts?: {
  category?: string;
  industry?: string;
  style?: string;
}): BuiltinTemplate[] {
  let list = BUILTIN_TEMPLATES;
  if (opts?.category) list = list.filter((t) => t.category === opts.category);
  if (opts?.industry) list = list.filter((t) => t.industry === opts.industry || t.industry === null);
  if (opts?.style) list = list.filter((t) => t.style === opts.style);
  return list;
}
