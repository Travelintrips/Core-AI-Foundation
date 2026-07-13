import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import {
  ArrowRight, Sparkles, ChevronRight, Star,
  Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3,
  Users, ShoppingCart, FileText, Headphones, Globe, Package,
  Cpu, Briefcase, Shield, Play, Brain,
  FileCheck, Boxes, PieChart, Building2, Zap,
  CheckCircle2, Clock, BadgeCheck, ExternalLink,
  Lock, Award,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/* ─── ANIMATION VARIANTS ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] } },
};
const stagger = (delay = 0.1) => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
});

/* ─── COUNT-UP HOOK ─── */
function useCountUp(target: number, duration = 1600, inView = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = target / (duration / 16);
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setVal(target); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 16);
    return () => clearInterval(id);
  }, [inView, target, duration]);
  return val;
}

/* ─── SERVICE VERTICALS (names are brand names — same in both languages) ─── */
const SERVICES = [
  { icon: Palette,      name: "Creative AI",        descId: "Brand, desain, konten kreatif",    descEn: "Brand, design, creative content",    badgeKey: "mostPopular", badgeColor: "#F97316", featured: true },
  { icon: TrendingUp,   name: "Marketing AI",        descId: "Campaign, digital, growth",        descEn: "Campaign, digital, growth",          badgeKey: "fastDelivery", badgeColor: "#22D3EE", featured: true },
  { icon: DollarSign,   name: "Finance AI",          descId: "Analisis, laporan, proyeksi",      descEn: "Analysis, reports, projections",     badgeKey: "enterprise",   badgeColor: "#F59E0B", featured: true },
  { icon: BarChart3,    name: "Sales AI",            descId: "Lead gen, proposal, CRM",          descEn: "Lead gen, proposal, CRM" },
  { icon: FileText,     name: "Accounting AI",       descId: "Pembukuan, rekonsiliasi",          descEn: "Bookkeeping, reconciliation",         badgeKey: "enterprise",  badgeColor: "#10B981" },
  { icon: Shield,       name: "Tax AI",              descId: "Pajak, kepatuhan, SPT",            descEn: "Tax, compliance, filings",            badgeKey: "humanReview", badgeColor: "#8B5CF6" },
  { icon: Users,        name: "HR & Payroll AI",     descId: "SDM, penggajian, kontrak",         descEn: "HR, payroll, contracts" },
  { icon: Scale,        name: "Legal AI",            descId: "Kontrak, compliance, dokumen",     descEn: "Contracts, compliance, documents",    badgeKey: "humanReview", badgeColor: "#8B5CF6" },
  { icon: Truck,        name: "Logistics AI",        descId: "Rantai pasok, ekspedisi",          descEn: "Supply chain, shipping" },
  { icon: Globe,        name: "Customs & PPJK AI",   descId: "Kepabeanan, BC, dokumen",          descEn: "Customs, documents",                  badgeKey: "new",        badgeColor: "#22D3EE" },
  { icon: ShoppingCart, name: "Procurement AI",      descId: "Pengadaan, vendor, tender",        descEn: "Procurement, vendor, tender" },
  { icon: Package,      name: "Trading AI",          descId: "Analisis pasar, arbitrase",        descEn: "Market analysis, arbitrage" },
  { icon: PieChart,     name: "Data Analytics AI",   descId: "BI, dashboard, insight",           descEn: "BI, dashboard, insights" },
  { icon: Briefcase,    name: "Executive AI",        descId: "Ringkasan eksekutif, strategi",    descEn: "Executive summaries, strategy",       badgeKey: "enterprise", badgeColor: "#F59E0B" },
  { icon: Headphones,   name: "Customer Service AI", descId: "Support, chatbot, eskalasi",       descEn: "Support, chatbot, escalation" },
];

/* ─── PARTNER COMPANIES ─── */
const PARTNERS = [
  { name: "PT Pertamina", initials: "PT" }, { name: "Bank Mandiri", initials: "BM" },
  { name: "Unilever ID", initials: "UL" }, { name: "Astra Group", initials: "AG" },
  { name: "Tokopedia", initials: "TP" }, { name: "BCA", initials: "BC" },
  { name: "Gojek", initials: "GJ" }, { name: "Telkom", initials: "TK" },
];

