import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { AutosaveStatus, type AutosaveState } from "@/components/brief/autosave-status";
import {
  SectionCard, FieldTitle, HelperText, SuggestionGroup,
  SelectionCard, ChoiceChip, ColorPicker, ProgressStepper, SummaryCard,
  TagSelector, CpAssetUploader,
} from "@/components/creative-ui";
import { MultiChoiceChip } from "@/components/creative-ui/ChoiceChip";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import { useToast } from "@/hooks/use-toast";
import { useRequestDetail, useSaveBrief, useStartBrief, useServiceDetail } from "@/hooks/use-catalog";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, AlertCircle,
  Building2, Target, Users, Palette, Package, Calendar, ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  serializeChoices, parseChoices, serializeSingleChoice, parseSingleChoice,
  serializeColors, parseColors, normalizeLegacyPriority, hasAnySelection,
} from "@/lib/brief-utils";
import { detectServiceType, getServiceConfig } from "@/config/brief-service-config";
import {
  INDUSTRY_OPTIONS, INDUSTRY_QUICK_VALUES, COMPANY_SIZE_OPTIONS,
  GOAL_OPTIONS, METRIC_OPTIONS, ASSET_OPTIONS, AUDIENCE_OPTIONS,
  CHANNEL_OPTIONS, STYLE_OPTIONS, PRIORITY_OPTIONS, LANGUAGE_OPTIONS,
  // Fashion Design Specialist options
  FASHION_STYLE_OPTIONS, FASHION_GARMENT_OPTIONS, FASHION_GENDER_OPTIONS,
  FASHION_SEASON_OPTIONS, FASHION_PRICEPOINT_OPTIONS,
  // Interior Design Specialist options
  INTERIOR_STYLE_OPTIONS, INTERIOR_ROOM_OPTIONS, INTERIOR_PROJECT_OPTIONS,
  INTERIOR_MATERIAL_OPTIONS, INTERIOR_BUDGET_OPTIONS,
} from "@/config/brief-options";
import { BriefRecommendationPanel } from "@/features/brief-intelligence";
import { STYLE_MAX, COLOR_MAX, AUDIENCE_MAX } from "@/features/brief-intelligence/apply-adapter";
import { BriefAssistantLauncher, BriefAssistantPanel } from "@/features/brief-assistant";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BriefData = {
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
  // Fashion Design fields — namespaced `fd*`, only rendered for fashion_design service
  fdFashionSegment: string;    // luxury | streetwear | modest_fashion | casual | sportswear | workwear | kidswear | bridal
  fdCollectionType: string;    // ready_to_wear | capsule | seasonal | limited_edition | custom_order
  fdTargetGender: string;      // women | men | unisex | kids
  fdSeason: string;            // ss25 | fw25 | resort | holiday | all_season
  fdPricePoint: string;        // mass_market | mid_range | premium | luxury
  fdColorDirection: string;    // free text
  fdFabricPreference: string;  // free text
  fdNumberOfLooks: string;     // free text
  // Interior Design fields — namespaced `int*`, only rendered for interior_design service
  intSpaceType: string;        // residential | commercial | hospitality | retail | office | restaurant | cafe
  intRoomTypes: string;        // free text, e.g. "living room, master bedroom"
  intTotalArea: string;        // sqm
  intDesignStyle: string;      // japandi | scandinavian | industrial | tropical_modern | mid_century | luxury_classic | minimalist | bohemian
  intBudgetTier: string;       // basic | standard | premium | luxury
  intMoodGoal: string;         // free text
  intExistingElements: string; // free text
  intMustHaveFeatures: string; // free text
  intAvoidElements: string;    // free text
  // Company Profile sprint (P0) — extra fields, only rendered/required when
  // the service is Company Profile. Namespaced `cp*` so they never collide
  // with the generic fields above or with any other service's brief data.
  cpLegalName: string;
  cpBusinessTypeDetail: string;
  cpYearEstablished: string;
  cpCompanyHistory: string;
  cpVision: string;
  cpMission: string;
  cpCompanyValues: string;
  cpValueProposition: string;
  cpProductsServices: string;
  cpGeographicCoverage: string;
  cpFacilities: string;
  cpProductionCapacity: string;
  cpCertifications: string;
  cpLegalDocuments: string;
  cpOrganizationStructure: string;
  cpKeyPeople: string;
  cpClientsPartners: string;
  cpProjectExperience: string;
  cpQualityAssurance: string;
  cpSustainability: string;
  cpPageTarget: string;
  cpUploadedLogo: string;
  cpUploadedPhotos: string;
  cpReferenceDocuments: string;
  cpVideo: string;
  cpContactEmail: string;
  cpContactPhone: string;
  cpContactAddress: string;
  cpContactWebsite: string;
  // Fashion Design Specialist (extended) — namespaced `fd*` to avoid collision
  fdCollectionName: string;
  fdSeasonCollection: string;
  fdGarmentTypes: string;
  // fdTargetGender and fdPricePoint declared above (lines 71/73) — no duplicate
  fdFashionStyle: string;
  fdMoodBoardRef: string;
  fdBrandPersonality: string;
  // Interior Design Specialist — namespaced `id*`
  idRoomTypes: string;
  idProjectType: string;
  idInteriorStyle: string;
  idMaterialPreference: string;
  idBudgetRange: string;
  idTechnicalSpecs: string;
  idFurnishingScope: string;
};

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
  fdFashionSegment: "", fdCollectionType: "", fdTargetGender: "",
  fdSeason: "", fdPricePoint: "", fdColorDirection: "",
  fdFabricPreference: "", fdNumberOfLooks: "",
  intSpaceType: "", intRoomTypes: "", intTotalArea: "",
  intDesignStyle: "", intBudgetTier: "", intMoodGoal: "",
  intExistingElements: "", intMustHaveFeatures: "", intAvoidElements: "",
  cpLegalName: "", cpBusinessTypeDetail: "", cpYearEstablished: "",
  cpCompanyHistory: "", cpVision: "", cpMission: "", cpCompanyValues: "",
  cpValueProposition: "", cpProductsServices: "", cpGeographicCoverage: "",
  cpFacilities: "", cpProductionCapacity: "", cpCertifications: "",
  cpLegalDocuments: "", cpOrganizationStructure: "", cpKeyPeople: "",
  cpClientsPartners: "", cpProjectExperience: "", cpQualityAssurance: "",
  cpSustainability: "", cpPageTarget: "", cpUploadedLogo: "",
  cpUploadedPhotos: "", cpReferenceDocuments: "", cpVideo: "", cpContactEmail: "",
  cpContactPhone: "", cpContactAddress: "", cpContactWebsite: "",
  // Fashion Design Specialist (extended fields — fdTargetGender/fdPricePoint already set above)
  fdCollectionName: "", fdSeasonCollection: "", fdGarmentTypes: "",
  fdFashionStyle: "",
  fdMoodBoardRef: "", fdBrandPersonality: "",
  // Interior Design Specialist
  idRoomTypes: "", idProjectType: "", idInteriorStyle: "",
  idMaterialPreference: "", idBudgetRange: "", idTechnicalSpecs: "",
  idFurnishingScope: "",
};

