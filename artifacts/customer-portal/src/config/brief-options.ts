/**
 * Creative AI Brief — Shared option registries.
 *
 * Single source of truth for every stable `value` key used across the brief
 * wizard (src/pages/brief.tsx) AND the Brief Intelligence Engine
 * (src/features/brief-intelligence/). Extracted verbatim from brief.tsx so
 * both consumers reference the exact same keys/labels — the engine must
 * never redefine or duplicate these lists.
 *
 * IMPORTANT: values here are persisted (in serialized form, see
 * src/lib/brief-utils.ts) inside BriefData string fields. Do not rename or
 * remove existing `value`s — that would break parsing of already-submitted
 * briefs. Additive changes (new options) are safe.
 */

import type { TagOption } from "@/components/creative-ui/TagSelector";

export const INDUSTRY_OPTIONS: TagOption[] = [
  // Perdagangan
  { value: "ecommerce",          label: "E-commerce",           group: "Perdagangan" },
  { value: "marketplace",        label: "Marketplace",          group: "Perdagangan" },
  { value: "retail",             label: "Retail",               group: "Perdagangan" },
  { value: "trading",            label: "Trading",              group: "Perdagangan" },
  // Teknologi
  { value: "technology",         label: "Technology",           group: "Teknologi" },
  { value: "software",           label: "Software",             group: "Teknologi" },
  { value: "ai",                 label: "Artificial Intelligence", group: "Teknologi" },
  { value: "startup",            label: "Startup",              group: "Teknologi" },
  // Keuangan
  { value: "fintech",            label: "Fintech",              group: "Keuangan" },
  { value: "banking",            label: "Banking",              group: "Keuangan" },
  { value: "insurance",          label: "Insurance",            group: "Keuangan" },
  // Kesehatan
  { value: "healthcare",         label: "Healthcare",           group: "Kesehatan" },
  { value: "hospital",           label: "Hospital",             group: "Kesehatan" },
  { value: "clinic",             label: "Clinic",               group: "Kesehatan" },
  { value: "pharmacy",           label: "Pharmacy",             group: "Kesehatan" },
  // Pendidikan
  { value: "education",          label: "Education",            group: "Pendidikan" },
  { value: "school",             label: "School",               group: "Pendidikan" },
  { value: "university",         label: "University",           group: "Pendidikan" },
  // Kuliner & F&B
  { value: "restaurant",         label: "Restaurant",           group: "Kuliner & F&B" },
  { value: "fnb",                label: "Kuliner & F&B",        group: "Kuliner & F&B" },
  { value: "cafe",               label: "Cafe",                 group: "Kuliner & F&B" },
  { value: "coffee_shop",        label: "Coffee Shop",          group: "Kuliner & F&B" },
  { value: "bakery",             label: "Bakery",               group: "Kuliner & F&B" },
  // Perhotelan & Pariwisata
  { value: "hotel",              label: "Hotel",                group: "Perhotelan & Pariwisata" },
  { value: "travel",             label: "Travel",               group: "Perhotelan & Pariwisata" },
  { value: "tourism",            label: "Tourism",              group: "Perhotelan & Pariwisata" },
  // Logistik
  { value: "logistics",          label: "Logistics",            group: "Logistik" },
  { value: "freight",            label: "Freight Forwarding",   group: "Logistik" },
  { value: "shipping",           label: "Shipping",             group: "Logistik" },
  { value: "warehousing",        label: "Warehousing",          group: "Logistik" },
  { value: "export_import",      label: "Export Import",        group: "Logistik" },
  // Industri
  { value: "manufacturing",      label: "Manufacturing",        group: "Industri" },
  { value: "factory",            label: "Factory",              group: "Industri" },
  { value: "construction",       label: "Construction",         group: "Industri" },
  // Properti
  { value: "property",           label: "Property",             group: "Properti" },
  { value: "real_estate",        label: "Real Estate",          group: "Properti" },
  { value: "architecture",       label: "Architecture",         group: "Properti" },
  { value: "interior",           label: "Interior Design",      group: "Properti" },
  // Jasa Profesional
  { value: "consulting",         label: "Consulting",           group: "Jasa Profesional" },
  { value: "law",                label: "Law Firm",             group: "Jasa Profesional" },
  { value: "accounting",         label: "Accounting",           group: "Jasa Profesional" },
  { value: "professional_svcs",  label: "Professional Services",group: "Jasa Profesional" },
  // Kreatif & Media
  { value: "creative_agency",    label: "Creative Agency",      group: "Kreatif & Media" },
  { value: "marketing_agency",   label: "Marketing Agency",     group: "Kreatif & Media" },
  { value: "media",              label: "Media",                group: "Kreatif & Media" },
  { value: "entertainment",      label: "Entertainment",        group: "Kreatif & Media" },
  // Fashion & Kecantikan
  { value: "fashion",            label: "Fashion",              group: "Fashion & Kecantikan" },
  { value: "beauty",             label: "Beauty",               group: "Fashion & Kecantikan" },
  { value: "cosmetics",          label: "Cosmetics",            group: "Fashion & Kecantikan" },
  { value: "jewelry",            label: "Jewelry",              group: "Fashion & Kecantikan" },
  // Furnitur & Dekorasi
  { value: "furniture",          label: "Furniture",            group: "Furnitur & Dekorasi" },
  // Agribisnis
  { value: "agriculture",        label: "Agriculture",          group: "Agribisnis" },
  { value: "plantation",         label: "Plantation",           group: "Agribisnis" },
  { value: "seafood",            label: "Seafood",              group: "Agribisnis" },
  { value: "fishery",            label: "Fishery",              group: "Agribisnis" },
  { value: "mining",             label: "Mining",               group: "Agribisnis" },
  { value: "coal",               label: "Coal",                 group: "Agribisnis" },
  { value: "palm_oil",           label: "Palm Oil",             group: "Agribisnis" },
  { value: "coconut",            label: "Coconut Product",      group: "Agribisnis" },
  { value: "charcoal",           label: "Charcoal",             group: "Agribisnis" },
  // Otomotif
  { value: "automotive",         label: "Automotive",           group: "Otomotif" },
  { value: "car_dealer",         label: "Car Dealer",           group: "Otomotif" },
  { value: "motorcycle",         label: "Motorcycle",           group: "Otomotif" },
  // Kebugaran & Sport
  { value: "fitness",            label: "Fitness",              group: "Kebugaran & Sport" },
  { value: "gym",                label: "Gym",                  group: "Kebugaran & Sport" },
  { value: "sport_center",       label: "Sport Center",         group: "Kebugaran & Sport" },
  // Event & Fotografi
  { value: "event_organizer",    label: "Event Organizer",      group: "Event & Fotografi" },
  { value: "wedding",            label: "Wedding",              group: "Event & Fotografi" },
  { value: "photography",        label: "Photography",          group: "Event & Fotografi" },
  // Publik & Sosial
  { value: "government",         label: "Government",           group: "Publik & Sosial" },
  { value: "nonprofit",          label: "Nonprofit / NGO",      group: "Publik & Sosial" },
  // Lainnya
  { value: "other",              label: "Lainnya",              group: "Lainnya" },
];

