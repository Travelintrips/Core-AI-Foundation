import type { CatalogService, ServiceCategory, ServicePackage } from "@/hooks/use-catalog";
import type { ServiceFaq } from "@/hooks/use-portfolio";
import type { Lang } from "@/lib/i18n";

type ServiceCopy = {
  name: string;
  short: string;
  full?: string;
  deliverables?: string[];
};

type CategoryCopy = {
  name: string;
  description: string;
};

const CATEGORY_COPY: Record<string, Record<Lang, CategoryCopy>> = {
  "brand-identity": {
    id: { name: "Brand & Identity", description: "Bangun fondasi brand: logo, positioning, strategi, dan sistem identitas visual." },
    en: { name: "Brand & Identity", description: "Build your brand foundation: logos, positioning, strategy, and a complete visual identity system." },
  },
  "content-marketing": {
    id: { name: "Content & Marketing", description: "Copy, konten sosial, kampanye, dan materi edukasi yang siap dipublikasikan." },
    en: { name: "Content & Marketing", description: "On-brand copy, social content, campaigns, and educational materials ready to publish." },
  },
  "ai-visual-design": {
    id: { name: "AI Visual Design", description: "Visual AI untuk kampanye, sosial media, poster, banner, brosur, dan ilustrasi." },
    en: { name: "AI Visual Design", description: "AI visuals for campaigns, social media, posters, banners, brochures, and illustrations." },
  },
  "presentation-documents": {
    id: { name: "Presentation & Business Documents", description: "Pitch deck, company profile, proposal, laporan, dan dokumen bisnis profesional." },
    en: { name: "Presentation & Business Documents", description: "Investor decks, company profiles, proposals, reports, and polished business documents." },
  },
  "product-commercial": {
    id: { name: "Product & Commercial Design", description: "Katalog produk, product sheet, packaging, dan aset komersial yang konsisten." },
    en: { name: "Product & Commercial Design", description: "Product catalogs, product sheets, packaging, and consistent commercial assets." },
  },
  "specialized-design": {
    id: { name: "Specialized Design", description: "Konsep khusus untuk fashion dan interior dengan arahan visual yang lebih spesifik." },
    en: { name: "Specialized Design", description: "Specialist concepts for fashion and interiors with a more focused visual direction." },
  },
};