/** Free-text industry/business-type matchers for the 5 conditional question
 *  groups (mirrors artifacts/api-server/src/services/companyProfileBriefIntelligence.ts —
 *  keep both in sync if the groups change). */
const CP_INDUSTRY_GROUPS: { key: string; label: string; needles: string[]; fields: { key: keyof BriefData; label: string }[] }[] = [
  {
    key: "logistics", label: "Logistik",
    needles: ["logistik", "logistics", "freight", "shipping", "ekspedisi", "warehousing"],
    fields: [
      { key: "cpFacilities", label: "Armada & gudang yang dimiliki" },
    ],
  },
  {
    key: "trading", label: "Trading / Ekspor-Impor",
    needles: ["trading", "export", "import", "ekspor", "impor", "perdagangan"],
    fields: [
      { key: "cpGeographicCoverage", label: "Negara asal & tujuan komoditas" },
    ],
  },
  {
    key: "manufacturing", label: "Manufaktur",
    needles: ["manufaktur", "manufacturing", "pabrik", "factory", "produksi", "industri"],
    fields: [
      { key: "cpProductionCapacity", label: "Kapasitas produksi & mesin utama" },
    ],
  },
  {
    key: "professional", label: "Jasa Profesional",
    needles: ["konsultan", "consulting", "jasa profesional", "professional_svcs", "hukum", "akuntansi"],
    fields: [
      { key: "cpQualityAssurance", label: "Metodologi kerja & pengalaman kasus" },
    ],
  },
  {
    key: "medical", label: "Kesehatan / Medis",
    needles: ["kesehatan", "healthcare", "klinik", "clinic", "rumah sakit", "hospital", "medical"],
    fields: [
      { key: "cpLegalDocuments", label: "Izin praktik & lisensi" },
    ],
  },
];

function resolveCpIndustryGroup(industryText: string): (typeof CP_INDUSTRY_GROUPS)[number] | null {
  const normalized = industryText.toLowerCase();
  if (!normalized) return null;
  return CP_INDUSTRY_GROUPS.find((g) => g.needles.some((n) => normalized.includes(n))) ?? null;
}

/** Lightweight client-side mirror of the server's readiness check — used only
 *  for live UX in the wizard. The server (companyProfileBriefIntelligence.ts)
 *  is the authoritative gate at checkout/conversion. */
