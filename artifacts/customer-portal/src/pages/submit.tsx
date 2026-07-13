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
import { useTranslation } from "@/lib/i18n";

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

function StepperBar({ current, steps }: { current: number; steps: { num: number; label: string; icon: React.ElementType }[] }) {
  return (
    <nav aria-label={`Langkah ${current} dari ${steps.length}`} className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const done   = current > s.num;
        const active = current === s.num;
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
            {i < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full transition-all duration-300"
                style={{ background: current > s.num ? "#10B981" : "#243352" }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function SubmitPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const submitProject = useSubmitCustomerProject();
  const [step, setStep] = useState(1);

  const STEPS = [
    { num: 1, label: t('submit.steps.contact'),  icon: User },
    { num: 2, label: t('submit.steps.brand'),    icon: Building2 },
    { num: 3, label: t('submit.steps.brief'),    icon: Target },
    { num: 4, label: t('submit.steps.confirm'),  icon: CheckCircle2 },
  ];

  const GOAL_SUGGESTIONS = [
    "Landing page hero", t('submit.step3.goal').includes("Tujuan") ? "Brand identity lengkap" : "Complete brand identity",
    "Ad campaign visual", t('submit.step3.goal').includes("Tujuan") ? "Konten sosial media" : "Social media content",
  ];
  const STYLE_SUGGESTIONS = [
    t('submit.step3.stylePlaceholder').includes("Minimalis") ? "Minimalis" : "Minimalist",
    "Bold & playful", "Corporate",
    t('submit.step3.stylePlaceholder').includes("Minimalis") ? "Elegant & luxury" : "Elegant & luxury",
  ];
  const AUDIENCE_SUGGESTIONS = [
    "Gen Z urban", "Profesional B2B",
    t('submit.step2.marketPlaceholder').includes("Siapa") ? "Ibu rumah tangga" : "Homemakers",
    t('submit.step2.marketPlaceholder').includes("Siapa") ? "Pemilik UKM" : "SMB owners",
  ];

  const formSchema = z.object({
    clientName:       z.string().min(2, t('submit.errors.name')),
    clientEmail:      z.string().email(t('submit.errors.email')),
    clientPhone:      z.string().optional(),
    brandName:        z.string().min(2, t('submit.errors.brand')),
    businessType:     z.string().min(2, t('submit.errors.type')),
    productOrService: z.string().min(2, t('submit.errors.product')),
    targetMarket:     z.string().min(2, t('submit.errors.market')),
    stylePreference:  z.string().optional(),
    colorPreference:  z.string().optional(),
    referenceLinks:   z.string().optional(),
    goal:             z.string().min(10, t('submit.errors.goal')),
    notes:            z.string().optional(),
    deadline:         z.string().optional(),
  });

  type FormValues = z.infer<typeof formSchema>;

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

  useEffect(() => { stepHeadingRef.current?.focus(); }, [step]);

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
            title: t('submit.failed.title'),
            description: err instanceof Error ? err.message : t('submit.failed.desc'),
            variant: "destructive",
          });
        },
      }
    );
  };

  const slideVariants = {
    enter:  (dir: number) => ({ opacity: 0, x: dir > 0 ? 32 : -32 }),
    center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
    exit:   (dir: number) => ({ opacity: 0, x: dir > 0 ? -32 : 32, transition: { duration: 0.25 } }),
  };

  return (
    <Layout>
      <section className="relative min-h-screen py-16 px-4 bg-[#060B18]">
        <div className="pointer-events-none absolute top-0 right-1/4 w-96 h-96 bg-[#7C6EFA] rounded-full blur-[100px] opacity-20" />

        <div className="relative container mx-auto max-w-2xl">
          <Link href="/services"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8B9BC4] hover:text-[#F0F4FF] mb-10 group transition-colors">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            {t('submit.backToServices')}
          </Link>

          <div className="text-center mb-10">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-[#7C6EFA]/20"
              style={{ background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" }}>
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-[#F0F4FF] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t('submit.title')}
            </h1>
            <p className="text-[#8B9BC4]">{t('submit.subtitle')}</p>
            {step === 1 && <p className="text-xs text-[#4F6494] mt-1">{t('submit.timeHint')}</p>}
          </div>

          <StepperBar current={step} steps={STEPS} />

          <div className="bg-[#0D1526] rounded-2xl shadow-xl border border-[#243352] overflow-hidden">
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <AnimatePresence mode="wait" initial={false} custom={1}>
                <motion.div key={step} custom={1}
                  variants={slideVariants} initial="enter" animate="center" exit="exit"
                  className="p-6 md:p-8 space-y-5">

                  {/* ── Step 1: Contact ── */}
                  {step === 1 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1}
                        className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <User className="w-5 h-5 text-[#7C6EFA]" />
                        {t('submit.step1.title')}
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label={t('submit.step1.name')} required error={e.clientName?.message} id="clientName">
                          <Input id="clientName" {...form.register("clientName")}
                            placeholder={t('submit.step1.namePlaceholder')} autoComplete="name"
                            aria-invalid={!!e.clientName} aria-describedby={e.clientName ? "clientName-error" : undefined} />
                        </Field>
                        <Field label={t('submit.step1.email')} required error={e.clientEmail?.message} id="clientEmail">
                          <Input id="clientEmail" {...form.register("clientEmail")} type="email"
                            placeholder={t('submit.step1.emailPlaceholder')} autoComplete="email"
                            aria-invalid={!!e.clientEmail} aria-describedby={e.clientEmail ? "clientEmail-error" : undefined} />
                        </Field>
                        <Field label={t('submit.step1.phone')} error={e.clientPhone?.message} id="clientPhone">
                          <Input id="clientPhone" {...form.register("clientPhone")}
                            placeholder={t('submit.step1.phonePlaceholder')} autoComplete="tel" />
                        </Field>
                      </div>
                      <div className="mt-4 p-4 rounded-xl flex items-start gap-3 bg-[#7C6EFA]/[0.08] border border-[#7C6EFA]/20">
                        <Sparkles className="w-4 h-4 text-[#7C6EFA] shrink-0 mt-0.5" />
                        <p className="text-sm text-[#8B9BC4]">{t('submit.step1.aiHint')}</p>
                      </div>
                    </>
                  )}

                  {/* ── Step 2: Brand Context ── */}
                  {step === 2 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1}
                        className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <Building2 className="w-5 h-5 text-[#7C6EFA]" />
                        {t('submit.step2.title')}
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label={t('submit.step2.brand')} required error={e.brandName?.message} id="brandName">
                          <Input id="brandName" {...form.register("brandName")}
                            placeholder={t('submit.step2.brandPlaceholder')}
                            aria-invalid={!!e.brandName} aria-describedby={e.brandName ? "brandName-error" : undefined} />
                        </Field>
                        <Field label={t('submit.step2.type')} required error={e.businessType?.message} id="businessType">
                          <Input id="businessType" {...form.register("businessType")}
                            placeholder={t('submit.step2.typePlaceholder')}
                            aria-invalid={!!e.businessType} aria-describedby={e.businessType ? "businessType-error" : undefined} />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label={t('submit.step2.product')} required error={e.productOrService?.message} id="productOrService">
                            <Input id="productOrService" {...form.register("productOrService")}
                              placeholder={t('submit.step2.productPlaceholder')}
                              aria-invalid={!!e.productOrService} aria-describedby={e.productOrService ? "productOrService-error" : undefined} />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label={t('submit.step2.market')} required error={e.targetMarket?.message} id="targetMarket">
                            <Input id="targetMarket" {...form.register("targetMarket")}
                              placeholder={t('submit.step2.marketPlaceholder')}
                              aria-invalid={!!e.targetMarket} aria-describedby={e.targetMarket ? "targetMarket-error" : undefined} />
                            <GuidedChips options={AUDIENCE_SUGGESTIONS}
                              onSelect={(val) => form.setValue("targetMarket", v.targetMarket ? `${v.targetMarket}, ${val}` : val, { shouldValidate: true, shouldDirty: true })} />
                          </Field>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Step 3: Brief ── */}
                  {step === 3 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1}
                        className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <Target className="w-5 h-5 text-[#7C6EFA]" />
                        {t('submit.step3.title')}
                      </h2>
                      <Field label={t('submit.step3.goal')} required error={e.goal?.message} id="goal">
                        <Textarea id="goal" {...form.register("goal")} rows={4}
                          placeholder={t('submit.step3.goalPlaceholder')}
                          aria-invalid={!!e.goal} aria-describedby={e.goal ? "goal-error" : undefined} />
                        <GuidedChips options={GOAL_SUGGESTIONS}
                          onSelect={(val) => form.setValue("goal", v.goal ? `${v.goal}. ${val}` : val, { shouldValidate: true, shouldDirty: true })} />
                      </Field>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Field label={t('submit.step3.style')} error={e.stylePreference?.message} id="stylePreference">
                          <Input id="stylePreference" {...form.register("stylePreference")}
                            placeholder={t('submit.step3.stylePlaceholder')} />
                          <GuidedChips options={STYLE_SUGGESTIONS}
                            onSelect={(val) => form.setValue("stylePreference", val, { shouldDirty: true })} />
                        </Field>
                        <Field label={t('submit.step3.color')} error={e.colorPreference?.message} id="colorPreference">
                          <Input id="colorPreference" {...form.register("colorPreference")}
                            placeholder={t('submit.step3.colorPlaceholder')} />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label={t('submit.step3.refs')} error={e.referenceLinks?.message} id="referenceLinks">
                            <Input id="referenceLinks" {...form.register("referenceLinks")}
                              placeholder={t('submit.step3.refsPlaceholder')} />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label={t('submit.step3.notes')} error={e.notes?.message} id="notes">
                            <Textarea id="notes" {...form.register("notes")} rows={3}
                              placeholder={t('submit.step3.notesPlaceholder')} />
                          </Field>
                        </div>
                        <Field label={t('submit.step3.deadline')} error={e.deadline?.message} id="deadline">
                          <Input id="deadline" {...form.register("deadline")}
                            placeholder={t('submit.step3.deadlinePlaceholder')} />
                          <div className="flex items-center gap-1 mt-1 text-xs text-[#4F6494]">
                            <Clock className="w-3 h-3" /> {t('submit.step3.deadlineHint')}
                          </div>
                        </Field>
                      </div>
                    </>
                  )}

                  {/* ── Step 4: Confirm ── */}
                  {step === 4 && (
                    <>
                      <h2 ref={stepHeadingRef} tabIndex={-1}
                        className="font-display font-bold text-xl text-[#F0F4FF] mb-4 flex items-center gap-2 outline-none"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        <FileText className="w-5 h-5 text-[#7C6EFA]" />
                        {t('submit.step4.title')}
                      </h2>

                      {[
                        { heading: t('submit.step4.contact'), step: 1, rows: [
                          { label: t('submit.step4.nameLabel'),  value: v.clientName },
                          { label: t('submit.step4.emailLabel'), value: v.clientEmail },
                          { label: t('submit.step4.phoneLabel'), value: v.clientPhone },
                        ] },
                        { heading: t('submit.step4.brand'), step: 2, rows: [
                          { label: t('submit.step4.brandLabel'), value: v.brandName },
                          { label: t('submit.step4.typeLabel'),  value: v.businessType },
                          { label: t('submit.step4.marketLabel'), value: v.targetMarket },
                        ] },
                        { heading: t('submit.step4.brief'), step: 3, rows: [
                          { label: t('submit.step4.goalLabel'),  value: v.goal },
                          { label: t('submit.step4.styleLabel'), value: v.stylePreference },
                          { label: t('submit.step4.deadlineLabel'), value: v.deadline },
                        ] },
                      ].map((section) => (
                        <div key={section.heading} className="mb-4 rounded-xl border border-[#243352] p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wide">{section.heading}</h3>
                            <button type="button" onClick={() => goToStep(section.step)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#9D91FB] hover:underline">
                              <Pencil className="w-3 h-3" /> {t('common.edit')}
                            </button>
                          </div>
                          <div className="space-y-2">
                            {section.rows.map((row) => (
                              <div key={row.label} className="flex gap-3">
                                <span className="text-xs font-semibold text-[#8B9BC4] w-28 shrink-0 pt-0.5">{row.label}</span>
                                <span className="text-sm text-[#F0F4FF] font-medium">
                                  {row.value?.trim() ? row.value : <em className="text-[#4F6494] not-italic font-normal">{t('common.notProvided')}</em>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="mt-5 p-4 rounded-xl flex items-start gap-3 bg-[#7C6EFA]/[0.08] border border-[#7C6EFA]/20">
                        <Sparkles className="w-4 h-4 text-[#7C6EFA] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-[#F0F4FF] mb-0.5">{t('submit.step4.nextStepsTitle')}</p>
                          <p className="text-xs text-[#8B9BC4]">{t('submit.step4.nextStepsDesc')}</p>
                        </div>
                      </div>

                      <label className="mt-4 flex items-start gap-3 p-3 rounded-xl border border-[#243352] bg-[#131E35] cursor-pointer">
                        <input type="checkbox" checked={confirmed}
                          onChange={(ev) => setConfirmed(ev.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-[#7C6EFA] shrink-0" />
                        <span className="text-sm text-[#F0F4FF]">{t('submit.step4.confirmLabel')}</span>
                      </label>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              <div className="px-6 md:px-8 pb-6 md:pb-8 pt-4 border-t border-[#243352] flex items-center justify-between gap-3">
                {step > 1 ? (
                  <button type="button" onClick={() => setStep(s => s - 1)} className="btn-ghost text-sm py-2.5 px-5">
                    <ArrowLeft className="w-4 h-4" /> {t('submit.buttons.back')}
                  </button>
                ) : <div />}

                {step < 4 ? (
                  <button type="button" onClick={goNext} disabled={!canAdvance(step)}
                    className="btn-primary text-sm py-2.5 px-6 disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('submit.buttons.next')} <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button type="submit" disabled={submitProject.isPending || !confirmed}
                    title={!confirmed ? t('submit.buttons.confirmHint') : undefined}
                    className="btn-primary text-sm py-2.5 px-8 disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitProject.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {t('submit.buttons.sending')}</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> {t('submit.buttons.send')}</>
                    )}
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="mt-4 text-center text-xs text-[#4F6494]">
            {t('submit.progress', { step, total: STEPS.length })}
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