const SERVICE_COPY: Record<string, Record<Lang, ServiceCopy>> = {
  copywriting: {
    id: { name: "Copywriting", short: "Copy on-brand untuk caption, landing page, atau kampanye.", deliverables: ["Dokumen copy"] },
    en: { name: "Copywriting", short: "On-brand copy for captions, landing pages, or campaigns.", deliverables: ["Copy document"] },
  },
  "social-media-design": {
    id: { name: "Desain Media Sosial", short: "Desain konten sosial media on-brand per batch.", deliverables: ["Desain feed", "Headline/copy pendek"] },
    en: { name: "Social Media Design", short: "On-brand social media content designs delivered in batches.", deliverables: ["Feed designs", "Headlines/short copy"] },
  },
  "fashion-brand-brief": {
    id: { name: "Desain Fashion", short: "Brief koleksi fashion lengkap: narasi tema, arah estetik, target konsumen, dan panduan visual.", deliverables: ["Dokumen konsep koleksi", "Narasi brand", "Panduan arah estetik"] },
    en: { name: "Fashion Design", short: "A complete fashion collection brief covering the theme, aesthetic direction, target customer, and visual guidance.", deliverables: ["Collection concept document", "Brand narrative", "Aesthetic direction guide"] },
  },
  "interior-concept-design": {
    id: { name: "Desain Interior", short: "Konsep desain interior lengkap: suasana ruangan, palet material, gaya, dan narasi spasial.", deliverables: ["Dokumen konsep interior", "Palet material", "Narasi spasial"] },
    en: { name: "Interior Design", short: "A complete interior concept covering atmosphere, material palette, style, and spatial narrative.", deliverables: ["Interior concept document", "Material palette", "Spatial narrative"] },
  },
  "product-catalog": {
    id: { name: "Katalog Produk / Layanan", short: "Katalog produk atau layanan on-brand: intro brand, kategori, fitur unggulan, dan informasi pemesanan.", deliverables: ["PDF katalog produk"] },
    en: { name: "Product / Service Catalog", short: "An on-brand product or service catalog with brand introduction, categories, highlights, and ordering information.", deliverables: ["Product catalog PDF"] },
  },
  "logo-design": {
    id: { name: "Konsep Logo AI", short: "3 konsep logo awal dengan arah warna, siap dikembangkan lebih lanjut.", deliverables: ["3 konsep logo", "1 arah warna", "PNG/JPG konsep"] },
    en: { name: "AI Logo Concepts", short: "Three initial logo concepts with color direction, ready for further development.", deliverables: ["3 logo concepts", "1 color direction", "PNG/JPG concepts"] },
  },
  "brand-identity": {
    id: { name: "Paket Identitas Brand", short: "Sistem identitas visual lengkap: logo, warna, tipografi, dan panduan pakai.", deliverables: ["Brand guideline", "Logo suite", "Sistem warna & tipografi"] },
    en: { name: "Brand Identity Package", short: "A complete visual identity system covering logo, color, typography, and usage guidance.", deliverables: ["Brand guideline", "Logo suite", "Color & type system"] },
  },
  "image-generation": {
    id: { name: "Pembuatan Gambar AI", short: "Gambar AI untuk kampanye dan konten.", deliverables: ["Set gambar"] },
    en: { name: "AI Image Generation", short: "AI-generated imagery for campaigns and content.", deliverables: ["Image set"] },
  },
  "pitch-deck": {
    id: { name: "Pitch Deck / Presentasi", short: "Pitch deck investor-ready dengan storytelling dan arah visual.", deliverables: ["Pitch deck (PDF/PPTX)"] },
    en: { name: "Pitch Deck / Presentation", short: "An investor-ready pitch deck with clear storytelling and visual direction.", deliverables: ["Pitch deck (PDF/PPTX)"] },
  },
  proposal: {
    id: { name: "Proposal Bisnis", short: "Proposal bisnis profesional: latar belakang, ruang lingkup, deliverable, dan langkah selanjutnya.", deliverables: ["PDF proposal", "Ringkasan eksekutif"] },
    en: { name: "Business Proposal", short: "A professional business proposal covering background, scope, deliverables, and next steps.", deliverables: ["Proposal PDF", "Executive summary"] },
  },
  "brand-strategy": {
    id: { name: "Strategi Brand", short: "Positioning, target audience, USP, dan tone of voice untuk brand Anda.", deliverables: ["Dokumen strategi brand", "Messaging framework"] },
    en: { name: "Brand Strategy", short: "Positioning, target audience, USP, and tone of voice for your brand.", deliverables: ["Brand strategy document", "Messaging framework"] },
  },
  "GD-BANNER": {
    id: { name: "Banner", short: "Roll-up, X-banner, backdrop, leaderboard digital, dan billboard untuk kebutuhan indoor maupun outdoor.", deliverables: ["PDF siap cetak", "Pratinjau PNG", "JPG digital"] },
    en: { name: "Banner", short: "Roll-up, X-banner, backdrop, digital leaderboard, and billboard banners for indoor and outdoor use.", deliverables: ["Print-ready PDF", "PNG preview", "Digital JPG"] },
  },
  "GD-BROCHURE": {
    id: { name: "Brosur", short: "Brosur trifold, bifold, gatefold, dan accordion dalam berbagai ukuran untuk profil perusahaan hingga katalog produk.", deliverables: ["PDF siap cetak (CMYK+bleed)", "Pratinjau PNG cover", "PDF digital"] },
    en: { name: "Brochure", short: "Trifold, bifold, gatefold, and accordion brochures in A4/A5/DL formats for company profiles and product catalogs.", deliverables: ["Print-ready PDF (CMYK+bleed)", "Cover PNG preview", "Digital flat PDF"] },
  },
  "GD-BCARD": {
    id: { name: "Kartu Nama", short: "Desain kartu nama siap cetak dengan full bleed, profil warna CMYK, dan ukuran standar.", deliverables: ["PDF siap cetak (CMYK+bleed)", "Pratinjau PNG", "PDF digital"] },
    en: { name: "Business Card", short: "Print-ready business card design with full bleed, CMYK color profile, and standard sizes.", deliverables: ["Print-ready PDF (CMYK+bleed)", "PNG preview", "Digital PDF"] },
  },
  "case-study": {
    id: { name: "Case Study / Studi Kasus", short: "Studi kasus klien profesional: latar belakang, tantangan, solusi, dan hasil.", deliverables: ["PDF studi kasus"] },
    en: { name: "Case Study", short: "A professional client case study covering the background, challenge, solution, and outcome.", deliverables: ["Case study PDF"] },
  },
  "GD-CERT": {
    id: { name: "Sertifikat", short: "Sertifikat pencapaian, penyelesaian, dan apresiasi dengan tanda tangan, seal, dan keamanan opsional.", deliverables: ["PDF siap cetak", "PDF digital", "Pratinjau PNG", "JPG untuk dibagikan"] },
    en: { name: "Certificate", short: "Achievement, completion, and appreciation certificates with signatures, seals, and optional security.", deliverables: ["Print-ready PDF", "Digital PDF", "PNG preview", "JPG social share"] },
  },
  "company-profile": {
    id: { name: "Company Profile", short: "Dokumen company profile profesional dengan struktur dan copy.", deliverables: ["PDF company profile"] },
    en: { name: "Company Profile", short: "A professional company profile document with clear structure and copy.", deliverables: ["Company profile PDF"] },
  },
  "pd-company-profile-doc": {
    id: { name: "Dokumen Company Profile", short: "Dokumen company profile lengkap dengan profil perusahaan, portofolio, dan pencapaian untuk klien dan mitra.", deliverables: ["PDF company profile (32+ halaman)"] },
    en: { name: "Company Profile Document", short: "A complete company profile with company overview, portfolio, and achievements for clients and partners.", deliverables: ["Company profile PDF (32+ pages)"] },
  },
  "pd-meeting-deck": {
    id: { name: "Deck Rapat / Presentasi Internal", short: "Presentasi rapat internal yang rapi untuk update proyek, status laporan, atau review bulanan.", deliverables: ["Meeting deck (PPTX/PDF)"] },
    en: { name: "Meeting / Internal Presentation Deck", short: "A polished internal meeting deck for project updates, status reports, or monthly reviews.", deliverables: ["Meeting deck (PPTX/PDF)"] },
  },
  ebook: {
    id: { name: "E-Book / Panduan Edukasi", short: "E-book edukasi atau panduan thought leadership dengan pengantar, hingga lima bab tematis, dan kesimpulan.", deliverables: ["PDF e-book", "Daftar isi"] },
    en: { name: "E-Book / Educational Guide", short: "An educational e-book or thought-leadership guide with an introduction, up to five thematic chapters, and a conclusion.", deliverables: ["E-book PDF", "Table of contents"] },
  },
  "pd-executive-summary": {
    id: { name: "Executive Summary", short: "Ringkasan eksekutif proyek atau strategi bisnis untuk presentasi kepemimpinan.", deliverables: ["PDF executive summary"] },
    en: { name: "Executive Summary", short: "An executive summary of a project or business strategy for leadership presentations.", deliverables: ["Executive summary PDF"] },
  },
  "GD-FLYER": {
    id: { name: "Flyer", short: "Flyer menarik ukuran A4/A5/A6 untuk acara, promosi, menu, dan peluncuran produk.", deliverables: ["PDF siap cetak", "Pratinjau PNG", "JPG untuk dibagikan"] },
    en: { name: "Flyer", short: "Eye-catching A4/A5/A6 flyers for events, promotions, menus, and product launches.", deliverables: ["Print-ready PDF", "PNG preview", "JPG social share"] },
  },
  "pd-product-catalog": {
    id: { name: "Katalog Produk", short: "Katalog produk profesional dengan deskripsi, spesifikasi, dan harga — siap cetak dan digital.", deliverables: ["PDF katalog produk"] },
    en: { name: "Product Catalog", short: "A professional product catalog with descriptions, specifications, and pricing for print and digital use.", deliverables: ["Product catalog PDF"] },
  },
  "packaging-design": {
    id: { name: "Konsep Kemasan", short: "Konsep desain kemasan produk sesuai brand Anda.", deliverables: ["Konsep visual kemasan"] },
    en: { name: "Packaging Concept", short: "A product packaging design concept aligned with your brand.", deliverables: ["Packaging visual concept"] },
  },
  "creative-consultation": {
    id: { name: "Konsultasi Kreatif", short: "Sesi konsultasi kreatif strategis dengan review manusia.", deliverables: ["Catatan konsultasi"] },
    en: { name: "Creative Consultation", short: "A strategic creative consultation session with human review.", deliverables: ["Consultation notes"] },
  },
  "pd-annual-report": {
    id: { name: "Laporan Tahunan", short: "Laporan tahunan perusahaan dengan ringkasan kinerja, highlight finansial, dan narasi strategis.", deliverables: ["PDF laporan tahunan"] },
    en: { name: "Annual Report", short: "An annual company report with performance summary, financial highlights, and strategic narrative.", deliverables: ["Annual report PDF"] },
  },
  "annual-report": {
    id: { name: "Laporan Tahunan (Annual Report)", short: "Laporan tahunan perusahaan: pesan kepemimpinan, sorotan kinerja operasional, keberlanjutan, dan outlook.", deliverables: ["PDF laporan tahunan"] },
    en: { name: "Annual Report", short: "An annual report covering leadership message, operational highlights, sustainability, and outlook.", deliverables: ["Annual report PDF"] },
  },
  "GD-LTRHEAD": {
    id: { name: "Kop Surat", short: "Kop surat profesional A4/Letter dengan opsi amplop, complimentary slip, dan varian halaman kedua.", deliverables: ["PDF kop surat siap cetak", "PDF digital", "Pratinjau PNG"] },
    en: { name: "Letterhead", short: "Professional A4/Letter letterhead with optional envelope, complimentary slip, and second-page variant.", deliverables: ["Letterhead PDF (print-ready)", "Digital PDF", "PNG preview"] },
  },
  "GD-LOGO": {
    id: { name: "Konsep Logo", short: "Konsep logo berbasis AI: wordmark, lettermark, kombinasi, emblem, atau gaya maskot.", deliverables: ["Logo utama (SVG/PDF/PNG)", "Varian gelap & monokrom", "Set favicon"] },
    en: { name: "Logo Concept", short: "AI-generated logo concepts in wordmark, lettermark, combination, emblem, or mascot styles.", deliverables: ["Primary logo (SVG/PDF/PNG)", "Dark & monochrome variants", "Favicon set"] },
  },
  "pd-training-material": {
    id: { name: "Materi Pelatihan", short: "Slide dan materi pelatihan internal untuk onboarding karyawan atau program training.", deliverables: ["Training deck (PPTX)", "Handout PDF"] },
    en: { name: "Training Materials", short: "Internal training slides and materials for employee onboarding or training programs.", deliverables: ["Training deck (PPTX)", "Handout PDF"] },
  },
  "pd-pitch-deck": {
    id: { name: "Pitch Deck Presentasi", short: "Presentasi pitch deck investor-ready dengan narasi visual profesional dan storytelling berbasis data.", deliverables: ["Pitch deck (PPTX)", "PDF export"] },
    en: { name: "Presentation Pitch Deck", short: "An investor-ready pitch deck with professional visual narrative and data-driven storytelling.", deliverables: ["Pitch deck (PPTX)", "PDF export"] },
  },
  "GD-POSTER": {
    id: { name: "Poster", short: "Poster ukuran besar A0–A4 pada 300dpi untuk acara, iklan, informasi, dan gaya artistik.", deliverables: ["PDF siap cetak", "Pratinjau PNG", "JPG web", "PDF digital"] },
    en: { name: "Poster", short: "Large-format A0–A4 posters at 300dpi for events, advertising, informational, and artistic styles.", deliverables: ["Print-ready PDF", "PNG preview", "JPG web share", "Digital PDF"] },
  },
  "poster-banner": {
    id: { name: "Poster / Banner / Brosur", short: "Desain poster, banner digital, atau brosur.", deliverables: ["File poster/banner"] },
    en: { name: "Poster / Banner / Brochure", short: "Poster, digital banner, or brochure design.", deliverables: ["Poster/banner file"] },
  },
  "pd-business-proposal": {
    id: { name: "Proposal Bisnis", short: "Proposal bisnis profesional dengan analisis kebutuhan, solusi terstruktur, dan estimasi anggaran.", deliverables: ["PDF proposal bisnis"] },
    en: { name: "Business Proposal", short: "A professional business proposal with needs analysis, structured solution, and budget estimate.", deliverables: ["Business proposal PDF"] },
  },
  "GD-SOCIAL": {
    id: { name: "Paket Media Sosial", short: "Set desain media sosial on-brand untuk Instagram, Facebook, LinkedIn, Twitter, YouTube, dan TikTok.", deliverables: ["PNG spesifik platform (semua ukuran)", "Varian story", "Ikon highlight", "Arsip ZIP"] },
    en: { name: "Social Media Kit", short: "Branded social media design sets for Instagram, Facebook, LinkedIn, Twitter, YouTube, and TikTok.", deliverables: ["Platform-specific PNGs (all sizes)", "Story variants", "Highlight icons", "ZIP archive"] },
  },
  "GD-STATIONERY": {
    id: { name: "Paket Stationery", short: "Stationery brand lengkap: kop surat, amplop, kartu nama, notepad, folder, dan ID card yang konsisten.", deliverables: ["Semua PDF stationery (siap cetak)", "Pratinjau PNG", "Arsip ZIP"] },
    en: { name: "Stationery Suite", short: "Complete brand stationery: letterhead, envelope, business card, notepad, folder, and ID card — all consistent.", deliverables: ["All stationery PDFs (print-ready)", "PNG previews", "ZIP archive"] },
  },
  whitepaper: {
    id: { name: "White Paper / Thought Leadership", short: "White paper atau thought leadership dengan abstrak, pengantar, analisis masalah, kerangka solusi, dan rekomendasi.", deliverables: ["PDF whitepaper"] },
    en: { name: "White Paper / Thought Leadership", short: "A white paper or thought-leadership document with abstract, introduction, problem analysis, solution framework, and recommendations.", deliverables: ["Whitepaper PDF"] },
  },
};