export const INDUSTRY_QUICK_VALUES = [
  "ecommerce", "technology", "fnb", "retail", "healthcare", "startup", "creative_agency", "property",
];

export const COMPANY_SIZE_OPTIONS = [
  { value: "solo",       label: "Personal / Individu", icon: "👤", description: "1 orang" },
  { value: "startup",    label: "Startup / Tim Kecil", icon: "🚀", description: "2–10 orang" },
  { value: "smb",        label: "Usaha Kecil",         icon: "🏢", description: "11–50 orang" },
  { value: "mid",        label: "Perusahaan Menengah", icon: "🏬", description: "51–200 orang" },
  { value: "enterprise", label: "Enterprise",          icon: "🏙", description: "Lebih dari 200 orang" },
];

export const GOAL_OPTIONS = [
  { value: "brand_awareness",   label: "Meningkatkan brand awareness" },
  { value: "sales",             label: "Meningkatkan penjualan" },
  { value: "leads",             label: "Mendapatkan lebih banyak leads" },
  { value: "new_product",       label: "Memperkenalkan produk baru" },
  { value: "rebranding",        label: "Melakukan rebranding" },
  { value: "professional",      label: "Membuat bisnis terlihat lebih profesional" },
  { value: "trust",             label: "Membangun kepercayaan pelanggan" },
  { value: "engagement",        label: "Meningkatkan engagement media sosial" },
  { value: "conversion",        label: "Meningkatkan konversi website" },
  { value: "investor",          label: "Mencari investor" },
  { value: "distributor",       label: "Menarik distributor atau reseller" },
  { value: "international",     label: "Memasuki pasar internasional" },
  { value: "promo_material",    label: "Membuat materi promosi" },
  { value: "brand_identity",    label: "Memperkuat identitas brand" },
  { value: "other",             label: "Lainnya" },
];