function getCompanyProfileMissingFields(brief: BriefData): string[] {
  const missing: string[] = [];
  if (!brief.cpLegalName.trim()) missing.push("Nama resmi perusahaan");
  if (!brief.companyIndustry.trim() && !brief.cpBusinessTypeDetail.trim()) missing.push("Jenis bisnis");
  if (!brief.cpCompanyHistory.trim() && !brief.cpVision.trim() && !brief.cpMission.trim())
    missing.push("Sejarah, visi, atau misi perusahaan (minimal salah satu)");
  if (!brief.cpValueProposition.trim()) missing.push("Value proposition");
  if (!brief.cpProductsServices.trim()) missing.push("Produk/jasa yang ditawarkan");
  if (!brief.cpContactEmail.trim() && !brief.cpContactPhone.trim()) missing.push("Email atau nomor telepon kontak");
  return missing;
}

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


// ── Validation ────────────────────────────────────────────────────────────────

type FieldErrors = Partial<Record<keyof BriefData, string>>;

function validateStep(step: number, brief: BriefData, isCP = false): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1) {
    const ind = brief.companyIndustry.trim();
    if (!ind || ind === "Lainnya")
      errors.companyIndustry = "Pilih atau tuliskan industri bisnis Anda sebelum melanjutkan";
    if (isCP && !brief.cpLegalName.trim())
      errors.cpLegalName = "Nama resmi perusahaan wajib diisi";
    if (isCP && !brief.cpContactEmail.trim() && !brief.cpContactPhone.trim())
      errors.cpContactEmail = "Minimal email atau nomor telepon kontak wajib diisi";
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
  const serviceType = useMemo(
    () => detectServiceType(serviceDetail?.serviceName),
    [serviceDetail?.serviceName],
  );
  const serviceConfig = useMemo(
    () => getServiceConfig(serviceType),
    [serviceType],
  );
  const isCompanyProfile  = serviceType === "company_profile";
  const isFashionDesign   = serviceType === "fashion_design";
  const isInteriorDesign  = serviceType === "interior_design";

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

  // CP — resolved industry group for conditional questions (mirrors backend logic)
  // Must be declared AFTER `brief` useState to avoid temporal dead zone error.
  const cpIndustryGroup = useMemo(
    () => isCompanyProfile
      ? resolveCpIndustryGroup(brief.cpBusinessTypeDetail || brief.companyIndustry)
      : null,
    [isCompanyProfile, brief.cpBusinessTypeDetail, brief.companyIndustry],
  );

  const [assistantOpen, setAssistantOpen]     = useState(false);
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

  // Whether we've already merged the server-saved brief (briefJson) into
  // local state once. Prevents a previously-submitted brief from being
  // silently discarded on reload, while never clobbering in-progress edits.
  const serverBriefHydrated = useRef(false);

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

  // ── Server brief hydration ──────────────────────────────────────────────────
  // If there's no local (unsynced) draft to restore, load the brief the
  // customer already saved on the server (e.g. returning on a new device,
  // after clearing browser storage, or once a local draft has expired).
  // Runs once; never overwrites a draft the user is actively restoring/editing.
  useEffect(() => {
    if (!draftChecked || pendingDraft || serverBriefHydrated.current) return;
    if (!requestDetail?.briefJson) return;
    const fromServer = { ...EMPTY_BRIEF, ...requestDetail.briefJson } as BriefData;
    fromServer.priority = normalizeLegacyPriority(fromServer.priority);
    serverBriefHydrated.current = true;
    if (hasContent(fromServer)) setBrief(fromServer);
  }, [draftChecked, pendingDraft, requestDetail]);

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
  // Pick the right style option list based on service type
  const activeStyleOptions = useMemo(() => {
    if (isFashionDesign)  return FASHION_STYLE_OPTIONS;
    if (isInteriorDesign) return INTERIOR_STYLE_OPTIONS;
    return STYLE_OPTIONS;
  }, [isFashionDesign, isInteriorDesign]);

  const styleParsed = useMemo(() => parseChoices(brief.stylePreference, activeStyleOptions), [brief.stylePreference, activeStyleOptions]);

  const handleStyleChange = useCallback((newSelected: string[]) => {
    const hadUnsure = styleParsed.selected.includes("unsure");
    const hasUnsure = newSelected.includes("unsure");
    let final = newSelected;
    if (!hadUnsure && hasUnsure) final = ["unsure"];
    else if (hadUnsure && newSelected.length > 1) final = newSelected.filter((v) => v !== "unsure");
    const serialized = serializeChoices(final, activeStyleOptions, styleParsed.custom);
    handleChange("stylePreference", serialized);
  }, [handleChange, styleParsed, activeStyleOptions]);

  const handleStyleCustom = useCallback((text: string) => {
    const serialized = serializeChoices(styleParsed.selected, activeStyleOptions, text);
    handleChange("stylePreference", serialized);
  }, [handleChange, styleParsed.selected, activeStyleOptions]);

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
    const stepErrors = validateStep(currentStep, brief, isCompanyProfile);
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
    // "Start over" discards the unsynced local draft, not data already saved
    // on the server — fall back to the last server-saved brief, if any.
    const fromServer = requestDetail?.briefJson
      ? ({ ...EMPTY_BRIEF, ...requestDetail.briefJson } as BriefData)
      : EMPTY_BRIEF;
    fromServer.priority = normalizeLegacyPriority(fromServer.priority);
    serverBriefHydrated.current = true;
    setBrief(fromServer);
    setPendingDraft(null);
  }, [STORAGE_KEY, requestDetail]);

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

                {/* ── Fashion Design Specialist — Collection Info ───────── */}
                {isFashionDesign && (
                  <>
                    <FieldItem id="fdCollectionName" label="Nama koleksi atau project fashion" optional hint="Bisa berupa nama koleksi, nama kampanye, atau nama brand">
                      <input
                        id="brief-fdCollectionName"
                        className="input-field"
                        value={brief.fdCollectionName}
                        onChange={(e) => handleChange("fdCollectionName", e.target.value)}
                        placeholder="Contoh: 'Nusantara Noir SS25' atau 'Koleksi Ramadan'"
                      />
                    </FieldItem>
                    <FieldItem id="fdSeasonCollection" label="Season atau momentum koleksi" optional>
                      <ChoiceChip
                        options={FASHION_SEASON_OPTIONS}
                        value={brief.fdSeasonCollection}
                        onChange={(v) => handleChange("fdSeasonCollection", v)}
                      />
                    </FieldItem>
                    <FieldItem id="fdGarmentTypes" label="Tipe garmen atau produk dalam koleksi" optional hint="Pilih semua yang relevan">
                      <MultiSelectChips
                        options={FASHION_GARMENT_OPTIONS}
                        selected={parseChoices(brief.fdGarmentTypes, FASHION_GARMENT_OPTIONS).selected}
                        onChange={(v) => handleChange("fdGarmentTypes", serializeChoices(v, FASHION_GARMENT_OPTIONS, ""))}
                        max={6}
                      />
                    </FieldItem>
                    <FieldItem id="fdTargetGender" label="Target gender / segmen pembeli" optional>
                      <ChoiceChip
                        options={FASHION_GENDER_OPTIONS}
                        value={brief.fdTargetGender}
                        onChange={(v) => handleChange("fdTargetGender", v)}
                      />
                    </FieldItem>
                    <FieldItem id="fdPricePoint" label="Price point koleksi" optional hint="Segmen harga per produk">
                      <ChoiceChip
                        options={FASHION_PRICEPOINT_OPTIONS}
                        value={brief.fdPricePoint}
                        onChange={(v) => handleChange("fdPricePoint", v)}
                      />
                    </FieldItem>
                  </>
                )}

                {/* ── Interior Design Specialist — Project Info ─────────── */}
                {isInteriorDesign && (
                  <>
                    <FieldItem id="idProjectType" label="Jenis project interior" optional>
                      <ChoiceChip
                        options={INTERIOR_PROJECT_OPTIONS}
                        value={brief.idProjectType}
                        onChange={(v) => handleChange("idProjectType", v)}
                      />
                    </FieldItem>
                    <FieldItem id="idRoomTypes" label="Ruangan yang akan didesain" optional hint="Pilih semua yang relevan">
                      <MultiSelectChips
                        options={INTERIOR_ROOM_OPTIONS}
                        selected={parseChoices(brief.idRoomTypes, INTERIOR_ROOM_OPTIONS).selected}
                        onChange={(v) => handleChange("idRoomTypes", serializeChoices(v, INTERIOR_ROOM_OPTIONS, ""))}
                        max={8}
                      />
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Beberapa ruangan akan diproses sebagai satu kesatuan properti.
                        Sistem akan menyelaraskan alur ruang, material, warna, plafon,
                        dan pencahayaan agar hasilnya terasa seperti satu rumah.
                      </p>
                    </FieldItem>
                    <FieldItem id="idBudgetRange" label="Estimasi budget total proyek" optional>
                      <ChoiceChip
                        options={INTERIOR_BUDGET_OPTIONS}
                        value={brief.idBudgetRange}
                        onChange={(v) => handleChange("idBudgetRange", v)}
                      />
                    </FieldItem>
                  </>
                )}

                {/* ── Company Profile — Identity & Contact ──────────────── */}
                {isCompanyProfile && (
                  <>
                    <FieldItem id="cpLegalName" label="Nama resmi perusahaan (sesuai akta)" required error={errors.cpLegalName}>
                      <input
                        id="brief-cpLegalName"
                        className="input-field"
                        value={brief.cpLegalName}
                        onChange={(e) => handleChange("cpLegalName", e.target.value)}
                        placeholder="Contoh: PT Maju Bersama Indonesia"
                        aria-invalid={!!errors.cpLegalName}
                      />
                    </FieldItem>

                    <FieldItem id="cpBusinessTypeDetail" label="Jenis & bidang usaha spesifik" optional hint="Contoh: Distributor produk FMCG, Manufaktur komponen otomotif">
                      <input
                        id="brief-cpBusinessTypeDetail"
                        className="input-field"
                        value={brief.cpBusinessTypeDetail}
                        onChange={(e) => handleChange("cpBusinessTypeDetail", e.target.value)}
                        placeholder="Jelaskan bidang usaha secara lebih spesifik"
                      />
                    </FieldItem>

                    <FieldItem id="cpYearEstablished" label="Tahun berdiri" optional>
                      <input
                        id="brief-cpYearEstablished"
                        className="input-field"
                        type="number"
                        min={1900}
                        max={new Date().getFullYear()}
                        value={brief.cpYearEstablished}
                        onChange={(e) => handleChange("cpYearEstablished", e.target.value)}
                        placeholder="Contoh: 2010"
                      />
                    </FieldItem>

                    <FieldItem id="cpContactEmail" label="Email kontak utama perusahaan" required={!brief.cpContactPhone.trim()} error={errors.cpContactEmail} hint="Email atau nomor telepon minimal salah satu wajib diisi">
                      <input
                        id="brief-cpContactEmail"
                        className="input-field"
                        type="email"
                        value={brief.cpContactEmail}
                        onChange={(e) => handleChange("cpContactEmail", e.target.value)}
                        placeholder="info@perusahaan.co.id"
                        aria-invalid={!!errors.cpContactEmail}
                      />
                    </FieldItem>

                    <FieldItem id="cpContactPhone" label="Nomor telepon / WhatsApp" optional>
                      <input
                        id="brief-cpContactPhone"
                        className="input-field"
                        type="tel"
                        value={brief.cpContactPhone}
                        onChange={(e) => handleChange("cpContactPhone", e.target.value)}
                        placeholder="+62-21-123456 atau 0811-xxxx-xxxx"
                      />
                    </FieldItem>

                    <FieldItem id="cpContactAddress" label="Alamat kantor/operasional" optional>
                      <textarea
                        id="brief-cpContactAddress"
                        className="input-field min-h-[72px]"
                        value={brief.cpContactAddress}
                        onChange={(e) => handleChange("cpContactAddress", e.target.value)}
                        placeholder="Jl. Industri No. 1, Kawasan Industri Bekasi, Jawa Barat"
                      />
                    </FieldItem>

                    <FieldItem id="cpContactWebsite" label="Website / media sosial perusahaan" optional>
                      <input
                        id="brief-cpContactWebsite"
                        className="input-field"
                        type="url"
                        value={brief.cpContactWebsite}
                        onChange={(e) => handleChange("cpContactWebsite", e.target.value)}
                        placeholder="https://perusahaan.co.id atau @perusahaan"
                      />
                    </FieldItem>
                  </>
                )}
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


                {/* ── Company Profile — Narasi Perusahaan ────────────────── */}
                {isCompanyProfile && (
                  <>
                    <FieldItem id="cpValueProposition" label="Value proposition — mengapa pelanggan harus memilih Anda?" required hint="1–3 kalimat yang membedakan Anda dari kompetitor">
                      <textarea
                        id="brief-cpValueProposition"
                        className="input-field min-h-[80px]"
                        value={brief.cpValueProposition}
                        onChange={(e) => handleChange("cpValueProposition", e.target.value)}
                        placeholder="Contoh: Kami adalah satu-satunya distributor bersertifikat ISO 9001 di wilayah Sumatra dengan pengiriman 24 jam."
                      />
                    </FieldItem>

                    <FieldItem id="cpCompanyHistory" label="Sejarah singkat perusahaan" optional hint="Minimal salah satu dari sejarah, visi, atau misi wajib diisi">
                      <textarea
                        id="brief-cpCompanyHistory"
                        className="input-field min-h-[80px]"
                        value={brief.cpCompanyHistory}
                        onChange={(e) => handleChange("cpCompanyHistory", e.target.value)}
                        placeholder="Contoh: Didirikan tahun 2005 oleh Budi Santoso untuk melayani kebutuhan baja konstruksi di Jawa..."
                      />
                    </FieldItem>

                    <FieldItem id="cpVision" label="Visi perusahaan" optional>
                      <textarea
                        id="brief-cpVision"
                        className="input-field min-h-[60px]"
                        value={brief.cpVision}
                        onChange={(e) => handleChange("cpVision", e.target.value)}
                        placeholder="Contoh: Menjadi mitra logistik terpercaya di Asia Tenggara pada 2030."
                      />
                    </FieldItem>

                    <FieldItem id="cpMission" label="Misi perusahaan" optional>
                      <textarea
                        id="brief-cpMission"
                        className="input-field min-h-[60px]"
                        value={brief.cpMission}
                        onChange={(e) => handleChange("cpMission", e.target.value)}
                        placeholder="Contoh: Memberikan solusi pengiriman tepat waktu dengan teknologi tracking real-time."
                      />
                    </FieldItem>

                    <FieldItem id="cpCompanyValues" label="Nilai-nilai perusahaan (core values)" optional>
                      <input
                        id="brief-cpCompanyValues"
                        className="input-field"
                        value={brief.cpCompanyValues}
                        onChange={(e) => handleChange("cpCompanyValues", e.target.value)}
                        placeholder="Contoh: Integritas, Inovasi, Kepuasan Pelanggan"
                      />
                    </FieldItem>
                  </>
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
                    max={AUDIENCE_MAX}
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
                    options={activeStyleOptions}
                    selected={styleParsed.selected}
                    onChange={handleStyleChange}
                    max={STYLE_MAX}
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
                      max={COLOR_MAX}
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


                {/* ── Fashion Design — Mood Board & Brand Personality ───── */}
                {isFashionDesign && (
                  <>
                    <FieldItem id="fdFashionStyle" label="Referensi desainer atau brand yang Anda kagumi" optional hint="Nama desainer, brand, atau era mode yang paling mendekati arah estetika Anda">
                      <textarea
                        id="brief-fdFashionStyle"
                        className="input-field min-h-[72px]"
                        value={brief.fdFashionStyle}
                        onChange={(e) => handleChange("fdFashionStyle", e.target.value)}
                        placeholder="Contoh: Rick Owens meets Khatulistiwa, atau seperti kampanye Issey Miyake era 90s"
                      />
                    </FieldItem>
                    <FieldItem id="fdBrandPersonality" label="Kepribadian brand fashion Anda" optional hint="Gambaran brand dalam 3–5 kata atau kalimat singkat">
                      <input
                        id="brief-fdBrandPersonality"
                        className="input-field"
                        value={brief.fdBrandPersonality}
                        onChange={(e) => handleChange("fdBrandPersonality", e.target.value)}
                        placeholder="Contoh: bold, unapologetic, rooted in culture — atau: quiet luxury, earth-toned, sustainable"
                      />
                    </FieldItem>
                  </>
                )}

                {/* ── Interior Design — Material & Technical Specs ──────── */}
                {isInteriorDesign && (
                  <>
                    <FieldItem id="idMaterialPreference" label="Material atau finish yang diinginkan" optional hint="Pilih semua yang relevan">
                      <MultiSelectChips
                        options={INTERIOR_MATERIAL_OPTIONS}
                        selected={parseChoices(brief.idMaterialPreference, INTERIOR_MATERIAL_OPTIONS).selected}
                        onChange={(v) => handleChange("idMaterialPreference", serializeChoices(v, INTERIOR_MATERIAL_OPTIONS, ""))}
                        max={6}
                      />
                    </FieldItem>
                    <FieldItem id="idTechnicalSpecs" label="Spesifikasi teknis atau pantangan desain" optional hint="Ukuran ruang, keterbatasan struktural, atau hal yang tidak boleh ada">
                      <textarea
                        id="brief-idTechnicalSpecs"
                        className="input-field min-h-[72px]"
                        value={brief.idTechnicalSpecs}
                        onChange={(e) => handleChange("idTechnicalSpecs", e.target.value)}
                        placeholder="Contoh: Plafon 2,8m, tidak bisa bongkar dinding, harus child-friendly, lantai granit sudah ada"
                      />
                    </FieldItem>
                  </>
                )}

                {/* ── Company Profile — Legalitas, Kepercayaan & Aset Visual ── */}
                {isCompanyProfile && (
                  <>
                    <FieldItem id="cpCertifications" label="Sertifikasi & penghargaan" optional hint="ISO, SNI, BPOM, atau penghargaan industri lainnya">
                      <input id="brief-cpCertifications" className="input-field"
                        value={brief.cpCertifications} onChange={(e) => handleChange("cpCertifications", e.target.value)}
                        placeholder="Contoh: ISO 9001:2015, SNI, Halal MUI, PROPER Emas 2023" />
                    </FieldItem>

                    <FieldItem id="cpOrganizationStructure" label="Struktur organisasi (ringkas)" optional>
                      <textarea id="brief-cpOrganizationStructure" className="input-field min-h-[60px]"
                        value={brief.cpOrganizationStructure} onChange={(e) => handleChange("cpOrganizationStructure", e.target.value)}
                        placeholder="Contoh: CEO → 3 GM (Operasi, Keuangan, Pemasaran) → 12 Manajer" />
                    </FieldItem>

                    <FieldItem id="cpSustainability" label="Komitmen lingkungan & sosial (ESG)" optional>
                      <textarea id="brief-cpSustainability" className="input-field min-h-[60px]"
                        value={brief.cpSustainability} onChange={(e) => handleChange("cpSustainability", e.target.value)}
                        placeholder="Contoh: Panel surya 500 kWp, program CSR beasiswa 50 siswa/tahun" />
                    </FieldItem>

                    <FieldItem id="cpUploadedLogo" label="Logo perusahaan" optional hint="Unggah logo resolusi tinggi (PNG, JPG, atau SVG)">
                      <CpAssetUploader
                        value={brief.cpUploadedLogo}
                        onChange={(v) => handleChange("cpUploadedLogo", v)}
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        multiple={false}
                        maxSizeMB={5}
                        label="Unggah logo perusahaan"
                      />
                    </FieldItem>

                    <FieldItem id="cpUploadedPhotos" label="Foto gedung / produk / tim" optional hint="Unggah beberapa foto sekaligus">
                      <CpAssetUploader
                        value={brief.cpUploadedPhotos}
                        onChange={(v) => handleChange("cpUploadedPhotos", v)}
                        accept="image/*"
                        multiple
                        maxSizeMB={10}
                        label="Unggah foto gedung, produk, atau tim"
                      />
                    </FieldItem>

                    <FieldItem id="cpReferenceDocuments" label="Dokumen referensi (annual report, brosur lama, dll)" optional>
                      <CpAssetUploader
                        value={brief.cpReferenceDocuments}
                        onChange={(v) => handleChange("cpReferenceDocuments", v)}
                        accept="application/pdf,.doc,.docx"
                        multiple
                        maxSizeMB={20}
                        label="Unggah dokumen referensi"
                      />
                    </FieldItem>

                    <FieldItem id="cpVideo" label="Video profil perusahaan" optional hint="Unggah video company profile atau produk yang sudah ada (opsional, jika ada)">
                      <CpAssetUploader
                        value={brief.cpVideo}
                        onChange={(v) => handleChange("cpVideo", v)}
                        accept="video/mp4,video/quicktime,video/webm"
                        multiple={false}
                        maxSizeMB={200}
                        label="Unggah video perusahaan"
                      />
                    </FieldItem>
                  </>
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

                {/* ── Fashion Design — Output scope ─────────────────── */}
                {isFashionDesign && (
                  <FieldItem id="fdMoodBoardRef" label="Link mood board atau referensi visual" optional hint="Pinterest board, Behance, atau link gambar favorit Anda">
                    <textarea
                      id="brief-fdMoodBoardRef"
                      className="input-field min-h-[72px]"
                      value={brief.fdMoodBoardRef}
                      onChange={(e) => handleChange("fdMoodBoardRef", e.target.value)}
                      placeholder="https://pinterest.com/board/... atau deskripsi visual yang diinginkan"
                    />
                  </FieldItem>
                )}

                {/* ── Interior Design — Furnishing scope ────────────── */}
                {isInteriorDesign && (
                  <FieldItem id="idFurnishingScope" label="Lingkup pengadaan furnitur / material" optional hint="Apakah project ini termasuk rekomendasi atau pengadaan furnitur?">
                    <textarea
                      id="brief-idFurnishingScope"
                      className="input-field min-h-[72px]"
                      value={brief.idFurnishingScope}
                      onChange={(e) => handleChange("idFurnishingScope", e.target.value)}
                      placeholder="Contoh: konsep dan spec saja (tanpa pengadaan), atau termasuk rekomendasi vendor furnitur lokal"
                    />
                  </FieldItem>
                )}

                {isCompanyProfile && (
                  <FieldItem id="cpPageTarget" label="Target jumlah halaman company profile" optional hint="Estimasi panjang dokumen yang diinginkan">
                    <input
                      id="brief-cpPageTarget"
                      className="input-field"
                      type="number"
                      min={4}
                      max={100}
                      value={brief.cpPageTarget}
                      onChange={(e) => handleChange("cpPageTarget", e.target.value)}
                      placeholder="Contoh: 20 (default 16–24 halaman)"
                    />
                  </FieldItem>
                )}

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
                isCompanyProfile={isCompanyProfile}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Brief Intelligence — deterministic, rule-based recommendations */}
        {currentStep >= 2 && currentStep <= 6 && (
          <div className="mt-6">
            <BriefRecommendationPanel
              brief={brief}
              serviceName={serviceDetail?.serviceName}
              onApply={(updated) => setBrief(updated)}
            />
          </div>
        )}

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

      {/* ── Brief Assistant ───────────────────────────────────────────────── */}
      <BriefAssistantLauncher
        onOpen={() => setAssistantOpen(true)}
        disabled={!requestId}
      />
      <AnimatePresence>
        {assistantOpen && requestId && (
          <BriefAssistantPanel
            requestId={requestId}
            brief={brief}
            serviceType={serviceType}
            serviceConfig={serviceConfig}
            onBriefChange={(newBrief) => setBrief(newBrief)}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </AnimatePresence>
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
  brief, onEditStep, confirmed, onConfirmChange, isCompanyProfile,
}: {
  brief: BriefData; onEditStep: (step: number) => void;
  confirmed: boolean; onConfirmChange: (v: boolean) => void;
  isCompanyProfile?: boolean;
}) {
  const sections = REVIEW_SECTIONS.map((s) => ({
    heading: s.heading, step: s.step, icon: s.icon,
    rows: s.rows
      .map((r) => ({ label: r.label, value: brief[r.key] || "" }))
      .filter((r) => r.value),
  })).filter((s) => s.rows.length > 0);

  // ── Company Profile extra review sections ────────────────────────────────
  const cpSections: typeof sections = isCompanyProfile
    ? [
        {
          heading: "Identitas Perusahaan", step: 1, icon: Building2,
          rows: [
            { label: "Nama Resmi",     value: brief.cpLegalName },
            { label: "Jenis Usaha",    value: brief.cpBusinessTypeDetail },
            { label: "Tahun Berdiri",  value: brief.cpYearEstablished },
            { label: "Email Kontak",   value: brief.cpContactEmail },
            { label: "Telepon",        value: brief.cpContactPhone },
            { label: "Alamat",         value: brief.cpContactAddress },
            { label: "Website",        value: brief.cpContactWebsite },
          ].filter((r) => r.value),
        },
        {
          heading: "Narasi Perusahaan", step: 2, icon: Target,
          rows: [
            { label: "Value Proposition", value: brief.cpValueProposition },
            { label: "Sejarah",           value: brief.cpCompanyHistory },
            { label: "Visi",              value: brief.cpVision },
            { label: "Misi",              value: brief.cpMission },
            { label: "Core Values",       value: brief.cpCompanyValues },
          ].filter((r) => r.value),
        },
        {
          heading: "Layanan & Operasi", step: 3, icon: Users,
          rows: [
            { label: "Produk/Jasa",       value: brief.cpProductsServices },
            { label: "Cakupan Wilayah",   value: brief.cpGeographicCoverage },
            { label: "Klien Utama",       value: brief.cpClientsPartners },
            { label: "Portofolio",        value: brief.cpProjectExperience },
            { label: "Tim Kunci",         value: brief.cpKeyPeople },
            { label: "Fasilitas",         value: brief.cpFacilities },
            { label: "Kapasitas",         value: brief.cpProductionCapacity },
          ].filter((r) => r.value),
        },
        {
          heading: "Legalitas & Aset Visual", step: 4, icon: Palette,
          rows: [
            { label: "Sertifikasi",     value: brief.cpCertifications },
            { label: "Dokumen Legal",   value: brief.cpLegalDocuments },
            { label: "Org. Struktur",   value: brief.cpOrganizationStructure },
            { label: "ESG / Sustainab", value: brief.cpSustainability },
            { label: "Logo",            value: brief.cpUploadedLogo },
            { label: "Foto",            value: brief.cpUploadedPhotos },
            { label: "Dok. Referensi",  value: brief.cpReferenceDocuments },
            { label: "Video",           value: brief.cpVideo },
          ].filter((r) => r.value),
        },
        {
          heading: "Skema Dokumen", step: 5, icon: Package,
          rows: [
            { label: "Target Halaman", value: brief.cpPageTarget },
          ].filter((r) => r.value),
        },
      ].filter((s) => s.rows.length > 0)
    : [];

  // ── CP readiness check (client-side mirror of backend guard) ─────────────
  const cpMissing = isCompanyProfile ? getCompanyProfileMissingFields(brief) : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Tinjau ringkasan brief Anda sebelum mengirim. Tim kami akan mempelajari detail ini untuk menyiapkan proposal harga yang tepat.
      </p>

      {/* Company Profile readiness banner */}
      {isCompanyProfile && (
        <div className={`rounded-xl border p-4 ${cpMissing.length === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
          <div className="flex items-center gap-2 mb-1">
            {cpMissing.length === 0 ? (
              <><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Brief company profile siap untuk produksi AI</span></>
            ) : (
              <><AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Beberapa field penting belum diisi ({cpMissing.length} item)</span></>
            )}
          </div>
          {cpMissing.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {cpMissing.map((m) => (
                <li key={m} className="text-xs text-amber-600 dark:text-amber-300 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" /> {m}
                </li>
              ))}
            </ul>
          )}
          {cpMissing.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Anda tetap dapat mengirim brief ini. Tim kami akan menghubungi Anda jika ada informasi tambahan yang diperlukan.
            </p>
          )}
        </div>
      )}

      <SummaryCard sections={[...sections, ...cpSections]} onEditStep={onEditStep} />

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