/* ─── TRUST STATS ─── */
const TRUST_STAT_DEFS = [
  { value: 500,   suffix: "+", icon: Building2, color: "#7C6EFA", labelKey: "landing.trust.clients" },
  { value: 15,    suffix: "",  icon: Brain,      color: "#22D3EE", labelKey: "landing.trust.servicesCount" },
  { value: 99,    suffix: "%", icon: Star,       color: "#F59E0B", labelKey: "landing.trust.satisfaction" },
  { value: 48000, suffix: "+", icon: Clock,      color: "#10B981", labelKey: "landing.stats.hours" },
];

/* ─── NOISE TEXTURE ─── */
function NoiseTexture() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ opacity: 0.028, mixBlendMode: "overlay" }} xmlns="http://www.w3.org/2000/svg">
      <filter id="ln-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="4" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#ln-noise)" />
    </svg>
  );
}

/* ─── DASHBOARD MOCKUP ─── */
function DashboardMockup() {
  const { t } = useTranslation();
  const ACTIVITY_FEED = [
    { agent: "Creative AI",  status: t('landing.activity.generating'), dot: "#F97316" },
    { agent: "Finance AI",   status: t('landing.activity.completed'),  dot: "#10B981" },
    { agent: "Legal AI",     status: t('landing.activity.reviewing'),  dot: "#F59E0B" },
    { agent: "Marketing AI", status: t('landing.activity.processing'), dot: "#22D3EE" },
  ];

  const [progressA, setProgressA] = useState(62);
  const [progressC, setProgressC] = useState(35);
  const [savedHours, setSavedHours] = useState(312);
  const [activityIdx, setActivityIdx] = useState(0);

  useEffect(() => {
    const pid = setInterval(() => {
      setProgressA(p => p < 68 ? p + 0.08 : p);
      setProgressC(p => p < 48 ? p + 0.06 : p);
    }, 80);
    const cid = setInterval(() => { setSavedHours(h => h < 324 ? h + 1 : h); }, 250);
    const aid = setInterval(() => { setActivityIdx(i => (i + 1) % ACTIVITY_FEED.length); }, 2200);
    return () => { clearInterval(pid); clearInterval(cid); clearInterval(aid); };
  }, []);

  const PROJECTS = [
    { name: "Brand Refresh Q1",   status: "PRODUKSI", pct: progressA, color: "#F97316" },
    { name: "Marketing Campaign", status: "REVIEW",   pct: 92,        color: "#22D3EE" },
    { name: "Finance Report Q4",  status: "ANALISIS", pct: progressC, color: "#F59E0B" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-lg mx-auto">
      <div className="absolute -inset-4 rounded-3xl pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(124,110,250,0.20) 0%, transparent 70%)" }} />
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: "#0D1526", border: "1px solid rgba(124,110,250,0.22)",
          boxShadow: "0 32px 80px rgba(6,11,24,0.80), 0 0 0 1px rgba(124,110,250,0.10), 0 0 60px rgba(124,110,250,0.10)",
          transform: "perspective(1200px) rotateX(2deg) rotateY(-1deg)" }}>
        <div className="flex items-center gap-1.5 px-4 py-3"
          style={{ borderBottom: "1px solid rgba(36,51,82,0.80)", background: "#060B18" }}>
          <div className="w-3 h-3 rounded-full bg-red-500/70" />
          <div className="w-3 h-3 rounded-full bg-amber-400/70" />
          <div className="w-3 h-3 rounded-full bg-emerald-400/70" />
          <div className="ml-3 h-5 rounded flex-1" style={{ maxWidth: 180, background: "rgba(36,51,82,0.60)" }} />
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs" style={{ color: "#8B9BC4" }}>Live</span>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-display font-bold" style={{ color: "#F0F4FF" }}>{t('landing.dashboard.projectOverview')}</div>
              <div className="text-xs" style={{ color: "#8B9BC4" }}>{t('landing.dashboard.activeSubtitle')}</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('landing.dashboard.activeProjects'), value: "3",              color: "#F97316" },
              { label: t('landing.dashboard.completedMonth'), value: "7",              color: "#10B981" },
              { label: t('landing.dashboard.hoursSaved'),     value: String(savedHours), color: "#F59E0B" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3" style={{ background: "#131E35", border: "1px solid #243352" }}>
                <div className="text-xs mb-1" style={{ color: "#8B9BC4" }}>{s.label}</div>
                <div className="text-xl font-display font-bold" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {PROJECTS.map((p) => (
              <div key={p.name} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: "#131E35", border: "1px solid #243352" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate mb-1.5" style={{ color: "#F0F4FF" }}>{p.name}</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: "#243352" }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p.pct}%`, background: p.color }} />
                    </div>
                    <span className="text-xs font-mono min-w-8 text-right" style={{ color: "#8B9BC4" }}>{Math.round(p.pct)}%</span>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-semibold"
                  style={{ background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}30` }}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #243352" }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: "#060B18", borderBottom: "1px solid #243352" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#8B9BC4" }}>{t('landing.dashboard.activityFeed')}</span>
            </div>
            {ACTIVITY_FEED.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 transition-all duration-700"
                style={{ background: i === activityIdx ? "rgba(124,110,250,0.06)" : "#0D1526", opacity: i === activityIdx ? 1 : 0.45 }}>
                <span className="text-xs" style={{ color: "#8B9BC4" }}>{item.agent}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                  <span className="text-xs font-medium" style={{ color: item.dot }}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.20)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "#7C6EFA" }} />
            <span className="text-xs" style={{ color: "#9D91FB" }}>{t('landing.dashboard.aiInsight')}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── TRUST STATS SECTION ─── */
function TrustStats() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const v0 = useCountUp(TRUST_STAT_DEFS[0].value, 1600, inView);
  const v1 = useCountUp(TRUST_STAT_DEFS[1].value, 900,  inView);
  const v2 = useCountUp(TRUST_STAT_DEFS[2].value, 1400, inView);
  const v3 = useCountUp(TRUST_STAT_DEFS[3].value, 2000, inView);
  const vals = [v0, v1, v2, v3];

  return (
    <motion.section ref={ref}
      className="py-20 px-4 relative overflow-hidden"
      style={{ background: "#0D1526", borderTop: "1px solid #243352", borderBottom: "1px solid #243352" }}
      initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 80% at 50% 50%, rgba(124,110,250,0.05) 0%, transparent 70%)" }} />
      <div className="relative container mx-auto max-w-5xl">
        <motion.p className="text-center text-xs font-semibold uppercase tracking-widest mb-12" style={{ color: "#4F6494" }} variants={fadeUp}>
          {t('landing.stats.label')}
        </motion.p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 md:gap-6">
          {TRUST_STAT_DEFS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.labelKey}
                className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl"
                style={{ background: "rgba(13,21,38,0.80)", border: "1px solid #243352", boxShadow: "0 2px 8px rgba(6,11,24,0.40)" }}
                variants={fadeUp}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: `${s.color}14`, border: `1px solid ${s.color}28`, boxShadow: `0 0 20px ${s.color}10` }}>
                  <Icon className="w-5 h-5" style={{ color: s.color }} />
                </div>
                <div>
                  <div className="font-display font-bold text-3xl md:text-4xl" style={{ color: "#F0F4FF" }}>
                    {vals[i].toLocaleString("id-ID")}{s.suffix}
                  </div>
                  <div className="text-xs mt-1.5 leading-relaxed" style={{ color: "#8B9BC4" }}>{t(s.labelKey)}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

/* ═══════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════ */
export default function LandingPage() {
  const { t, lang } = useTranslation();

  const HOW_IT_WORKS_STEPS = [
    { num: "01", icon: FileText, title: t('landing.steps.s1.title'), desc: t('landing.steps.s1.desc'), time: t('landing.steps.s1.time'), color: "#7C6EFA" },
    { num: "02", icon: Brain,    title: t('landing.steps.s2.title'), desc: t('landing.steps.s2.desc'), time: t('landing.steps.s2.time'), color: "#22D3EE" },
    { num: "03", icon: Users,    title: t('landing.steps.s3.title'), desc: t('landing.steps.s3.desc'), time: t('landing.steps.s3.time'), color: "#F59E0B" },
    { num: "04", icon: Boxes,    title: t('landing.steps.s4.title'), desc: t('landing.steps.s4.desc'), time: t('landing.steps.s4.time'), color: "#10B981" },
  ];

  const TESTIMONIALS = [
    {
      quote: t('landing.testimonials.t1.quote'),
      name: "Sari Wulandari", title: "Head of Marketing", company: "PT Retail Indonesia",
      metrics: [
        { label: t('landing.testimonials.t1.metrics[0].label'), value: t('landing.testimonials.t1.metrics[0].value'), color: "#7C6EFA" },
        { label: t('landing.testimonials.t1.metrics[1].label'), value: t('landing.testimonials.t1.metrics[1].value'), color: "#10B981" },
      ],
      initials: "SW",
    },
    {
      quote: t('landing.testimonials.t2.quote'),
      name: "Ahmad Fauzi", title: "Logistics Director", company: "PT Maju Freight",
      metrics: [
        { label: t('landing.testimonials.t2.metrics[0].label'), value: t('landing.testimonials.t2.metrics[0].value'), color: "#22D3EE" },
        { label: t('landing.testimonials.t2.metrics[1].label'), value: t('landing.testimonials.t2.metrics[1].value'), color: "#10B981" },
      ],
      initials: "AF",
    },
    {
      quote: t('landing.testimonials.t3.quote'),
      name: "Dewi Kusuma", title: "Finance Director", company: "PT Sentosa Group",
      metrics: [
        { label: t('landing.testimonials.t3.metrics[0].label'), value: t('landing.testimonials.t3.metrics[0].value'), color: "#F59E0B" },
        { label: t('landing.testimonials.t3.metrics[1].label'), value: t('landing.testimonials.t3.metrics[1].value'), color: "#10B981" },
      ],
      initials: "DK",
    },
  ];

  const BADGE_MAP: Record<string, string> = {
    mostPopular: t('landing.services.mostPopular'),
    fastDelivery: t('landing.services.fastDelivery'),
    enterprise: t('landing.services.enterprise'),
    humanReview: t('landing.services.humanReview'),
    new: t('landing.services.new'),
  };

  return (
    <Layout>

      {/* ── HERO ──────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ minHeight: "100vh", display: "flex", alignItems: "center", background: "#060B18" }}>
        <NoiseTexture />
        <div className="pointer-events-none absolute" style={{ top: "-10%", right: "-5%", width: "55%", height: "65%", background: "radial-gradient(ellipse at center, rgba(124,110,250,0.16) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute" style={{ bottom: "0%", left: "-5%", width: "40%", height: "50%", background: "radial-gradient(ellipse at center, rgba(34,211,238,0.07) 0%, transparent 65%)" }} />
        <div className="pointer-events-none absolute" style={{ bottom: "-15%", left: "30%", width: "40%", height: "60%", background: "radial-gradient(ellipse at center, rgba(95,82,208,0.10) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute animate-float-orb" style={{ top: "18%", right: "28%", width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,110,250,0.07) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute animate-float-orb-b" style={{ top: "55%", right: "12%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.05) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute" style={{ backgroundImage: "linear-gradient(rgba(240,244,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,255,0.025) 1px, transparent 1px)", backgroundSize: "80px 80px", inset: 0, position: "absolute" }} />

        <div className="relative z-10 container mx-auto px-4 md:px-8 max-w-7xl py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div className="space-y-8 text-center lg:text-left" initial="hidden" animate="show" variants={stagger(0.12)}>
              <motion.div variants={fadeUp}>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
                  style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.28)", color: "#A89EFC", boxShadow: "0 0 20px rgba(124,110,250,0.10)" }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#7C6EFA" }} />
                  ✦ {t('landing.badge')}
                  <ChevronRight className="w-3 h-3 opacity-50" />
                </div>
              </motion.div>

              <motion.div className="space-y-5" variants={fadeUp}>
                <h1 className="font-display font-bold leading-[1.06] tracking-tight"
                  style={{ fontSize: "clamp(2.6rem, 5.5vw, 4.25rem)", color: "#F0F4FF", letterSpacing: "-0.03em" }}>
                  {t('landing.hero.title1')}<br />
                  {t('landing.hero.title2')}{" "}
                  <span className="text-gradient-primary italic">{t('landing.hero.titleHighlight')}</span>
                  {" "}{t('landing.hero.title3')}
                </h1>
                <p className="text-lg leading-relaxed max-w-xl mx-auto lg:mx-0" style={{ color: "#6B7FA8" }}>
                  {t('landing.hero.desc')}
                </p>
              </motion.div>

              <motion.div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start" variants={fadeUp}>
                <Link href="/services"
                  className="inline-flex items-center justify-center gap-2 font-semibold text-base text-white rounded-full transition-all"
                  style={{ padding: "14px 28px", background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", boxShadow: "0 4px 24px rgba(124,110,250,0.40), 0 1px 0 rgba(255,255,255,0.10) inset" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ""; (e.currentTarget as HTMLElement).style.transform = ""; }}>
                  {t('landing.cta.start')} <ArrowRight className="w-5 h-5" />
                </Link>
                <button
                  className="inline-flex items-center justify-center gap-2 font-semibold text-base rounded-full transition-all"
                  style={{ padding: "14px 28px", color: "#C8D0E8", border: "1.5px solid rgba(240,244,255,0.14)", background: "rgba(240,244,255,0.03)" }}
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.40)"; (e.currentTarget as HTMLElement).style.color = "#F0F4FF"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.14)"; (e.currentTarget as HTMLElement).style.color = "#C8D0E8"; }}>
                  <Play className="w-4 h-4" /> {t('landing.cta.demo')}
                </button>
              </motion.div>

              <motion.div className="flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 pt-5"
                style={{ borderTop: "1px solid rgba(36,51,82,0.70)" }} variants={fadeUp}>
                {[
                  { icon: Building2,   value: "2,400+", label: t('landing.trust.clients') },
                  { icon: Sparkles,    value: "15",     label: t('landing.trust.servicesCount') },
                  { icon: CheckCircle2, value: "99.2%", label: t('landing.trust.satisfaction') },
                  { icon: TrendingUp,  value: "4.8×",  label: t('landing.trust.roi') },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.label} className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: "#7C6EFA" }} />
                      <span className="font-display font-bold text-base" style={{ color: "#F0F4FF" }}>{s.value}</span>
                      <span className="text-xs" style={{ color: "#6B7FA8" }}>{s.label}</span>
                    </div>
                  );
                })}
              </motion.div>
            </motion.div>

            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── PARTNER LOGOS ─────────────────────────── */}
      <section className="py-10 relative overflow-hidden" style={{ background: "#0D1526", borderTop: "1px solid #1C2A40", borderBottom: "1px solid #1C2A40" }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl mb-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest" style={{ color: "#4F6494" }}>
            {t('landing.partners.label')}
          </p>
        </div>
        <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
          {[0, 1].map((track) => (
            <div key={track} className="flex gap-4 animate-marquee shrink-0" aria-hidden>
              {[...PARTNERS, ...PARTNERS].map((p, i) => (
                <div key={`${track}-${i}`}
                  className="flex items-center gap-2.5 px-5 py-2.5 rounded-full shrink-0 select-none"
                  style={{ background: "rgba(240,244,255,0.03)", border: "1px solid rgba(240,244,255,0.07)" }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: "rgba(124,110,250,0.12)", color: "#9D91FB", border: "1px solid rgba(124,110,250,0.18)" }}>
                    {p.initials}
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "#6B7FA8" }}>{p.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── TRUST STATS ───────────────────────────── */}
      <TrustStats />

      {/* ── SERVICES GRID ─────────────────────────── */}
      <section className="py-24 px-4 relative overflow-hidden" style={{ background: "#060B18" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 100%, rgba(124,110,250,0.06) 0%, transparent 70%)" }} />
        <div className="relative container mx-auto max-w-7xl">
          <motion.div className="text-center mb-16 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.22)", color: "#9D91FB" }}>
                <Sparkles className="w-3 h-3" />
                {t('landing.services.badge', { count: 15 })}
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              {t('landing.services.title')}<br className="hidden md:block" />
              {t('landing.services.titleSuffix')}
            </motion.h2>
            <motion.p className="text-base max-w-xl mx-auto leading-relaxed" style={{ color: "#6B7FA8" }} variants={fadeUp}>
              {t('landing.services.subtitle')}
            </motion.p>
          </motion.div>

          {/* Featured row */}
          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            {SERVICES.filter(s => s.featured).map((svc) => {
              const Icon = svc.icon;
              const badgeLabel = svc.badgeKey ? BADGE_MAP[svc.badgeKey] : undefined;
              return (
                <motion.div key={svc.name} variants={fadeUp}>
                  <Link href="/services" className="service-card-featured group relative flex flex-col gap-4 p-6 rounded-2xl cursor-pointer" style={{ display: "flex" }}>
                    {badgeLabel && (
                      <div className="absolute top-4 right-4 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: `${svc.badgeColor}14`, color: svc.badgeColor, border: `1px solid ${svc.badgeColor}28` }}>
                        {badgeLabel}
                      </div>
                    )}
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.18) 0%, rgba(95,82,208,0.10) 100%)", border: "1px solid rgba(124,110,250,0.22)", boxShadow: "0 0 16px rgba(124,110,250,0.10)" }}>
                      <Icon className="w-5 h-5" style={{ color: "#9D91FB" }} />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-base mb-1.5" style={{ color: "#F0F4FF" }}>{svc.name}</h3>
                      <p className="text-sm leading-relaxed" style={{ color: "#6B7FA8" }}>{lang === "en" ? svc.descEn : svc.descId}</p>
                    </div>
                    <div className="mt-auto pt-3 flex items-center gap-1 text-xs font-semibold transition-all duration-200 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0"
                      style={{ borderTop: "1px solid rgba(36,51,82,0.80)", color: "#9D91FB" }}>
                      {t('nav.services')} <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Other services grid */}
          <motion.div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.05)}>
            {SERVICES.filter(s => !s.featured).map((svc) => {
              const Icon = svc.icon;
              const badgeLabel = svc.badgeKey ? BADGE_MAP[svc.badgeKey] : undefined;
              return (
                <motion.div key={svc.name} variants={fadeUp}>
                  <Link href="/services" className="service-card-sm group flex flex-col items-center gap-2 p-4 rounded-xl text-center cursor-pointer" style={{ display: "flex" }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.16)" }}>
                      <Icon className="w-4 h-4" style={{ color: "#9D91FB" }} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold leading-snug" style={{ color: "#C8D0E8" }}>{svc.name}</div>
                      {badgeLabel && (
                        <div className="mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block"
                          style={{ background: `${svc.badgeColor}12`, color: svc.badgeColor }}>
                          {badgeLabel}
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>

          <div className="text-center mt-12">
            <Link href="/services"
              className="inline-flex items-center gap-2 font-semibold text-sm rounded-full transition-all"
              style={{ padding: "12px 24px", border: "1.5px solid rgba(124,110,250,0.30)", color: "#9D91FB", background: "rgba(124,110,250,0.06)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(124,110,250,0.12)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(124,110,250,0.06)"; }}>
              {t('landing.services.viewAll')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────── */}
      <section id="how-it-works" className="py-24 px-4 relative overflow-hidden" style={{ background: "#0D1526", borderTop: "1px solid #1C2A40" }}>
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(240,244,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,255,0.015) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative container mx-auto max-w-5xl">
          <motion.div className="text-center mb-16 space-y-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)", color: "#22D3EE" }}>
                <Zap className="w-3 h-3" /> {t('landing.howItWorks.badge')}
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              {t('landing.howItWorks.title')}<br className="hidden md:block" />{t('landing.howItWorks.titleSuffix')}
            </motion.h2>
            <motion.p className="text-base max-w-lg mx-auto" style={{ color: "#6B7FA8" }} variants={fadeUp}>
              {t('landing.howItWorks.subtitle')}
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {HOW_IT_WORKS_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div key={step.num}
                  initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.10, duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] }}
                  viewport={{ once: true }} className="relative">
                  {i < HOW_IT_WORKS_STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-9 left-[calc(50%+36px)] right-[-8px] h-px"
                      style={{ background: `linear-gradient(to right, ${step.color}40, rgba(36,51,82,0.40))` }} />
                  )}
                  <div className="flex flex-col items-center text-center gap-4 p-5 rounded-2xl h-full"
                    style={{ background: "rgba(13,21,38,0.60)", border: "1px solid #1C2A40", boxShadow: "0 2px 8px rgba(6,11,24,0.40)" }}>
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                        style={{ background: `${step.color}12`, border: `1px solid ${step.color}22` }}>
                        <Icon className="w-7 h-7" style={{ color: step.color }} />
                      </div>
                      <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: step.color, color: "#060B18" }}>{i + 1}</div>
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-base mb-2" style={{ color: "#F0F4FF" }}>{step.title}</h3>
                      <p className="text-sm leading-relaxed" style={{ color: "#6B7FA8" }}>{step.desc}</p>
                    </div>
                    <div className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                      style={{ background: `${step.color}10`, color: step.color, border: `1px solid ${step.color}22` }}>
                      <Clock className="w-3 h-3" /> {step.time}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────── */}
      <section className="py-24 px-4 relative overflow-hidden" style={{ background: "#060B18", borderTop: "1px solid #1C2A40" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(245,158,11,0.04) 0%, transparent 70%)" }} />
        <div className="relative container mx-auto max-w-5xl">
          <motion.div className="text-center mb-14 space-y-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "#F59E0B" }}>
                <Star className="w-3 h-3 fill-amber-500" /> {t('landing.testimonials.badge')}
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              {t('landing.testimonials.title')}<br className="hidden md:block" />{t('landing.testimonials.titleSuffix')}
            </motion.h2>
          </motion.div>

          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-5" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
            {TESTIMONIALS.map((tm) => (
              <motion.div key={tm.name} variants={fadeUp}
                className="relative rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:-translate-y-1"
                style={{ background: "#0D1526", border: "1px solid #1C2A40", boxShadow: "0 2px 8px rgba(6,11,24,0.50)" }}>
                <div className="absolute top-3 right-5 font-display font-bold leading-none select-none"
                  style={{ fontSize: "5rem", color: "rgba(124,110,250,0.07)", lineHeight: 1 }}>"</div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (<Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />))}
                </div>
                <p className="text-sm leading-relaxed flex-1" style={{ color: "#8B9BC4" }}>"{tm.quote}"</p>
                <div className="grid grid-cols-2 gap-2">
                  {tm.metrics.map((m) => (
                    <div key={m.label} className="text-center rounded-xl p-2.5" style={{ background: `${m.color}08`, border: `1px solid ${m.color}18` }}>
                      <div className="font-display font-bold text-lg" style={{ color: m.color }}>{m.value}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: "#6B7FA8" }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid rgba(36,51,82,0.70)" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                    style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", boxShadow: "0 2px 8px rgba(124,110,250,0.30)" }}>
                    {tm.initials}
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "#F0F4FF" }}>{tm.name}</div>
                    <div className="text-xs" style={{ color: "#6B7FA8" }}>{tm.title} · {tm.company}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA FINAL ─────────────────────────────── */}
      <section className="py-28 px-4 relative overflow-hidden" style={{ background: "#0A0F1E" }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(124,110,250,0.18) 0%, transparent 65%)" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 40% 50% at 20% 50%, rgba(34,211,238,0.06) 0%, transparent 70%)" }} />
        <NoiseTexture />
        <div className="absolute top-0 inset-x-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(124,110,250,0.50) 30%, rgba(34,211,238,0.30) 70%, transparent)" }} />

        <div className="relative z-10 container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] }}
            viewport={{ once: true }} className="space-y-7">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
              style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.28)", color: "#9D91FB" }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: "#7C6EFA" }} />
              {t('landing.finalCta.badge')}
            </div>
            <h2 className="font-display font-bold" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)", color: "#F0F4FF", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {t('landing.finalCta.title')}{" "}
              <span className="text-gradient-primary italic">{t('landing.finalCta.titleSuffix')}</span>
            </h2>
            <p className="text-lg max-w-xl mx-auto leading-relaxed" style={{ color: "#6B7FA8" }}>
              {t('landing.finalCta.desc')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Link href="/services"
                className="inline-flex items-center justify-center gap-2 font-semibold text-base text-white rounded-full transition-all"
                style={{ padding: "15px 32px", background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", boxShadow: "0 4px 24px rgba(124,110,250,0.45), 0 1px 0 rgba(255,255,255,0.10) inset" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ""; (e.currentTarget as HTMLElement).style.transform = ""; }}>
                {t('landing.finalCta.start')} <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/access"
                className="inline-flex items-center justify-center gap-2 font-semibold text-base rounded-full transition-all"
                style={{ padding: "15px 32px", color: "#C8D0E8", border: "1.5px solid rgba(240,244,255,0.14)", background: "rgba(240,244,255,0.03)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.28)"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#F0F4FF"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.14)"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.03)"; (e.currentTarget as HTMLElement).style.color = "#C8D0E8"; }}>
                <ExternalLink className="w-4 h-4" /> {t('nav.clientLogin')}
              </Link>
            </div>
            <div className="flex flex-wrap justify-center gap-3 pt-4">
              {[
                { icon: Brain,        label: "150+ AI Specialists" },
                { icon: CheckCircle2, label: "500+ Projects Delivered" },
                { icon: Lock,         label: t('landing.security.badge') },
                { icon: Award,        label: "Commercial Ready" },
              ].map(({ icon: Icon, label }) => (
                <div key={label}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ color: "#8B9BC4", background: "rgba(240,244,255,0.04)", border: "1px solid rgba(240,244,255,0.07)" }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: "#7C6EFA" }} />
                  {label}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
