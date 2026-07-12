import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSubmitCustomerProject } from "@/hooks/use-customer";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, ArrowLeft, ArrowRight, CheckCircle2, Sparkles,
  User, Building2, Target, FileText, Clock, Pencil,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { GuidedChips } from "@/components/brief/guided-chips";

/* ── Schema ─────────────────────────────────────────────────────── */
const formSchema = z.object({
  clientName:        z.string().min(2, "Nama wajib diisi"),
  clientEmail:       z.string().email("Email tidak valid"),
  clientPhone:       z.string().optional(),
  brandName:         z.string().min(2, "Nama brand wajib diisi"),
  businessType:      z.string().min(2, "Tipe bisnis wajib diisi"),
  productOrService:  z.string().min(2, "Produk/layanan wajib diisi"),
  targetMarket:      z.string().min(2, "Target pasar wajib diisi"),
  stylePreference:   z.string().optional(),
  colorPreference:   z.string().optional(),
  referenceLinks:    z.string().optional(),
  goal:              z.string().min(10, "Jelaskan tujuan proyek Anda lebih detail"),
  notes:             z.string().optional(),
  deadline:          z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

/* ── Step definitions ────────────────────────────────────────────── */
const STEPS = [
  { num: 1, label: "Informasi Anda", icon: User },
  { num: 2, label: "Brand Context",  icon: Building2 },
  { num: 3, label: "Brief Proyek",   icon: Target },
  { num: 4, label: "Konfirmasi",     icon: CheckCircle2 },
];

const GOAL_SUGGESTIONS = [
  "Landing page hero", "Brand identity lengkap", "Ad campaign visual", "Konten sosial media",
];
const STYLE_SUGGESTIONS = ["Minimalis", "Bold & playful", "Corporate", "Elegant & luxury"];
const AUDIENCE_SUGGESTIONS = ["Gen Z urban", "Profesional B2B", "Ibu rumah tangga", "Pemilik UKM"];

/* ── Input wrapper ───────────────────────────────────────────────── */
function Field({
  label, required, children, error, id,
}: {
  label: string; required?: boolean; children: React.ReactNode; error?: string; id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-[#F0F4FF]">
        {label} {required && <span className="text-[#7C6EFA]" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <p id={id ? `${id}-error` : undefined} role="alert" className="text-xs text-[#F43F5E] flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-[#F43F5E]/20 text-[#F43F5E] flex items-center justify-center text-[10px]" aria-hidden="true">!</span>
          {error}
        </p>
      )}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="input-field transition-all bg-[#131E35] border-[#243352] text-[#F0F4FF] placeholder:text-[#4F6494] focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA] outline-none"
    />
  );
}

function Textarea({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="input-field resize-none bg-[#131E35] border-[#243352] text-[#F0F4FF] placeholder:text-[#4F6494] focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA] outline-none"
    />
  );
}

/* ── Stepper header ──────────────────────────────────────────────── */
function StepperBar({ current }: { current: number }) {
  return (
    <nav aria-label={`Langkah ${current} dari ${STEPS.length}`} className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done    = current > s.num;
        const active  = current === s.num;
        return (
          <div key={s.num} className="flex items-center flex-1 last:flex-none" aria-current={active ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                done   ? "bg-[#10B981]" :
                active ? "shadow-lg shadow-[#7C6EFA]/20" : "bg-[#131E35] border-2 border-[#243352]"
              }`}
                style={active ? { background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" } : {}}>
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : (
                  <Icon className={`w-4 h-4 ${active ? "text-white" : "text-[#4F6494]"}`} />
                )}
              </div>
              <span className={`text-[10px] font-semibold whitespace-nowrap hidden md:block ${
                active ? "text-[#9D91FB]" : done ? "text-[#10B981]" : "text-[#4F6494]"
              }`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full transition-all duration-300"
                style={{ background: current > s.num ? "#10B981" : "#243352" }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export default function SubmitPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const submitProject = useSubmitCustomerProject();
  const [step, setStep] = useState(1);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      clientName: "", clientEmail: "", clientPhone: "",
      brandName: "", businessType: "", productOrService: "", targetMarket: "",
      stylePreference: "", colorPreference: "", referenceLinks: "",
      goal: "", notes: "", deadline: "",
    },
  });

  const v = form.watch();
  const e = form.formState.errors;
  const [confirmed, setConfirmed] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  // Warn before an accidental tab close once the user has started typing —
  // unlike brief.tsx, this flow has no localStorage draft, so closing really loses input.
  useEffect(() => {
    const handler = (ev: BeforeUnloadEvent) => {
      if (form.formState.isDirty && !submitProject.isSuccess) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [form.formState.isDirty, submitProject.isSuccess]);

  const canAdvance = (s: number) => {
    if (s === 1) return v.clientName.length >= 2 && v.clientEmail.includes("@");
    if (s === 2) return v.brandName.length >= 2 && v.businessType.length >= 2 &&
      v.productOrService.length >= 2 && v.targetMarket.length >= 2;
    if (s === 3) return v.goal.length >= 10;
    return true;
  };

  const goNext = async () => {
    const fields: Array<keyof FormValues>[] = [
      ["clientName", "clientEmail", "clientPhone"],
      ["brandName", "businessType", "productOrService", "targetMarket"],
      ["goal", "stylePreference", "colorPreference", "referenceLinks", "notes", "deadline"],
      [],
    ];
    const currentFields = fields[step - 1];
    const ok = await form.trigger(currentFields);
    if (ok) {
      setStep((s) => Math.min(4, s + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      const firstInvalid = currentFields.find((f) => e[f]);
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
    }
  };

  const goToStep = (s: number) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onSubmit = (values: FormValues) => {
    submitProject.mutate(
      { data: values },
      {
        onSuccess: (res) => {
          setLocation(`/success?review=${res.reviewToken}&dashboard=${res.dashboardToken}`);
        },
        onError: (err) => {
          toast({
            title: "Gagal mengirim",
            description: err instanceof Error ? err.message : "Terjadi kesalahan.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const slideVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 32 : -32 }),
    center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
    exit:  (dir: number) => ({ opacity: 0, x: dir > 0 ? -32 : 32, transition: { duration: 0.25 } }),
  };

  return (
    <Layout>
      <section className="relative min-h-screen py-16 px-4 bg-[#060B18]">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute top-0 right-1/4 w-96 h-96 bg-[#7C6EFA] rounded-full blur-[100px] opacity-20" />

        <div className="relative container mx-auto max-w-2xl">
          {/* Back */}
          <Link href="/services"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8B9BC4] hover:text-[#F0F4FF] mb-10 group transition-colors">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Kembali ke Layanan
          </Link>

          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-[#7C6EFA]/20"
              style={{ background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" }}>
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-[#F0F4FF] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Mulai Proyek Baru
            </h1>
            <p className="text-[#8B9BC4]">Isi brief Anda dan tim AI kami akan segera bekerja.</p>
            {step === 1 && <p className="text-xs text-[#4F6494] mt-1">Sekitar 4–6 menit untuk menyelesaikan</p>}
          </div>

          {/* Stepper */}
          <StepperBar current={step} />

          {/* Card */}
          <div className="bg-[#0D1526] rounded-2xl shadow-xl border border-[#243352] overflow-hidden">
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <AnimatePresence mode="wait" initial={false} custom={1}>
                <motion.div
                  key={step}
                  custom={1}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="p-6 md:p-8 space-y-5"
                >

                  {/* ── Step 1: Contact ── */}
                  {step === 1 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <User className="w-5 h-5 text-[#7C6EFA]" />
                        Informasi Kontak Anda
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Nama Lengkap" required error={e.clientName?.message} id="clientName">
                          <Input id="clientName" {...form.register("clientName")} placeholder="Budi Santoso" autoComplete="name"
                            aria-invalid={!!e.clientName} aria-describedby={e.clientName ? "clientName-error" : undefined} />
                        </Field>
                        <Field label="Email Bisnis" required error={e.clientEmail?.message} id="clientEmail">
                          <Input id="clientEmail" {...form.register("clientEmail")} type="email" placeholder="budi@perusahaan.id" autoComplete="email"
                            aria-invalid={!!e.clientEmail} aria-describedby={e.clientEmail ? "clientEmail-error" : undefined} />
                        </Field>
                        <Field label="Nomor Telepon" error={e.clientPhone?.message} id="clientPhone">
                          <Input id="clientPhone" {...form.register("clientPhone")} placeholder="+62 812 3456 7890" autoComplete="tel" />
                        </Field>
                      </div>
                      <div className="mt-4 p-4 rounded-xl flex items-start gap-3 bg-[#7C6EFA]/[0.08] border border-[#7C6EFA]/20">
                        <Sparkles className="w-4 h-4 text-[#7C6EFA] shrink-0 mt-0.5" />
                        <p className="text-sm text-[#8B9BC4]">
                          AI kami akan menggunakan informasi ini untuk mempersonalisasi brief dan quotation Anda.
                        </p>
                      </div>
                    </>
                  )}

                  {/* ── Step 2: Brand Context ── */}
                  {step === 2 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <Building2 className="w-5 h-5 text-[#7C6EFA]" />
                        Brand Context
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Nama Brand / Perusahaan" required error={e.brandName?.message} id="brandName">
                          <Input id="brandName" {...form.register("brandName")} placeholder="PT TechVenture Indonesia"
                            aria-invalid={!!e.brandName} aria-describedby={e.brandName ? "brandName-error" : undefined} />
                        </Field>
                        <Field label="Tipe Bisnis" required error={e.businessType?.message} id="businessType">
                          <Input id="businessType" {...form.register("businessType")} placeholder="B2B SaaS, D2C Coffee, dll."
                            aria-invalid={!!e.businessType} aria-describedby={e.businessType ? "businessType-error" : undefined} />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Produk / Layanan Utama" required error={e.productOrService?.message} id="productOrService">
                            <Input id="productOrService" {...form.register("productOrService")} placeholder="Apa yang Anda jual?"
                              aria-invalid={!!e.productOrService} aria-describedby={e.productOrService ? "productOrService-error" : undefined} />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label="Target Pasar" required error={e.targetMarket?.message} id="targetMarket">
                            <Input id="targetMarket" {...form.register("targetMarket")} placeholder="Siapa pelanggan Anda? Demografis, psikografis."
                              aria-invalid={!!e.targetMarket} aria-describedby={e.targetMarket ? "targetMarket-error" : undefined} />
                            <GuidedChips options={AUDIENCE_SUGGESTIONS} onSelect={(val) => form.setValue("targetMarket", v.targetMarket ? `${v.targetMarket}, ${val}` : val, { shouldValidate: true, shouldDirty: true })} />
                          </Field>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Step 3: Creative Brief ── */}
                  {step === 3 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <Target className="w-5 h-5 text-[#7C6EFA]" />
                        Detail Proyek
                      </h2>
                      <Field label="Tujuan Proyek" required error={e.goal?.message} id="goal">
                        <Textarea id="goal" {...form.register("goal")} rows={4}
                          placeholder="Apa yang ingin kami kerjakan? Contoh: landing page hero, ad campaign, brand identity..."
                          aria-invalid={!!e.goal} aria-describedby={e.goal ? "goal-error" : undefined} />
                        <GuidedChips options={GOAL_SUGGESTIONS} onSelect={(val) => form.setValue("goal", v.goal ? `${v.goal}. ${val}` : val, { shouldValidate: true, shouldDirty: true })} />
                      </Field>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Preferensi Gaya" error={e.stylePreference?.message} id="stylePreference">
                          <Input id="stylePreference" {...form.register("stylePreference")} placeholder="Minimalis, playful, corporate..." />
                          <GuidedChips options={STYLE_SUGGESTIONS} onSelect={(val) => form.setValue("stylePreference", val, { shouldDirty: true })} />
                        </Field>
                        <Field label="Preferensi Warna" error={e.colorPreference?.message} id="colorPreference">
                          <Input id="colorPreference" {...form.register("colorPreference")} placeholder="Neon green dan hitam, dll." />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Link Referensi (Opsional)" error={e.referenceLinks?.message} id="referenceLinks">
                            <Input id="referenceLinks" {...form.register("referenceLinks")} placeholder="URL moodboard, kompetitor, atau inspirasi" />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label="Catatan Tambahan" error={e.notes?.message} id="notes">
                            <Textarea id="notes" {...form.register("notes")} rows={3}
                              placeholder="Hal lain yang ingin Anda sampaikan ke tim kami?" />
                          </Field>
                        </div>
                        <Field label="Deadline (Opsional)" error={e.deadline?.message} id="deadline">
                          <Input id="deadline" {...form.register("deadline")} placeholder="Selasa depan, 2 minggu..." />
                          <div className="flex items-center gap-1 mt-1 text-xs text-[#4F6494]">
                            <Clock className="w-3 h-3" /> Opsional, tapi membantu kami memprioritaskan
                          </div>
                        </Field>
                      </div>
                    </>
                  )}

                  {/* ── Step 4: Confirm ── */}
                  {step === 4 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <FileText className="w-5 h-5 text-[#7C6EFA]" />
                        Konfirmasi Brief
                      </h2>

                      {[
                        { heading: "Kontak", step: 1, rows: [
                          { label: "Nama", value: v.clientName },
                          { label: "Email", value: v.clientEmail },
                          { label: "Telepon", value: v.clientPhone },
                        ] },
                        { heading: "Brand", step: 2, rows: [
                          { label: "Brand", value: v.brandName },
                          { label: "Tipe Bisnis", value: v.businessType },
                          { label: "Target Pasar", value: v.targetMarket },
                        ] },
                        { heading: "Brief", step: 3, rows: [
                          { label: "Tujuan Proyek", value: v.goal },
                          { label: "Preferensi Gaya", value: v.stylePreference },
                          { label: "Deadline", value: v.deadline },
                        ] },
                      ].map((section) => (
                        <div key={section.heading} className="mb-4 rounded-xl border border-[#243352] p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wide">{section.heading}</h3>
                            <button type="button" onClick={() => goToStep(section.step)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#9D91FB] hover:underline">
                              <Pencil className="w-3 h-3" /> Edit
                            </button>
                          </div>
                          <div className="space-y-2">
                            {section.rows.map((row) => (
                              <div key={row.label} className="flex gap-3">
                                <span className="text-xs font-semibold text-[#8B9BC4] w-28 shrink-0 pt-0.5">{row.label}</span>
                                <span className="text-sm text-[#F0F4FF] font-medium">
                                  {row.value?.trim() ? row.value : <em className="text-[#4F6494] not-italic font-normal">Not provided</em>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="mt-5 p-4 rounded-xl flex items-start gap-3 bg-[#7C6EFA]/[0.08] border border-[#7C6EFA]/20">
                        <Sparkles className="w-4 h-4 text-[#7C6EFA] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-[#F0F4FF] mb-0.5">Proses selanjutnya</p>
                          <p className="text-xs text-[#8B9BC4]">
                            Tim kami akan mereview brief Anda dan mengirimkan quotation harga dalam 1-4 jam.
                            Produksi dimulai setelah Anda menyetujui penawaran.
                          </p>
                        </div>
                      </div>

                      <label className="mt-4 flex items-start gap-3 p-3 rounded-xl border border-[#243352] bg-[#131E35] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(ev) => setConfirmed(ev.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-[#7C6EFA] shrink-0"
                        />
                        <span className="text-sm text-[#F0F4FF]">
                          Saya sudah memeriksa informasi di atas dan menyatakan sudah benar.
                        </span>
                      </label>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Footer buttons */}
              <div className="px-6 md:px-8 pb-6 md:pb-8 pt-4 border-t border-[#243352] flex items-center justify-between gap-3">
                {step > 1 ? (
                  <button type="button" onClick={() => setStep(s => s - 1)}
                    className="btn-ghost text-sm py-2.5 px-5">
                    <ArrowLeft className="w-4 h-4" /> Kembali
                  </button>
                ) : <div />}

                {step < 4 ? (
                  <button type="button" onClick={goNext}
                    disabled={!canAdvance(step)}
                    className="btn-primary text-sm py-2.5 px-6 disabled:opacity-50 disabled:cursor-not-allowed">
                    Lanjut <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button type="submit" disabled={submitProject.isPending || !confirmed}
                    title={!confirmed ? "Konfirmasi bahwa informasi sudah benar untuk melanjutkan" : undefined}
                    className="btn-primary text-sm py-2.5 px-8 disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitProject.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim…</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Kirim Brief</>
                    )}
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Progress indicator */}
          <div className="mt-4 text-center text-xs text-[#4F6494]">
            Langkah {step} dari {STEPS.length}
            <div className="mt-2 h-1 bg-[#131E35] rounded-full max-w-xs mx-auto overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg,#7C6EFA,#5F52D0)" }}
                animate={{ width: `${(step / STEPS.length) * 100}%` }}
                transition={{ duration: 0.4 }} />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