export const METRIC_OPTIONS = [
  { value: "sales_up",      label: "Peningkatan penjualan" },
  { value: "more_leads",    label: "Peningkatan jumlah leads" },
  { value: "inquiry",       label: "Peningkatan inquiry pelanggan" },
  { value: "engagement_up", label: "Peningkatan engagement" },
  { value: "followers",     label: "Peningkatan followers" },
  { value: "traffic",       label: "Peningkatan traffic website" },
  { value: "conversion",    label: "Peningkatan conversion rate" },
  { value: "distributor",   label: "Lebih banyak distributor atau reseller" },
  { value: "brand_pro",     label: "Brand terlihat lebih profesional" },
  { value: "recognizable",  label: "Brand lebih mudah dikenali" },
  { value: "trust",         label: "Meningkatkan kepercayaan pelanggan" },
  { value: "investor",      label: "Mendapatkan investor" },
  { value: "launch",        label: "Mencapai target peluncuran" },
  { value: "unsure",        label: "Belum menentukan metrik" },
  { value: "other",         label: "Lainnya" },
];

export const ASSET_OPTIONS = [
  { value: "logo",          label: "Logo" },
  { value: "brand_guide",   label: "Brand guideline" },
  { value: "company_profile",label: "Company profile" },
  { value: "product_photo", label: "Foto produk" },
  { value: "office_photo",  label: "Foto perusahaan / kantor" },
  { value: "video",         label: "Video" },
  { value: "website",       label: "Website" },
  { value: "social_content",label: "Konten media sosial" },
  { value: "copywriting",   label: "Copywriting" },
  { value: "catalog",       label: "Katalog atau brosur" },
  { value: "packaging",     label: "Packaging" },
  { value: "presentation",  label: "Presentasi" },
  { value: "documents",     label: "Data atau dokumen pendukung" },
  { value: "none",          label: "Belum punya aset" },
  { value: "other",         label: "Lainnya" },
];

export const AUDIENCE_OPTIONS = [
  { value: "general",      label: "Konsumen umum" },
  { value: "b2c",          label: "B2C" },
  { value: "b2b",          label: "B2B" },
  { value: "corporate",    label: "Perusahaan" },
  { value: "umkm",         label: "UMKM" },
  { value: "startup",      label: "Startup" },
  { value: "investor",     label: "Investor" },
  { value: "government",   label: "Pemerintah" },
  { value: "distributor",  label: "Distributor" },
  { value: "reseller",     label: "Reseller" },
  { value: "retail_cust",  label: "Retail customer" },
  { value: "professional", label: "Profesional" },
  { value: "student",      label: "Pelajar / mahasiswa" },
  { value: "family",       label: "Keluarga" },
  { value: "youth",        label: "Anak muda" },
  { value: "premium",      label: "Premium market" },
  { value: "local",        label: "Pasar lokal" },
  { value: "international",label: "International buyer" },
  { value: "other",        label: "Lainnya" },
];

