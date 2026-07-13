import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2, ArrowRight, Sparkles, Copy, Check,
  LayoutDashboard, FileText, Clock, Users, Bell, Star, Headphones,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type Particle = { id: number; x: number; y: number; size: number; color: string; rotation: number; drift: number; speed: number; shape: "rect" | "circle" | "triangle" };
const CONFETTI_COLORS = ["#F97316", "#EA580C", "#F59E0B", "#10B981", "#22D3EE", "#0F172A", "#FFFFFF"];

function Confetti({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    if (!active) return;
    const shapes: Particle["shape"][] = ["rect", "circle", "triangle"];
    setParticles(Array.from({ length: 64 }, (_, i) => ({
      id: i, x: Math.random() * 100, y: -10 - Math.random() * 20,
      size: 6 + Math.random() * 10,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * 360, drift: -30 + Math.random() * 60,
      speed: 2 + Math.random() * 4,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    })));
  }, [active]);
  if (!active || !particles.length) return null;
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {particles.map((p) => (
        <motion.div key={p.id} className="absolute"
          initial={{ x: `${p.x}vw`, y: `${p.y}vh`, rotate: p.rotation, opacity: 1 }}
          animate={{ y: "110vh", x: `calc(${p.x}vw + ${p.drift}px)`, rotate: p.rotation + 360 * (2 + Math.random()), opacity: [1, 1, 0] }}
          transition={{ duration: p.speed + 1.5, ease: "linear", delay: Math.random() * 1.2 }}
          style={{ width: p.size, height: p.shape === "circle" ? p.size : p.shape === "rect" ? p.size * 0.5 : p.size,
            background: p.color, borderRadius: p.shape === "circle" ? "50%" : p.shape === "rect" ? 2 : 0,
            clipPath: p.shape === "triangle" ? "polygon(50% 0%, 0% 100%, 100% 100%)" : undefined }} />
      ))}
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
        <div className="text-sm font-mono text-gray-700 truncate">{text}</div>
      </div>
      <button onClick={copy}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
        style={{ background: copied ? "rgba(16,185,129,0.10)" : "rgba(249,115,22,0.08)", border: `1px solid ${copied ? "rgba(16,185,129,0.25)" : "rgba(249,115,22,0.20)"}`, color: copied ? "#10B981" : "#F97316" }}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function SuccessPage() {
  const { t } = useTranslation();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const reviewToken    = params.get("review");
  const dashboardToken = params.get("dashboard");
  const requestId      = params.get("requestId");
  const [confettiOn, setConfettiOn] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    setTimeout(() => setConfettiOn(true), 300);
    setTimeout(() => setConfettiOn(false), 5000);
  }, []);

  const reviewLink    = reviewToken    ? `${window.location.origin}/review/${reviewToken}`    : null;
  const dashboardLink = dashboardToken ? `${window.location.origin}/workspace/${dashboardToken}` : null;

  const steps = [
    { label: t('success.progress.briefReceived'), done: true },
    { label: t('success.progress.aiAnalysis'),    done: true },
    { label: t('success.progress.quotation'),      done: false },
    { label: t('success.progress.production'),     done: false },
    { label: t('success.progress.delivery'),       done: false },
  ];

  const nextSteps = [
    { icon: Clock,  color: "#F97316", title: t('success.nextSteps.s1.title'), desc: t('success.nextSteps.s1.desc'), time: t('success.nextSteps.s1.time') },
    { icon: FileText, color: "#F59E0B", title: t('success.nextSteps.s2.title'), desc: t('success.nextSteps.s2.desc'), time: t('success.nextSteps.s2.time') },
    { icon: Users, color: "#22D3EE", title: t('success.nextSteps.s3.title'), desc: t('success.nextSteps.s3.desc'), time: t('success.nextSteps.s3.time') },
    { icon: Star,  color: "#10B981", title: t('success.nextSteps.s4.title'), desc: t('success.nextSteps.s4.desc'), time: t('success.nextSteps.s4.time') },
  ];

  const quickActions = [
    { icon: LayoutDashboard, label: t('success.actions.workspace'),  desc: t('success.actions.workspaceDesc'),  primary: true },
    { icon: FileText,        label: t('success.actions.another'),    desc: t('success.actions.anotherDesc'),    href: "/submit" },
    { icon: Headphones,      label: t('success.actions.support'),    desc: t('success.actions.supportDesc'),    href: "#" },
  ];

  return (
    <Layout>
      <Confetti active={confettiOn} />
      <section className="relative min-h-screen py-16 px-4"
        style={{ background: "linear-gradient(160deg, #FAFAF7 0%, #FFF7ED 50%, #FAFAF7 100%)" }}>
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[100px] opacity-30"
          style={{ background: "radial-gradient(ellipse, rgba(249,115,22,0.3) 0%, transparent 70%)" }} />

        <div className="relative container mx-auto max-w-2xl text-center">
          <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
            className="mx-auto w-24 h-24 rounded-full flex items-center justify-center mb-8"
            style={{ background: "linear-gradient(135deg, #F97316, #EA580C)", boxShadow: "0 16px 48px rgba(249,115,22,0.35)" }}>
            <CheckCircle2 className="w-12 h-12 text-white" />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
            <div className="section-chip mx-auto mb-4">
              <Sparkles className="w-3 h-3 animate-pulse" />
              {t('success.badge')}
            </div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-navy mb-4">{t('success.title')}</h1>
            <p className="text-gray-500 text-base max-w-lg mx-auto"
              dangerouslySetInnerHTML={{ __html: t('success.desc') }} />
          </motion.div>

          {/* Progress tracker */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }}
            className="mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-display font-semibold text-base text-navy mb-4">{t('success.progress.title')}</h2>
            <div className="flex items-center gap-0">
              {steps.map((s, i) => (
                <div key={s.label} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${s.done ? "text-white" : "text-gray-300 border-2 border-gray-200"}`}
                      style={s.done ? { background: "linear-gradient(135deg,#F97316,#EA580C)" } : {}}>
                      {s.done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                    </div>
                    <span className={`text-[10px] font-semibold whitespace-nowrap ${s.done ? "text-orange-600" : "text-gray-300"}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="flex-1 h-0.5 mx-1 rounded-full" style={{ background: s.done ? "#F97316" : "#E5E7EB" }} />
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Access links */}
          {(dashboardLink || reviewLink) && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }}
              className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left">
              <h2 className="font-display font-semibold text-base text-navy mb-3 flex items-center gap-2">
                <Bell className="w-4 h-4 text-orange-500" />
                {t('success.saveLinks.title')}
              </h2>
              <div className="space-y-2">
                {dashboardLink && <CopyBtn text={dashboardLink} label={t('success.saveLinks.workspace')} />}
                {reviewLink    && <CopyBtn text={reviewLink}    label={t('success.saveLinks.review')} />}
                {requestId     && <CopyBtn text={requestId}     label={t('success.saveLinks.requestId')} />}
              </div>
              <p className="text-xs text-gray-400 mt-3">{t('success.saveLinks.emailNote')}</p>
            </motion.div>
          )}

          {/* Next steps */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left">
            <h2 className="font-display font-semibold text-base text-navy mb-4">{t('success.nextSteps.title')}</h2>
            <div className="space-y-4">
              {nextSteps.map((s, i) => {
                const Icon = s.icon;
                return (
                  <motion.div key={s.title} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.65 + i * 0.1, duration: 0.4 }} className="flex items-start gap-4">
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: `${s.color}12`, border: `1px solid ${s.color}20` }}>
                        <Icon className="w-4.5 h-4.5" style={{ color: s.color }} />
                      </div>
                      {i < nextSteps.length - 1 && (
                        <div className="absolute left-1/2 top-10 bottom-0 w-px -translate-x-1/2 mt-1"
                          style={{ background: "rgba(15,23,42,0.06)", height: "calc(100% + 16px)" }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-sm text-navy">{s.title}</h3>
                        <span className="text-xs shrink-0 px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: `${s.color}10`, color: s.color }}>
                          {s.time}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Quick actions */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.5 }}
            className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {quickActions.map((a) => {
              const Icon = a.icon;
              const href = a.primary ? (dashboardLink ?? a.href ?? "/") : (a.href ?? "#");
              return (
                <Link key={a.label} href={href}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                    a.primary ? "text-white" : "bg-white border-gray-100 text-navy hover:border-orange-200"
                  }`}
                  style={a.primary ? { background: "linear-gradient(135deg,#F97316,#EA580C)", border: "none", boxShadow: "0 4px 20px rgba(249,115,22,0.25)" } : {}}>
                  <Icon className={`w-5 h-5 ${a.primary ? "text-white" : "text-orange-500"}`} />
                  <div>
                    <div className={`text-xs font-semibold ${a.primary ? "text-white" : "text-navy"}`}>{a.label}</div>
                    <div className={`text-[10px] ${a.primary ? "text-orange-100" : "text-gray-400"}`}>{a.desc}</div>
                  </div>
                </Link>
              );
            })}
          </motion.div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.5 }}
            className="text-xs text-gray-400 mt-6">
            {t('success.footer.help')}{" "}
            <Link href="#" className="text-orange-500 hover:underline font-medium">{t('success.footer.contact')}</Link>
            {" "}{t('success.footer.online')}
          </motion.p>
        </div>
      </section>
    </Layout>
  );
}
