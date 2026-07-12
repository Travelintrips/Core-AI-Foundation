import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { GuidedChips } from "@/components/brief/guided-chips";
import { AutosaveStatus, type AutosaveState } from "@/components/brief/autosave-status";
import { useToast } from "@/hooks/use-toast";
import { useRequestDetail, useSaveBrief, useStartBrief, useServiceDetail } from "@/hooks/use-catalog";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Loader2,
  Building2, Target, Users, Palette, Package, Calendar, ClipboardList, Pencil,
} from "lucide-react";

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

/** True once the user has typed something meaningfully different from a fresh brief. */
function hasContent(brief: BriefData) {
  return Object.entries(brief).some(([key, value]) => {
    if (key === "outputLanguage" || key === "priority") return false;
    return typeof value === "string" && value.trim().length > 0;
  });
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: "Informasi Bisnis",         description: "Ceritakan sedikit tentang bisnis Anda.", icon: Building2,    key: "business" },
  { id: 2, title: "Tujuan Project",           description: "Apa yang ingin Anda capai dengan project ini?", icon: Target,       key: "goals" },
  { id: 3, title: "Target Audiens",           description: "Siapa yang akan melihat hasil karya ini?", icon: Users,       key: "audience" },
  { id: 4, title: "Gaya Visual & Referensi",  description: "Bantu tim kami memahami arah visual yang Anda mau.", icon: Palette,      key: "visual" },
  { id: 5, title: "Deliverables",             description: "Format dan jumlah output yang Anda butuhkan.", icon: Package,      key: "deliverables" },
  { id: 6, title: "Deadline",                 description: "Kapan Anda membutuhkan hasil akhirnya?", icon: Calendar,     key: "timeline" },
  { id: 7, title: "Review",                   description: "Periksa kembali sebelum mengirim ke tim kami.", icon: ClipboardList, key: "review" },
];

const TOTAL_STEPS = STEPS.length;

const GOAL_SUGGESTIONS = [
  "Meningkatkan brand awareness", "Meningkatkan konversi penjualan",
  "Memperkenalkan produk baru", "Membangun kepercayaan investor",
];
const CHANNEL_SUGGESTIONS = ["Instagram", "TikTok", "LinkedIn", "Website", "WhatsApp", "Marketplace"];
const INDUSTRY_SUGGESTIONS = ["E-commerce", "Fintech", "Kuliner & F&B", "Properti", "Kesehatan", "Edukasi"];

type FieldErrors = Partial<Record<keyof BriefData, string>>;

