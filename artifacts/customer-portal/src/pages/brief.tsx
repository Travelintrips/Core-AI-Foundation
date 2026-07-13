import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { AutosaveStatus, type AutosaveState } from "@/components/brief/autosave-status";
import {
  SectionCard, FieldTitle, HelperText, SuggestionGroup,
  SelectionCard, ChoiceChip, ColorPicker, ProgressStepper, SummaryCard,
} from "@/components/creative-ui";
import { useToast } from "@/hooks/use-toast";
import { useRequestDetail, useSaveBrief, useStartBrief, useServiceDetail } from "@/hooks/use-catalog";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2,
  Building2, Target, Users, Palette, Package, Calendar, ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
  deadline: "", priority: "normal", milestones: "",
};

function hasContent(brief: BriefData) {
  return Object.entries(brief).some(([key, value]) => {
    if (key === "outputLanguage" || key === "priority") return false;
    return typeof value === "string" && value.trim().length > 0;
  });
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: "Informasi Bisnis",         description: "Ceritakan sedikit tentang bisnis Anda.",              icon: Building2 },
  { id: 2, title: "Tujuan Project",           description: "Apa yang ingin Anda capai dengan project ini?",       icon: Target },
  { id: 3, title: "Target Audiens",           description: "Siapa yang akan melihat hasil karya ini?",            icon: Users },
  { id: 4, title: "Gaya Visual & Referensi",  description: "Bantu tim kami memahami arah visual yang Anda mau.", icon: Palette },
  { id: 5, title: "Deliverables",             description: "Format dan jumlah output yang Anda butuhkan.",        icon: Package },
  { id: 6, title: "Deadline",                 description: "Kapan Anda membutuhkan hasil akhirnya?",              icon: Calendar },
  { id: 7, title: "Review",                   description: "Periksa kembali sebelum mengirim ke tim kami.",       icon: ClipboardList },
];

const TOTAL_STEPS = STEPS.length;

// ── Static option data ────────────────────────────────────────────────────────

const INDUSTRY_SUGGESTIONS = ["E-commerce", "Fintech", "Kuliner & F&B", "Properti", "Kesehatan", "Edukasi"];
const GOAL_SUGGESTIONS = [
  "Meningkatkan brand awareness", "Meningkatkan konversi penjualan",
  "Memperkenalkan produk baru", "Membangun kepercayaan investor",
];
const CHANNEL_SUGGESTIONS = ["Instagram", "TikTok", "LinkedIn", "Website", "WhatsApp", "Marketplace"];

const COMPANY_SIZE_OPTIONS = [
  { value: "solo",       label: "Solo",         icon: "👤", description: "Freelancer / 1 orang" },
  { value: "startup",    label: "Startup",      icon: "🚀", description: "1–10 orang" },
  { value: "smb",        label: "UKM",          icon: "🏢", description: "10–50 orang" },
  { value: "mid",        label: "Menengah",     icon: "🏬", description: "50–200 orang" },
  { value: "enterprise", label: "Enterprise",   icon: "🏙", description: "200+ orang" },
];

const STYLE_OPTIONS = [
  { value: "modern_minimal",        label: "Modern & Minimal" },
  { value: "bold_vibrant",          label: "Bold & Vibrant" },
  { value: "elegant_luxury",        label: "Elegant & Luxury" },
  { value: "playful_fun",           label: "Playful & Fun" },
  { value: "corporate_professional",label: "Corporate & Professional" },
  { value: "natural_organic",       label: "Natural & Organic" },
  { value: "tech_futuristic",       label: "Tech & Futuristic" },
  { value: "cultural_traditional",  label: "Cultural & Traditional" },
  { value: "other",                 label: "Lainnya" },
];

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "high",   label: "Tinggi (dipercepat)" },
  { value: "urgent", label: "Urgent (24h)" },
];

const LANGUAGE_OPTIONS = [
  { value: "id",    label: "Bahasa Indonesia" },
  { value: "en",    label: "Bahasa Inggris" },
  { value: "id_en", label: "Bilingual" },
];

type FieldErrors = Partial<Record<keyof BriefData, string>>;

