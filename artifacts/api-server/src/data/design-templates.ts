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

  // ── IG-STORY-MODERN-001 ──────────────────────────────────────────────────
  {
    templateCode: "IG-STORY-MODERN-001",
    name: "Modern Story Gradient",
    description: "Instagram Story vertikal dengan gradasi ungu-biru. Cocok untuk pengumuman, event, dan konten brand premium.",
    category: "Instagram Story",
    style: "Modern",
    industry: null,
    tags: ["instagram", "story", "vertical", "gradient", "modern", "announcement"],
    canvasWidth: 1080,
    canvasHeight: 1920,
    canvasState: {
      width: 1080,
      height: 1920,
      background: "#0F0A2E",
      elements: [
        // Gradient top circle
        { id: "grad-circle-1", name: "Gradient Circle 1", type: "rect", x: -200, y: -200, width: 900, height: 900, rotation: 0, opacity: 0.6, zIndex: 1, locked: true, visible: true, fill: "#7C3AED", borderRadius: 450 },
        // Bottom gradient circle
        { id: "grad-circle-2", name: "Gradient Circle 2", type: "rect", x: 300, y: 1200, width: 1000, height: 1000, rotation: 0, opacity: 0.4, zIndex: 1, locked: true, visible: true, fill: "#2563EB", borderRadius: 500 },
        // Center glow
        { id: "center-glow", name: "Center Glow", type: "rect", x: 140, y: 600, width: 800, height: 800, rotation: 0, opacity: 0.15, zIndex: 2, locked: true, visible: true, fill: "#A78BFA", borderRadius: 400 },
        // Top label pill
        { id: "top-pill", name: "Label Atas", type: "rect", x: 340, y: 200, width: 400, height: 56, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "rgba(124,58,237,0.6)", borderRadius: 28 },
        { id: "top-pill-text", name: "Text Label Atas", type: "text", x: 340, y: 214, width: 400, height: 28, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "✨ SPECIAL ANNOUNCEMENT", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#E9D5FF" },
        // Thin horizontal rule
        { id: "rule-top", name: "Rule Atas", type: "line", x: 200, y: 330, width: 680, height: 1, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, fill: "#A78BFA", stroke: "#A78BFA", strokeWidth: 1 },
        // Main headline — EDITABLE
        { id: "headline", name: "Headline Utama", type: "text", x: 60, y: 380, width: 960, height: 400, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "JUDUL\nBESAR\nSTORY", fontSize: 130, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#FFFFFF" },
        // Sub headline — EDITABLE
        { id: "sub-headline", name: "Sub Headline", type: "text", x: 80, y: 830, width: 920, height: 80, rotation: 0, opacity: 0.85, zIndex: 6, locked: false, visible: true, text: "Deskripsi singkat yang menjelaskan konteks story ini kepada audiens.", fontSize: 30, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#C4B5FD" },
        // Divider with diamond
        { id: "divider-line", name: "Divider", type: "line", x: 200, y: 960, width: 680, height: 1, rotation: 0, opacity: 0.3, zIndex: 7, locked: true, visible: true, fill: "#A78BFA", stroke: "#A78BFA", strokeWidth: 1 },
        { id: "diamond", name: "Diamond", type: "rect", x: 524, y: 952, width: 16, height: 16, rotation: 45, opacity: 0.8, zIndex: 8, locked: true, visible: true, fill: "#A78BFA" },
        // Image/content placeholder
        { id: "content-card", name: "Content Card", type: "rect", x: 80, y: 1010, width: 920, height: 600, rotation: 0, opacity: 0.15, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 24 },
        { id: "content-label", name: "Label Konten", type: "text", x: 80, y: 1260, width: 920, height: 100, rotation: 0, opacity: 0.35, zIndex: 10, locked: true, visible: true, text: "Visual / Gambar Produk", fontSize: 32, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#FFFFFF" },
        // Brand name bottom — EDITABLE
        { id: "brand-name", name: "Nama Brand", type: "text", x: 80, y: 1680, width: 920, height: 60, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "NAMA BRAND", fontSize: 36, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        // Swipe up CTA
        { id: "swipe-cta", name: "Swipe Up CTA", type: "text", x: 80, y: 1760, width: 920, height: 50, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "👆 Swipe Up untuk Info Lebih Lanjut", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "center", color: "#C4B5FD" },
        // Bottom handle dots
        { id: "dot1", name: "Dot 1", type: "rect", x: 480, y: 1840, width: 12, height: 12, rotation: 0, opacity: 0.6, zIndex: 13, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 6 },
        { id: "dot2", name: "Dot 2", type: "rect", x: 502, y: 1840, width: 12, height: 12, rotation: 0, opacity: 0.3, zIndex: 13, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 6 },
        { id: "dot3", name: "Dot 3", type: "rect", x: 524, y: 1840, width: 12, height: 12, rotation: 0, opacity: 0.3, zIndex: 13, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 6 },
        { id: "dot4", name: "Dot 4", type: "rect", x: 546, y: 1840, width: 12, height: 12, rotation: 0, opacity: 0.3, zIndex: 13, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 6 },
        { id: "dot5", name: "Dot 5", type: "rect", x: 568, y: 1840, width: 12, height: 12, rotation: 0, opacity: 0.3, zIndex: 13, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 6 },
      ],
    },
  },

  // ── IG-STORY-PROMO-001 ────────────────────────────────────────────────────
  {
    templateCode: "IG-STORY-PROMO-001",
    name: "Promo Story Merah",
    description: "Instagram Story promosi dengan desain bold merah-hitam. Cocok untuk flash sale, diskon, dan event spesial.",
    category: "Instagram Story",
    style: "Bold",
    industry: null,
    tags: ["instagram", "story", "promo", "sale", "bold", "red", "discount"],
    canvasWidth: 1080,
    canvasHeight: 1920,
    canvasState: {
      width: 1080,
      height: 1920,
      background: "#0A0A0A",
      elements: [
        // Top red strip
        { id: "red-strip", name: "Strip Merah Atas", type: "rect", x: 0, y: 0, width: 1080, height: 12, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#DC2626" },
        // Large circle decoration left
        { id: "circle-left", name: "Circle Kiri", type: "rect", x: -300, y: 400, width: 800, height: 800, rotation: 0, opacity: 0.08, zIndex: 2, locked: true, visible: true, fill: "#DC2626", borderRadius: 400 },
        // Pre-headline badge
        { id: "badge", name: "Badge Atas", type: "rect", x: 60, y: 120, width: 300, height: 56, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#DC2626", borderRadius: 8 },
        { id: "badge-text", name: "Text Badge", type: "text", x: 60, y: 135, width: 300, height: 26, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "🔥 FLASH SALE", fontSize: 20, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        // Brand name right — EDITABLE
        { id: "brand-top", name: "Brand Atas Kanan", type: "text", x: 700, y: 132, width: 320, height: 40, rotation: 0, opacity: 0.6, zIndex: 4, locked: false, visible: true, text: "@namabrand", fontSize: 22, fontFamily: "Inter", fontWeight: "600", textAlign: "right", color: "#FFFFFF" },
        // Discount circle
        { id: "disc-circle", name: "Lingkaran Diskon", type: "rect", x: 140, y: 280, width: 800, height: 800, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, fill: "#DC2626", borderRadius: 400 },
        // Discount value — EDITABLE
        { id: "disc-pct", name: "Persen Diskon", type: "text", x: 140, y: 380, width: 800, height: 500, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "70%", fontSize: 320, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#FFFFFF" },
        { id: "disc-label", name: "Label Diskon", type: "text", x: 140, y: 850, width: 800, height: 80, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "DISKON", fontSize: 64, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        // Product details card — EDITABLE
        { id: "detail-card", name: "Card Detail", type: "rect", x: 60, y: 1160, width: 960, height: 340, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, fill: "#1A1A1A", borderRadius: 20 },
        { id: "product-headline", name: "Nama Produk / Promo", type: "text", x: 80, y: 1200, width: 920, height: 80, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, text: "Nama Produk / Promo", fontSize: 44, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        { id: "promo-detail", name: "Detail Promo", type: "text", x: 80, y: 1300, width: 920, height: 60, rotation: 0, opacity: 0.7, zIndex: 10, locked: false, visible: true, text: "Berlaku s/d 31 Desember 2025  ·  Min. Pembelian Rp 100.000", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FCA5A5" },
        { id: "promo-code", name: "Kode Promo", type: "text", x: 80, y: 1380, width: 920, height: 80, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "Kode: FLASH70", fontSize: 36, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#DC2626" },
        // CTA button
        { id: "cta-btn", name: "Tombol CTA", type: "rect", x: 200, y: 1580, width: 680, height: 90, rotation: 0, opacity: 1, zIndex: 12, locked: false, visible: true, fill: "#DC2626", borderRadius: 45 },
        { id: "cta-text", name: "Text CTA", type: "text", x: 200, y: 1604, width: 680, height: 42, rotation: 0, opacity: 1, zIndex: 13, locked: false, visible: true, text: "BELANJA SEKARANG →", fontSize: 28, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        // Bottom strip
        { id: "bottom-strip", name: "Strip Bawah", type: "rect", x: 0, y: 1908, width: 1080, height: 12, rotation: 0, opacity: 1, zIndex: 14, locked: true, visible: true, fill: "#DC2626" },
      ],
    },
  },

  // ── BANNER-WEB-MODERN-001 ─────────────────────────────────────────────────
  {
    templateCode: "BANNER-WEB-MODERN-001",
    name: "Modern Web Banner",
    description: "Banner web/Facebook horizontal dengan desain modern. Cocok untuk iklan digital, header website, dan promo online.",
    category: "Banner",
    style: "Modern",
    industry: null,
    tags: ["banner", "web", "facebook", "horizontal", "modern", "ads", "digital"],
    canvasWidth: 1200,
    canvasHeight: 630,
    canvasState: {
      width: 1200,
      height: 630,
      background: "#0D1117",
      elements: [
        // Background gradient rect left
        { id: "bg-grad-left", name: "BG Gradient Kiri", type: "rect", x: 0, y: 0, width: 700, height: 630, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#0D1B3E" },
        // Diagonal separator
        { id: "diagonal", name: "Separator Diagonal", type: "rect", x: 580, y: 0, width: 200, height: 630, rotation: 0, opacity: 1, zIndex: 2, locked: true, visible: true, fill: "#0F2A5E" },
        // Right side accent
        { id: "right-bg", name: "BG Kanan", type: "rect", x: 700, y: 0, width: 500, height: 630, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#112244" },
        // Top accent bar
        { id: "top-bar", name: "Bar Atas", type: "rect", x: 0, y: 0, width: 1200, height: 6, rotation: 0, opacity: 1, zIndex: 3, locked: true, visible: true, fill: "#3B82F6" },
        // Blue accent circle
        { id: "circle-accent", name: "Circle Aksen", type: "rect", x: 620, y: -100, width: 500, height: 500, rotation: 0, opacity: 0.12, zIndex: 3, locked: true, visible: true, fill: "#3B82F6", borderRadius: 250 },
        // Brand logo area — EDITABLE
        { id: "logo-area", name: "Area Logo", type: "rect", x: 60, y: 50, width: 180, height: 70, rotation: 0, opacity: 0.15, zIndex: 4, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 10 },
        { id: "logo-text", name: "Logo / Brand", type: "text", x: 60, y: 67, width: 180, height: 36, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "BRAND", fontSize: 28, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#FFFFFF" },
        // Tag line — EDITABLE
        { id: "tagline", name: "Tagline", type: "text", x: 60, y: 160, width: 600, height: 40, rotation: 0, opacity: 0.7, zIndex: 6, locked: false, visible: true, text: "SOLUSI TERBAIK UNTUK BISNIS ANDA", fontSize: 18, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#3B82F6" },
        // Main headline — EDITABLE
        { id: "headline", name: "Headline Utama", type: "text", x: 60, y: 210, width: 640, height: 200, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "Tingkatkan\nPenjualan Anda\n3× Lebih Cepat", fontSize: 62, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#FFFFFF" },
        // CTA button — EDITABLE
        { id: "cta-btn", name: "Tombol CTA", type: "rect", x: 60, y: 460, width: 260, height: 70, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, fill: "#3B82F6", borderRadius: 35 },
        { id: "cta-text", name: "Text CTA", type: "text", x: 60, y: 479, width: 260, height: 32, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, text: "Mulai Gratis →", fontSize: 20, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        // Right side visual placeholder
        { id: "right-visual", name: "Visual Kanan", type: "rect", x: 760, y: 80, width: 380, height: 380, rotation: 0, opacity: 0.2, zIndex: 6, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 20 },
        { id: "right-label", name: "Label Visual", type: "text", x: 760, y: 240, width: 380, height: 80, rotation: 0, opacity: 0.3, zIndex: 7, locked: true, visible: true, text: "Gambar / Visual\nProduk", fontSize: 24, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#FFFFFF" },
        // Bottom right website — EDITABLE
        { id: "website", name: "Website", type: "text", x: 760, y: 560, width: 380, height: 40, rotation: 0, opacity: 0.5, zIndex: 8, locked: false, visible: true, text: "www.brand.com", fontSize: 18, fontFamily: "Inter", fontWeight: "400", textAlign: "right", color: "#94A3B8" },
        // Stats strip
        { id: "stat1-box", name: "Stat 1", type: "rect", x: 60, y: 545, width: 160, height: 60, rotation: 0, opacity: 0.12, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 10 },
        { id: "stat1-num", name: "Angka 1", type: "text", x: 60, y: 548, width: 160, height: 30, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "10.000+", fontSize: 20, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#3B82F6" },
        { id: "stat1-lab", name: "Label 1", type: "text", x: 60, y: 578, width: 160, height: 20, rotation: 0, opacity: 0.6, zIndex: 10, locked: false, visible: true, text: "Pengguna Aktif", fontSize: 12, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "stat2-box", name: "Stat 2", type: "rect", x: 240, y: 545, width: 160, height: 60, rotation: 0, opacity: 0.12, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 10 },
        { id: "stat2-num", name: "Angka 2", type: "text", x: 240, y: 548, width: 160, height: 30, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "98%", fontSize: 20, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#3B82F6" },
        { id: "stat2-lab", name: "Label 2", type: "text", x: 240, y: 578, width: 160, height: 20, rotation: 0, opacity: 0.6, zIndex: 10, locked: false, visible: true, text: "Kepuasan Klien", fontSize: 12, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
      ],
    },
  },

  // ── BANNER-WEB-MINIMAL-001 ────────────────────────────────────────────────
  {
    templateCode: "BANNER-WEB-MINIMAL-001",
    name: "Clean Banner Putih",
    description: "Banner horizontal minimalis dengan latar putih. Cocok untuk brand premium, skincare, dan lifestyle.",
    category: "Banner",
    style: "Minimalist",
    industry: null,
    tags: ["banner", "minimal", "white", "clean", "premium", "lifestyle"],
    canvasWidth: 1200,
    canvasHeight: 630,
    canvasState: {
      width: 1200,
      height: 630,
      background: "#FAFAFA",
      elements: [
        // Left color block
        { id: "left-block", name: "Blok Kiri", type: "rect", x: 0, y: 0, width: 80, height: 630, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1A1A1A" },
        // Right image area
        { id: "right-img", name: "Area Gambar Kanan", type: "rect", x: 640, y: 0, width: 560, height: 630, rotation: 0, opacity: 1, zIndex: 1, locked: false, visible: true, fill: "#E5E7EB" },
        { id: "right-label", name: "Label Gambar", type: "text", x: 640, y: 265, width: 560, height: 100, rotation: 0, opacity: 0.35, zIndex: 2, locked: true, visible: true, text: "Gambar Produk / Visual", fontSize: 24, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#555555" },
        // Content left area
        { id: "brand", name: "Nama Brand", type: "text", x: 120, y: 100, width: 480, height: 60, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, text: "BRAND NAME", fontSize: 32, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#1A1A1A" },
        // Thin accent bar
        { id: "accent-bar", name: "Bar Aksen", type: "rect", x: 120, y: 172, width: 60, height: 4, rotation: 0, opacity: 1, zIndex: 4, locked: true, visible: true, fill: "#1A1A1A", borderRadius: 2 },
        // Headline — EDITABLE
        { id: "headline", name: "Headline", type: "text", x: 120, y: 200, width: 480, height: 200, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "Keindahan\nAlami untuk\nHidup Anda", fontSize: 58, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        // Subtext — EDITABLE
        { id: "subtext", name: "Deskripsi", type: "text", x: 120, y: 420, width: 460, height: 80, rotation: 0, opacity: 0.6, zIndex: 6, locked: false, visible: true, text: "Produk premium dari bahan alami pilihan, diformulasikan untuk kulit Anda.", fontSize: 20, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#555555" },
        // CTA — EDITABLE
        { id: "cta-btn", name: "Tombol CTA", type: "rect", x: 120, y: 520, width: 200, height: 64, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, fill: "#1A1A1A", borderRadius: 0 },
        { id: "cta-text", name: "Text CTA", type: "text", x: 120, y: 538, width: 200, height: 28, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "Lihat Produk", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        // Small website text
        { id: "website", name: "Website", type: "text", x: 340, y: 536, width: 260, height: 32, rotation: 0, opacity: 0.4, zIndex: 8, locked: false, visible: true, text: "www.brand.com", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
      ],
    },
  },

  // ── LINKEDIN-POST-CORP-001 ────────────────────────────────────────────────
  {
    templateCode: "LINKEDIN-POST-CORP-001",
    name: "LinkedIn Professional",
    description: "Post LinkedIn profesional bernuansa navy dan emas. Ideal untuk insight bisnis, pencapaian perusahaan, dan konten thought leadership.",
    category: "LinkedIn Post",
    style: "Professional",
    industry: null,
    tags: ["linkedin", "professional", "corporate", "navy", "gold", "business", "b2b"],
    canvasWidth: 1200,
    canvasHeight: 1200,
    canvasState: {
      width: 1200,
      height: 1200,
      background: "#0A1628",
      elements: [
        // Gold top border
        { id: "gold-top", name: "Border Emas Atas", type: "rect", x: 0, y: 0, width: 1200, height: 8, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#C9A84C" },
        // Subtle background grid
        { id: "grid-h1", name: "Grid H1", type: "line", x: 0, y: 300, width: 1200, height: 1, rotation: 0, opacity: 0.05, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "grid-h2", name: "Grid H2", type: "line", x: 0, y: 600, width: 1200, height: 1, rotation: 0, opacity: 0.05, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "grid-h3", name: "Grid H3", type: "line", x: 0, y: 900, width: 1200, height: 1, rotation: 0, opacity: 0.05, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "grid-v1", name: "Grid V1", type: "line", x: 400, y: 0, width: 1, height: 1200, rotation: 0, opacity: 0.05, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "grid-v2", name: "Grid V2", type: "line", x: 800, y: 0, width: 1, height: 1200, rotation: 0, opacity: 0.05, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        // Large geometric accent
        { id: "geo-accent", name: "Geometric Aksen", type: "rect", x: 700, y: -200, width: 800, height: 800, rotation: 30, opacity: 0.06, zIndex: 3, locked: true, visible: true, fill: "#C9A84C" },
        // Company logo/name area — EDITABLE
        { id: "logo-bg", name: "Logo BG", type: "rect", x: 80, y: 80, width: 220, height: 80, rotation: 0, opacity: 0.15, zIndex: 4, locked: false, visible: true, fill: "#C9A84C", borderRadius: 12 },
        { id: "logo-text", name: "Logo / Brand", type: "text", x: 80, y: 96, width: 220, height: 48, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "BRAND", fontSize: 32, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#C9A84C" },
        // LinkedIn badge
        { id: "li-badge", name: "Badge LinkedIn", type: "rect", x: 1060, y: 88, width: 80, height: 56, rotation: 0, opacity: 0.9, zIndex: 4, locked: true, visible: true, fill: "#0A66C2", borderRadius: 8 },
        { id: "li-text", name: "LI Text", type: "text", x: 1060, y: 102, width: 80, height: 28, rotation: 0, opacity: 1, zIndex: 5, locked: true, visible: true, text: "in", fontSize: 32, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#FFFFFF" },
        // Eyebrow label — EDITABLE
        { id: "eyebrow", name: "Label Kategori", type: "text", x: 80, y: 230, width: 800, height: 50, rotation: 0, opacity: 0.7, zIndex: 6, locked: false, visible: true, text: "INSIGHT BISNIS  ·  KUARTAL 4 2025", fontSize: 20, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#C9A84C" },
        // Gold accent bar
        { id: "gold-bar", name: "Bar Emas", type: "rect", x: 80, y: 292, width: 80, height: 6, rotation: 0, opacity: 1, zIndex: 7, locked: true, visible: true, fill: "#C9A84C", borderRadius: 3 },
        // Main headline — EDITABLE
        { id: "headline", name: "Headline Utama", type: "text", x: 80, y: 320, width: 1040, height: 260, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "5 Strategi yang\nMembawa Bisnis Kami\nTumbuh 200% dalam 1 Tahun", fontSize: 70, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        // Content divider
        { id: "content-divider", name: "Divider Konten", type: "line", x: 80, y: 630, width: 1040, height: 1, rotation: 0, opacity: 0.2, zIndex: 9, locked: true, visible: true, fill: "#C9A84C", stroke: "#C9A84C", strokeWidth: 1 },
        // Key point 1 — EDITABLE
        { id: "kp1-dot", name: "Dot KP1", type: "rect", x: 80, y: 658, width: 16, height: 16, rotation: 0, opacity: 1, zIndex: 10, locked: true, visible: true, fill: "#C9A84C", borderRadius: 8 },
        { id: "kp1", name: "Key Point 1", type: "text", x: 116, y: 650, width: 1004, height: 50, rotation: 0, opacity: 0.9, zIndex: 10, locked: false, visible: true, text: "01  ·  Fokus pada customer retention, bukan hanya akuisisi", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#E2E8F0" },
        // Key point 2 — EDITABLE
        { id: "kp2-dot", name: "Dot KP2", type: "rect", x: 80, y: 718, width: 16, height: 16, rotation: 0, opacity: 1, zIndex: 10, locked: true, visible: true, fill: "#C9A84C", borderRadius: 8 },
        { id: "kp2", name: "Key Point 2", type: "text", x: 116, y: 710, width: 1004, height: 50, rotation: 0, opacity: 0.9, zIndex: 10, locked: false, visible: true, text: "02  ·  Investasi di automation dan digital tools", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#E2E8F0" },
        // Key point 3 — EDITABLE
        { id: "kp3-dot", name: "Dot KP3", type: "rect", x: 80, y: 778, width: 16, height: 16, rotation: 0, opacity: 1, zIndex: 10, locked: true, visible: true, fill: "#C9A84C", borderRadius: 8 },
        { id: "kp3", name: "Key Point 3", type: "text", x: 116, y: 770, width: 1004, height: 50, rotation: 0, opacity: 0.9, zIndex: 10, locked: false, visible: true, text: "03  ·  Bangun ekosistem partner strategis", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#E2E8F0" },
        // Key point 4 — EDITABLE
        { id: "kp4-dot", name: "Dot KP4", type: "rect", x: 80, y: 838, width: 16, height: 16, rotation: 0, opacity: 1, zIndex: 10, locked: true, visible: true, fill: "#C9A84C", borderRadius: 8 },
        { id: "kp4", name: "Key Point 4", type: "text", x: 116, y: 830, width: 1004, height: 50, rotation: 0, opacity: 0.9, zIndex: 10, locked: false, visible: true, text: "04  ·  Data-driven decision making di setiap level", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#E2E8F0" },
        // Key point 5 — EDITABLE
        { id: "kp5-dot", name: "Dot KP5", type: "rect", x: 80, y: 898, width: 16, height: 16, rotation: 0, opacity: 1, zIndex: 10, locked: true, visible: true, fill: "#C9A84C", borderRadius: 8 },
        { id: "kp5", name: "Key Point 5", type: "text", x: 116, y: 890, width: 1004, height: 50, rotation: 0, opacity: 0.9, zIndex: 10, locked: false, visible: true, text: "05  ·  Culture of continuous learning & innovation", fontSize: 24, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#E2E8F0" },
        // Bottom separator
        { id: "bottom-sep", name: "Separator Bawah", type: "line", x: 80, y: 980, width: 1040, height: 1, rotation: 0, opacity: 0.2, zIndex: 11, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        // Author / CTA — EDITABLE
        { id: "author", name: "Nama Penulis / CTA", type: "text", x: 80, y: 1010, width: 700, height: 60, rotation: 0, opacity: 1, zIndex: 12, locked: false, visible: true, text: "Oleh: Nama Anda  ·  CEO & Founder", fontSize: 28, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#FFFFFF" },
        { id: "cta", name: "CTA Engagement", type: "text", x: 80, y: 1070, width: 700, height: 50, rotation: 0, opacity: 0.6, zIndex: 12, locked: false, visible: true, text: "💬 Bagikan strategi bisnis Anda di komentar!", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#94A3B8" },
        // Hashtags — EDITABLE
        { id: "hashtags", name: "Hashtags", type: "text", x: 80, y: 1130, width: 1040, height: 40, rotation: 0, opacity: 0.5, zIndex: 12, locked: false, visible: true, text: "#BisnisIndonesia #Entrepreneur #Leadership #Growth #Startup", fontSize: 18, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#3B82F6" },
        // Bottom gold border
        { id: "gold-bottom", name: "Border Emas Bawah", type: "rect", x: 0, y: 1192, width: 1200, height: 8, rotation: 0, opacity: 1, zIndex: 13, locked: true, visible: true, fill: "#C9A84C" },
      ],
    },
  },

  // ── LINKEDIN-POST-MINIMAL-001 ─────────────────────────────────────────────
  {
    templateCode: "LINKEDIN-POST-MINIMAL-001",
    name: "LinkedIn Minimalist",
    description: "Post LinkedIn bersih dengan desain minimalis hitam-putih. Cocok untuk tips, quote, dan konten edukasi.",
    category: "LinkedIn Post",
    style: "Minimalist",
    industry: null,
    tags: ["linkedin", "minimal", "clean", "quote", "tips", "education", "b2b"],
    canvasWidth: 1200,
    canvasHeight: 1200,
    canvasState: {
      width: 1200,
      height: 1200,
      background: "#FFFFFF",
      elements: [
        // Left thick black bar
        { id: "left-bar", name: "Bar Kiri", type: "rect", x: 0, y: 0, width: 16, height: 1200, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1A1A1A" },
        // Bottom thick bar
        { id: "bottom-bar", name: "Bar Bawah", type: "rect", x: 0, y: 1184, width: 1200, height: 16, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1A1A1A" },
        // Large quote mark
        { id: "quote-mark", name: "Tanda Kutip", type: "text", x: 60, y: 60, width: 200, height: 200, rotation: 0, opacity: 0.08, zIndex: 2, locked: true, visible: true, text: '"', fontSize: 300, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        // Category badge — EDITABLE
        { id: "category", name: "Kategori", type: "text", x: 80, y: 180, width: 400, height: 40, rotation: 0, opacity: 0.5, zIndex: 3, locked: false, visible: true, text: "TIPS & INSIGHT  ·  2025", fontSize: 18, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#1A1A1A" },
        // Thin separator
        { id: "sep", name: "Separator", type: "rect", x: 80, y: 234, width: 80, height: 4, rotation: 0, opacity: 1, zIndex: 4, locked: true, visible: true, fill: "#1A1A1A", borderRadius: 2 },
        // Main content/headline — EDITABLE
        { id: "headline", name: "Headline / Quote Utama", type: "text", x: 80, y: 270, width: 1040, height: 400, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "Bisnis yang baik\nbukan hanya soal profit,\ntapi soal dampak\nyang kita berikan.", fontSize: 72, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        // Sub content — EDITABLE
        { id: "subcontent", name: "Sub Konten / Deskripsi", type: "text", x: 80, y: 710, width: 1040, height: 160, rotation: 0, opacity: 0.6, zIndex: 6, locked: false, visible: true, text: "Setiap keputusan bisnis harus mempertimbangkan nilai jangka panjang — bukan hanya angka di laporan keuangan, tapi dampak nyata terhadap karyawan, pelanggan, dan komunitas.", fontSize: 26, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#555555" },
        // Divider
        { id: "content-div", name: "Divider Konten", type: "line", x: 80, y: 920, width: 1040, height: 1, rotation: 0, opacity: 0.15, zIndex: 7, locked: true, visible: true, fill: "#1A1A1A", stroke: "#1A1A1A", strokeWidth: 1 },
        // Profile / author — EDITABLE
        { id: "author-circle", name: "Avatar Placeholder", type: "rect", x: 80, y: 960, width: 80, height: 80, rotation: 0, opacity: 0.1, zIndex: 8, locked: false, visible: true, fill: "#1A1A1A", borderRadius: 40 },
        { id: "author-init", name: "Initial Avatar", type: "text", x: 80, y: 983, width: 80, height: 34, rotation: 0, opacity: 0.4, zIndex: 9, locked: true, visible: true, text: "NA", fontSize: 22, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#1A1A1A" },
        { id: "author-name", name: "Nama Penulis", type: "text", x: 180, y: 968, width: 700, height: 40, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, text: "Nama Anda", fontSize: 28, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#1A1A1A" },
        { id: "author-title", name: "Jabatan / Perusahaan", type: "text", x: 180, y: 1010, width: 700, height: 36, rotation: 0, opacity: 0.5, zIndex: 9, locked: false, visible: true, text: "CEO · PT Nama Perusahaan Anda", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#555555" },
        // Hashtags — EDITABLE
        { id: "hashtags", name: "Hashtags", type: "text", x: 80, y: 1100, width: 1040, height: 50, rotation: 0, opacity: 0.45, zIndex: 10, locked: false, visible: true, text: "#Leadership #Bisnis #Entrepreneur #MindsetBisnis #Indonesia", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
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


  // ─────────────────────────────────────────────────────────────────────────
  // Brand Identity Guide (A4 landscape 1200×848)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "BRAND-IDENTITY-GUIDE-001",
    name: "Brand Identity Guideline",
    description: "Panduan identitas brand lengkap: warna, tipografi, logo usage, dan tone of voice.",
    category: "Brand Identity",
    style: "corporate",
    industry: null,
    tags: ["brand-identity","branding","guideline","warna","tipografi","logo","corporate"],
    canvasWidth: 1200,
    canvasHeight: 848,
    canvasState: {
      width: 1200, height: 848, background: "#0D1B2A",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1200, height: 848, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#0D1B2A" },
        { id: "accent-bar", name: "Accent Bar", type: "rect", x: 0, y: 0, width: 8, height: 848, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#E8C547" },
        { id: "section-line", name: "Section Line", type: "line", x: 320, y: 60, width: 1, height: 728, rotation: 0, opacity: 0.2, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        // Left panel — brand name & tagline
        { id: "brand-label", name: "Label", type: "text", x: 30, y: 60, width: 280, height: 30, rotation: 0, opacity: 0.5, zIndex: 3, locked: true, visible: true, text: "BRAND IDENTITY GUIDELINES", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#E8C547" },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 30, y: 110, width: 280, height: 120, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "NAMA\nBRAND", fontSize: 52, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        { id: "brand-tagline", name: "Tagline", type: "text", x: 30, y: 248, width: 280, height: 50, rotation: 0, opacity: 0.7, zIndex: 5, locked: false, visible: true, text: "Tagline brand Anda di sini", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "divider-left", name: "Divider", type: "line", x: 30, y: 320, width: 60, height: 2, rotation: 0, opacity: 1, zIndex: 6, locked: true, visible: true, fill: "#E8C547", stroke: "#E8C547", strokeWidth: 2 },
        { id: "primary-color-label", name: "Label Warna", type: "text", x: 30, y: 340, width: 280, height: 20, rotation: 0, opacity: 0.5, zIndex: 7, locked: true, visible: true, text: "PRIMARY COLORS", fontSize: 10, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#FFFFFF" },
        { id: "swatch-1", name: "Swatch Primer", type: "rect", x: 30, y: 370, width: 70, height: 70, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, fill: "#E8C547", borderRadius: 8 },
        { id: "swatch-2", name: "Swatch Sekunder", type: "rect", x: 115, y: 370, width: 70, height: 70, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, fill: "#1A3A5C", borderRadius: 8 },
        { id: "swatch-3", name: "Swatch Aksen", type: "rect", x: 200, y: 370, width: 70, height: 70, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 8 },
        { id: "swatch-1-label", name: "Label Hex 1", type: "text", x: 30, y: 448, width: 70, height: 20, rotation: 0, opacity: 0.7, zIndex: 9, locked: false, visible: true, text: "#E8C547", fontSize: 11, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "swatch-2-label", name: "Label Hex 2", type: "text", x: 115, y: 448, width: 70, height: 20, rotation: 0, opacity: 0.7, zIndex: 9, locked: false, visible: true, text: "#1A3A5C", fontSize: 11, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "swatch-3-label", name: "Label Hex 3", type: "text", x: 200, y: 448, width: 70, height: 20, rotation: 0, opacity: 0.7, zIndex: 9, locked: false, visible: true, text: "#FFFFFF", fontSize: 11, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "font-label", name: "Label Font", type: "text", x: 30, y: 500, width: 280, height: 20, rotation: 0, opacity: 0.5, zIndex: 10, locked: true, visible: true, text: "TYPOGRAPHY", fontSize: 10, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#FFFFFF" },
        { id: "font-heading", name: "Font Heading", type: "text", x: 30, y: 528, width: 280, height: 40, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "Aa — Inter Bold", fontSize: 26, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#E8C547" },
        { id: "font-body", name: "Font Body", type: "text", x: 30, y: 574, width: 280, height: 30, rotation: 0, opacity: 0.8, zIndex: 11, locked: false, visible: true, text: "Aa — Inter Regular", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "version", name: "Versi", type: "text", x: 30, y: 800, width: 280, height: 20, rotation: 0, opacity: 0.4, zIndex: 12, locked: true, visible: true, text: "Version 1.0 • Confidential", fontSize: 11, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        // Right panel — logo showcase area
        { id: "right-bg", name: "Right BG", type: "rect", x: 320, y: 0, width: 880, height: 848, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#F5F5F0" },
        { id: "logo-area-label", name: "Logo Label", type: "text", x: 360, y: 60, width: 300, height: 20, rotation: 0, opacity: 0.5, zIndex: 13, locked: true, visible: true, text: "LOGO USAGE", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#0D1B2A" },
        { id: "logo-light-bg", name: "Logo Light", type: "rect", x: 360, y: 96, width: 380, height: 240, rotation: 0, opacity: 1, zIndex: 14, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 12 },
        { id: "logo-light-text", name: "Logo Light Center", type: "text", x: 360, y: 192, width: 380, height: 50, rotation: 0, opacity: 0.3, zIndex: 15, locked: false, visible: true, text: "LOGO LIGHT VERSION", fontSize: 18, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#0D1B2A" },
        { id: "logo-dark-bg", name: "Logo Dark", type: "rect", x: 780, y: 96, width: 380, height: 240, rotation: 0, opacity: 1, zIndex: 14, locked: true, visible: true, fill: "#0D1B2A", borderRadius: 12 },
        { id: "logo-dark-text", name: "Logo Dark Center", type: "text", x: 780, y: 192, width: 380, height: 50, rotation: 0, opacity: 0.3, zIndex: 15, locked: false, visible: true, text: "LOGO DARK VERSION", fontSize: 18, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        { id: "do-label", name: "DO Label", type: "text", x: 360, y: 370, width: 200, height: 24, rotation: 0, opacity: 1, zIndex: 16, locked: true, visible: true, text: "✓  DO", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#27AE60" },
        { id: "do-1", name: "Do 1", type: "text", x: 360, y: 402, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Gunakan logo pada background yang kontras", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "do-2", name: "Do 2", type: "text", x: 360, y: 428, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Jaga clear space minimal 1x tinggi logo", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "do-3", name: "Do 3", type: "text", x: 360, y: 454, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Gunakan file vektor (.svg/.eps) untuk cetak", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "dont-label", name: "DONT Label", type: "text", x: 780, y: 370, width: 200, height: 24, rotation: 0, opacity: 1, zIndex: 16, locked: true, visible: true, text: "✗  DON'T", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#E74C3C" },
        { id: "dont-1", name: "Dont 1", type: "text", x: 780, y: 402, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Jangan stretch atau distorsi logo", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "dont-2", name: "Dont 2", type: "text", x: 780, y: 428, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Jangan ubah warna logo sembarangan", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "dont-3", name: "Dont 3", type: "text", x: 780, y: 454, width: 380, height: 22, rotation: 0, opacity: 0.8, zIndex: 17, locked: false, visible: true, text: "Jangan gunakan logo dengan opacity rendah", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0D1B2A" },
        { id: "tone-label", name: "Tone Label", type: "text", x: 360, y: 530, width: 800, height: 20, rotation: 0, opacity: 0.5, zIndex: 18, locked: true, visible: true, text: "TONE OF VOICE", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#0D1B2A" },
        { id: "tone-1", name: "Tone 1", type: "rect", x: 360, y: 560, width: 180, height: 60, rotation: 0, opacity: 1, zIndex: 19, locked: false, visible: true, fill: "#E8C547", borderRadius: 8 },
        { id: "tone-1-text", name: "Tone 1 Text", type: "text", x: 360, y: 578, width: 180, height: 26, rotation: 0, opacity: 1, zIndex: 20, locked: false, visible: true, text: "PROFESIONAL", fontSize: 15, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#0D1B2A" },
        { id: "tone-2", name: "Tone 2", type: "rect", x: 560, y: 560, width: 180, height: 60, rotation: 0, opacity: 1, zIndex: 19, locked: false, visible: true, fill: "#1A3A5C", borderRadius: 8 },
        { id: "tone-2-text", name: "Tone 2 Text", type: "text", x: 560, y: 578, width: 180, height: 26, rotation: 0, opacity: 1, zIndex: 20, locked: false, visible: true, text: "TERPERCAYA", fontSize: 15, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        { id: "tone-3", name: "Tone 3", type: "rect", x: 760, y: 560, width: 180, height: 60, rotation: 0, opacity: 1, zIndex: 19, locked: false, visible: true, fill: "#F5F5F0", borderRadius: 8 },
        { id: "tone-3-text", name: "Tone 3 Text", type: "text", x: 760, y: 578, width: 180, height: 26, rotation: 0, opacity: 1, zIndex: 20, locked: false, visible: true, text: "INOVATIF", fontSize: 15, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#0D1B2A" },
        { id: "tone-4", name: "Tone 4", type: "rect", x: 960, y: 560, width: 180, height: 60, rotation: 0, opacity: 1, zIndex: 19, locked: false, visible: true, fill: "#ECF0F1", borderRadius: 8 },
        { id: "tone-4-text", name: "Tone 4 Text", type: "text", x: 960, y: 578, width: 180, height: 26, rotation: 0, opacity: 1, zIndex: 20, locked: false, visible: true, text: "HANGAT", fontSize: 15, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#0D1B2A" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Fashion Lookbook Cover (1080×1350 — portrait editorial)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "FASHION-LOOKBOOK-001",
    name: "Fashion Lookbook Cover",
    description: "Cover editorial fashion lookbook dengan layout majalah high-end.",
    category: "Fashion",
    style: "editorial",
    industry: "fashion",
    tags: ["fashion","lookbook","editorial","majalah","cover","high-fashion","portrait"],
    canvasWidth: 1080,
    canvasHeight: 1350,
    canvasState: {
      width: 1080, height: 1350, background: "#F2EDE8",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1080, height: 1350, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#F2EDE8" },
        { id: "img-area", name: "Area Foto Model", type: "rect", x: 0, y: 0, width: 1080, height: 900, rotation: 0, opacity: 1, zIndex: 1, locked: false, visible: true, fill: "#D4C5B5" },
        { id: "img-label", name: "Foto Model", type: "text", x: 0, y: 410, width: 1080, height: 80, rotation: 0, opacity: 0.3, zIndex: 2, locked: true, visible: true, text: "FOTO MODEL / KOLEKSI", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#5D4E3A" },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 60, y: 940, width: 700, height: 80, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, text: "MAISON", fontSize: 72, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        { id: "collection-name", name: "Nama Koleksi", type: "text", x: 60, y: 1026, width: 800, height: 40, rotation: 0, opacity: 0.8, zIndex: 4, locked: false, visible: true, text: "COLLECTION — AUTUMN/WINTER 2026", fontSize: 18, fontFamily: "Inter", fontWeight: "300", textAlign: "left", color: "#5D4E3A" },
        { id: "divider", name: "Divider", type: "line", x: 60, y: 1090, width: 960, height: 1, rotation: 0, opacity: 0.3, zIndex: 5, locked: true, visible: true, fill: "#1A1A1A", stroke: "#1A1A1A", strokeWidth: 1 },
        { id: "tag-1", name: "Tag 1", type: "text", x: 60, y: 1110, width: 200, height: 30, rotation: 0, opacity: 0.6, zIndex: 6, locked: false, visible: true, text: "LUXURY READY-TO-WEAR", fontSize: 12, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        { id: "tag-2", name: "Tag 2", type: "text", x: 60, y: 1145, width: 400, height: 30, rotation: 0, opacity: 0.5, zIndex: 6, locked: false, visible: true, text: "Inspired by Silence & Sophistication", fontSize: 16, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1A1A1A" },
        { id: "page-num", name: "Nomor Halaman", type: "text", x: 980, y: 1300, width: 60, height: 30, rotation: 0, opacity: 0.4, zIndex: 7, locked: true, visible: true, text: "01", fontSize: 14, fontFamily: "Inter", fontWeight: "300", textAlign: "right", color: "#1A1A1A" },
        { id: "accent-dot", name: "Accent Dot", type: "rect", x: 60, y: 1290, width: 8, height: 8, rotation: 45, opacity: 0.5, zIndex: 7, locked: true, visible: true, fill: "#1A1A1A", borderRadius: 0 },
        { id: "season-tag", name: "Season", type: "text", x: 800, y: 940, width: 240, height: 30, rotation: 0, opacity: 0.5, zIndex: 8, locked: false, visible: true, text: "SS / AW 2026", fontSize: 14, fontFamily: "Inter", fontWeight: "300", textAlign: "right", color: "#1A1A1A" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Interior Moodboard (1200×848 — A4 landscape concept board)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "INTERIOR-MOODBOARD-001",
    name: "Interior Design Moodboard",
    description: "Moodboard konsep desain interior dengan palette warna, material, dan vibe ruangan.",
    category: "Interior",
    style: "modern",
    industry: null,
    tags: ["interior","moodboard","konsep","ruangan","desain-ruang","material","modern"],
    canvasWidth: 1200,
    canvasHeight: 848,
    canvasState: {
      width: 1200, height: 848, background: "#F8F5F0",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1200, height: 848, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#F8F5F0" },
        { id: "header-bg", name: "Header BG", type: "rect", x: 0, y: 0, width: 1200, height: 80, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#2C2C27" },
        { id: "header-text", name: "Judul Proyek", type: "text", x: 40, y: 22, width: 600, height: 40, rotation: 0, opacity: 1, zIndex: 2, locked: false, visible: true, text: "NAMA PROYEK — KONSEP DESAIN", fontSize: 22, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#FFFFFF" },
        { id: "header-sub", name: "Sub Header", type: "text", x: 750, y: 28, width: 410, height: 28, rotation: 0, opacity: 0.6, zIndex: 2, locked: false, visible: true, text: "Residential • Modern Minimalist • 2026", fontSize: 14, fontFamily: "Inter", fontWeight: "300", textAlign: "right", color: "#FFFFFF" },
        // Main image area
        { id: "main-img", name: "Foto Ruangan Utama", type: "rect", x: 20, y: 100, width: 580, height: 440, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#D4CFC9", borderRadius: 4 },
        { id: "main-img-label", name: "Label Foto", type: "text", x: 20, y: 290, width: 580, height: 60, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, text: "FOTO RUANGAN / RENDER 3D", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        // Top right images
        { id: "img-tr1", name: "Foto Detail 1", type: "rect", x: 620, y: 100, width: 275, height: 210, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#C8BEB4", borderRadius: 4 },
        { id: "img-tr1-label", name: "Label Detail 1", type: "text", x: 620, y: 188, width: 275, height: 36, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, text: "DETAIL 1", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        { id: "img-tr2", name: "Foto Detail 2", type: "rect", x: 905, y: 100, width: 275, height: 210, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#B5ADA5", borderRadius: 4 },
        { id: "img-tr2-label", name: "Label Detail 2", type: "text", x: 905, y: 188, width: 275, height: 36, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, text: "DETAIL 2", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        // Color palette
        { id: "palette-label", name: "Label Palette", type: "text", x: 620, y: 328, width: 200, height: 20, rotation: 0, opacity: 0.6, zIndex: 5, locked: true, visible: true, text: "PALETTE WARNA", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#2C2C27" },
        { id: "c1", name: "Warna 1", type: "rect", x: 620, y: 356, width: 82, height: 82, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#2C2C27", borderRadius: 4 },
        { id: "c2", name: "Warna 2", type: "rect", x: 714, y: 356, width: 82, height: 82, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#8B7355", borderRadius: 4 },
        { id: "c3", name: "Warna 3", type: "rect", x: 808, y: 356, width: 82, height: 82, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#C4A882", borderRadius: 4 },
        { id: "c4", name: "Warna 4", type: "rect", x: 902, y: 356, width: 82, height: 82, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#E8DDD2", borderRadius: 4 },
        { id: "c5", name: "Warna 5", type: "rect", x: 996, y: 356, width: 82, height: 82, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, fill: "#F8F5F0", borderRadius: 4 },
        { id: "c1-label", name: "Hex 1", type: "text", x: 620, y: 444, width: 82, height: 18, rotation: 0, opacity: 0.6, zIndex: 7, locked: false, visible: true, text: "#2C2C27", fontSize: 10, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        { id: "c2-label", name: "Hex 2", type: "text", x: 714, y: 444, width: 82, height: 18, rotation: 0, opacity: 0.6, zIndex: 7, locked: false, visible: true, text: "#8B7355", fontSize: 10, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        { id: "c3-label", name: "Hex 3", type: "text", x: 808, y: 444, width: 82, height: 18, rotation: 0, opacity: 0.6, zIndex: 7, locked: false, visible: true, text: "#C4A882", fontSize: 10, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        { id: "c4-label", name: "Hex 4", type: "text", x: 902, y: 444, width: 82, height: 18, rotation: 0, opacity: 0.6, zIndex: 7, locked: false, visible: true, text: "#E8DDD2", fontSize: 10, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        { id: "c5-label", name: "Hex 5", type: "text", x: 996, y: 444, width: 82, height: 18, rotation: 0, opacity: 0.6, zIndex: 7, locked: false, visible: true, text: "#F8F5F0", fontSize: 10, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
        // Bottom section — materials & concept
        { id: "concept-bg", name: "Concept BG", type: "rect", x: 20, y: 560, width: 360, height: 268, rotation: 0, opacity: 1, zIndex: 3, locked: true, visible: true, fill: "#2C2C27", borderRadius: 4 },
        { id: "concept-label", name: "Label Konsep", type: "text", x: 40, y: 582, width: 300, height: 20, rotation: 0, opacity: 0.5, zIndex: 8, locked: true, visible: true, text: "KONSEP DESAIN", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#FFFFFF" },
        { id: "concept-title", name: "Nama Konsep", type: "text", x: 40, y: 610, width: 300, height: 50, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "Warm Minimalism", fontSize: 32, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#C4A882" },
        { id: "concept-desc", name: "Deskripsi Konsep", type: "text", x: 40, y: 668, width: 300, height: 140, rotation: 0, opacity: 0.8, zIndex: 8, locked: false, visible: true, text: "Ruang yang memancarkan kehangatan melalui material alami, palet netral, dan pencahayaan yang lembut — menciptakan sanctuary modern yang terasa seperti rumah.", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "material-label", name: "Label Material", type: "text", x: 400, y: 570, width: 200, height: 20, rotation: 0, opacity: 0.6, zIndex: 8, locked: true, visible: true, text: "MATERIAL UTAMA", fontSize: 11, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#2C2C27" },
        { id: "mat-1", name: "Material 1", type: "rect", x: 400, y: 598, width: 240, height: 50, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 4 },
        { id: "mat-1-text", name: "Teks Material 1", type: "text", x: 412, y: 611, width: 216, height: 26, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "🪵  Kayu Jati Solid", fontSize: 15, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#2C2C27" },
        { id: "mat-2", name: "Material 2", type: "rect", x: 400, y: 658, width: 240, height: 50, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 4 },
        { id: "mat-2-text", name: "Teks Material 2", type: "text", x: 412, y: 671, width: 216, height: 26, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "🪨  Marmer Travertine", fontSize: 15, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#2C2C27" },
        { id: "mat-3", name: "Material 3", type: "rect", x: 400, y: 718, width: 240, height: 50, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 4 },
        { id: "mat-3-text", name: "Teks Material 3", type: "text", x: 412, y: 731, width: 216, height: 26, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "🧱  Plester Semen Ekspos", fontSize: 15, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#2C2C27" },
        { id: "mat-4", name: "Material 4", type: "rect", x: 400, y: 778, width: 240, height: 42, rotation: 0, opacity: 1, zIndex: 9, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 4 },
        { id: "mat-4-text", name: "Teks Material 4", type: "text", x: 412, y: 791, width: 216, height: 26, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "🌿  Tanaman Indoor", fontSize: 15, fontFamily: "Inter", fontWeight: "500", textAlign: "left", color: "#2C2C27" },
        { id: "lifestyle-img", name: "Foto Lifestyle", type: "rect", x: 660, y: 480, width: 520, height: 348, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#C8BEB4", borderRadius: 4 },
        { id: "lifestyle-label", name: "Label Lifestyle", type: "text", x: 660, y: 635, width: 520, height: 40, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, text: "FOTO INSPIRASI / LIFESTYLE", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2C2C27" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Packaging Design Label (800×800 square product label)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "PACKAGING-LABEL-CLEAN-001",
    name: "Packaging Label Clean",
    description: "Label kemasan produk bersih dengan tata letak minimalis dan informasi produk.",
    category: "Packaging",
    style: "minimalist",
    industry: null,
    tags: ["packaging","kemasan","label","produk","minimalis","clean","mockup"],
    canvasWidth: 800,
    canvasHeight: 800,
    canvasState: {
      width: 800, height: 800, background: "#FAFAF7",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 800, height: 800, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#FAFAF7" },
        { id: "outer-border", name: "Border Luar", type: "rect", x: 30, y: 30, width: 740, height: 740, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "transparent", stroke: "#2A2A2A", strokeWidth: 2, borderRadius: 0 },
        { id: "inner-border", name: "Border Dalam", type: "rect", x: 42, y: 42, width: 716, height: 716, rotation: 0, opacity: 0.3, zIndex: 2, locked: true, visible: true, fill: "transparent", stroke: "#2A2A2A", strokeWidth: 1, borderRadius: 0 },
        { id: "top-band", name: "Top Band", type: "rect", x: 30, y: 30, width: 740, height: 100, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#2A2A2A" },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 30, y: 50, width: 740, height: 60, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "BRAND NAME", fontSize: 36, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        { id: "product-img", name: "Gambar Produk", type: "rect", x: 200, y: 150, width: 400, height: 300, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, fill: "#E8E5E0", borderRadius: 8 },
        { id: "product-img-label", name: "Label Produk", type: "text", x: 200, y: 275, width: 400, height: 50, rotation: 0, opacity: 0.3, zIndex: 6, locked: true, visible: true, text: "FOTO / ILUSTRASI PRODUK", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2A2A2A" },
        { id: "product-name", name: "Nama Produk", type: "text", x: 60, y: 478, width: 680, height: 60, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, text: "Nama Produk", fontSize: 40, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#2A2A2A" },
        { id: "product-variant", name: "Varian", type: "text", x: 60, y: 542, width: 680, height: 28, rotation: 0, opacity: 0.7, zIndex: 7, locked: false, visible: true, text: "ORIGINAL • 250 ML", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2A2A2A" },
        { id: "divider-1", name: "Divider 1", type: "line", x: 200, y: 582, width: 400, height: 1, rotation: 0, opacity: 0.3, zIndex: 8, locked: true, visible: true, fill: "#2A2A2A", stroke: "#2A2A2A", strokeWidth: 1 },
        { id: "description", name: "Deskripsi Singkat", type: "text", x: 100, y: 598, width: 600, height: 60, rotation: 0, opacity: 0.6, zIndex: 9, locked: false, visible: true, text: "Kalimat pendek mendeskripsikan manfaat utama produk ini untuk konsumen.", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#2A2A2A" },
        { id: "divider-2", name: "Divider 2", type: "line", x: 200, y: 668, width: 400, height: 1, rotation: 0, opacity: 0.3, zIndex: 8, locked: true, visible: true, fill: "#2A2A2A", stroke: "#2A2A2A", strokeWidth: 1 },
        { id: "bpom", name: "Info Regulasi", type: "text", x: 60, y: 684, width: 400, height: 24, rotation: 0, opacity: 0.5, zIndex: 10, locked: false, visible: true, text: "BPOM RI MD — HALAL", fontSize: 12, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#2A2A2A" },
        { id: "weight", name: "Berat Bersih", type: "text", x: 460, y: 684, width: 280, height: 24, rotation: 0, opacity: 0.5, zIndex: 10, locked: false, visible: true, text: "Netto: 250 ml / 250 g", fontSize: 12, fontFamily: "Inter", fontWeight: "400", textAlign: "right", color: "#2A2A2A" },
        { id: "bottom-band", name: "Bottom Band", type: "rect", x: 30, y: 718, width: 740, height: 52, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, fill: "#2A2A2A" },
        { id: "website", name: "Website", type: "text", x: 30, y: 731, width: 740, height: 26, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "www.namawebsite.com  •  @namainstagram", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Logo Minimalist (800×800)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "LOGO-MINIMAL-DARK-001",
    name: "Logo Minimalist Dark",
    description: "Logo minimalis monogram dengan latar gelap, cocok untuk brand premium.",
    category: "Logo",
    style: "minimalist",
    industry: null,
    tags: ["logo","minimalis","monogram","dark","premium","modern"],
    canvasWidth: 800,
    canvasHeight: 800,
    canvasState: {
      width: 800, height: 800, background: "#111111",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 800, height: 800, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#111111" },
        { id: "circle-outer", name: "Circle Outer", type: "rect", x: 250, y: 250, width: 300, height: 300, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "transparent", stroke: "#FFFFFF", strokeWidth: 1.5, borderRadius: 150 },
        { id: "circle-inner", name: "Circle Inner", type: "rect", x: 274, y: 274, width: 252, height: 252, rotation: 0, opacity: 0.15, zIndex: 2, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 126 },
        { id: "monogram", name: "Monogram", type: "text", x: 250, y: 296, width: 300, height: 208, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, text: "AB", fontSize: 110, fontFamily: "Georgia", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 100, y: 586, width: 600, height: 50, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "BRAND NAME", fontSize: 28, fontFamily: "Inter", fontWeight: "300", textAlign: "center", color: "#FFFFFF" },
        { id: "tagline", name: "Tagline", type: "text", x: 200, y: 640, width: 400, height: 30, rotation: 0, opacity: 0.5, zIndex: 5, locked: false, visible: true, text: "• EST. 2024 •", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "line-left", name: "Garis Kiri", type: "line", x: 140, y: 644, width: 80, height: 1, rotation: 0, opacity: 0.3, zIndex: 6, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "line-right", name: "Garis Kanan", type: "line", x: 580, y: 644, width: 80, height: 1, rotation: 0, opacity: 0.3, zIndex: 6, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Logo Geometric Bold (800×800)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "LOGO-GEOMETRIC-BOLD-001",
    name: "Logo Geometric Bold",
    description: "Logo geometric dengan bentuk tegas dan warna bold, cocok untuk brand youth dan startup.",
    category: "Logo",
    style: "bold",
    industry: null,
    tags: ["logo","geometric","bold","startup","modern","colorful","youth"],
    canvasWidth: 800,
    canvasHeight: 800,
    canvasState: {
      width: 800, height: 800, background: "#FFFFFF",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 800, height: 800, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#FFFFFF" },
        { id: "shape-1", name: "Shape 1", type: "rect", x: 270, y: 200, width: 120, height: 240, rotation: 0, opacity: 1, zIndex: 1, locked: false, visible: true, fill: "#FF3D00", borderRadius: 0 },
        { id: "shape-2", name: "Shape 2", type: "rect", x: 410, y: 200, width: 120, height: 240, rotation: 0, opacity: 1, zIndex: 2, locked: false, visible: true, fill: "#1A1A2E", borderRadius: 0 },
        { id: "shape-3", name: "Shape 3", type: "rect", x: 270, y: 200, width: 260, height: 60, rotation: 0, opacity: 0.15, zIndex: 3, locked: true, visible: true, fill: "#000000" },
        { id: "shape-accent", name: "Shape Accent", type: "rect", x: 310, y: 380, width: 180, height: 8, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, fill: "#FF3D00" },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 100, y: 470, width: 600, height: 70, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "BRANDNAME", fontSize: 52, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#1A1A2E" },
        { id: "tagline", name: "Tagline", type: "text", x: 200, y: 548, width: 400, height: 30, rotation: 0, opacity: 0.6, zIndex: 6, locked: false, visible: true, text: "THINK BOLD. BUILD BIG.", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#1A1A2E" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Facebook Post (1200×630 — landscape feed)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "FB-POST-MODERN-001",
    name: "Facebook Post Modern",
    description: "Template post Facebook dengan layout landscape modern, headline besar dan area gambar.",
    category: "Social Media",
    style: "modern",
    industry: null,
    tags: ["facebook","post","sosial-media","landscape","modern","feed","digital"],
    canvasWidth: 1200,
    canvasHeight: 630,
    canvasState: {
      width: 1200, height: 630, background: "#1B1F3B",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1200, height: 630, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#1B1F3B" },
        { id: "img-area", name: "Area Gambar", type: "rect", x: 0, y: 0, width: 520, height: 630, rotation: 0, opacity: 1, zIndex: 1, locked: false, visible: true, fill: "#2D3468" },
        { id: "img-label", name: "Label Gambar", type: "text", x: 0, y: 275, width: 520, height: 80, rotation: 0, opacity: 0.3, zIndex: 2, locked: true, visible: true, text: "FOTO / VISUAL", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "tag", name: "Tag Kategori", type: "rect", x: 560, y: 80, width: 160, height: 32, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#FF6B35", borderRadius: 4 },
        { id: "tag-text", name: "Teks Tag", type: "text", x: 560, y: 88, width: 160, height: 18, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "PROMO TERBARU", fontSize: 12, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        { id: "headline", name: "Headline", type: "text", x: 560, y: 136, width: 580, height: 180, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "Dapatkan\nPenawaran\nTerbaik", fontSize: 68, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        { id: "sub", name: "Subheadline", type: "text", x: 560, y: 334, width: 580, height: 60, rotation: 0, opacity: 0.75, zIndex: 6, locked: false, visible: true, text: "Deskripsi singkat penawaran Anda. Apa yang membuat ini spesial untuk pelanggan.", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "cta-bg", name: "CTA Background", type: "rect", x: 560, y: 428, width: 220, height: 56, rotation: 0, opacity: 1, zIndex: 7, locked: false, visible: true, fill: "#FF6B35", borderRadius: 28 },
        { id: "cta-text", name: "CTA Teks", type: "text", x: 560, y: 445, width: 220, height: 24, rotation: 0, opacity: 1, zIndex: 8, locked: false, visible: true, text: "Lihat Selengkapnya", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "center", color: "#FFFFFF" },
        { id: "brand", name: "Nama Brand", type: "text", x: 560, y: 556, width: 400, height: 30, rotation: 0, opacity: 0.5, zIndex: 9, locked: false, visible: true, text: "namawebsite.com  |  @namainstagram", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Twitter / X Post (1200×675 — 16:9 landscape)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "TWITTER-POST-CLEAN-001",
    name: "Twitter/X Post Clean",
    description: "Template post Twitter/X landscape bersih dengan quote besar dan branding minimal.",
    category: "Social Media",
    style: "minimalist",
    industry: null,
    tags: ["twitter","x","post","sosial-media","landscape","clean","quote","minimalis"],
    canvasWidth: 1200,
    canvasHeight: 675,
    canvasState: {
      width: 1200, height: 675, background: "#FFFFFF",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1200, height: 675, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#FFFFFF" },
        { id: "left-accent", name: "Left Accent", type: "rect", x: 0, y: 0, width: 12, height: 675, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#1DA1F2" },
        { id: "quote-mark", name: "Tanda Kutip", type: "text", x: 80, y: 60, width: 120, height: 120, rotation: 0, opacity: 0.12, zIndex: 2, locked: true, visible: true, text: "\"", fontSize: 180, fontFamily: "Georgia", fontWeight: "400", textAlign: "left", color: "#1DA1F2" },
        { id: "headline", name: "Quote / Headline", type: "text", x: 80, y: 160, width: 840, height: 200, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, text: "Insight atau pernyataan kuat yang ingin Anda bagikan kepada audiens.", fontSize: 44, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#14171A" },
        { id: "sub", name: "Sub / Konteks", type: "text", x: 80, y: 378, width: 840, height: 60, rotation: 0, opacity: 0.6, zIndex: 4, locked: false, visible: true, text: "Tambahkan konteks, data, atau elaborasi di sini untuk memperkuat pesan utama.", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#14171A" },
        { id: "divider", name: "Divider", type: "line", x: 80, y: 460, width: 200, height: 2, rotation: 0, opacity: 1, zIndex: 5, locked: true, visible: true, fill: "#1DA1F2", stroke: "#1DA1F2", strokeWidth: 2 },
        { id: "brand-name", name: "Nama Brand", type: "text", x: 80, y: 490, width: 400, height: 34, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "Nama Brand / Perusahaan", fontSize: 22, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#14171A" },
        { id: "handle", name: "Handle", type: "text", x: 80, y: 528, width: 400, height: 26, rotation: 0, opacity: 0.5, zIndex: 7, locked: false, visible: true, text: "@username • namawebsite.com", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#14171A" },
        { id: "right-img", name: "Area Visual Kanan", type: "rect", x: 960, y: 0, width: 240, height: 675, rotation: 0, opacity: 1, zIndex: 2, locked: false, visible: true, fill: "#E8F4FD" },
        { id: "right-img-label", name: "Label Visual", type: "text", x: 960, y: 298, width: 240, height: 80, rotation: 0, opacity: 0.3, zIndex: 3, locked: true, visible: true, text: "VISUAL", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#1DA1F2" },
        { id: "x-logo", name: "X Logo Area", type: "text", x: 1070, y: 30, width: 80, height: 50, rotation: 0, opacity: 0.2, zIndex: 8, locked: true, visible: true, text: "𝕏", fontSize: 40, fontFamily: "Inter", fontWeight: "900", textAlign: "center", color: "#14171A" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TikTok / Reels Cover (1080×1920 — vertical 9:16)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "TIKTOK-COVER-BOLD-001",
    name: "TikTok/Reels Cover Bold",
    description: "Cover video TikTok dan Instagram Reels vertikal 9:16 dengan desain bold eye-catching.",
    category: "Social Media",
    style: "bold",
    industry: null,
    tags: ["tiktok","reels","cover","vertikal","9:16","bold","eye-catching","video"],
    canvasWidth: 1080,
    canvasHeight: 1920,
    canvasState: {
      width: 1080, height: 1920, background: "#0A0A0A",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1080, height: 1920, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#0A0A0A" },
        { id: "img-area", name: "Area Foto/Video", type: "rect", x: 0, y: 0, width: 1080, height: 1920, rotation: 0, opacity: 0.6, zIndex: 1, locked: false, visible: true, fill: "#252525" },
        { id: "img-label", name: "Label Foto", type: "text", x: 0, y: 800, width: 1080, height: 80, rotation: 0, opacity: 0.2, zIndex: 2, locked: true, visible: true, text: "THUMBNAIL / FOTO COVER", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "gradient-bottom", name: "Gradient Bottom", type: "rect", x: 0, y: 1100, width: 1080, height: 820, rotation: 0, opacity: 0.9, zIndex: 3, locked: true, visible: true, fill: "#0A0A0A" },
        { id: "top-tag", name: "Tag Atas", type: "rect", x: 60, y: 100, width: 300, height: 50, rotation: 0, opacity: 0.9, zIndex: 4, locked: false, visible: true, fill: "#FF0050", borderRadius: 25 },
        { id: "top-tag-text", name: "Teks Tag", type: "text", x: 60, y: 115, width: 300, height: 22, rotation: 0, opacity: 1, zIndex: 5, locked: false, visible: true, text: "# TRENDING", fontSize: 18, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#FFFFFF" },
        { id: "headline", name: "Headline Utama", type: "text", x: 60, y: 1260, width: 960, height: 280, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "JUDUL\nKONTEN\nDI SINI", fontSize: 110, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#FFFFFF" },
        { id: "sub", name: "Subteks", type: "text", x: 60, y: 1556, width: 700, height: 70, rotation: 0, opacity: 0.8, zIndex: 7, locked: false, visible: true, text: "Deskripsi singkat konten yang memancing rasa penasaran penonton.", fontSize: 28, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "accent-bar", name: "Accent Bar", type: "rect", x: 60, y: 1640, width: 100, height: 6, rotation: 0, opacity: 1, zIndex: 8, locked: true, visible: true, fill: "#FF0050", borderRadius: 3 },
        { id: "brand", name: "Nama Brand / Handle", type: "text", x: 60, y: 1780, width: 700, height: 40, rotation: 0, opacity: 0.7, zIndex: 9, locked: false, visible: true, text: "@username  •  #hashtag #trending", fontSize: 24, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "play-icon", name: "Play Icon", type: "rect", x: 460, y: 860, width: 160, height: 160, rotation: 0, opacity: 0.3, zIndex: 10, locked: true, visible: true, fill: "#FFFFFF", borderRadius: 80 },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Presentation Slide (1920×1080 — 16:9 widescreen)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "PRESENTATION-SLIDE-CORP-001",
    name: "Presentation Slide Corporate",
    description: "Slide presentasi korporat 16:9 dengan layout profesional untuk konten dan data.",
    category: "Presentation",
    style: "corporate",
    industry: null,
    tags: ["presentasi","slide","16:9","korporat","profesional","bisnis","powerpoint"],
    canvasWidth: 1920,
    canvasHeight: 1080,
    canvasState: {
      width: 1920, height: 1080, background: "#FFFFFF",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#FFFFFF" },
        { id: "left-panel", name: "Panel Kiri", type: "rect", x: 0, y: 0, width: 640, height: 1080, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#0A2351" },
        { id: "accent-bar", name: "Accent Bar", type: "rect", x: 640, y: 0, width: 8, height: 1080, rotation: 0, opacity: 1, zIndex: 2, locked: true, visible: true, fill: "#F5A623" },
        { id: "slide-num-bg", name: "Slide Num BG", type: "rect", x: 560, y: 0, width: 88, height: 88, rotation: 0, opacity: 1, zIndex: 3, locked: true, visible: true, fill: "#F5A623" },
        { id: "slide-num", name: "Nomor Slide", type: "text", x: 560, y: 20, width: 88, height: 50, rotation: 0, opacity: 1, zIndex: 4, locked: false, visible: true, text: "01", fontSize: 36, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#0A2351" },
        { id: "section-label", name: "Label Seksi", type: "text", x: 60, y: 140, width: 500, height: 28, rotation: 0, opacity: 0.5, zIndex: 5, locked: false, visible: true, text: "NAMA SEKSI / TOPIK", fontSize: 14, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#FFFFFF" },
        { id: "slide-title", name: "Judul Slide", type: "text", x: 60, y: 186, width: 520, height: 180, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "Judul\nSlide di\nSini", fontSize: 56, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        { id: "divider", name: "Divider", type: "line", x: 60, y: 400, width: 80, height: 3, rotation: 0, opacity: 1, zIndex: 7, locked: true, visible: true, fill: "#F5A623", stroke: "#F5A623", strokeWidth: 3 },
        { id: "presenter", name: "Nama Presenter", type: "text", x: 60, y: 430, width: 500, height: 30, rotation: 0, opacity: 0.8, zIndex: 8, locked: false, visible: true, text: "Nama Presenter", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "date", name: "Tanggal", type: "text", x: 60, y: 464, width: 500, height: 26, rotation: 0, opacity: 0.5, zIndex: 8, locked: false, visible: true, text: "Juli 2026", fontSize: 16, fontFamily: "Inter", fontWeight: "300", textAlign: "left", color: "#FFFFFF" },
        { id: "company", name: "Nama Perusahaan", type: "text", x: 60, y: 980, width: 400, height: 32, rotation: 0, opacity: 0.4, zIndex: 9, locked: false, visible: true, text: "NAMA PERUSAHAAN", fontSize: 16, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#FFFFFF" },
        // Right content area
        { id: "content-label", name: "Label Konten", type: "text", x: 700, y: 80, width: 1160, height: 28, rotation: 0, opacity: 0.4, zIndex: 10, locked: true, visible: true, text: "ISI KONTEN SLIDE", fontSize: 13, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#0A2351" },
        { id: "point-1-box", name: "Point 1 Box", type: "rect", x: 700, y: 130, width: 540, height: 200, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, fill: "#F7F9FC", borderRadius: 8 },
        { id: "point-1-num", name: "Point 1 Num", type: "text", x: 715, y: 148, width: 50, height: 50, rotation: 0, opacity: 1, zIndex: 12, locked: true, visible: true, text: "01", fontSize: 28, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#F5A623" },
        { id: "point-1-title", name: "Point 1 Title", type: "text", x: 780, y: 148, width: 440, height: 38, rotation: 0, opacity: 1, zIndex: 12, locked: false, visible: true, text: "Poin Utama Pertama", fontSize: 24, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#0A2351" },
        { id: "point-1-desc", name: "Point 1 Desc", type: "text", x: 780, y: 194, width: 440, height: 120, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Deskripsi poin pertama yang menjelaskan argumentasi atau data utama Anda dalam slide ini.", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0A2351" },
        { id: "point-2-box", name: "Point 2 Box", type: "rect", x: 700, y: 350, width: 540, height: 200, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, fill: "#F7F9FC", borderRadius: 8 },
        { id: "point-2-num", name: "Point 2 Num", type: "text", x: 715, y: 368, width: 50, height: 50, rotation: 0, opacity: 1, zIndex: 12, locked: true, visible: true, text: "02", fontSize: 28, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#F5A623" },
        { id: "point-2-title", name: "Point 2 Title", type: "text", x: 780, y: 368, width: 440, height: 38, rotation: 0, opacity: 1, zIndex: 12, locked: false, visible: true, text: "Poin Utama Kedua", fontSize: 24, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#0A2351" },
        { id: "point-2-desc", name: "Point 2 Desc", type: "text", x: 780, y: 414, width: 440, height: 120, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Elaborasi poin kedua dengan data, fakta, atau argumen yang mendukung tujuan slide ini.", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0A2351" },
        { id: "point-3-box", name: "Point 3 Box", type: "rect", x: 700, y: 570, width: 540, height: 200, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, fill: "#F7F9FC", borderRadius: 8 },
        { id: "point-3-num", name: "Point 3 Num", type: "text", x: 715, y: 588, width: 50, height: 50, rotation: 0, opacity: 1, zIndex: 12, locked: true, visible: true, text: "03", fontSize: 28, fontFamily: "Inter", fontWeight: "900", textAlign: "left", color: "#F5A623" },
        { id: "point-3-title", name: "Point 3 Title", type: "text", x: 780, y: 588, width: 440, height: 38, rotation: 0, opacity: 1, zIndex: 12, locked: false, visible: true, text: "Poin Utama Ketiga", fontSize: 24, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#0A2351" },
        { id: "point-3-desc", name: "Point 3 Desc", type: "text", x: 780, y: 634, width: 440, height: 120, rotation: 0, opacity: 0.7, zIndex: 12, locked: false, visible: true, text: "Kesimpulan atau rekomendasi yang muncul dari analisis dan poin-poin sebelumnya.", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#0A2351" },
        { id: "chart-area", name: "Area Chart / Visual", type: "rect", x: 1270, y: 130, width: 600, height: 640, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, fill: "#F7F9FC", borderRadius: 8 },
        { id: "chart-label", name: "Label Chart", type: "text", x: 1270, y: 400, width: 600, height: 100, rotation: 0, opacity: 0.2, zIndex: 12, locked: true, visible: true, text: "GRAFIK / DATA / VISUAL", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#0A2351" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // E-Book Cover (800×1130 — portrait A4-ish)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "EBOOK-COVER-MODERN-001",
    name: "E-Book Cover Modern",
    description: "Cover e-book portrait dengan layout modern, judul besar, dan identitas penulis/brand.",
    category: "E-Book",
    style: "modern",
    industry: null,
    tags: ["ebook","e-book","cover","buku","digital","panduan","modern","portrait"],
    canvasWidth: 800,
    canvasHeight: 1130,
    canvasState: {
      width: 800, height: 1130, background: "#0B1D3A",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 800, height: 1130, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#0B1D3A" },
        { id: "top-shape", name: "Top Shape", type: "rect", x: 0, y: 0, width: 800, height: 420, rotation: 0, opacity: 0.4, zIndex: 1, locked: true, visible: true, fill: "#1A3A6A" },
        { id: "img-area", name: "Area Ilustrasi / Foto", type: "rect", x: 60, y: 60, width: 680, height: 340, rotation: 0, opacity: 1, zIndex: 2, locked: false, visible: true, fill: "#2A4A7A", borderRadius: 8 },
        { id: "img-label", name: "Label Gambar", type: "text", x: 60, y: 206, width: 680, height: 50, rotation: 0, opacity: 0.2, zIndex: 3, locked: true, visible: true, text: "ILUSTRASI / FOTO COVER", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "category-tag", name: "Tag Kategori", type: "text", x: 60, y: 446, width: 300, height: 26, rotation: 0, opacity: 0.6, zIndex: 4, locked: false, visible: true, text: "PANDUAN LENGKAP  •  FREE E-BOOK", fontSize: 13, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#5B9CF6" },
        { id: "accent-line", name: "Accent Line", type: "rect", x: 60, y: 484, width: 60, height: 4, rotation: 0, opacity: 1, zIndex: 5, locked: true, visible: true, fill: "#F5A623", borderRadius: 2 },
        { id: "title-line1", name: "Judul Baris 1", type: "text", x: 60, y: 504, width: 680, height: 100, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "Judul", fontSize: 86, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        { id: "title-line2", name: "Judul Baris 2", type: "text", x: 60, y: 598, width: 680, height: 100, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "E-Book", fontSize: 86, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#F5A623" },
        { id: "subtitle", name: "Subjudul", type: "text", x: 60, y: 710, width: 640, height: 60, rotation: 0, opacity: 0.75, zIndex: 7, locked: false, visible: true, text: "Panduan step-by-step untuk mencapai tujuan Anda dengan strategi yang terbukti.", fontSize: 22, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "divider", name: "Divider", type: "line", x: 60, y: 790, width: 680, height: 1, rotation: 0, opacity: 0.2, zIndex: 8, locked: true, visible: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 1 },
        { id: "author-label", name: "Label Penulis", type: "text", x: 60, y: 816, width: 200, height: 22, rotation: 0, opacity: 0.5, zIndex: 9, locked: true, visible: true, text: "PENULIS", fontSize: 12, fontFamily: "Inter", fontWeight: "600", textAlign: "left", color: "#5B9CF6" },
        { id: "author-name", name: "Nama Penulis", type: "text", x: 60, y: 844, width: 440, height: 40, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, text: "Nama Penulis / Brand", fontSize: 28, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#FFFFFF" },
        { id: "author-title", name: "Jabatan Penulis", type: "text", x: 60, y: 888, width: 440, height: 26, rotation: 0, opacity: 0.55, zIndex: 10, locked: false, visible: true, text: "Expert di bidang • namawebsite.com", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "bottom-bar", name: "Bottom Bar", type: "rect", x: 0, y: 1060, width: 800, height: 70, rotation: 0, opacity: 0.6, zIndex: 11, locked: true, visible: true, fill: "#0B1D3A" },
        { id: "page-count", name: "Jumlah Halaman", type: "text", x: 60, y: 1082, width: 300, height: 28, rotation: 0, opacity: 0.4, zIndex: 12, locked: false, visible: true, text: "50+ Halaman  •  PDF Gratis", fontSize: 14, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "year", name: "Tahun", type: "text", x: 660, y: 1082, width: 80, height: 28, rotation: 0, opacity: 0.4, zIndex: 12, locked: false, visible: true, text: "2026", fontSize: 14, fontFamily: "Inter", fontWeight: "300", textAlign: "right", color: "#FFFFFF" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Company Profile Cover (1200×848 — A4 landscape)
  // ─────────────────────────────────────────────────────────────────────────
  {
    templateCode: "CP-COVER-PROFESSIONAL-001",
    name: "Company Profile Cover Professional",
    description: "Cover company profile A4 landscape dengan layout korporat bersih dan foto hero.",
    category: "Company Profile",
    style: "professional",
    industry: null,
    tags: ["company-profile","profil-perusahaan","cover","korporat","profesional","A4","landscape"],
    canvasWidth: 1200,
    canvasHeight: 848,
    canvasState: {
      width: 1200, height: 848, background: "#FFFFFF",
      elements: [
        { id: "bg", name: "BG", type: "rect", x: 0, y: 0, width: 1200, height: 848, rotation: 0, opacity: 1, zIndex: 0, locked: true, visible: true, fill: "#FFFFFF" },
        { id: "left-panel", name: "Panel Kiri", type: "rect", x: 0, y: 0, width: 480, height: 848, rotation: 0, opacity: 1, zIndex: 1, locked: true, visible: true, fill: "#003366" },
        { id: "top-accent", name: "Top Accent", type: "rect", x: 0, y: 0, width: 480, height: 8, rotation: 0, opacity: 1, zIndex: 2, locked: true, visible: true, fill: "#F5A623" },
        { id: "logo-area", name: "Area Logo", type: "rect", x: 40, y: 50, width: 160, height: 80, rotation: 0, opacity: 0.2, zIndex: 3, locked: false, visible: true, fill: "#FFFFFF", borderRadius: 4 },
        { id: "logo-label", name: "Label Logo", type: "text", x: 40, y: 82, width: 160, height: 18, rotation: 0, opacity: 0.3, zIndex: 4, locked: true, visible: true, text: "LOGO", fontSize: 13, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#FFFFFF" },
        { id: "doc-type", name: "Tipe Dokumen", type: "text", x: 40, y: 210, width: 380, height: 26, rotation: 0, opacity: 0.55, zIndex: 5, locked: true, visible: true, text: "COMPANY PROFILE", fontSize: 14, fontFamily: "Inter", fontWeight: "700", textAlign: "left", color: "#F5A623" },
        { id: "company-name", name: "Nama Perusahaan", type: "text", x: 40, y: 248, width: 400, height: 160, rotation: 0, opacity: 1, zIndex: 6, locked: false, visible: true, text: "NAMA\nPERUSAHAAN", fontSize: 58, fontFamily: "Inter", fontWeight: "800", textAlign: "left", color: "#FFFFFF" },
        { id: "tagline", name: "Tagline", type: "text", x: 40, y: 426, width: 400, height: 50, rotation: 0, opacity: 0.75, zIndex: 7, locked: false, visible: true, text: "Tagline atau slogan perusahaan Anda.", fontSize: 18, fontFamily: "Inter", fontWeight: "300", textAlign: "left", color: "#FFFFFF" },
        { id: "divider", name: "Divider", type: "line", x: 40, y: 500, width: 60, height: 3, rotation: 0, opacity: 1, zIndex: 8, locked: true, visible: true, fill: "#F5A623", stroke: "#F5A623", strokeWidth: 3 },
        { id: "website", name: "Website", type: "text", x: 40, y: 530, width: 380, height: 28, rotation: 0, opacity: 0.6, zIndex: 9, locked: false, visible: true, text: "www.namawebsite.com", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "email", name: "Email", type: "text", x: 40, y: 562, width: 380, height: 28, rotation: 0, opacity: 0.6, zIndex: 9, locked: false, visible: true, text: "info@perusahaan.com", fontSize: 16, fontFamily: "Inter", fontWeight: "400", textAlign: "left", color: "#FFFFFF" },
        { id: "year-badge", name: "Year Badge", type: "rect", x: 40, y: 750, width: 120, height: 50, rotation: 0, opacity: 1, zIndex: 10, locked: false, visible: true, fill: "#F5A623", borderRadius: 4 },
        { id: "year-text", name: "Tahun", type: "text", x: 40, y: 764, width: 120, height: 24, rotation: 0, opacity: 1, zIndex: 11, locked: false, visible: true, text: "2026", fontSize: 22, fontFamily: "Inter", fontWeight: "800", textAlign: "center", color: "#003366" },
        // Right panel — hero image
        { id: "hero-img", name: "Foto Hero / Visual", type: "rect", x: 480, y: 0, width: 720, height: 848, rotation: 0, opacity: 1, zIndex: 3, locked: false, visible: true, fill: "#D4DCEC" },
        { id: "hero-label", name: "Label Hero", type: "text", x: 480, y: 380, width: 720, height: 90, rotation: 0, opacity: 0.2, zIndex: 4, locked: true, visible: true, text: "FOTO GEDUNG /\nTIM / PRODUK / KEGIATAN", fontSize: 20, fontFamily: "Inter", fontWeight: "400", textAlign: "center", color: "#003366" },
        { id: "overlay-bottom", name: "Overlay Bottom", type: "rect", x: 480, y: 700, width: 720, height: 148, rotation: 0, opacity: 0.4, zIndex: 5, locked: true, visible: true, fill: "#003366" },
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
