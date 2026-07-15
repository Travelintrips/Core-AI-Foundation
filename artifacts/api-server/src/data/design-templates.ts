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