/** Field-level validation so errors can render inline and drive focus. */
function validateStep(step: number, brief: BriefData): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1 && !brief.companyIndustry.trim()) errors.companyIndustry = "Industri perusahaan wajib diisi";
  if (step === 2 && !brief.primaryGoal.trim()) errors.primaryGoal = "Tujuan utama project wajib diisi";
  if (step === 3 && !brief.audienceDemographics.trim()) errors.audienceDemographics = "Deskripsi target audiens wajib diisi";
  if (step === 4 && !brief.stylePreference.trim()) errors.stylePreference = "Preferensi gaya visual wajib diisi";
  if (step === 5 && !brief.outputFormats.trim()) errors.outputFormats = "Format deliverables wajib diisi";
  if (step === 6 && !brief.deadline.trim()) errors.deadline = "Deadline wajib diisi";
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

  // Guard startBrief so it fires at most once per mount, and never once the
  // request has already moved past "draft" (avoids redundant status writes
  // on refresh — client-side guard on top of the server-side one).
  const startBriefFired = useRef(false);
  useEffect(() => {
    if (!requestId || requestLoading || startBriefFired.current) return;
    startBriefFired.current = true;
    if (requestDetail && requestDetail.status !== "draft") return;
    startBrief.mutate({ requestId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, requestLoading, requestDetail]);

  const [currentStep, setCurrentStep] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [brief, setBrief] = useState<BriefData>(EMPTY_BRIEF);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Draft restoration prompt — never silently overwrite what's on screen.
  const [pendingDraft, setPendingDraft] = useState<BriefData | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = { ...EMPTY_BRIEF, ...JSON.parse(stored) } as BriefData;
        if (hasContent(parsed)) {
          setPendingDraft(parsed);
          setDraftChecked(true);
          return;
        }
      }
    } catch {
      // corrupt draft — ignore and start fresh
    }
    setDraftChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick every 15s so "Saved X minutes ago" stays accurate.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);

  // Autosave to localStorage, debounced, only once the draft-restore decision is made.
  useEffect(() => {
    if (!draftChecked || pendingDraft) return;
    setAutosaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(brief));
        setLastSavedAt(new Date());
        setNow(Date.now());
        setAutosaveState(navigator.onLine ? "saved" : "offline");
      } catch {
        setAutosaveState("error");
      }
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, STORAGE_KEY, draftChecked, pendingDraft]);

  useEffect(() => {
    const goOffline = () => setAutosaveState((s) => (s === "saved" ? "offline" : s));
    const goOnline = () => setAutosaveState((s) => (s === "offline" ? "saved" : s));
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Warn before an accidental tab close while there's unsaved input.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (autosaveState === "saving" || autosaveState === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [autosaveState]);

  // Focus the step heading whenever the step changes — keyboard/SR users land
  // in the right place instead of at the top of a long page.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [currentStep]);

  const handleChange = (field: keyof BriefData, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

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
    setIsSaving(true);
    setSubmitError(null);
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
          // Draft is intentionally NOT cleared — the user's work stays safe to retry.
        },
      },
    );
  }, [requestId, brief, saveBrief, toast, setLocation, STORAGE_KEY]);

  const continueDraft = () => {
    if (pendingDraft) setBrief(pendingDraft);
    setPendingDraft(null);
  };

  const startOver = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setBrief(EMPTY_BRIEF);
    setPendingDraft(null);
  };

  const servicePackage = useMemo(
    () => serviceDetail?.packages.find((p) => p.id === requestDetail?.packageId) ?? null,
    [serviceDetail, requestDetail],
  );

  if (requestLoading || !draftChecked) {
    return (
      <Layout>
        <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
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
          <button onClick={() => setLocation("/services")} className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors">
            Ke Halaman Layanan
          </button>
        </div>
      </Layout>
    );
  }

  // Draft restoration prompt — blocks the form until the user decides.
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
              Kami menemukan jawaban yang belum terkirim, tersimpan di perangkat ini. Lanjutkan mengisi, atau mulai dari awal?
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={startOver} className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors">
                Mulai dari Awal
              </button>
              <button onClick={continueDraft} className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors">
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

      <div className="container mx-auto px-4 md:px-8 py-12 pb-28 md:pb-12 max-w-3xl">
        {/* Wizard header */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground mb-3">
            <span className="font-medium text-foreground/80 truncate">
              {serviceDetail?.serviceName ?? "Project Brief"}
              {servicePackage ? ` · ${servicePackage.packageName}` : ""}
            </span>
            {currentStep === 1 ? (
              <span className="shrink-0">Sekitar 4–6 menit</span>
            ) : (
              <span className="shrink-0">Langkah {currentStep} dari {TOTAL_STEPS}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <StepIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-serif font-medium outline-none"
              >
                {stepInfo.title}
              </h2>
              <p className="text-xs text-muted-foreground">{stepInfo.description}</p>
            </div>
            <AutosaveStatus state={autosaveState} lastSavedAt={lastSavedAt} now={now} className="ml-auto shrink-0" />
          </div>
        </div>

        {/* Step progress bar — accessible micro-stepper for this wizard's 7 internal steps */}
        <nav aria-label={`Langkah brief, ${currentStep} dari ${TOTAL_STEPS}`} className="mb-10">
          <ol className="flex gap-1">
            {STEPS.map((s) => (
              <li
                key={s.id}
                className="flex-1"
                aria-current={s.id === currentStep ? "step" : undefined}
              >
                <div className={`h-1 rounded-full transition-colors motion-reduce:transition-none ${s.id <= currentStep ? "bg-primary" : "bg-border"}`} />
              </li>
            ))}
          </ol>
        </nav>

        <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
          {/* Step 1 — Business Info */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <FieldGroup id="companyIndustry" label="Apa industri bisnis Anda?" required hint="Contoh: E-commerce, Fintech, Kuliner, Properti" error={errors.companyIndustry}>
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
                <GuidedChips options={INDUSTRY_SUGGESTIONS} onSelect={(v) => handleChange("companyIndustry", v)} />
              </FieldGroup>
              <FieldGroup id="companySize" label="Berapa ukuran perusahaan Anda?" optional hint="Jumlah karyawan / skala bisnis">
                <select id="brief-companySize" className="input-field" value={brief.companySize} onChange={(e) => handleChange("companySize", e.target.value)}>
                  <option value="">Pilih ukuran</option>
                  <option value="solo">Solo / Freelancer</option>
                  <option value="startup">Startup (1–10 orang)</option>
                  <option value="smb">UKM (10–50 orang)</option>
                  <option value="mid">Menengah (50–200 orang)</option>
                  <option value="enterprise">Enterprise (200+ orang)</option>
                </select>
              </FieldGroup>
              <FieldGroup id="websiteUrl" label="Punya website atau media sosial?" optional hint="URL profil bisnis yang sudah ada">
                <input
                  id="brief-websiteUrl"
                  className="input-field"
                  type="url"
                  value={brief.websiteUrl}
                  onChange={(e) => handleChange("websiteUrl", e.target.value)}
                  placeholder="https://..."
                  autoComplete="url"
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 2 — Project Goals */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <FieldGroup id="primaryGoal" label="Apa tujuan utama project ini?" required hint="Contoh: meningkatkan brand awareness, memperkenalkan produk baru." error={errors.primaryGoal}>
                <textarea
                  id="brief-primaryGoal"
                  className="input-field min-h-[100px]"
                  value={brief.primaryGoal}
                  onChange={(e) => handleChange("primaryGoal", e.target.value)}
                  placeholder="Contoh: Meningkatkan brand awareness, memperkenalkan produk baru, meningkatkan konversi penjualan..."
                  aria-invalid={!!errors.primaryGoal}
                  aria-describedby={errors.primaryGoal ? "brief-primaryGoal-error" : undefined}
                />
                <GuidedChips options={GOAL_SUGGESTIONS} onSelect={(v) => handleChange("primaryGoal", brief.primaryGoal ? `${brief.primaryGoal}. ${v}` : v)} />
              </FieldGroup>
              <FieldGroup id="successMetrics" label="Bagaimana Anda mengukur kesuksesan project ini?" optional>
                <textarea
                  id="brief-successMetrics"
                  className="input-field min-h-[80px]"
                  value={brief.successMetrics}
                  onChange={(e) => handleChange("successMetrics", e.target.value)}
                  placeholder="Contoh: 1000 engagement dalam 7 hari, 10% peningkatan click-through rate..."
                />
              </FieldGroup>
              <FieldGroup id="existingAssets" label="Apakah Anda sudah punya materi yang bisa kami gunakan?" optional hint="Logo, foto, brand guideline, dll — tulis 'tidak ada' bila belum punya">
                <textarea
                  id="brief-existingAssets"
                  className="input-field min-h-[80px]"
                  value={brief.existingAssets}
                  onChange={(e) => handleChange("existingAssets", e.target.value)}
                  placeholder="Sebutkan aset yang dimiliki atau tulis 'tidak ada'"
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 3 — Target Audience */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <FieldGroup id="audienceDemographics" label="Siapa target utama proyek ini?" required hint="Contoh: pemilik bisnis F&B usia 25–40 tahun di Jakarta." error={errors.audienceDemographics}>
                <textarea
                  id="brief-audienceDemographics"
                  className="input-field min-h-[100px]"
                  value={brief.audienceDemographics}
                  onChange={(e) => handleChange("audienceDemographics", e.target.value)}
                  placeholder="Contoh: Wanita 25–35 tahun, profesional urban, penghasilan Rp 5–15 juta/bulan..."
                  aria-invalid={!!errors.audienceDemographics}
                  aria-describedby={errors.audienceDemographics ? "brief-audienceDemographics-error" : undefined}
                />
              </FieldGroup>
              <FieldGroup id="audiencePainPoints" label="Masalah apa yang ingin diselesaikan untuk audiens ini?" optional>
                <textarea
                  id="brief-audiencePainPoints"
                  className="input-field min-h-[80px]"
                  value={brief.audiencePainPoints}
                  onChange={(e) => handleChange("audiencePainPoints", e.target.value)}
                  placeholder="Contoh: Kesulitan menemukan produk berkualitas dengan harga terjangkau..."
                />
              </FieldGroup>
              <FieldGroup id="audienceChannels" label="Di mana audiens Anda biasanya berada?" optional hint="Platform / channel utama">
                <input
                  id="brief-audienceChannels"
                  className="input-field"
                  value={brief.audienceChannels}
                  onChange={(e) => handleChange("audienceChannels", e.target.value)}
                  placeholder="Contoh: Instagram, TikTok, LinkedIn, Website, WhatsApp..."
                />
                <GuidedChips options={CHANNEL_SUGGESTIONS} label="Suggested options" onSelect={(v) => {
                  const parts = brief.audienceChannels.split(",").map((p) => p.trim()).filter(Boolean);
                  if (!parts.includes(v)) parts.push(v);
                  handleChange("audienceChannels", parts.join(", "));
                }} />
              </FieldGroup>
            </div>
          )}

          {/* Step 4 — Visual Style */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <FieldGroup id="stylePreference" label="Gaya visual seperti apa yang Anda inginkan?" required error={errors.stylePreference}>
                <select
                  id="brief-stylePreference"
                  className="input-field"
                  value={brief.stylePreference}
                  onChange={(e) => handleChange("stylePreference", e.target.value)}
                  aria-invalid={!!errors.stylePreference}
                  aria-describedby={errors.stylePreference ? "brief-stylePreference-error" : undefined}
                >
                  <option value="">Pilih gaya</option>
                  <option value="modern_minimal">Modern & Minimal</option>
                  <option value="bold_vibrant">Bold & Vibrant</option>
                  <option value="elegant_luxury">Elegant & Luxury</option>
                  <option value="playful_fun">Playful & Fun</option>
                  <option value="corporate_professional">Corporate & Professional</option>
                  <option value="natural_organic">Natural & Organic</option>
                  <option value="tech_futuristic">Tech & Futuristic</option>
                  <option value="cultural_traditional">Cultural & Traditional</option>
                  <option value="other">Lainnya (deskripsikan di bawah)</option>
                </select>
              </FieldGroup>
              <FieldGroup id="colorPalette" label="Ada warna brand yang sudah Anda pakai?" optional hint="Warna brand yang sudah ada atau preferensi warna">
                <input
                  id="brief-colorPalette"
                  className="input-field"
                  value={brief.colorPalette}
                  onChange={(e) => handleChange("colorPalette", e.target.value)}
                  placeholder="Contoh: Biru dan putih, atau #1A73E8 dan #EA4335..."
                />
              </FieldGroup>
              <FieldGroup id="referenceLinks" label="Punya contoh desain yang Anda suka?" optional hint="Tempel link — opsional, tapi sangat membantu">
                <textarea
                  id="brief-referenceLinks"
                  className="input-field min-h-[80px]"
                  value={brief.referenceLinks}
                  onChange={(e) => handleChange("referenceLinks", e.target.value)}
                  placeholder="Tempelkan link contoh desain, iklan kompetitor, atau inspirasi visual..."
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 5 — Deliverables */}
          {currentStep === 5 && (
            <div className="space-y-5">
              <FieldGroup id="outputFormats" label="Format output apa yang Anda butuhkan?" required error={errors.outputFormats}>
                <textarea
                  id="brief-outputFormats"
                  className="input-field min-h-[100px]"
                  value={brief.outputFormats}
                  onChange={(e) => handleChange("outputFormats", e.target.value)}
                  placeholder="Contoh: 3 variasi konten Instagram (1:1 + Story), 1 banner website (1200x628), PDF katalog 4 halaman..."
                  aria-invalid={!!errors.outputFormats}
                  aria-describedby={errors.outputFormats ? "brief-outputFormats-error" : undefined}
                />
              </FieldGroup>
              <FieldGroup id="outputLanguage" label="Bahasa apa yang digunakan dalam konten?" optional>
                <select id="brief-outputLanguage" className="input-field" value={brief.outputLanguage} onChange={(e) => handleChange("outputLanguage", e.target.value)}>
                  <option value="id">Bahasa Indonesia</option>
                  <option value="en">Bahasa Inggris</option>
                  <option value="id_en">Bilingual (Indonesia + Inggris)</option>
                </select>
              </FieldGroup>
              <FieldGroup id="specialRequirements" label="Ada hal khusus yang perlu kami perhatikan?" optional>
                <textarea
                  id="brief-specialRequirements"
                  className="input-field min-h-[80px]"
                  value={brief.specialRequirements}
                  onChange={(e) => handleChange("specialRequirements", e.target.value)}
                  placeholder="Contoh: Jangan gunakan gambar manusia, harus ada tagline tertentu, format harus editable..."
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 6 — Timeline */}
          {currentStep === 6 && (
            <div className="space-y-5">
              <FieldGroup id="deadline" label="Kapan Anda membutuhkan deliverables ini?" required error={errors.deadline}>
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
              </FieldGroup>
              <FieldGroup id="priority" label="Seberapa mendesak project ini?" optional>
                <select id="brief-priority" className="input-field" value={brief.priority} onChange={(e) => handleChange("priority", e.target.value)}>
                  <option value="normal">Normal (sesuai jadwal)</option>
                  <option value="high">Tinggi (dipercepat)</option>
                  <option value="urgent">Urgent (same-day/24h)</option>
                </select>
                {brief.priority === "urgent" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                    Permintaan urgent dapat memengaruhi biaya tambahan (rush fee) pada penawaran harga.
                  </p>
                )}
              </FieldGroup>
              <FieldGroup id="milestones" label="Ada tanggal penting lain yang perlu diperhatikan?" optional>
                <textarea
                  id="brief-milestones"
                  className="input-field min-h-[80px]"
                  value={brief.milestones}
                  onChange={(e) => handleChange("milestones", e.target.value)}
                  placeholder="Contoh: Draft pertama dibutuhkan sebelum 20 Juli, final sebelum 31 Juli untuk launch event..."
                />
              </FieldGroup>
            </div>
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
        </div>

        {submitError && currentStep === TOTAL_STEPS && (
          <div role="alert" className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            Gagal mengirim brief: {submitError}. Jawaban Anda tetap tersimpan — silakan coba lagi.
          </div>
        )}

        {/* Navigation */}
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

      {/* Sticky mobile action bar — keeps CTA reachable above the on-screen keyboard */}
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

// ── Navigation buttons (shared between desktop row and mobile sticky bar) ──────

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
        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>

      {!isReview ? (
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors min-h-[44px]"
        >
          Lanjut <ArrowRight className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={onSubmit}
          disabled={isSaving || !reviewConfirmed}
          title={!reviewConfirmed ? "Konfirmasi bahwa informasi sudah benar untuk melanjutkan" : undefined}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[44px]"
        >
          {isSaving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
          ) : (
            <><CheckCircle2 className="w-4 h-4" /> Kirim Brief</>
          )}
        </button>
      )}
    </>
  );
}

// ── Review step ──────────────────────────────────────────────────────────────

const REVIEW_SECTIONS: { heading: string; step: number; rows: { label: string; key: keyof BriefData }[] }[] = [
  { heading: "Bisnis", step: 1, rows: [
    { label: "Industri", key: "companyIndustry" },
    { label: "Ukuran Perusahaan", key: "companySize" },
    { label: "Website", key: "websiteUrl" },
  ] },
  { heading: "Tujuan", step: 2, rows: [
    { label: "Tujuan Utama", key: "primaryGoal" },
    { label: "Metrik Keberhasilan", key: "successMetrics" },
  ] },
  { heading: "Audiens", step: 3, rows: [
    { label: "Target Audiens", key: "audienceDemographics" },
    { label: "Channel", key: "audienceChannels" },
  ] },
  { heading: "Arah Visual", step: 4, rows: [
    { label: "Gaya Visual", key: "stylePreference" },
    { label: "Palet Warna", key: "colorPalette" },
  ] },
  { heading: "Deliverables", step: 5, rows: [
    { label: "Format Output", key: "outputFormats" },
    { label: "Bahasa", key: "outputLanguage" },
  ] },
  { heading: "Timeline", step: 6, rows: [
    { label: "Deadline", key: "deadline" },
    { label: "Prioritas", key: "priority" },
  ] },
];

function ReviewStep({
  brief, onEditStep, confirmed, onConfirmChange,
}: {
  brief: BriefData; onEditStep: (step: number) => void; confirmed: boolean; onConfirmChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Tinjau ringkasan brief Anda sebelum mengirim. Tim kami akan mempelajari detail ini untuk menyiapkan proposal harga yang tepat.
      </p>

      {REVIEW_SECTIONS.map((section) => (
        <div key={section.heading} className="border border-border/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
            <button
              type="button"
              onClick={() => onEditStep(section.step)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </div>
          <div className="space-y-2">
            {section.rows.map((row) => (
              <div key={row.key} className="flex gap-4">
                <span className="text-xs font-medium text-muted-foreground w-32 shrink-0">{row.label}</span>
                <span className="text-sm text-foreground">
                  {brief[row.key]?.trim() ? brief[row.key] : <em className="text-muted-foreground not-italic">Not provided</em>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Draft ini tersimpan hanya di perangkat/browser Anda sampai dikirim. File yang Anda referensikan tidak dibagikan ke pihak lain di luar tim project ini.
      </p>

      <label className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20 cursor-pointer">
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function FieldGroup({
  id, label, hint, required, optional, error, children,
}: {
  id: string; label: string; hint?: string; required?: boolean; optional?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`brief-${id}`} className="text-sm font-medium text-foreground flex items-center gap-1.5">
        {label}
        {required && <span className="text-primary" aria-hidden="true">*</span>}
        {optional && <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">Opsional</span>}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && (
        <p id={`brief-${id}-error`} role="alert" className="text-xs text-destructive flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-destructive/20 text-destructive flex items-center justify-center text-[10px]" aria-hidden="true">!</span>
          {error}
        </p>
      )}
    </div>
  );
}