function validateStep(step: number, brief: BriefData): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1 && !brief.companyIndustry.trim()) errors.companyIndustry = "Industri perusahaan wajib diisi";
  if (step === 2 && !brief.primaryGoal.trim())     errors.primaryGoal = "Tujuan utama project wajib diisi";
  if (step === 3 && !brief.audienceDemographics.trim()) errors.audienceDemographics = "Deskripsi target audiens wajib diisi";
  if (step === 4 && !brief.stylePreference.trim()) errors.stylePreference = "Preferensi gaya visual wajib diisi";
  if (step === 5 && !brief.outputFormats.trim())   errors.outputFormats = "Format deliverables wajib diisi";
  if (step === 6 && !brief.deadline.trim())        errors.deadline = "Deadline wajib diisi";
  return errors;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: requestDetail, isLoading: requestLoading, isError: requestError } = useRequestDetail(requestId);
  const { data: serviceDetail } = useServiceDetail(requestDetail?.serviceId);
  const saveBrief = useSaveBrief();
  const startBrief = useStartBrief();

  const STORAGE_KEY = `brief_draft_${requestId}`;

  const startBriefFired = useRef(false);
  useEffect(() => {
    if (!requestId || requestLoading || startBriefFired.current) return;
    startBriefFired.current = true;
    if (requestDetail && requestDetail.status !== "draft") return;
    startBrief.mutate({ requestId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, requestLoading, requestDetail]);

  const [currentStep, setCurrentStep]       = useState(1);
  const [errors, setErrors]                 = useState<FieldErrors>({});
  const [brief, setBrief]                   = useState<BriefData>(EMPTY_BRIEF);
  const [isSaving, setIsSaving]             = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const [autosaveState, setAutosaveState]   = useState<AutosaveState>("idle");
  const [lastSavedAt, setLastSavedAt]       = useState<Date | null>(null);
  const [now, setNow]                       = useState(() => Date.now());

  const [pendingDraft, setPendingDraft]     = useState<BriefData | null>(null);
  const [draftChecked, setDraftChecked]     = useState(false);

  // Local state for color picker multi-select (synced to brief.colorPalette string)
  const [colorSelection, setColorSelection] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = { ...EMPTY_BRIEF, ...JSON.parse(stored) } as BriefData;
        if (hasContent(parsed)) { setPendingDraft(parsed); setDraftChecked(true); return; }
      }
    } catch { /* corrupt draft — ignore */ }
    setDraftChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleChange = (field: keyof BriefData, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => prev[field] ? { ...prev, [field]: undefined } : prev);
  };

  const handleColorChange = useCallback((selected: string[]) => {
    setColorSelection(selected);
    const label = selected.includes("none")
      ? "Tidak Ada Preferensi"
      : selected.map((v) => v.charAt(0).toUpperCase() + v.slice(1)).join(", ");
    handleChange("colorPalette", selected.length ? label : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusField = (field: keyof BriefData) => {
    document.getElementById(`brief-${field}`)?.focus();
  };

  const handleNext = () => {
    const stepErrors = validateStep(currentStep, brief);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      const firstField = Object.keys(stepErrors)[0] as keyof BriefData;
      focusField(firstField);
      toast({ title: "Lengkapi field yang wajib diisi", description: Object.values(stepErrors)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBack = () => {
    setErrors({});
    setCurrentStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jumpToStep = (step: number) => {
    setErrors({});
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

  const continueDraft = () => {
    if (pendingDraft) { setBrief(pendingDraft); setColorSelection([]); }
    setPendingDraft(null);
  };

  const startOver = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setBrief(EMPTY_BRIEF);
    setColorSelection([]);
    setPendingDraft(null);
  };

  const servicePackage = useMemo(
    () => serviceDetail?.packages.find((p) => p.id === requestDetail?.packageId) ?? null,
    [serviceDetail, requestDetail],
  );

  // ── Loading ────────────────────────────────────────────────────────────────

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

  // ── Draft restore prompt ───────────────────────────────────────────────────

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
      {/* Flow progress (top bar — overall order flow) */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep="brief" />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-10 pb-28 md:pb-12 max-w-3xl">

        {/* ── Wizard header ─────────────────────────────────────────────────── */}
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

          {/* ── Modern progress stepper (internal brief steps) ── */}
          <ProgressStepper
            steps={STEPS}
            currentStep={currentStep}
            estimatedMinutes={5}
          />
        </div>

        {/* ── Step content ──────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Step 1 — Business Info */}
            {currentStep === 1 && (
              <SectionCard icon={Building2} title="Informasi Bisnis" description="Ceritakan sedikit tentang bisnis Anda.">
                <FieldItem id="companyIndustry" label="Apa industri bisnis Anda?" required hint="Contoh: E-commerce, Fintech, Kuliner, Properti" error={errors.companyIndustry}>
                  <input
                    id="brief-companyIndustry"
                    className="input-field"
                    value={brief.companyIndustry}
                    onChange={(e) => handleChange("companyIndustry", e.target.value)}
                    placeholder="Masukkan industri perusahaan Anda"
                    aria-invalid={!!errors.companyIndustry}
                    aria-describedby={errors.companyIndustry ? "brief-companyIndustry-error" : undefined}
                    autoComplete="organization"
                  />
                  <SuggestionGroup
                    options={INDUSTRY_SUGGESTIONS}
                    onSelect={(v) => handleChange("companyIndustry", v)}
                  />
                </FieldItem>

                <FieldItem id="companySize" label="Berapa ukuran perusahaan Anda?" optional hint="Pilih yang paling sesuai">
                  <SelectionCard
                    options={COMPANY_SIZE_OPTIONS}
                    value={brief.companySize}
                    onChange={(v) => handleChange("companySize", v)}
                    columns={5}
                  />
                </FieldItem>

                <FieldItem id="websiteUrl" label="Punya website atau media sosial?" optional hint="URL profil bisnis yang sudah ada">
                  <input
                    id="brief-websiteUrl"
                    className="input-field"
                    type="url"
                    value={brief.websiteUrl}
                    onChange={(e) => handleChange("websiteUrl", e.target.value)}
                    placeholder="https://..."
                    autoComplete="url"
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 2 — Project Goals */}
            {currentStep === 2 && (
              <SectionCard icon={Target} title="Tujuan Project" description="Apa yang ingin Anda capai dengan project ini?">
                <FieldItem id="primaryGoal" label="Apa tujuan utama project ini?" required hint="Contoh: meningkatkan brand awareness, memperkenalkan produk baru." error={errors.primaryGoal}>
                  <textarea
                    id="brief-primaryGoal"
                    className="input-field min-h-[100px]"
                    value={brief.primaryGoal}
                    onChange={(e) => handleChange("primaryGoal", e.target.value)}
                    placeholder="Contoh: Meningkatkan brand awareness, memperkenalkan produk baru, meningkatkan konversi penjualan..."
                    aria-invalid={!!errors.primaryGoal}
                    aria-describedby={errors.primaryGoal ? "brief-primaryGoal-error" : undefined}
                  />
                  <SuggestionGroup
                    options={GOAL_SUGGESTIONS}
                    onSelect={(v) => handleChange("primaryGoal", brief.primaryGoal ? `${brief.primaryGoal}. ${v}` : v)}
                  />
                </FieldItem>

                <FieldItem id="successMetrics" label="Bagaimana Anda mengukur kesuksesan project ini?" optional>
                  <textarea
                    id="brief-successMetrics"
                    className="input-field min-h-[80px]"
                    value={brief.successMetrics}
                    onChange={(e) => handleChange("successMetrics", e.target.value)}
                    placeholder="Contoh: 1000 engagement dalam 7 hari, 10% peningkatan click-through rate..."
                  />
                </FieldItem>

                <FieldItem id="existingAssets" label="Apakah Anda sudah punya materi yang bisa kami gunakan?" optional hint="Logo, foto, brand guideline, dll — tulis 'tidak ada' bila belum punya">
                  <textarea
                    id="brief-existingAssets"
                    className="input-field min-h-[80px]"
                    value={brief.existingAssets}
                    onChange={(e) => handleChange("existingAssets", e.target.value)}
                    placeholder="Sebutkan aset yang dimiliki atau tulis 'tidak ada'"
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 3 — Target Audience */}
            {currentStep === 3 && (
              <SectionCard icon={Users} title="Target Audiens" description="Siapa yang akan melihat hasil karya ini?">
                <FieldItem id="audienceDemographics" label="Siapa target utama proyek ini?" required hint="Contoh: pemilik bisnis F&B usia 25–40 tahun di Jakarta." error={errors.audienceDemographics}>
                  <textarea
                    id="brief-audienceDemographics"
                    className="input-field min-h-[100px]"
                    value={brief.audienceDemographics}
                    onChange={(e) => handleChange("audienceDemographics", e.target.value)}
                    placeholder="Contoh: Wanita 25–35 tahun, profesional urban, penghasilan Rp 5–15 juta/bulan..."
                    aria-invalid={!!errors.audienceDemographics}
                    aria-describedby={errors.audienceDemographics ? "brief-audienceDemographics-error" : undefined}
                  />
                </FieldItem>

                <FieldItem id="audiencePainPoints" label="Masalah apa yang ingin diselesaikan untuk audiens ini?" optional>
                  <textarea
                    id="brief-audiencePainPoints"
                    className="input-field min-h-[80px]"
                    value={brief.audiencePainPoints}
                    onChange={(e) => handleChange("audiencePainPoints", e.target.value)}
                    placeholder="Contoh: Kesulitan menemukan produk berkualitas dengan harga terjangkau..."
                  />
                </FieldItem>

                <FieldItem id="audienceChannels" label="Di mana audiens Anda biasanya berada?" optional hint="Platform / channel utama">
                  <input
                    id="brief-audienceChannels"
                    className="input-field"
                    value={brief.audienceChannels}
                    onChange={(e) => handleChange("audienceChannels", e.target.value)}
                    placeholder="Contoh: Instagram, TikTok, LinkedIn, Website, WhatsApp..."
                  />
                  <SuggestionGroup
                    label="Platform populer"
                    options={CHANNEL_SUGGESTIONS}
                    onSelect={(v) => {
                      const parts = brief.audienceChannels.split(",").map((p) => p.trim()).filter(Boolean);
                      if (!parts.includes(v)) parts.push(v);
                      handleChange("audienceChannels", parts.join(", "));
                    }}
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 4 — Visual Style */}
            {currentStep === 4 && (
              <SectionCard icon={Palette} title="Gaya Visual & Referensi" description="Bantu tim kami memahami arah visual yang Anda mau.">
                <FieldItem id="stylePreference" label="Gaya visual seperti apa yang Anda inginkan?" required error={errors.stylePreference}>
                  <ChoiceChip
                    options={STYLE_OPTIONS}
                    value={brief.stylePreference}
                    onChange={(v) => handleChange("stylePreference", v)}
                  />
                  {errors.stylePreference && (
                    <p id="brief-stylePreference-error" role="alert" className="sr-only">{errors.stylePreference}</p>
                  )}
                </FieldItem>

                <FieldItem id="colorPalette" label="Ada warna brand yang sudah Anda pakai?" optional hint="Pilih dari preset atau ketik warna / kode hex Anda">
                  <ColorPicker
                    value={colorSelection}
                    onChange={handleColorChange}
                  />
                  <input
                    id="brief-colorPalette"
                    className="input-field mt-3"
                    value={brief.colorPalette}
                    onChange={(e) => { handleChange("colorPalette", e.target.value); setColorSelection([]); }}
                    placeholder="Atau ketik warna brand: Biru dan putih, atau #1A73E8..."
                  />
                </FieldItem>

                <FieldItem id="referenceLinks" label="Punya contoh desain yang Anda suka?" optional hint="Tempel link — opsional, tapi sangat membantu">
                  <textarea
                    id="brief-referenceLinks"
                    className="input-field min-h-[80px]"
                    value={brief.referenceLinks}
                    onChange={(e) => handleChange("referenceLinks", e.target.value)}
                    placeholder="Tempelkan link contoh desain, iklan kompetitor, atau inspirasi visual..."
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 5 — Deliverables */}
            {currentStep === 5 && (
              <SectionCard icon={Package} title="Deliverables" description="Format dan jumlah output yang Anda butuhkan.">
                <FieldItem id="outputFormats" label="Format output apa yang Anda butuhkan?" required error={errors.outputFormats}>
                  <textarea
                    id="brief-outputFormats"
                    className="input-field min-h-[100px]"
                    value={brief.outputFormats}
                    onChange={(e) => handleChange("outputFormats", e.target.value)}
                    placeholder="Contoh: 3 variasi konten Instagram (1:1 + Story), 1 banner website (1200x628), PDF katalog 4 halaman..."
                    aria-invalid={!!errors.outputFormats}
                    aria-describedby={errors.outputFormats ? "brief-outputFormats-error" : undefined}
                  />
                </FieldItem>

                <FieldItem id="outputLanguage" label="Bahasa apa yang digunakan dalam konten?" optional>
                  <ChoiceChip
                    options={LANGUAGE_OPTIONS}
                    value={brief.outputLanguage}
                    onChange={(v) => handleChange("outputLanguage", v)}
                  />
                </FieldItem>

                <FieldItem id="specialRequirements" label="Ada hal khusus yang perlu kami perhatikan?" optional>
                  <textarea
                    id="brief-specialRequirements"
                    className="input-field min-h-[80px]"
                    value={brief.specialRequirements}
                    onChange={(e) => handleChange("specialRequirements", e.target.value)}
                    placeholder="Contoh: Jangan gunakan gambar manusia, harus ada tagline tertentu, format harus editable..."
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 6 — Timeline */}
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

                <FieldItem id="priority" label="Seberapa mendesak project ini?" optional>
                  <ChoiceChip
                    options={PRIORITY_OPTIONS}
                    value={brief.priority}
                    onChange={(v) => handleChange("priority", v)}
                  />
                  {brief.priority === "urgent" && (
                    <p className="text-xs text-amber-500 mt-2 flex items-center gap-1.5">
                      ⚡ Permintaan urgent dapat memengaruhi biaya tambahan (rush fee) pada penawaran harga.
                    </p>
                  )}
                </FieldItem>

                <FieldItem id="milestones" label="Ada tanggal penting lain yang perlu diperhatikan?" optional>
                  <textarea
                    id="brief-milestones"
                    className="input-field min-h-[80px]"
                    value={brief.milestones}
                    onChange={(e) => handleChange("milestones", e.target.value)}
                    placeholder="Contoh: Draft pertama dibutuhkan sebelum 20 Juli, final sebelum 31 Juli untuk launch event..."
                  />
                </FieldItem>
              </SectionCard>
            )}

            {/* Step 7 — Review */}
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
  { heading: "Bisnis",      step: 1, icon: Building2, rows: [
    { label: "Industri",     key: "companyIndustry" as keyof BriefData },
    { label: "Ukuran",       key: "companySize"     as keyof BriefData },
    { label: "Website",      key: "websiteUrl"      as keyof BriefData },
  ]},
  { heading: "Tujuan",      step: 2, icon: Target, rows: [
    { label: "Tujuan Utama", key: "primaryGoal"     as keyof BriefData },
    { label: "Metrik",       key: "successMetrics"  as keyof BriefData },
  ]},
  { heading: "Audiens",     step: 3, icon: Users, rows: [
    { label: "Target",       key: "audienceDemographics" as keyof BriefData },
    { label: "Channel",      key: "audienceChannels"     as keyof BriefData },
  ]},
  { heading: "Visual",      step: 4, icon: Palette, rows: [
    { label: "Gaya",         key: "stylePreference" as keyof BriefData },
    { label: "Warna",        key: "colorPalette"    as keyof BriefData },
  ]},
  { heading: "Deliverables",step: 5, icon: Package, rows: [
    { label: "Format Output",key: "outputFormats"   as keyof BriefData },
    { label: "Bahasa",       key: "outputLanguage"  as keyof BriefData },
  ]},
  { heading: "Timeline",    step: 6, icon: Calendar, rows: [
    { label: "Deadline",     key: "deadline"        as keyof BriefData },
    { label: "Prioritas",    key: "priority"        as keyof BriefData },
  ]},
];

function ReviewStep({
  brief, onEditStep, confirmed, onConfirmChange,
}: {
  brief: BriefData; onEditStep: (step: number) => void; confirmed: boolean; onConfirmChange: (v: boolean) => void;
}) {
  const sections = REVIEW_SECTIONS.map((s) => ({
    heading: s.heading,
    step: s.step,
    icon: s.icon,
    rows: s.rows.map((r) => ({
      label: r.label,
      value: brief[r.key] || "",
    })),
  }));

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
