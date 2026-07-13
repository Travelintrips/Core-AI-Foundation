import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { AutosaveStatus, type AutosaveState } from "@/components/brief/autosave-status";
import {
  SectionCard, FieldTitle, HelperText, SuggestionGroup,
  SelectionCard, ChoiceChip, ColorPicker, ProgressStepper, SummaryCard,
  TagSelector,
} from "@/components/creative-ui";
import { MultiChoiceChip } from "@/components/creative-ui/ChoiceChip";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import { useToast } from "@/hooks/use-toast";
import { useRequestDetail, useSaveBrief, useStartBrief, useServiceDetail } from "@/hooks/use-catalog";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus,
  Building2, Target, Users, Palette, Package, Calendar, ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  serializeChoices, parseChoices, serializeSingleChoice, parseSingleChoice,
  serializeColors, parseColors, normalizeLegacyPriority, hasAnySelection,
} from "@/lib/brief-utils";
import { detectServiceType, getServiceConfig } from "@/config/brief-service-config";
import type { TagOption } from "@/components/creative-ui/TagSelector";

// ── Types ─────────────────────────────────────────────────────────────────────

type BriefData = {
  // Step 1 — Business Info
  companyIndustry: string;
  companySize: string;
  websiteUrl: string;
  // Step 2 — Project Goals
  primaryGoal: string;
  successMetrics: string;
  existingAssets: string;
  // Step 3 — Target Audience
  audienceDemographics: string;
  audiencePainPoints: string;
  audienceChannels: string;
  // Step 4 — Visual Style & References
  stylePreference: string;
  colorPalette: string;
  referenceLinks: string;
  // Step 5 — Deliverables
  outputFormats: string;
  outputLanguage: string;
  specialRequirements: string;
  // Step 6 — Timeline
  deadline: string;
  priority: string;
  milestones: string;
};

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
};

function hasContent(brief: BriefData): boolean {
  return Object.entries(brief).some(([key, value]) => {
    if (key === "outputLanguage" || key === "priority") return false;
    return typeof value === "string" && value.trim().length > 0;
  });
}

// ── Steps ─────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: "Informasi Bisnis",        description: "Ceritakan sedikit tentang bisnis Anda.",              icon: Building2 },
  { id: 2, title: "Tujuan Project",          description: "Apa yang ingin Anda capai dengan project ini?",       icon: Target },
  { id: 3, title: "Target Audiens",          description: "Siapa yang paling ingin Anda jangkau?",              icon: Users },
  { id: 4, title: "Gaya Visual & Referensi", description: "Bantu tim kami memahami arah visual yang Anda mau.", icon: Palette },
  { id: 5, title: "Deliverables",            description: "Format dan jumlah output yang Anda butuhkan.",       icon: Package },
  { id: 6, title: "Deadline",                description: "Kapan Anda membutuhkan hasil akhirnya?",             icon: Calendar },
  { id: 7, title: "Review",                  description: "Periksa kembali sebelum mengirim ke tim kami.",      icon: ClipboardList },
];

const TOTAL_STEPS = STEPS.length;

// ── Static option data (defined outside component to avoid re-creation) ───────