export const CHANNEL_OPTIONS = [
  { value: "instagram",   label: "Instagram" },
  { value: "tiktok",      label: "TikTok" },
  { value: "facebook",    label: "Facebook" },
  { value: "linkedin",    label: "LinkedIn" },
  { value: "twitter",     label: "X (Twitter)" },
  { value: "youtube",     label: "YouTube" },
  { value: "whatsapp",    label: "WhatsApp" },
  { value: "website",     label: "Website" },
  { value: "marketplace", label: "Marketplace" },
  { value: "email",       label: "Email" },
  { value: "pinterest",   label: "Pinterest" },
  { value: "other",       label: "Lainnya" },
];

export const STYLE_OPTIONS = [
  { value: "minimalis",   label: "Minimalis",    description: "Sederhana, bersih, dan banyak ruang kosong" },
  { value: "modern",      label: "Modern",       description: "Kontemporer, dinamis, dan segar" },
  { value: "corporate",   label: "Corporate",    description: "Profesional, terpercaya, dan formal" },
  { value: "premium",     label: "Premium",      description: "Berkualitas tinggi dan eksklusif" },
  { value: "luxury",      label: "Luxury",       description: "Eksklusif, mewah, dan berkelas" },
  { value: "elegant",     label: "Elegant",      description: "Halus, refined, dan timeless" },
  { value: "classic",     label: "Classic",      description: "Abadi, traditional, dan mapan" },
  { value: "bold",        label: "Bold",         description: "Kuat, tegas, dan berani" },
  { value: "playful",     label: "Playful",      description: "Ramah, energik, dan penuh karakter" },
  { value: "creative",    label: "Creative",     description: "Ekspresif, unik, dan inovatif" },
  { value: "natural",     label: "Natural",      description: "Organik, hangat, dan dekat dengan alam" },
  { value: "industrial",  label: "Industrial",   description: "Raw, maskulin, dan tekstural" },
  { value: "teknologi",   label: "Teknologi",    description: "Digital, futuristik, dan inovatif" },
  { value: "monokrom",    label: "Monokrom",     description: "Elegan dalam hitam, putih, dan abu" },
  { value: "colorful",    label: "Colorful",     description: "Cerah, berani, dan penuh warna" },
  { value: "editorial",   label: "Editorial",    description: "Berkelas seperti majalah premium" },
  { value: "clean",       label: "Clean",        description: "Jernih, teratur, dan mudah dibaca" },
  { value: "futuristic",  label: "Futuristic",   description: "Hi-tech dan forward-looking" },
  { value: "unsure",      label: "Tidak yakin — beri rekomendasi", description: "Tim kami akan merekomendasikan gaya terbaik" },
  { value: "other",       label: "Lainnya",      description: "" },
];

export const PRIORITY_OPTIONS = [
  { value: "quality",  label: "Kualitas terbaik",               description: "Prioritaskan hasil yang sempurna" },
  { value: "speed",    label: "Kecepatan pengerjaan",           description: "Dipercepat, mungkin ada rush fee" },
  { value: "budget",   label: "Efisiensi anggaran",             description: "Maksimalkan hasil dalam budget" },
  { value: "balanced", label: "Keseimbangan",                   description: "Kualitas baik dalam waktu wajar" },
  { value: "unsure",   label: "Belum yakin",                    description: "Tim kami akan bantu tentukan" },
];

export const LANGUAGE_OPTIONS = [
  { value: "id",    label: "Bahasa Indonesia" },
  { value: "en",    label: "English" },
  { value: "id_en", label: "Bilingual — Indonesia & English" },
];

// ─── Fashion Design Specialist Options ────────────────────────────────────────

