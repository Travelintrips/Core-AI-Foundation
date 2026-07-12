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
  User, Building2, Target, FileText, Clock, ChevronRight,
} from "lucide-react";
import { useState } from "react";

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

/* ── Input wrapper ───────────────────────────────────────────────── */
function Field({
  label, required, children, error,
}: {
  label: string; required?: boolean; children: React.ReactNode; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-semibold text-gray-700">
        {label} {required && <span className="text-orange-500">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-100 text-red-500 flex items-center justify-center text-[10px]">!</span>
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
      className="input-field transition-all"
    />
  );
}

function Textarea({ ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="input-field resize-none"
    />
  );
}

/* ── Stepper header ──────────────────────────────────────────────── */
function StepperBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done    = current > s.num;
        const active  = current === s.num;
        return (
          <div key={s.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                done   ? "bg-emerald-500" :
                active ? "shadow-lg" : "bg-gray-100 border-2 border-gray-200"
              }`}
                style={active ? { background: "linear-gradient(135deg,#F97316,#EA580C)" } : {}}>
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : (
                  <Icon className={`w-4 h-4 ${active ? "text-white" : "text-gray-400"}`} />
                )}
              </div>
              <span className={`text-[10px] font-semibold whitespace-nowrap hidden md:block ${
                active ? "text-orange-600" : done ? "text-emerald-600" : "text-gray-400"
              }`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full transition-all duration-300"
                style={{ background: current > s.num ? "#10B981" : "#E5E7EB" }} />
            )}
          </div>
        );
      })}
    </div>
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
    const ok = await form.trigger(fields[step - 1]);
    if (ok) setStep((s) => Math.min(4, s + 1));
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
    center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } },
    exit:  (dir: number) => ({ opacity: 0, x: dir > 0 ? -32 : 32, transition: { duration: 0.25 } }),
  };

  return (
    <Layout>
      <section className="relative min-h-screen py-16 px-4" style={{ background: "linear-gradient(135deg,#FAFAF7 0%,#FFF7ED 60%,#FAFAF7 100%)" }}>
        {/* Ambient glow */}
        <div className="pointer-events-none absolute top-0 right-1/4 w-96 h-96 bg-orange-100 rounded-full blur-[80px] opacity-40" />

        <div className="relative container mx-auto max-w-2xl">
          {/* Back */}
          <Link href="/services"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-10 group transition-colors">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Kembali ke Layanan
          </Link>

          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg,#F97316,#EA580C)" }}>
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-navy mb-2">
              Mulai Proyek Baru
            </h1>
            <p className="text-gray-500">Isi brief Anda dan tim AI kami akan segera bekerja.</p>
          </div>

          {/* Stepper */}
          <StepperBar current={step} />

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
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
                      <h2 className="font-display font-bold text-xl text-navy mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-orange-500" />
                        Informasi Kontak Anda
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Nama Lengkap" required error={e.clientName?.message}>
                          <Input {...form.register("clientName")} placeholder="Budi Santoso" />
                        </Field>
                        <Field label="Email Bisnis" required error={e.clientEmail?.message}>
                          <Input {...form.register("clientEmail")} type="email" placeholder="budi@perusahaan.id" />
                        </Field>
                        <Field label="Nomor Telepon" error={e.clientPhone?.message}>
                          <Input {...form.register("clientPhone")} placeholder="+62 812 3456 7890" />
                        </Field>
                      </div>
                      <div className="mt-4 p-4 rounded-xl flex items-start gap-3"
                        style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}>
                        <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-gray-600">
                          AI kami akan menggunakan informasi ini untuk mempersonalisasi brief dan quotation Anda.
                        </p>
                      </div>
                    </>
                  )}

                  {/* ── Step 2: Brand Context ── */}
                  {step === 2 && (
                    <>
                      <h2 className="font-display font-bold text-xl text-navy mb-4 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-orange-500" />
                        Brand Context
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Nama Brand / Perusahaan" required error={e.brandName?.message}>
                          <Input {...form.register("brandName")} placeholder="PT TechVenture Indonesia" />
                        </Field>
                        <Field label="Tipe Bisnis" required error={e.businessType?.message}>
                          <Input {...form.register("businessType")} placeholder="B2B SaaS, D2C Coffee, dll." />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Produk / Layanan Utama" required error={e.productOrService?.message}>
                            <Input {...form.register("productOrService")} placeholder="Apa yang Anda jual?" />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label="Target Pasar" required error={e.targetMarket?.message}>
                            <Input {...form.register("targetMarket")} placeholder="Siapa pelanggan Anda? Demografis, psikografis." />
                          </Field>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Step 3: Creative Brief ── */}
                  {step === 3 && (
                    <>
                      <h2 className="font-display font-bold text-xl text-navy mb-4 flex items-center gap-2">
                        <Target className="w-5 h-5 text-orange-500" />
                        Detail Proyek
                      </h2>
                      <Field label="Tujuan Proyek" required error={e.goal?.message}>
                        <Textarea {...form.register("goal")} rows={4}
                          placeholder="Apa yang ingin kami kerjakan? Contoh: landing page hero, ad campaign, brand identity..." />
                      </Field>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label="Preferensi Gaya" error={e.stylePreference?.message}>
                          <Input {...form.register("stylePreference")} placeholder="Minimalis, playful, corporate..." />
                        </Field>
                        <Field label="Preferensi Warna" error={e.colorPreference?.message}>
                          <Input {...form.register("colorPreference")} placeholder="Neon green dan hitam, dll." />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Link Referensi (Opsional)" error={e.referenceLinks?.message}>
                            <Input {...form.register("referenceLinks")} placeholder="URL moodboard, kompetitor, atau inspirasi" />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label="Catatan Tambahan" error={e.notes?.message}>
                            <Textarea {...form.register("notes")} rows={3}
                              placeholder="Hal lain yang perlu diketahui AI kami?" />
                          </Field>
                        </div>
                        <Field label="Deadline (Opsional)" error={e.deadline?.message}>
                          <Input {...form.register("deadline")} placeholder="Selasa depan, 2 minggu..." />
                          <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                            <Clock className="w-3 h-3" /> Opsional, tapi membantu kami memprioritaskan
                          </div>
                        </Field>
                      </div>
                    </>
                  )}

                  {/* ── Step 4: Confirm ── */}
                  {step === 4 && (
                    <>
                      <h2 className="font-display font-bold text-xl text-navy mb-4 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-orange-500" />
                        Konfirmasi Brief
                      </h2>

                      <div className="space-y-3">
                        {[
                          { label: "Nama",          value: v.clientName },
                          { label: "Email",          value: v.clientEmail },
                          { label: "Brand",          value: v.brandName },
                          { label: "Tipe Bisnis",    value: v.businessType },
                          { label: "Target Pasar",   value: v.targetMarket },
                          { label: "Tujuan Proyek",  value: v.goal },
                          ...(v.deadline ? [{ label: "Deadline", value: v.deadline }] : []),
                        ].map((row) => (
                          <div key={row.label} className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                            <span className="text-xs font-semibold text-gray-400 w-28 shrink-0 pt-0.5">{row.label}</span>
                            <span className="text-sm text-navy font-medium">{row.value}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 p-4 rounded-xl flex items-start gap-3"
                        style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}>
                        <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5 animate-pulse" />
                        <div>
                          <p className="text-sm font-semibold text-navy mb-0.5">Proses selanjutnya</p>
                          <p className="text-xs text-gray-500">
                            Tim kami akan mereview brief Anda dan mengirimkan quotation harga dalam 1-4 jam.
                            Produksi dimulai setelah Anda menyetujui penawaran.
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Footer buttons */}
              <div className="px-6 md:px-8 pb-6 md:pb-8 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
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
                  <button type="submit" disabled={submitProject.isPending}
                    className="btn-primary text-sm py-2.5 px-8 disabled:opacity-70">
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
          <div className="mt-4 text-center text-xs text-gray-400">
            Langkah {step} dari {STEPS.length}
            <div className="mt-2 h-1 bg-gray-100 rounded-full max-w-xs mx-auto overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg,#F97316,#EA580C)" }}
                animate={{ width: `${(step / STEPS.length) * 100}%` }}
                transition={{ duration: 0.4 }} />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
