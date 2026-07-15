/**
 * Service-based brief section configuration.
 *
 * Determines labels, hints, and field visibility for each service type.
 * All options map to EXISTING BriefData string fields — no new DB fields.
 */

export type ServiceType =
  | "brand_identity"
  | "logo_design"
  | "company_profile"
  | "pitch_deck"
  | "social_media"
  | "copywriting"
  | "image_generation"
  | "fashion_design"
  | "interior_design"
  | "default";

export interface BriefStep1Config {
  industryLabel: string;
  industryHint: string;
  showSize: boolean;
  websiteLabel: string;
  websiteHint: string;
}

export interface BriefStep2Config {
  goalLabel: string;
  goalDescription: string;
  showSuccessMetrics: boolean;
  showExistingAssets: boolean;
  existingAssetsLabel: string;
}

export interface BriefStep3Config {
  audienceLabel: string;
  audienceDescription: string;
  showPainPoints: boolean;
  painPointsLabel: string;
  showChannels: boolean;
  channelsLabel: string;
}

export interface BriefStep4Config {
  styleLabel: string;
  showColor: boolean;
  showReferences: boolean;
  referenceLabel: string;
  referenceHint: string;
  showSpecialReq: boolean;
  specialReqLabel: string;
  specialReqHint: string;
}

export interface BriefStep5Config {
  outputLabel: string;
  outputHint: string;
  showLanguage: boolean;
}

export interface BriefStep6Config {
  showPriority: boolean;
  showMilestones: boolean;
}

export interface BriefSectionConfig {
  step1: BriefStep1Config;
  step2: BriefStep2Config;
  step3: BriefStep3Config;
  step4: BriefStep4Config;
  step5: BriefStep5Config;
  step6: BriefStep6Config;
}

// ── Default config ─────────────────────────────────────────────────────────────

const DEFAULT: BriefSectionConfig = {
  step1: {
    industryLabel: "Apa industri bisnis Anda?",
    industryHint: "Pilih industri yang paling sesuai dengan bisnis Anda",
    showSize: true,
    websiteLabel: "Website atau media sosial bisnis",
    websiteHint: "Satu link utama sudah cukup",
  },
  step2: {
    goalLabel: "Apa tujuan utama project ini?",
    goalDescription: "Pilih hingga 5 tujuan. Minimal satu wajib dipilih.",
    showSuccessMetrics: true,
    showExistingAssets: true,
    existingAssetsLabel: "Aset yang sudah Anda miliki",
  },
  step3: {
    audienceLabel: "Siapa yang paling ingin Anda jangkau?",
    audienceDescription: "Pilih hingga 4 segmen. Minimal satu wajib dipilih.",
    showPainPoints: true,
    painPointsLabel: "Masalah yang ingin diselesaikan untuk audiens ini",
    showChannels: true,
    channelsLabel: "Di mana audiens Anda biasanya berada?",
  },
  step4: {
    styleLabel: "Pilih tampilan yang paling sesuai dengan karakter brand Anda",
    showColor: true,
    showReferences: true,
    referenceLabel: "Contoh desain atau referensi",
    referenceHint: "Tempel link referensi (Pinterest, Behance, URL) — sangat membantu tim kami",
    showSpecialReq: true,
    specialReqLabel: "Ada hal khusus yang perlu kami perhatikan?",
    specialReqHint: "Pantangan, spesifikasi teknis, atau catatan khusus",
  },
  step5: {
    outputLabel: "Format output yang Anda butuhkan",
    outputHint: "Contoh: 3 variasi konten Instagram (1:1 + Story), 1 banner website 1200×628",
    showLanguage: true,
  },
  step6: {
    showPriority: true,
    showMilestones: true,
  },
};

// ── Per-service overrides ──────────────────────────────────────────────────────