export const FASHION_STYLE_OPTIONS = [
  { value: "editorial",      label: "Editorial",        description: "Artistik, magazine-worthy, high-concept" },
  { value: "ready_to_wear",  label: "Ready-to-Wear",    description: "Wearable, commercial, dan accessible" },
  { value: "haute_couture",  label: "Haute Couture",    description: "Ultra-premium, bespoke, dan eksklusif" },
  { value: "streetwear",     label: "Streetwear",       description: "Urban, cultural, dan youth-driven" },
  { value: "athleisure",     label: "Athleisure",       description: "Performance meets lifestyle aesthetic" },
  { value: "sustainable",    label: "Sustainable",      description: "Conscious, ethical, dan eco-forward" },
  { value: "vintage_retro",  label: "Vintage / Retro",  description: "Nostalgik, era-inspired, dan curated" },
  { value: "minimalist",     label: "Minimalist",       description: "Clean lines, monochrome, dan quiet luxury" },
  { value: "maximalist",     label: "Maximalist",       description: "Layered, textured, dan statement-making" },
  { value: "avant_garde",    label: "Avant-Garde",      description: "Experimental, boundary-pushing, dan conceptual" },
  { value: "resort",         label: "Resort / Tropical", description: "Relaxed luxury untuk lifestyle tropis" },
  { value: "modest_fashion", label: "Modest Fashion",   description: "Modest, refined, dan culturally aware" },
  { value: "other",          label: "Lainnya",          description: "" },
];

export const FASHION_GARMENT_OPTIONS = [
  { value: "outerwear",   label: "Outerwear" },
  { value: "dress",       label: "Dress / Rok" },
  { value: "tops",        label: "Tops / Blouse" },
  { value: "pants",       label: "Celana / Trousers" },
  { value: "suit",        label: "Suit / Blazer" },
  { value: "activewear",  label: "Activewear" },
  { value: "accessories", label: "Aksesori" },
  { value: "footwear",    label: "Alas Kaki" },
  { value: "bags",        label: "Tas" },
  { value: "swimwear",    label: "Swimwear / Beachwear" },
  { value: "ethnic",      label: "Pakaian Tradisional / Etnik" },
  { value: "modest",      label: "Busana Muslim / Modest" },
  { value: "kids",        label: "Pakaian Anak" },
  { value: "other",       label: "Lainnya" },
];

export const FASHION_GENDER_OPTIONS = [
  { value: "womenswear", label: "Womenswear" },
  { value: "menswear",   label: "Menswear" },
  { value: "unisex",     label: "Unisex / Gender-Neutral" },
  { value: "kidswear",   label: "Kidswear" },
  { value: "all",        label: "All Genders" },
];

export const FASHION_SEASON_OPTIONS = [
  { value: "ss",       label: "Spring/Summer (SS)" },
  { value: "fw",       label: "Fall/Winter (FW)" },
  { value: "resort",   label: "Resort / Cruise" },
  { value: "pre_fall", label: "Pre-Fall / Transitional" },
  { value: "capsule",  label: "Capsule Collection" },
  { value: "evergreen",label: "Evergreen / Tidak Musiman" },
];

export const FASHION_PRICEPOINT_OPTIONS = [
  { value: "mass",        label: "Mass Market",    description: "< Rp 200rb per item" },
  { value: "mid_range",   label: "Mid-Range",      description: "Rp 200rb – 1jt per item" },
  { value: "premium",     label: "Premium",        description: "Rp 1jt – 5jt per item" },
  { value: "luxury",      label: "Luxury",         description: "> Rp 5jt per item" },
  { value: "ultra_luxury",label: "Ultra-Luxury",   description: "Bespoke / Custom order" },
];

// ─── Interior Design Specialist Options ──────────────────────────────────────

