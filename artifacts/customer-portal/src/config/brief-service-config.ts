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
      industryLabel: "Industri / kategori brand fashion Anda",
      industryHint: "Pilih industri yang paling sesuai — misalnya Fashion, Beauty, atau Retail",
      websiteLabel: "Website atau media sosial brand",
      websiteHint: "Instagram, TikTok, atau website utama",
      showSize: false,
    },
    step2: {
      ...DEFAULT.step2,
      goalLabel: "Tujuan koleksi ini",
      goalDescription: "Pilih hingga 5 tujuan. Minimal satu wajib dipilih.",
      showSuccessMetrics: true,
      showExistingAssets: true,
      existingAssetsLabel: "Koleksi atau aset visual yang sudah ada",
    },
    step3: {
      ...DEFAULT.step3,
      audienceLabel: "Target pelanggan utama koleksi ini",
      audienceDescription: "Pilih hingga 4 segmen audiens.",
      painPointsLabel: "Kebutuhan atau keinginan yang belum terpenuhi oleh brand lain",
      channelsLabel: "Di mana target pelanggan Anda berbelanja?",
    },
    step4: {
      ...DEFAULT.step4,
      styleLabel: "Arah gaya visual koleksi",
      referenceLabel: "Referensi visual atau brand fashion yang Anda admirasi",
      referenceHint: "Link Pinterest board, Instagram brand, atau URL lookbook",
      specialReqLabel: "Hal khusus yang perlu diperhatikan",
      specialReqHint: "Contoh: warna pantangan, bahan yang harus dihindari, aturan brand",
    },
    step5: {
      outputLabel: "Deliverables yang Anda butuhkan",
      outputHint: "Contoh: lookbook PDF 10 look, press release, caption Instagram 15 post",
      showLanguage: true,
    },
  },
  interior_design: {
    step1: {
      ...DEFAULT.step1,
      industryLabel: "Jenis proyek interior",
      industryHint: "Pilih industri yang paling sesuai — misalnya Properti, Hotel, atau Retail",
      websiteLabel: "Website atau referensi portofolio",
      websiteHint: "Jika ada website atau Instagram yang ingin Anda referensikan",
      showSize: false,
    },
    step2: {
      ...DEFAULT.step2,
      goalLabel: "Tujuan utama proyek desain interior ini",
      goalDescription: "Pilih hingga 5 tujuan. Minimal satu wajib dipilih.",
      showSuccessMetrics: true,
      showExistingAssets: true,
      existingAssetsLabel: "Elemen existing yang sudah ada (furnitur, arsitektur, dsb)",
    },
    step3: {
      ...DEFAULT.step3,
      audienceLabel: "Siapa yang akan menggunakan ruang ini?",
      audienceDescription: "Pilih hingga 4 profil pengguna.",
      painPointsLabel: "Masalah atau ketidaknyamanan pada ruang saat ini",
      channelsLabel: "Di mana pengguna biasa menghabiskan waktu? (referensi lifestyle)",
    },
    step4: {
      ...DEFAULT.step4,
      styleLabel: "Arah gaya desain interior yang diinginkan",
      referenceLabel: "Referensi desain atau interior yang Anda sukai",
      referenceHint: "Link Pinterest, Houzz, Instagram, atau foto ruang yang Anda kagumi",
      specialReqLabel: "Persyaratan atau pantangan khusus",
      specialReqHint: "Contoh: harus ramah anak, bisa pet-friendly, budget khusus per area",
    },
    step5: {
      outputLabel: "Deliverables yang Anda butuhkan",
      outputHint: "Contoh: proposal desain PDF, mood board, spesifikasi material, narasi ruang",
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