const FAQ_COPY: Record<string, Record<Lang, { question: string; answer: string }>> = {
  "1": {
    id: { question: "Apakah Live AI Preview gratis adalah kualitas final yang akan saya terima?", answer: "Tidak — preview gratis adalah konsep beresolusi rendah dengan watermark untuk menunjukkan arah dan gaya, bukan deliverable final. Aset final dibuat dalam resolusi penuh tanpa watermark setelah Anda memulai proyek." },
    en: { question: "Is the free Live AI Preview the final quality I'll receive?", answer: "No — the free preview is a low-resolution, watermarked concept meant to show direction and style, not a deliverable. Your final assets are produced at full resolution, without a watermark, after you start a project." },
  },
  "2": {
    id: { question: "Apakah gambar preview dapat diunduh atau digunakan kembali?", answer: "Gambar preview tidak dapat diunduh atau digunakan secara komersial — ini adalah contoh arah AI, dengan maksimal dua percobaan gratis per kunjungan. Pilihan untuk melanjutkan konsep membawa konsep yang sama ke proyek Anda." },
    en: { question: "Can I download or reuse the preview image?", answer: "The preview image can't be downloaded or used commercially — it's a taste of the AI's direction, capped at 2 free tries per visit. Choosing to continue with the concept carries it into your project instead." },
  },
  "3": {
    id: { question: "Berapa revisi yang termasuk?", answer: "Setiap paket mencantumkan jumlah putaran revisinya. Revisi tambahan dapat ditambahkan dengan biaya kecil selama proses permintaan." },
    en: { question: "How many revisions are included?", answer: "Each package lists its included revision rounds. Additional revisions can be added for a small fee during the request flow." },
  },
  "4": {
    id: { question: "Bagaimana jika saya tidak menyukai kedua konsep preview?", answer: "Anda dapat membuat ulang hingga batas preview gratis, atau langsung memulai proyek — alur kerja kami yang ditinjau manusia akan mengeksplorasi arah lain pada tahap brief." },
    en: { question: "What if I don't like either preview concept?", answer: "You can regenerate up to your free preview limit, or start a project directly — our human-reviewed workflow explores further directions during the brief stage." },
  },
  "5": {
    id: { question: "Apakah saya dapat melihat portfolio dari industri saya sebelum memesan?", answer: "Ya — kunjungi Portfolio Gallery untuk melihat karya yang dibuat AI dari lebih dari 10 industri dan gaya. Gunakan filter industri, gaya, dan paket untuk menemukan contoh yang paling dekat dengan brief Anda." },
    en: { question: "Can I see portfolios from my industry before ordering?", answer: "Yes — visit our Portfolio Gallery to browse real AI-generated work across 10+ industries and styles. Filter by industry, style, and package to find examples closest to your brief." },
  },
  "6": {
    id: { question: "Format file apa yang akan saya terima?", answer: "Tergantung paket dan layanannya. Paket logo dan brand mencakup PNG transparan, SVG, dan PDF. Paket Pro juga mencakup file sumber yang dapat diedit seperti AI, PSD, atau Figma." },
    en: { question: "What file formats do I receive?", answer: "It depends on your package and service. Logo and brand packages include PNG, SVG, and PDF. Pro packages also include editable source files such as AI, PSD, or Figma." },
  },
};