export const INTERIOR_STYLE_OPTIONS = [
  { value: "scandinavian",    label: "Scandinavian",     description: "Bersih, fungsional, warm neutral tones" },
  { value: "japandi",         label: "Japandi",          description: "Japanese-Scandinavian: zen, natural, minimal" },
  { value: "modern_luxury",   label: "Modern Luxury",    description: "Kontemporer mewah, material premium" },
  { value: "industrial",      label: "Industrial",       description: "Raw concrete, exposed brick, metal accents" },
  { value: "bohemian",        label: "Bohemian",         description: "Eclectic, textured, layered dan artsy" },
  { value: "tropical",        label: "Tropical Modern",  description: "Natural materials, plants, breezy atmosphere" },
  { value: "mediterranean",   label: "Mediterranean",    description: "Warm terracotta, arches, earthy palette" },
  { value: "classic",         label: "Classic / Formal", description: "Timeless elegance, symmetrical, ornamented" },
  { value: "minimalist",      label: "Minimalist",       description: "Ruang bernapas, palette monochrome, clean forms" },
  { value: "biophilic",       label: "Biophilic",        description: "Alam masuk ke dalam: kayu, tanaman, natural light" },
  { value: "art_deco",        label: "Art Deco",         description: "Geometrik, glamour, gold & jewel tones" },
  { value: "coastal",         label: "Coastal / Nautical",description: "Breezy, blue-white palette, light textures" },
  { value: "other",           label: "Lainnya",          description: "" },
];

export const INTERIOR_ROOM_OPTIONS = [
  { value: "living_room",   label: "Ruang Tamu / Living Room" },
  { value: "bedroom",       label: "Kamar Tidur" },
  { value: "kitchen",       label: "Dapur / Kitchen" },
  { value: "dining_room",   label: "Ruang Makan" },
  { value: "bathroom",      label: "Kamar Mandi" },
  { value: "home_office",   label: "Ruang Kerja / Home Office" },
  { value: "kids_room",     label: "Kamar Anak" },
  { value: "outdoor",       label: "Area Outdoor / Taman" },
  { value: "full_unit",     label: "Satu Unit Penuh" },
  { value: "commercial",    label: "Ruang Komersial" },
  { value: "office_space",  label: "Kantor" },
  { value: "retail_store",  label: "Toko / Retail" },
  { value: "restaurant",    label: "Restoran / Cafe" },
  { value: "hotel_lobby",   label: "Lobby / Hospitality" },
  { value: "other",         label: "Lainnya" },
];

export const INTERIOR_PROJECT_OPTIONS = [
  { value: "residential",   label: "Residential (Hunian Pribadi)" },
  { value: "apartment",     label: "Apartemen" },
  { value: "villa",         label: "Villa / Guest House" },
  { value: "commercial",    label: "Komersial" },
  { value: "office",        label: "Kantor" },
  { value: "hospitality",   label: "Hotel / Hospitality" },
  { value: "retail",        label: "Retail Store" },
  { value: "fnb",           label: "Restoran / Cafe" },
  { value: "other",         label: "Lainnya" },
];

export const INTERIOR_MATERIAL_OPTIONS = [
  { value: "marble",      label: "Marmer / Stone" },
  { value: "wood",        label: "Kayu / Timber" },
  { value: "concrete",    label: "Beton Ekspos" },
  { value: "metal",       label: "Metal / Stainless" },
  { value: "rattan",      label: "Rotan / Bambu" },
  { value: "fabric",      label: "Fabric / Upholstery" },
  { value: "leather",     label: "Kulit / Leather" },
  { value: "glass",       label: "Kaca / Glass" },
  { value: "ceramic",     label: "Keramik / Terrakota" },
  { value: "wallpaper",   label: "Wallpaper / Wall Treatment" },
  { value: "plants",      label: "Tanaman / Greenery" },
  { value: "other",       label: "Lainnya" },
];

export const INTERIOR_BUDGET_OPTIONS = [
  { value: "entry",     label: "Entry",   description: "< Rp 50jt" },
  { value: "mid",       label: "Mid",     description: "Rp 50jt – 200jt" },
  { value: "premium",   label: "Premium", description: "Rp 200jt – 500jt" },
  { value: "luxury",    label: "Luxury",  description: "> Rp 500jt" },
  { value: "unsure",    label: "Belum ditentukan", description: "Tim kami akan bantu estimasi" },
];
