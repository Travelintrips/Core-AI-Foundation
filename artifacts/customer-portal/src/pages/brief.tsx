import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useToast } from "@/hooks/use-toast";
import { useRequestDetail, useSaveBrief } from "@/hooks/use-catalog";
import {
  ArrowLeft, ArrowRight, Save, CheckCircle2, Loader2,
  Building2, Target, Users, Palette, Package, Calendar, ClipboardList,
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

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: "Informasi Bisnis",        icon: Building2,    key: "business" },
  { id: 2, title: "Tujuan Project",           icon: Target,       key: "goals" },
  { id: 3, title: "Target Audiens",           icon: Users,        key: "audience" },
  { id: 4, title: "Gaya Visual & Referensi", icon: Palette,      key: "visual" },
  { id: 5, title: "Deliverables",             icon: Package,      key: "deliverables" },
  { id: 6, title: "Deadline",                 icon: Calendar,     key: "timeline" },
  { id: 7, title: "Review",                   icon: ClipboardList, key: "review" },
];

function validateStep(step: number, brief: BriefData): string | null {
  if (step === 1 && !brief.companyIndustry.trim()) return "Industri perusahaan wajib diisi";
  if (step === 2 && !brief.primaryGoal.trim()) return "Tujuan utama project wajib diisi";
  if (step === 3 && !brief.audienceDemographics.trim()) return "Deskripsi target audiens wajib diisi";
  if (step === 4 && !brief.stylePreference.trim()) return "Preferensi gaya visual wajib diisi";
  if (step === 5 && !brief.outputFormats.trim()) return "Format deliverables wajib diisi";
  if (step === 6 && !brief.deadline.trim()) return "Deadline wajib diisi";
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BriefPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: requestDetail, isLoading: requestLoading } = useRequestDetail(requestId);
  const saveBrief = useSaveBrief();

  const STORAGE_KEY = `brief_draft_${requestId}`;

  const [currentStep, setCurrentStep] = useState(1);
  const [brief, setBrief] = useState<BriefData>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...EMPTY_BRIEF, ...JSON.parse(stored) } : EMPTY_BRIEF;
    } catch {
      return EMPTY_BRIEF;
    }
  });
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Autosave to localStorage every 2s on change
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(brief));
      setLastSaved(new Date());
    }, 2000);
    return () => clearTimeout(timer);
  }, [brief, STORAGE_KEY]);

  const handleChange = (field: keyof BriefData, value: string) => {
    setBrief((prev) => ({ ...prev, [field]: value }));
  };

  const handleNext = () => {
    const error = validateStep(currentStep, brief);
    if (error) {
      toast({ title: "Validasi gagal", description: error, variant: "destructive" });
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, 7));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = useCallback(() => {
    if (!requestId) return;
    setIsSaving(true);
    saveBrief.mutate(
      { requestId, brief },
      {
        onSuccess: () => {
          localStorage.removeItem(STORAGE_KEY);
          toast({ title: "Brief tersimpan!", description: "Brief Anda berhasil dikirim." });
          setLocation(`/request-service/${requestId}/pricing`);
        },
        onError: (err) => {
          toast({ title: "Gagal menyimpan", description: String((err as Error)?.message ?? err), variant: "destructive" });
          setIsSaving(false);
        },
      },
    );
  }, [requestId, brief, saveBrief, toast, setLocation, STORAGE_KEY]);

  if (requestLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
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

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <StepIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Langkah {currentStep} dari 7</p>
            <h2 className="text-xl font-serif font-medium">{stepInfo.title}</h2>
          </div>
          {lastSaved && (
            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Save className="w-3 h-3" />
              Tersimpan {lastSaved.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>

        {/* Step progress bar */}
        <div className="flex gap-1 mb-10">
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-colors ${s.id <= currentStep ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
          {/* Step 1 — Business Info */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <FieldGroup label="Industri Perusahaan *" hint="Contoh: E-commerce, Fintech, Kuliner, Properti">
                <input
                  className="input-field"
                  value={brief.companyIndustry}
                  onChange={(e) => handleChange("companyIndustry", e.target.value)}
                  placeholder="Masukkan industri perusahaan Anda"
                />
              </FieldGroup>
              <FieldGroup label="Ukuran Perusahaan" hint="Jumlah karyawan / skala bisnis">
                <select className="input-field" value={brief.companySize} onChange={(e) => handleChange("companySize", e.target.value)}>
                  <option value="">Pilih ukuran</option>
                  <option value="solo">Solo / Freelancer</option>
                  <option value="startup">Startup (1–10 orang)</option>
                  <option value="smb">UKM (10–50 orang)</option>
                  <option value="mid">Menengah (50–200 orang)</option>
                  <option value="enterprise">Enterprise (200+ orang)</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Website / Media Sosial" hint="URL profil bisnis yang sudah ada (opsional)">
                <input
                  className="input-field"
                  value={brief.websiteUrl}
                  onChange={(e) => handleChange("websiteUrl", e.target.value)}
                  placeholder="https://..."
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 2 — Project Goals */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <FieldGroup label="Tujuan Utama Project *" hint="Apa yang ingin Anda capai dari project ini?">
                <textarea
                  className="input-field min-h-[100px]"
                  value={brief.primaryGoal}
                  onChange={(e) => handleChange("primaryGoal", e.target.value)}
                  placeholder="Contoh: Meningkatkan brand awareness, memperkenalkan produk baru, meningkatkan konversi penjualan..."
                />
              </FieldGroup>
              <FieldGroup label="Metrik Keberhasilan" hint="Bagaimana Anda mengukur kesuksesan project ini?">
                <textarea
                  className="input-field min-h-[80px]"
                  value={brief.successMetrics}
                  onChange={(e) => handleChange("successMetrics", e.target.value)}
                  placeholder="Contoh: 1000 engagement dalam 7 hari, 10% peningkatan click-through rate..."
                />
              </FieldGroup>
              <FieldGroup label="Aset yang Sudah Ada" hint="Materi existing yang bisa kami gunakan (logo, foto, brand guideline, dll)">
                <textarea
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
              <FieldGroup label="Demografis Target Audiens *" hint="Usia, jenis kelamin, lokasi, profesi, daya beli">
                <textarea
                  className="input-field min-h-[100px]"
                  value={brief.audienceDemographics}
                  onChange={(e) => handleChange("audienceDemographics", e.target.value)}
                  placeholder="Contoh: Wanita 25–35 tahun, profesional urban, penghasilan Rp 5–15 juta/bulan..."
                />
              </FieldGroup>
              <FieldGroup label="Pain Points & Kebutuhan" hint="Masalah apa yang ingin diselesaikan untuk audiens ini?">
                <textarea
                  className="input-field min-h-[80px]"
                  value={brief.audiencePainPoints}
                  onChange={(e) => handleChange("audiencePainPoints", e.target.value)}
                  placeholder="Contoh: Kesulitan menemukan produk berkualitas dengan harga terjangkau..."
                />
              </FieldGroup>
              <FieldGroup label="Platform / Channel" hint="Di mana audiens Anda berada?">
                <input
                  className="input-field"
                  value={brief.audienceChannels}
                  onChange={(e) => handleChange("audienceChannels", e.target.value)}
                  placeholder="Contoh: Instagram, TikTok, LinkedIn, Website, WhatsApp..."
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 4 — Visual Style */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <FieldGroup label="Preferensi Gaya Visual *" hint="Describe the aesthetic you want">
                <select className="input-field" value={brief.stylePreference} onChange={(e) => handleChange("stylePreference", e.target.value)}>
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
              <FieldGroup label="Palet Warna" hint="Warna brand yang sudah ada atau preferensi warna">
                <input
                  className="input-field"
                  value={brief.colorPalette}
                  onChange={(e) => handleChange("colorPalette", e.target.value)}
                  placeholder="Contoh: Biru dan putih, atau #1A73E8 dan #EA4335..."
                />
              </FieldGroup>
              <FieldGroup label="Referensi Visual" hint="Link ke contoh desain yang Anda suka (opsional)">
                <textarea
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
              <FieldGroup label="Format Output yang Dibutuhkan *" hint="Jenis dan format file yang Anda perlukan">
                <textarea
                  className="input-field min-h-[100px]"
                  value={brief.outputFormats}
                  onChange={(e) => handleChange("outputFormats", e.target.value)}
                  placeholder="Contoh: 3 variasi konten Instagram (1:1 + Story), 1 banner website (1200x628), PDF katalog 4 halaman..."
                />
              </FieldGroup>
              <FieldGroup label="Bahasa" hint="Bahasa yang digunakan dalam konten">
                <select className="input-field" value={brief.outputLanguage} onChange={(e) => handleChange("outputLanguage", e.target.value)}>
                  <option value="id">Bahasa Indonesia</option>
                  <option value="en">Bahasa Inggris</option>
                  <option value="id_en">Bilingual (Indonesia + Inggris)</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Persyaratan Khusus" hint="Hal-hal penting lainnya yang perlu diperhatikan">
                <textarea
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
              <FieldGroup label="Deadline *" hint="Kapan Anda membutuhkan deliverables ini?">
                <input
                  type="date"
                  className="input-field"
                  value={brief.deadline}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => handleChange("deadline", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="Prioritas" hint="Seberapa mendesak project ini?">
                <select className="input-field" value={brief.priority} onChange={(e) => handleChange("priority", e.target.value)}>
                  <option value="normal">Normal (sesuai jadwal)</option>
                  <option value="high">Tinggi (dipercepat)</option>
                  <option value="urgent">Urgent (same-day/24h)</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Milestone Penting" hint="Ada tanggal-tanggal khusus yang perlu diperhatikan?">
                <textarea
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
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm mb-6">
                Tinjau ringkasan brief Anda sebelum mengirim. Tim kami akan mempelajari detail ini untuk menyiapkan proposal harga yang tepat.
              </p>
              <ReviewRow label="Industri" value={brief.companyIndustry} />
              <ReviewRow label="Tujuan Utama" value={brief.primaryGoal} />
              <ReviewRow label="Target Audiens" value={brief.audienceDemographics} />
              <ReviewRow label="Gaya Visual" value={brief.stylePreference} />
              <ReviewRow label="Deliverables" value={brief.outputFormats} />
              <ReviewRow label="Deadline" value={brief.deadline} />
              {brief.priority !== "normal" && <ReviewRow label="Prioritas" value={brief.priority} />}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleBack}
            disabled={currentStep === 1}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>

          {currentStep < 7 ? (
            <button
              onClick={handleNext}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
            >
              Lanjut <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSaving || saveBrief.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving || saveBrief.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> Kirim Brief</>
              )}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-4 py-3 border-b border-border/60 last:border-0">
      <span className="text-sm font-medium text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