export function localizeCategory(category: ServiceCategory, lang: Lang): ServiceCategory {
  const copy = CATEGORY_COPY[category.code]?.[lang];
  return copy ? { ...category, name: copy.name, description: copy.description } : category;
}

export function localizeService(service: CatalogService, lang: Lang): CatalogService {
  const copy = SERVICE_COPY[service.serviceCode]?.[lang];
  if (!copy) return service;
  return {
    ...service,
    serviceName: copy.name,
    shortDescription: copy.short,
    fullDescription: copy.full ?? copy.short,
    deliverables: copy.deliverables ?? service.deliverables,
  };
}

export function localizePackage(pkg: ServicePackage, serviceCode: string, lang: Lang): ServicePackage {
  const features = (pkg.featuresJson ?? []).map((feature, index) => {
    if (index === 0) {
      const copy = SERVICE_COPY[serviceCode]?.[lang];
      if (copy) return copy.short;
    }
    const common: Record<string, string> = lang === "en"
      ? {
        "Pengerjaan standar": "Standard delivery",
        "Pengerjaan prioritas": "Priority delivery",
        "1 kali revisi": "1 revision round",
        "2 kali revisi": "2 revision rounds",
        "Termasuk review manusia": "Human review included",
        "Cakupan kustom": "Custom scope",
        "Kapasitas departemen khusus": "Dedicated department capacity",
        "Pengiriman bergaransi SLA": "SLA-backed delivery",
        "Dukungan prioritas": "Priority support",
      }
      : {
        "Standard delivery": "Pengerjaan standar",
        "Priority delivery": "Pengerjaan prioritas",
        "1 revision round": "1 kali revisi",
        "2 revision rounds": "2 kali revisi",
        "Human review included": "Termasuk review manusia",
        "Custom scope": "Cakupan kustom",
        "Dedicated department capacity": "Kapasitas departemen khusus",
        "SLA-backed delivery": "Pengiriman bergaransi SLA",
        "Priority support": "Dukungan prioritas",
      };
    return common[feature] ?? feature;
  });
  return {
    ...pkg,
    packageName: lang === "en"
      ? ({ Standard: "Standard", Pro: "Pro", Enterprise: "Enterprise" }[pkg.packageName] ?? pkg.packageName)
      : pkg.packageName,
    featuresJson: features,
  };
}

export function localizeFaq(faq: ServiceFaq, lang: Lang): ServiceFaq {
  const copy = FAQ_COPY[String(faq.id)]?.[lang];
  return copy ? { ...faq, question: copy.question, answer: copy.answer } : faq;
}

export function serviceSearchText(service: CatalogService, lang: Lang): string {
  const localized = localizeService(service, lang);
  return [
    localized.serviceName,
    localized.shortDescription,
    localized.fullDescription,
    localized.serviceCode,
    ...(localized.aliases ?? []),
    ...(localized.deliverables ?? []),
  ].join(" ").toLowerCase();
}