const OVERRIDES: Partial<Record<ServiceType, Partial<BriefSectionConfig>>> = {
  brand_identity: {
    step4: {
      ...DEFAULT.step4,
      showSpecialReq: true,
      specialReqLabel: "Kepribadian brand & hal yang harus dihindari",
      specialReqHint: "Contoh: brand harus terasa warm & approachable, hindari nuansa gelap",
      referenceLabel: "Referensi brand atau kompetitor",
      referenceHint: "Brand mana yang tampilannya Anda sukai, atau nama kompetitor utama Anda",
    },
  },
  logo_design: {
    step4: {
      ...DEFAULT.step4,
      showSpecialReq: true,
      specialReqLabel: "Preferensi tipe logo & elemen yang harus ada/dihindari",
      specialReqHint:
        "Contoh: wordmark, lettermark, atau icon — simbol atau elemen yang wajib ada atau tidak boleh dipakai",
    },
  },
  company_profile: {
    step2: {
      ...DEFAULT.step2,
      existingAssetsLabel: "Materi perusahaan yang sudah tersedia",
    },
    step5: {
      outputLabel: "Jumlah halaman & bahasa konten",
      outputHint:
        "Contoh: 20 halaman — About, Services, Team, Portfolio, Contact",
      showLanguage: true,
    },
  },
  pitch_deck: {
    step2: {
      ...DEFAULT.step2,
      goalLabel: "Tujuan pitch deck ini",
      goalDescription: "Untuk apa deck ini dibuat? Pilih hingga 5.",
      existingAssetsLabel: "Data & materi yang tersedia untuk deck",
    },
    step3: {
      ...DEFAULT.step3,
      audienceLabel: "Siapa yang akan menerima pitch ini?",
      audienceDescription: "Investor, stakeholder, atau mitra potensial",
    },
    step5: {
      outputLabel: "Jumlah slide & format",
      outputHint:
        "Contoh: 15 slide PowerPoint/Keynote + PDF send version + PDF present version",
      showLanguage: true,
    },
  },
  social_media: {
    step3: {
      ...DEFAULT.step3,
      channelsLabel: "Platform media sosial yang akan digunakan",
    },
    step5: {
      outputLabel: "Jumlah konten & format per platform",
      outputHint:
        "Contoh: 12 post feed Instagram (1:1) + 4 story, format PNG editable",
      showLanguage: false,
    },
  },
  copywriting: {
    step5: {
      outputLabel: "Jenis konten & jumlah",
      outputHint:
        "Contoh: 10 caption Instagram, 2 artikel blog 800 kata, 1 landing page copy",
      showLanguage: true,
    },
  },
  image_generation: {
    step4: {
      ...DEFAULT.step4,
      styleLabel: "Gaya visual gambar yang diinginkan",
      referenceLabel: "Contoh gambar atau referensi visual",
      referenceHint:
        "Tempel link Pinterest, Behance, atau URL gambar yang mendekati harapan Anda",
    },
    step5: {
      outputLabel: "Jumlah & format gambar",
      outputHint:
        "Contoh: 10 foto produk (PNG transparan, 2000×2000px)",
      showLanguage: false,
    },
  },
  fashion_design: {
    step1: {
      ...DEFAULT.step1,
      industryLabel: "Kategori fashion brand Anda",
      industryHint: "Pilih industri yang paling sesuai dengan brand fashion Anda",
      websiteLabel: "Website, online store, atau media sosial brand",
      websiteHint: "Instagram, Shopee, Tokopedia, atau website resmi",
    },
    step2: {
      ...DEFAULT.step2,
      goalLabel: "Tujuan project fashion ini",
      goalDescription: "Pilih hingga 5 tujuan utama. Minimal satu wajib dipilih.",
      existingAssetsLabel: "Aset brand yang sudah Anda miliki (logo, lookbook, dsb.)",
    },
    step3: {
      ...DEFAULT.step3,
      audienceLabel: "Siapa target konsumen koleksi ini?",
      audienceDescription: "Pilih hingga 4 segmen konsumen utama.",
      painPointsLabel: "Apa yang sedang dicari oleh konsumen fashion Anda?",
      channelsLabel: "Di mana konsumen Anda biasanya berbelanja atau mencari inspirasi?",
    },
    step4: {
      ...DEFAULT.step4,
      styleLabel: "Gaya visual / estetika koleksi yang diinginkan",
      referenceLabel: "Referensi brand, desainer, atau lookbook",
      referenceHint: "Contoh: brand seperti X, desainer Y, atau link Pinterest mood board Anda",
      specialReqLabel: "Pantangan visual atau elemen wajib ada",
      specialReqHint: "Contoh: no head-to-toe hitam, harus ada batik motif, wajib inklusif size",
    },
    step5: {
      outputLabel: "Output yang dibutuhkan dari project ini",
      outputHint: "Contoh: brief koleksi 10 halaman, 20 product description, 30 caption Instagram",
      showLanguage: true,
    },
  },
  interior_design: {
    step1: {
      ...DEFAULT.step1,
      industryLabel: "Jenis project interior",
      industryHint: "Pilih kategori project yang paling sesuai",
      websiteLabel: "Website studio atau referensi proyek sebelumnya",
      websiteHint: "Portfolio, Instagram studio, atau website resmi",
    },
    step2: {
      ...DEFAULT.step2,
      goalLabel: "Tujuan utama project desain interior ini",
      goalDescription: "Pilih hingga 5 tujuan. Minimal satu wajib dipilih.",
      existingAssetsLabel: "Data yang sudah tersedia (denah, foto kondisi saat ini, dsb.)",
    },
    step3: {
      ...DEFAULT.step3,
      audienceLabel: "Siapa pengguna utama ruangan ini?",
      audienceDescription: "Pilih hingga 4 segmen pengguna.",
      painPointsLabel: "Masalah atau kebutuhan utama dari ruangan saat ini",
      channelsLabel: "Di mana klien Anda biasanya mencari inspirasi desain?",
    },
    step4: {
      ...DEFAULT.step4,
      styleLabel: "Gaya desain interior yang diinginkan",
      referenceLabel: "Referensi desainer, proyek, atau gambar inspirasi",
      referenceHint: "Link Pinterest board, Houzz, atau nama desainer yang Anda kagumi",
      specialReqLabel: "Spesifikasi teknis atau pantangan desain",
      specialReqHint: "Contoh: harus child-friendly, no dark wood, budget material max Rp X",
    },
    step5: {
      outputLabel: "Output yang dibutuhkan",
      outputHint: "Contoh: konsep desain 15 halaman + spesifikasi material + mood board 2 ruangan",
      showLanguage: true,
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Infer service type from service name string */
export function detectServiceType(serviceName?: string | null): ServiceType {
  if (!serviceName) return "default";
  const n = serviceName.toLowerCase();
  if (n.includes("brand identity") || n.includes("brand identit")) return "brand_identity";
  if (n.includes("logo")) return "logo_design";
  if (n.includes("company profile") || n.includes("profil perusahaan")) return "company_profile";
  if (n.includes("pitch deck") || n.includes("pitch")) return "pitch_deck";
  if (n.includes("social media") || n.includes("sosmed") || n.includes("konten media")) return "social_media";
  if (n.includes("copywriting") || n.includes("copywriter")) return "copywriting";
  if (n.includes("fashion design") || n.includes("fashion brief")) return "fashion_design";
  if (n.includes("interior design") || n.includes("desain interior")) return "interior_design";
  if (n.includes("image") || n.includes("gambar") || n.includes("ilustrasi")) return "image_generation";
  if (n.includes("fashion") || n.includes("koleksi") || n.includes("collection brief") || n.includes("fashion brand")) return "fashion_design";
  if (n.includes("interior") || n.includes("ruangan") || n.includes("spatial") || n.includes("mood board") && n.includes("room")) return "interior_design";
  return "default";
}

/** Merge service overrides on top of defaults */
export function getServiceConfig(serviceType: ServiceType): BriefSectionConfig {
  const ov = OVERRIDES[serviceType] ?? {};
  return {
    step1: { ...DEFAULT.step1, ...ov.step1 },
    step2: { ...DEFAULT.step2, ...ov.step2 },
    step3: { ...DEFAULT.step3, ...ov.step3 },
    step4: { ...DEFAULT.step4, ...ov.step4 },
    step5: { ...DEFAULT.step5, ...ov.step5 },
    step6: { ...DEFAULT.step6, ...ov.step6 },
  };
}