const INDUSTRY_OPTIONS: TagOption[] = [
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

const INDUSTRY_QUICK_VALUES = [
  "ecommerce", "technology", "fnb", "retail", "healthcare", "startup", "creative_agency", "property",
];

const COMPANY_SIZE_OPTIONS = [
  { value: "solo",       label: "Personal / Individu", icon: "👤", description: "1 orang" },
  { value: "startup",    label: "Startup / Tim Kecil", icon: "🚀", description: "2–10 orang" },
  { value: "smb",        label: "Usaha Kecil",         icon: "🏢", description: "11–50 orang" },
  { value: "mid",        label: "Perusahaan Menengah", icon: "🏬", description: "51–200 orang" },
  { value: "enterprise", label: "Enterprise",          icon: "🏙", description: "Lebih dari 200 orang" },
];

const GOAL_OPTIONS = [
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

const METRIC_OPTIONS = [
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

const ASSET_OPTIONS = [
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

const AUDIENCE_OPTIONS = [
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

const CHANNEL_OPTIONS = [
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

const STYLE_OPTIONS = [
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

const PRIORITY_OPTIONS = [
  { value: "quality",  label: "Kualitas terbaik",               description: "Prioritaskan hasil yang sempurna" },
  { value: "speed",    label: "Kecepatan pengerjaan",           description: "Dipercepat, mungkin ada rush fee" },
  { value: "budget",   label: "Efisiensi anggaran",             description: "Maksimalkan hasil dalam budget" },
  { value: "balanced", label: "Keseimbangan",                   description: "Kualitas baik dalam waktu wajar" },
  { value: "unsure",   label: "Belum yakin",                    description: "Tim kami akan bantu tentukan" },
];

const LANGUAGE_OPTIONS = [
  { value: "id",    label: "Bahasa Indonesia" },
  { value: "en",    label: "English" },
  { value: "id_en", label: "Bilingual — Indonesia & English" },
];

// ── Validation ────────────────────────────────────────────────────────────────

type FieldErrors = Partial<Record<keyof BriefData, string>>;

function validateStep(step: number, brief: BriefData): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1) {
    const ind = brief.companyIndustry.trim();
    if (!ind || ind === "Lainnya")
      errors.companyIndustry = "Pilih atau tuliskan industri bisnis Anda sebelum melanjutkan";
  }
  if (step === 2 && !hasAnySelection(brief.primaryGoal))
    errors.primaryGoal = "Pilih minimal satu tujuan project sebelum melanjutkan";
  if (step === 3 && !hasAnySelection(brief.audienceDemographics))
    errors.audienceDemographics = "Pilih minimal satu segmen audiens sebelum melanjutkan";
  if (step === 4 && !hasAnySelection(brief.stylePreference))
    errors.stylePreference = "Pilih minimal satu gaya visual sebelum melanjutkan";
  if (step === 5 && !brief.outputFormats.trim())
    errors.outputFormats = "Jelaskan format output yang Anda butuhkan";
  if (step === 6 && !brief.deadline.trim())
    errors.deadline = "Tentukan deadline project Anda";
  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split "chips; data\nExtra: text" → [chipsStr, extraText] */
function splitExtra(raw: string, prefix: string): [string, string] {
  const nl = raw.indexOf("\n");
  if (nl === -1) return [raw, ""];
  const chips = raw.slice(0, nl);
  const rest  = raw.slice(nl + 1).replace(new RegExp(`^${prefix}: ?`), "");
  return [chips, rest];
}

/** Build storage string from chips + optional extra line */
function joinExtra(chipsStr: string, extra: string, prefix: string): string {
  if (!extra.trim()) return chipsStr;
  return `${chipsStr}\n${prefix}: ${extra.trim()}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: requestDetail, isLoading: requestLoading, isError: requestError } = useRequestDetail(requestId);
  const { data: serviceDetail } = useServiceDetail(requestDetail?.serviceId);
  const saveBrief  = useSaveBrief();
  const startBrief = useStartBrief();

  const STORAGE_KEY = `brief_draft_${requestId}`;

  // ── Service config ──────────────────────────────────────────────────────────
  const serviceConfig = useMemo(() => {
    const svcType = detectServiceType(serviceDetail?.serviceName);
    return getServiceConfig(svcType);
  }, [serviceDetail?.serviceName]);

  // ── Start brief ─────────────────────────────────────────────────────────────
  const startBriefFired = useRef(false);
  useEffect(() => {
    if (!requestId || requestLoading || startBriefFired.current) return;
    startBriefFired.current = true;
    if (requestDetail && requestDetail.status !== "draft") return;
    startBrief.mutate({ requestId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, requestLoading, requestDetail]);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep]         = useState(1);
  const [errors, setErrors]                   = useState<FieldErrors>({});
  const [brief, setBrief]                     = useState<BriefData>(EMPTY_BRIEF);
  const [isSaving, setIsSaving]               = useState(false);
  const [submitError, setSubmitError]         = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  // Autosave
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [lastSavedAt, setLastSavedAt]     = useState<Date | null>(null);
  const [now, setNow]                     = useState(() => Date.now());

  // Draft restore
  const [pendingDraft, setPendingDraft] = useState<BriefData | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);

  // Progressive disclosure toggles (auto-expand if content exists)
  const [showPainPoints,  setShowPainPoints]  = useState(false);
  const [showMilestones,  setShowMilestones]  = useState(false);
  const [showSpecialReq,  setShowSpecialReq]  = useState(false);
  const [showAssetNotes,  setShowAssetNotes]  = useState(false);

  // ── Draft check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = { ...EMPTY_BRIEF, ...JSON.parse(stored) } as BriefData;
        // Normalize legacy priority
        parsed.priority = normalizeLegacyPriority(parsed.priority);
        if (hasContent(parsed)) { setPendingDraft(parsed); setDraftChecked(true); return; }
      }
    } catch { /* corrupt draft — ignore */ }
    setDraftChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand collapsible sections when draft content exists
  useEffect(() => {
    if (!brief.audiencePainPoints) return;
    setShowPainPoints(true);
  }, [brief.audiencePainPoints]);
  useEffect(() => {
    if (!brief.milestones) return;
    setShowMilestones(true);
  }, [brief.milestones]);
  useEffect(() => {
    if (!brief.specialRequirements) return;
    setShowSpecialReq(true);
  }, [brief.specialRequirements]);
  useEffect(() => {
    const [, notes] = splitExtra(brief.existingAssets, "Catatan");
    if (!notes) return;
    setShowAssetNotes(true);
  }, [brief.existingAssets]);

  // ── Autosave ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!draftChecked || pendingDraft) return;
    setAutosaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(brief));
        setLastSavedAt(new Date()); setNow(Date.now());
        setAutosaveState(navigator.onLine ? "saved" : "offline");
      } catch { setAutosaveState("error"); }
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, STORAGE_KEY, draftChecked, pendingDraft]);

  useEffect(() => {
    const goOffline = () => setAutosaveState((s) => s === "saved" ? "offline" : s);
    const goOnline  = () => setAutosaveState((s) => s === "offline" ? "saved" : s);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (autosaveState === "saving" || autosaveState === "error") { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [autosaveState]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [currentStep]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleChange = useCallback((field: keyof BriefData, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => prev[field] ? { ...prev, [field]: undefined } : prev);
  }, []);

  // ── Derived state from brief fields ─────────────────────────────────────────

  // Industry
  const industryParsed = useMemo(() => parseSingleChoice(brief.companyIndustry, INDUSTRY_OPTIONS), [brief.companyIndustry]);
  const industryTagValue = useMemo(() => industryParsed.selected ? [industryParsed.selected] : [], [industryParsed.selected]);

  const handleIndustryTagChange = useCallback((newVals: string[]) => {
    const val = newVals[0] ?? "";
    if (!val) { handleChange("companyIndustry", ""); return; }
    if (val === "other") {
      // Keep existing custom text or set sentinel so "other" stays selected
      const current = industryParsed.selected === "other" && industryParsed.custom
        ? industryParsed.custom
        : "Lainnya";
      handleChange("companyIndustry", current);
    } else {
      handleChange("companyIndustry", serializeSingleChoice(val, INDUSTRY_OPTIONS));
    }
  }, [handleChange, industryParsed]);

  // No website toggle
  const noWebsite = brief.websiteUrl === "Belum punya website";

  // Goals — multi-select (max 5)
  const goalParsed = useMemo(() => parseChoices(brief.primaryGoal, GOAL_OPTIONS), [brief.primaryGoal]);

  const handleGoalChange = useCallback((newSelected: string[]) => {
    const serialized = serializeChoices(newSelected, GOAL_OPTIONS, goalParsed.custom);
    handleChange("primaryGoal", serialized);
  }, [handleChange, goalParsed.custom]);

  const handleGoalCustom = useCallback((text: string) => {
    const serialized = serializeChoices(goalParsed.selected, GOAL_OPTIONS, text);
    handleChange("primaryGoal", serialized);
  }, [handleChange, goalParsed.selected]);

  // Metrics — multi-select; "unsure" exclusive; stores detail in \n suffix
  const [metricChipsStr, metricDetail] = useMemo(
    () => splitExtra(brief.successMetrics, "Detail"),
    [brief.successMetrics],
  );
  const metricParsed = useMemo(() => parseChoices(metricChipsStr, METRIC_OPTIONS), [metricChipsStr]);

  const handleMetricChange = useCallback((newSelected: string[]) => {
    const hadUnsure = metricParsed.selected.includes("unsure");
    const hasUnsure = newSelected.includes("unsure");
    let final = newSelected;
    if (!hadUnsure && hasUnsure) final = ["unsure"];
    else if (hadUnsure && newSelected.length > 1) final = newSelected.filter((v) => v !== "unsure");
    const chipsStr = serializeChoices(final, METRIC_OPTIONS, metricParsed.custom);
    handleChange("successMetrics", joinExtra(chipsStr, metricDetail, "Detail"));
  }, [handleChange, metricParsed, metricDetail]);

  const handleMetricCustom = useCallback((text: string) => {
    const chipsStr = serializeChoices(metricParsed.selected, METRIC_OPTIONS, text);
    handleChange("successMetrics", joinExtra(chipsStr, metricDetail, "Detail"));
  }, [handleChange, metricParsed, metricDetail]);

  const handleMetricDetail = useCallback((text: string) => {
    handleChange("successMetrics", joinExtra(metricChipsStr, text, "Detail"));
  }, [handleChange, metricChipsStr]);

  // Assets — multi-select; "none" exclusive; stores notes in \n suffix
  const [assetChipsStr, assetNotes] = useMemo(
    () => splitExtra(brief.existingAssets, "Catatan"),
    [brief.existingAssets],
  );
  const assetParsed = useMemo(() => parseChoices(assetChipsStr, ASSET_OPTIONS), [assetChipsStr]);

  const handleAssetChange = useCallback((newSelected: string[]) => {
    const hadNone = assetParsed.selected.includes("none");
    const hasNone = newSelected.includes("none");
    let final = newSelected;
    if (!hadNone && hasNone) final = ["none"];
    else if (hadNone && newSelected.length > 1) final = newSelected.filter((v) => v !== "none");
    const chipsStr = serializeChoices(final, ASSET_OPTIONS, assetParsed.custom);
    handleChange("existingAssets", joinExtra(chipsStr, assetNotes, "Catatan"));
  }, [handleChange, assetParsed, assetNotes]);

  const handleAssetCustom = useCallback((text: string) => {
    const chipsStr = serializeChoices(assetParsed.selected, ASSET_OPTIONS, text);
    handleChange("existingAssets", joinExtra(chipsStr, assetNotes, "Catatan"));
  }, [handleChange, assetParsed, assetNotes]);

  const handleAssetNotes = useCallback((text: string) => {
    handleChange("existingAssets", joinExtra(assetChipsStr, text, "Catatan"));
  }, [handleChange, assetChipsStr]);

  // Audience type — multi-select (max 4)
  const audienceParsed = useMemo(() => parseChoices(brief.audienceDemographics, AUDIENCE_OPTIONS), [brief.audienceDemographics]);

  const handleAudienceChange = useCallback((newSelected: string[]) => {
    const serialized = serializeChoices(newSelected, AUDIENCE_OPTIONS, audienceParsed.custom);
    handleChange("audienceDemographics", serialized);
  }, [handleChange, audienceParsed.custom]);

  const handleAudienceCustom = useCallback((text: string) => {
    const serialized = serializeChoices(audienceParsed.selected, AUDIENCE_OPTIONS, text);
    handleChange("audienceDemographics", serialized);
  }, [handleChange, audienceParsed.selected]);

  // Channels — multi-select
  const channelParsed = useMemo(() => parseChoices(brief.audienceChannels, CHANNEL_OPTIONS), [brief.audienceChannels]);

  const handleChannelChange = useCallback((newSelected: string[]) => {
    const serialized = serializeChoices(newSelected, CHANNEL_OPTIONS, channelParsed.custom);
    handleChange("audienceChannels", serialized);
  }, [handleChange, channelParsed.custom]);

  const handleChannelCustom = useCallback((text: string) => {
    const serialized = serializeChoices(channelParsed.selected, CHANNEL_OPTIONS, text);
    handleChange("audienceChannels", serialized);
  }, [handleChange, channelParsed.selected]);

  // Style — multi-select (max 3); "unsure" exclusive
  const styleParsed = useMemo(() => parseChoices(brief.stylePreference, STYLE_OPTIONS), [brief.stylePreference]);

  const handleStyleChange = useCallback((newSelected: string[]) => {
    const hadUnsure = styleParsed.selected.includes("unsure");
    const hasUnsure = newSelected.includes("unsure");
    let final = newSelected;
    if (!hadUnsure && hasUnsure) final = ["unsure"];
    else if (hadUnsure && newSelected.length > 1) final = newSelected.filter((v) => v !== "unsure");
    const serialized = serializeChoices(final, STYLE_OPTIONS, styleParsed.custom);
    handleChange("stylePreference", serialized);
  }, [handleChange, styleParsed]);

  const handleStyleCustom = useCallback((text: string) => {
    const serialized = serializeChoices(styleParsed.selected, STYLE_OPTIONS, text);
    handleChange("stylePreference", serialized);
  }, [handleChange, styleParsed.selected]);

  // Color — multi-select (max 3)
  const colorParsed = useMemo(() => parseColors(brief.colorPalette, DEFAULT_COLOR_PRESETS), [brief.colorPalette]);

  const handleColorChange = useCallback((newSelected: string[]) => {
    const serialized = serializeColors(newSelected, DEFAULT_COLOR_PRESETS, colorParsed.custom);
    handleChange("colorPalette", serialized);
  }, [handleChange, colorParsed.custom]);

  const handleColorCustom = useCallback((text: string) => {
    const serialized = serializeColors(colorParsed.selected, DEFAULT_COLOR_PRESETS, text);
    handleChange("colorPalette", serialized);
  }, [handleChange, colorParsed.selected]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    const stepErrors = validateStep(currentStep, brief);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      const firstField = Object.keys(stepErrors)[0] as keyof BriefData;
      document.getElementById(`brief-${firstField}`)?.focus();
      toast({ title: "Lengkapi field yang wajib diisi", description: Object.values(stepErrors)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep, brief, toast]);

  const handleBack = useCallback(() => {
    setErrors({});
    setCurrentStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const jumpToStep = useCallback((step: number) => {
    setErrors({});
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!requestId) return;
    setIsSaving(true); setSubmitError(null);
    saveBrief.mutate(
      { requestId, brief },
      {
        onSuccess: () => {
          localStorage.removeItem(STORAGE_KEY);
          toast({ title: "Brief tersimpan!", description: "Brief Anda berhasil dikirim." });
          setLocation(`/request-service/${requestId}/pricing`);
        },
        onError: (err) => {
          const message = String((err as Error)?.message ?? err);
          setSubmitError(message);
          toast({ title: "Gagal menyimpan", description: message, variant: "destructive" });
          setIsSaving(false);
        },
      },
    );
  }, [requestId, brief, saveBrief, toast, setLocation, STORAGE_KEY]);

  const continueDraft = useCallback(() => {
    if (pendingDraft) { setBrief(pendingDraft); }
    setPendingDraft(null);
  }, [pendingDraft]);

  const startOver = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setBrief(EMPTY_BRIEF);
    setPendingDraft(null);
  }, [STORAGE_KEY]);

  const servicePackage = useMemo(
    () => serviceDetail?.packages.find((p) => p.id === requestDetail?.packageId) ?? null,
    [serviceDetail, requestDetail],
  );

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (requestLoading || !draftChecked) {
    return (
      <Layout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (requestError || !requestId) {
    return (
      <Layout>
        <div className="container mx-auto px-4 md:px-8 py-24 max-w-lg text-center">
          <h1 className="text-xl font-serif font-medium mb-2">Brief tidak ditemukan</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Link ini mungkin sudah tidak berlaku. Coba akses kembali dari email atau dashboard Anda.
          </p>
          <button
            onClick={() => setLocation("/services")}
            className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          >
            Ke Halaman Layanan
          </button>
        </div>
      </Layout>
    );
  }

  // ── Draft restore prompt ─────────────────────────────────────────────────────

  if (pendingDraft) {
    return (
      <Layout>
        <div className="container mx-auto px-4 md:px-8 py-24 max-w-lg">
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <ClipboardList className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-serif font-medium mb-2">Draft brief ditemukan</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Kami menemukan jawaban yang belum terkirim. Lanjutkan mengisi, atau mulai dari awal?
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={startOver}
                className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
              >
                Mulai dari Awal
              </button>
              <button
                onClick={continueDraft}
                className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
              >
                Lanjutkan Draft
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const stepInfo = STEPS[currentStep - 1];
  const StepIcon = stepInfo.icon;

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep="brief" />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-10 pb-28 md:pb-12 max-w-3xl">

        {/* ── Wizard header ───────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground mb-4">
            <span className="font-medium text-foreground/80 truncate">
              {serviceDetail?.serviceName ?? "Project Brief"}
              {servicePackage ? ` · ${servicePackage.packageName}` : ""}
            </span>
            <AutosaveStatus state={autosaveState} lastSavedAt={lastSavedAt} now={now} className="shrink-0" />
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
              <StepIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-semibold text-foreground outline-none"
              >
                {stepInfo.title}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">{stepInfo.description}</p>
            </div>
          </div>

          <ProgressStepper steps={STEPS} currentStep={currentStep} estimatedMinutes={5} />
        </div>

        {/* ── Step content ────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          >

            {/* ── Step 1 — Business Info ─────────────────────────────────── */}
            {currentStep === 1 && (
              <SectionCard icon={Building2} title="Informasi Bisnis" description="Ceritakan sedikit tentang bisnis Anda.">

                {/* Industry */}
                <FieldItem id="companyIndustry" label={serviceConfig.step1.industryLabel} required error={errors.companyIndustry}>
                  <TagSelector
                    options={INDUSTRY_OPTIONS}
                    value={industryTagValue}
                    onChange={handleIndustryTagChange}
                    placeholder="Cari industri..."
                    singleSelect
                    groupable
                    searchable
                  />
                  {/* Quick suggestions */}
                  <SuggestionGroup
                    label="Pilihan cepat"
                    options={INDUSTRY_QUICK_VALUES.map((v) => INDUSTRY_OPTIONS.find((o) => o.value === v)?.label ?? v)}
                    onSelect={(label) => {
                      const opt = INDUSTRY_OPTIONS.find((o) => o.label === label);
                      if (opt) handleChange("companyIndustry", opt.label);
                    }}
                  />
                  {/* "Lainnya" custom input */}
                  <AnimatePresence>
                    {industryParsed.selected === "other" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <input
                          id="brief-companyIndustry"
                          className="input-field mt-2"
                          value={industryParsed.custom}
                          onChange={(e) => handleChange("companyIndustry", e.target.value || "Lainnya")}
                          placeholder="Tuliskan industri bisnis Anda"
                          aria-invalid={!!errors.companyIndustry}
                          aria-label="Tuliskan industri bisnis Anda"
                          autoFocus
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </FieldItem>

                {/* Company size */}
                {serviceConfig.step1.showSize && (
                  <FieldItem id="companySize" label="Berapa ukuran perusahaan Anda?" optional hint="Pilih yang paling sesuai">
                    <SelectionCard
                      options={COMPANY_SIZE_OPTIONS}
                      value={brief.companySize}
                      onChange={(v) => handleChange("companySize", v)}
                      columns={5}
                    />
                  </FieldItem>
                )}

                {/* Website */}
                <FieldItem id="websiteUrl" label={serviceConfig.step1.websiteLabel!} optional hint={serviceConfig.step1.websiteHint}>
                  {/* "Belum punya" toggle */}
                  <label className={cn(
                    "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer transition-all duration-200 mb-2",
                    noWebsite
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={noWebsite}
                      onChange={() => handleChange("websiteUrl", noWebsite ? "" : "Belum punya website")}
                    />
                    Belum punya website atau media sosial
                  </label>
                  <AnimatePresence>
                    {!noWebsite && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <input
                          id="brief-websiteUrl"
                          className="input-field"
                          type="url"
                          value={brief.websiteUrl}
                          onChange={(e) => handleChange("websiteUrl", e.target.value)}
                          placeholder="https://websiteanda.com atau @username"
                          autoComplete="url"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </FieldItem>
              </SectionCard>
            )}

            {/* ── Step 2 — Project Goals ─────────────────────────────────── */}
            {currentStep === 2 && (
              <SectionCard icon={Target} title="Tujuan Project" description="Apa yang ingin Anda capai dengan project ini?">

                {/* Primary Goal */}
                <FieldItem id="primaryGoal" label={serviceConfig.step2.goalLabel} required error={errors.primaryGoal}>
                  <p className="text-xs text-muted-foreground -mt-1 mb-2">{serviceConfig.step2.goalDescription}</p>
                  <MultiSelectChips
                    options={GOAL_OPTIONS}
                    selected={goalParsed.selected}
                    onChange={handleGoalChange}
                    max={5}
                    error={!!errors.primaryGoal}
                  />
                  <AnimatePresence>
                    {goalParsed.selected.includes("other") && (
                      <motion.textarea
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="input-field min-h-[80px] mt-2"
                        value={goalParsed.custom}
                        onChange={(e) => handleGoalCustom(e.target.value)}
                        placeholder="Jelaskan tujuan lain yang ingin dicapai"
                        aria-label="Tujuan lainnya"
                      />
                    )}
                  </AnimatePresence>
                </FieldItem>

                {/* Success Metrics */}
                {serviceConfig.step2.showSuccessMetrics && (
                  <FieldItem id="successMetrics" label="Bagaimana Anda mengukur kesuksesan project ini?" optional>
                    <MultiSelectChips
                      options={METRIC_OPTIONS}
                      selected={metricParsed.selected}
                      onChange={handleMetricChange}
                    />
                    <AnimatePresence>
                      {metricParsed.selected.includes("other") && (
                        <motion.input
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="input-field mt-2"
                          value={metricParsed.custom}
                          onChange={(e) => handleMetricCustom(e.target.value)}
                          placeholder="Metrik lain yang ingin dicapai"
                          aria-label="Metrik lainnya"
                        />
                      )}
                      {metricParsed.selected.length > 0 && !metricParsed.selected.includes("unsure") && (
                        <motion.input
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="input-field mt-2"
                          value={metricDetail}
                          onChange={(e) => handleMetricDetail(e.target.value)}
                          placeholder="Tambahkan target angka atau periode waktu — mis. 1.000 engagement dalam 7 hari"
                          aria-label="Target angka atau waktu"
                        />
                      )}
                    </AnimatePresence>
                  </FieldItem>
                )}

                {/* Existing Assets */}
                {serviceConfig.step2.showExistingAssets && (
                  <FieldItem id="existingAssets" label={serviceConfig.step2.existingAssetsLabel!} optional>
                    <MultiSelectChips
                      options={ASSET_OPTIONS}
                      selected={assetParsed.selected}
                      onChange={handleAssetChange}
                    />
                    <AnimatePresence>
                      {assetParsed.selected.includes("other") && (
                        <motion.input
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="input-field mt-2"
                          value={assetParsed.custom}
                          onChange={(e) => handleAssetCustom(e.target.value)}
                          placeholder="Sebutkan aset lain yang tersedia"
                          aria-label="Aset lainnya"
                        />
                      )}
                    </AnimatePresence>
                    {/* Collapsible notes */}
                    {!showAssetNotes ? (
                      <button
                        type="button"
                        onClick={() => setShowAssetNotes(true)}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambahkan catatan aset
                      </button>
                    ) : (
                      <AnimatePresence>
                        <motion.textarea
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          transition={{ duration: 0.2 }}
                          className="input-field min-h-[60px] mt-2"
                          value={assetNotes}
                          onChange={(e) => handleAssetNotes(e.target.value)}
                          placeholder="Catatan tambahan tentang aset yang tersedia..."
                          aria-label="Catatan aset"
                        />
                      </AnimatePresence>
                    )}
                  </FieldItem>
                )}
              </SectionCard>
            )}

            {/* ── Step 3 — Target Audience ───────────────────────────────── */}
            {currentStep === 3 && (
              <SectionCard icon={Users} title="Target Audiens" description="Siapa yang paling ingin Anda jangkau?">

                {/* Audience type */}
                <FieldItem id="audienceDemographics" label={serviceConfig.step3.audienceLabel} required error={errors.audienceDemographics}>
                  <p className="text-xs text-muted-foreground -mt-1 mb-2">{serviceConfig.step3.audienceDescription}</p>
                  <MultiSelectChips
                    options={AUDIENCE_OPTIONS}
                    selected={audienceParsed.selected}
                    onChange={handleAudienceChange}
                    max={4}
                    error={!!errors.audienceDemographics}
                  />
                  <AnimatePresence>
                    {audienceParsed.selected.includes("other") && (
                      <motion.input
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="input-field mt-2"
                        value={audienceParsed.custom}
                        onChange={(e) => handleAudienceCustom(e.target.value)}
                        placeholder="Segmen audiens lain yang ingin dijangkau"
                        aria-label="Audiens lainnya"
                      />
                    )}
                  </AnimatePresence>
                </FieldItem>

                {/* Pain points — collapsible */}
                {serviceConfig.step3.showPainPoints && (
                  <FieldItem id="audiencePainPoints" label={serviceConfig.step3.painPointsLabel!} optional>
                    {!showPainPoints ? (
                      <button
                        type="button"
                        onClick={() => setShowPainPoints(true)}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambahkan detail
                      </button>
                    ) : (
                      <textarea
                        id="brief-audiencePainPoints"
                        className="input-field min-h-[80px]"
                        value={brief.audiencePainPoints}
                        onChange={(e) => handleChange("audiencePainPoints", e.target.value)}
                        placeholder="Contoh: Kesulitan menemukan produk berkualitas dengan harga terjangkau..."
                      />
                    )}
                  </FieldItem>
                )}

                {/* Channels */}
                {serviceConfig.step3.showChannels && (
                  <FieldItem id="audienceChannels" label={serviceConfig.step3.channelsLabel!} optional>
                    <MultiSelectChips
                      options={CHANNEL_OPTIONS}
                      selected={channelParsed.selected}
                      onChange={handleChannelChange}
                    />
                    <AnimatePresence>
                      {channelParsed.selected.includes("other") && (
                        <motion.input
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="input-field mt-2"
                          value={channelParsed.custom}
                          onChange={(e) => handleChannelCustom(e.target.value)}
                          placeholder="Platform atau channel lain"
                          aria-label="Channel lainnya"
                        />
                      )}
                    </AnimatePresence>
                  </FieldItem>
                )}
              </SectionCard>
            )}

            {/* ── Step 4 — Visual Style & References ────────────────────── */}
            {currentStep === 4 && (
              <SectionCard icon={Palette} title="Gaya Visual & Referensi" description="Bantu tim kami memahami arah visual yang Anda mau.">

                {/* Style */}
                <FieldItem id="stylePreference" label={serviceConfig.step4.styleLabel!} required error={errors.stylePreference}>
                  <MultiSelectChips
                    options={STYLE_OPTIONS}
                    selected={styleParsed.selected}
                    onChange={handleStyleChange}
                    max={3}
                    error={!!errors.stylePreference}
                    hint="Maks. 3 pilihan. Hover chip untuk melihat deskripsi."
                  />
                  <AnimatePresence>
                    {styleParsed.selected.includes("other") && (
                      <motion.input
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="input-field mt-2"
                        value={styleParsed.custom}
                        onChange={(e) => handleStyleCustom(e.target.value)}
                        placeholder="Jelaskan gaya visual yang Anda inginkan"
                        aria-label="Gaya visual lainnya"
                      />
                    )}
                  </AnimatePresence>
                </FieldItem>

                {/* Color */}
                {serviceConfig.step4.showColor && (
                  <FieldItem id="colorPalette" label="Warna brand yang Anda suka?" optional hint="Maks. 3 warna">
                    <ColorPicker
                      value={colorParsed.selected}
                      onChange={handleColorChange}
                      max={3}
                    />
                    {/* "Warna lainnya" custom input */}
                    <AnimatePresence>
                      {colorParsed.selected.includes("other") && (
                        <motion.input
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="input-field mt-2"
                          value={colorParsed.custom}
                          onChange={(e) => handleColorCustom(e.target.value)}
                          placeholder="Nama warna atau kode hex — contoh: Teal, #006B75"
                          aria-label="Warna lainnya"
                        />
                      )}
                    </AnimatePresence>
                    {/* "Warna lainnya" trigger when not yet selected */}
                    {!colorParsed.selected.includes("other") && !colorParsed.selected.includes("none") && (
                      <button
                        type="button"
                        onClick={() => {
                          const newSel = [...colorParsed.selected.filter(v => v !== "none"), "other"];
                          handleColorChange(newSel);
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Warna lainnya
                      </button>
                    )}
                  </FieldItem>
                )}

                {/* References — collapsible */}
                {serviceConfig.step4.showReferences && (
                  <FieldItem id="referenceLinks" label={serviceConfig.step4.referenceLabel!} optional hint={serviceConfig.step4.referenceHint}>
                    <textarea
                      id="brief-referenceLinks"
                      className="input-field min-h-[80px]"
                      value={brief.referenceLinks}
                      onChange={(e) => handleChange("referenceLinks", e.target.value)}
                      placeholder="Tempelkan link referensi desain, brand yang Anda suka, atau kompetitor..."
                    />
                  </FieldItem>
                )}

                {/* Special requirements — collapsible */}
                {serviceConfig.step4.showSpecialReq && (
                  <FieldItem id="specialRequirements" label={serviceConfig.step4.specialReqLabel!} optional hint={serviceConfig.step4.specialReqHint}>
                    {!showSpecialReq ? (
                      <button
                        type="button"
                        onClick={() => setShowSpecialReq(true)}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambahkan detail
                      </button>
                    ) : (
                      <textarea
                        id="brief-specialRequirements"
                        className="input-field min-h-[80px]"
                        value={brief.specialRequirements}
                        onChange={(e) => handleChange("specialRequirements", e.target.value)}
                        placeholder="Contoh: Jangan gunakan gambar manusia, harus ada tagline tertentu..."
                      />
                    )}
                  </FieldItem>
                )}
              </SectionCard>
            )}

            {/* ── Step 5 — Deliverables ──────────────────────────────────── */}
            {currentStep === 5 && (
              <SectionCard icon={Package} title="Deliverables" description="Format dan jumlah output yang Anda butuhkan.">

                <FieldItem id="outputFormats" label={serviceConfig.step5.outputLabel} required error={errors.outputFormats}>
                  <textarea
                    id="brief-outputFormats"
                    className="input-field min-h-[100px]"
                    value={brief.outputFormats}
                    onChange={(e) => handleChange("outputFormats", e.target.value)}
                    placeholder={serviceConfig.step5.outputHint}
                    aria-invalid={!!errors.outputFormats}
                    aria-describedby={errors.outputFormats ? "brief-outputFormats-error" : undefined}
                  />
                </FieldItem>

                {serviceConfig.step5.showLanguage && (
                  <FieldItem id="outputLanguage" label="Bahasa konten" optional>
                    <ChoiceChip
                      options={LANGUAGE_OPTIONS}
                      value={brief.outputLanguage}
                      onChange={(v) => handleChange("outputLanguage", v)}
                    />
                  </FieldItem>
                )}

                {!serviceConfig.step4.showSpecialReq && (
                  <FieldItem id="specialRequirements" label="Ada hal khusus yang perlu kami perhatikan?" optional>
                    {!showSpecialReq ? (
                      <button
                        type="button"
                        onClick={() => setShowSpecialReq(true)}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambahkan detail
                      </button>
                    ) : (
                      <textarea
                        id="brief-specialRequirements"
                        className="input-field min-h-[80px]"
                        value={brief.specialRequirements}
                        onChange={(e) => handleChange("specialRequirements", e.target.value)}
                        placeholder="Contoh: Harus ada tagline tertentu, format harus editable, dll..."
                      />
                    )}
                  </FieldItem>
                )}
              </SectionCard>
            )}

            {/* ── Step 6 — Timeline ─────────────────────────────────────── */}
            {currentStep === 6 && (
              <SectionCard icon={Calendar} title="Deadline" description="Kapan Anda membutuhkan hasil akhirnya?">

                <FieldItem id="deadline" label="Kapan Anda membutuhkan deliverables ini?" required error={errors.deadline}>
                  <input
                    id="brief-deadline"
                    type="date"
                    className="input-field"
                    value={brief.deadline}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => handleChange("deadline", e.target.value)}
                    aria-invalid={!!errors.deadline}
                    aria-describedby={errors.deadline ? "brief-deadline-error" : undefined}
                  />
                </FieldItem>

                {serviceConfig.step6.showPriority && (
                  <FieldItem id="priority" label="Apa yang paling penting untuk Anda?" optional>
                    <ChoiceChip
                      options={PRIORITY_OPTIONS}
                      value={normalizeLegacyPriority(brief.priority)}
                      onChange={(v) => handleChange("priority", v)}
                    />
                    {brief.priority === "speed" && (
                      <p className="text-xs text-amber-500 mt-2">
                        ⚡ Pengerjaan dipercepat dapat memengaruhi rush fee pada penawaran harga.
                      </p>
                    )}
                  </FieldItem>
                )}

                {serviceConfig.step6.showMilestones && (
                  <FieldItem id="milestones" label="Ada tanggal penting lain yang perlu diperhatikan?" optional>
                    {!showMilestones ? (
                      <button
                        type="button"
                        onClick={() => setShowMilestones(true)}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tambahkan milestone
                      </button>
                    ) : (
                      <textarea
                        id="brief-milestones"
                        className="input-field min-h-[80px]"
                        value={brief.milestones}
                        onChange={(e) => handleChange("milestones", e.target.value)}
                        placeholder="Contoh: Draft pertama sebelum 20 Juli, final sebelum 31 Juli untuk launch event..."
                      />
                    )}
                  </FieldItem>
                )}
              </SectionCard>
            )}

            {/* ── Step 7 — Review ───────────────────────────────────────── */}
            {currentStep === 7 && (
              <ReviewStep
                brief={brief}
                onEditStep={jumpToStep}
                confirmed={reviewConfirmed}
                onConfirmChange={setReviewConfirmed}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Submit error */}
        {submitError && currentStep === TOTAL_STEPS && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-sm text-destructive"
          >
            Gagal mengirim brief: {submitError}. Jawaban Anda tetap tersimpan — silakan coba lagi.
          </motion.div>
        )}

        {/* Desktop navigation */}
        <div className="hidden md:flex items-center justify-between mt-6">
          <NavButtons
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            isSaving={isSaving || saveBrief.isPending}
            reviewConfirmed={reviewConfirmed}
            onBack={handleBack}
            onNext={handleNext}
            onSubmit={handleSubmit}
          />
        </div>
      </div>

      {/* Sticky mobile action bar */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border p-3 flex items-center justify-between gap-3">
        <NavButtons
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          isSaving={isSaving || saveBrief.isPending}
          reviewConfirmed={reviewConfirmed}
          onBack={handleBack}
          onNext={handleNext}
          onSubmit={handleSubmit}
        />
      </div>
    </Layout>
  );
}

// ── MultiSelectChips ──────────────────────────────────────────────────────────
// Local wrapper: renders MultiChoiceChip with optional counter + hint

function MultiSelectChips({
  options, selected, onChange, max, error, hint,
}: {
  options: { value: string; label: string; description?: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
  error?: boolean;
  hint?: string;
}) {
  return (
    <div>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <MultiChoiceChip
        options={options}
        value={selected}
        onChange={onChange}
        max={max}
        aria-invalid={error}
      />
      {max && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {selected.length} dari maks. {max} dipilih
        </p>
      )}
    </div>
  );
}

// ── Navigation buttons ────────────────────────────────────────────────────────

function NavButtons({
  currentStep, totalSteps, isSaving, reviewConfirmed, onBack, onNext, onSubmit,
}: {
  currentStep: number; totalSteps: number; isSaving: boolean; reviewConfirmed: boolean;
  onBack: () => void; onNext: () => void; onSubmit: () => void;
}) {
  const isReview = currentStep === totalSteps;
  return (
    <>
      <button
        onClick={onBack}
        disabled={currentStep === 1}
        className={cn(
          "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 min-h-[44px]",
          "text-muted-foreground hover:text-foreground hover:bg-surface-2",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>

      {!isReview ? (
        <motion.button
          onClick={onNext}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-xl min-h-[44px]",
            "bg-gradient-to-r from-violet-600 to-primary text-white",
            "hover:shadow-[0_0_20px_-4px_rgba(124,110,250,0.6)] transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          Lanjut <ArrowRight className="w-4 h-4" />
        </motion.button>
      ) : (
        <motion.button
          onClick={onSubmit}
          disabled={isSaving || !reviewConfirmed}
          whileHover={!isSaving && reviewConfirmed ? { scale: 1.02 } : undefined}
          whileTap={!isSaving && reviewConfirmed ? { scale: 0.98 } : undefined}
          title={!reviewConfirmed ? "Konfirmasi bahwa informasi sudah benar untuk melanjutkan" : undefined}
          className={cn(
            "inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-xl min-h-[44px]",
            "bg-gradient-to-r from-violet-600 to-primary text-white",
            "hover:shadow-[0_0_20px_-4px_rgba(124,110,250,0.6)] transition-all duration-200",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          {isSaving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
          ) : (
            <><CheckCircle2 className="w-4 h-4" /> Kirim Brief</>
          )}
        </motion.button>
      )}
    </>
  );
}

// ── Review step ───────────────────────────────────────────────────────────────

const REVIEW_SECTIONS = [
  { heading: "Bisnis",       step: 1, icon: Building2, rows: [
    { label: "Industri",     key: "companyIndustry"      as keyof BriefData },
    { label: "Ukuran",       key: "companySize"           as keyof BriefData },
    { label: "Website",      key: "websiteUrl"            as keyof BriefData },
  ]},
  { heading: "Tujuan",       step: 2, icon: Target, rows: [
    { label: "Tujuan Utama", key: "primaryGoal"           as keyof BriefData },
    { label: "Metrik",       key: "successMetrics"        as keyof BriefData },
    { label: "Aset",         key: "existingAssets"        as keyof BriefData },
  ]},
  { heading: "Audiens",      step: 3, icon: Users, rows: [
    { label: "Target",       key: "audienceDemographics"  as keyof BriefData },
    { label: "Channel",      key: "audienceChannels"      as keyof BriefData },
  ]},
  { heading: "Visual",       step: 4, icon: Palette, rows: [
    { label: "Gaya",         key: "stylePreference"       as keyof BriefData },
    { label: "Warna",        key: "colorPalette"          as keyof BriefData },
    { label: "Referensi",    key: "referenceLinks"        as keyof BriefData },
  ]},
  { heading: "Deliverables", step: 5, icon: Package, rows: [
    { label: "Format",       key: "outputFormats"         as keyof BriefData },
    { label: "Bahasa",       key: "outputLanguage"        as keyof BriefData },
  ]},
  { heading: "Timeline",     step: 6, icon: Calendar, rows: [
    { label: "Deadline",     key: "deadline"              as keyof BriefData },
    { label: "Prioritas",    key: "priority"              as keyof BriefData },
  ]},
];

function ReviewStep({
  brief, onEditStep, confirmed, onConfirmChange,
}: {
  brief: BriefData; onEditStep: (step: number) => void;
  confirmed: boolean; onConfirmChange: (v: boolean) => void;
}) {
  const sections = REVIEW_SECTIONS.map((s) => ({
    heading: s.heading, step: s.step, icon: s.icon,
    rows: s.rows
      .map((r) => ({ label: r.label, value: brief[r.key] || "" }))
      .filter((r) => r.value),
  })).filter((s) => s.rows.length > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Tinjau ringkasan brief Anda sebelum mengirim. Tim kami akan mempelajari detail ini untuk menyiapkan proposal harga yang tepat.
      </p>

      <SummaryCard sections={sections} onEditStep={onEditStep} />

      <p className="text-xs text-muted-foreground leading-relaxed">
        Draft ini tersimpan hanya di perangkat/browser Anda sampai dikirim. File yang Anda referensikan tidak dibagikan ke pihak lain di luar tim project ini.
      </p>

      <label className="flex items-start gap-3 p-4 rounded-xl border border-border/50 bg-primary/5 cursor-pointer hover:bg-primary/8 transition-colors duration-200">
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4 accent-primary shrink-0"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
        />
        <span className="text-sm text-foreground">
          Saya sudah memeriksa informasi di atas dan menyatakan sudah benar.
        </span>
      </label>
    </div>
  );
}

// ── FieldItem ─────────────────────────────────────────────────────────────────

function FieldItem({
  id, label, hint, required, optional, error, children,
}: {
  id: string; label: string; hint?: string; required?: boolean;
  optional?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <FieldTitle
        as="label"
        htmlFor={`brief-${id}`}
        required={required}
        optional={optional}
      >
        {label}
      </FieldTitle>
      {children}
      <HelperText
        id={`brief-${id}-error`}
        hint={!error ? hint : undefined}
        error={error}
      />
    </div>
  );
}
