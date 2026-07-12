import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import {
  ArrowRight, Sparkles, ChevronRight, Star, CheckCircle,
  Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3,
  Users, ShoppingCart, FileText, Headphones, Globe, Package,
  Cpu, Briefcase, Shield, Play, Quote, Brain,
  FileCheck, Boxes, PieChart, Building2, Zap,
  CheckCircle2, Clock, BadgeCheck, ExternalLink,
  Twitter, Linkedin, Github, Mail
} from "lucide-react";

/* ─── FADE UP VARIANT ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
};
const stagger = (delay = 0.1) => ({
  hidden: {},
  show:   { transition: { staggerChildren: delay } },
});

/* ─── COUNT-UP HOOK ─── */
function useCountUp(target: number, duration = 1800, inView = false) {
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

/* ─── SERVICE VERTICALS ─── */
const SERVICES = [
  { icon: Palette,      name: "Creative AI",        desc: "Brand, desain, konten kreatif",    badge: "Most Popular", badgeColor: "#7C6EFA", featured: true },
  { icon: TrendingUp,   name: "Marketing AI",        desc: "Campaign, digital, growth",        badge: "Fast Delivery", badgeColor: "#22D3EE", featured: true },
  { icon: DollarSign,   name: "Finance AI",          desc: "Analisis, laporan, proyeksi",      badge: "Enterprise",    badgeColor: "#F59E0B", featured: true },
  { icon: BarChart3,    name: "Sales AI",            desc: "Lead gen, proposal, CRM" },
  { icon: FileText,     name: "Accounting AI",       desc: "Pembukuan, rekonsiliasi",          badge: "Commercial Ready", badgeColor: "#10B981" },
  { icon: Shield,       name: "Tax AI",              desc: "Pajak, kepatuhan, SPT",            badge: "Human Review", badgeColor: "#8B5CF6" },
  { icon: Users,        name: "HR & Payroll AI",     desc: "SDM, penggajian, kontrak" },
  { icon: Scale,        name: "Legal AI",            desc: "Kontrak, compliance, dokumen",     badge: "Human Review", badgeColor: "#8B5CF6" },
  { icon: Truck,        name: "Logistics AI",        desc: "Rantai pasok, ekspedisi" },
  { icon: Globe,        name: "Customs & PPJK AI",   desc: "Kepabeanan, BC, dokumen",          badge: "New", badgeColor: "#22D3EE" },
  { icon: ShoppingCart, name: "Procurement AI",      desc: "Pengadaan, vendor, tender" },
  { icon: Package,      name: "Trading AI",          desc: "Analisis pasar, arbitrase" },
  { icon: PieChart,     name: "Data Analytics AI",   desc: "BI, dashboard, insight" },
  { icon: Briefcase,    name: "Executive AI",        desc: "Ringkasan eksekutif, strategi",    badge: "Enterprise", badgeColor: "#F59E0B" },
  { icon: Headphones,   name: "Customer Service AI", desc: "Support, chatbot, eskalasi" },
];

/* ─── AI WORKFORCE ─── */
const WORKFORCE = [
  { name: "Creative Director AI",      icon: Palette,      status: "Working",    skill: "Brand Strategy & Visuals",       current: "Redesigning TechCorp brand identity", statusColor: "#7C6EFA" },
  { name: "Finance Analyst AI",        icon: BarChart3,    status: "Available",  skill: "Financial Modeling & Reports",   current: "Ready to analyze your financials",    statusColor: "#10B981" },
  { name: "Tax Consultant AI",         icon: FileCheck,    status: "Thinking",   skill: "Tax Compliance & SPT",           current: "Calculating Q4 tax obligations",      statusColor: "#22D3EE" },
  { name: "Legal Advisor AI",          icon: Scale,        status: "Review",     skill: "Contract & Compliance",          current: "Reviewing NDA for PT Maju Group",     statusColor: "#F59E0B" },
  { name: "Marketing Strategist AI",   icon: TrendingUp,   status: "Working",    skill: "Campaign Planning & Growth",     current: "Building Q1 campaign framework",      statusColor: "#7C6EFA" },
  { name: "Procurement Specialist AI", icon: ShoppingCart, status: "Completed",  skill: "Vendor & Tender Management",     current: "Vendor comparison report delivered",  statusColor: "#10B981" },
  { name: "Supply Chain Planner AI",   icon: Truck,        status: "Available",  skill: "Logistics & Distribution",       current: "Ready for your supply chain brief",   statusColor: "#10B981" },
  { name: "Executive Assistant AI",    icon: Briefcase,    status: "Working",    skill: "Board Reports & Summaries",      current: "Preparing board deck for CEO meeting",statusColor: "#7C6EFA" },
];

const STATUS_CONFIG: Record<string, { bg: string; color: string; dot: string; pulse: boolean }> = {
  Available:  { bg: "rgba(16,185,129,0.1)",   color: "#10B981", dot: "#10B981", pulse: false },
  Working:    { bg: "rgba(124,110,250,0.12)",  color: "#9D91FB", dot: "#7C6EFA", pulse: true  },
  Thinking:   { bg: "rgba(34,211,238,0.1)",   color: "#22D3EE", dot: "#22D3EE", pulse: true  },
  Review:     { bg: "rgba(245,158,11,0.1)",   color: "#F59E0B", dot: "#F59E0B", pulse: false },
  Completed:  { bg: "rgba(16,185,129,0.1)",   color: "#10B981", dot: "#10B981", pulse: false },
};

/* ─── HOW IT WORKS ─── */
const STEPS = [
  { num: "01", icon: FileText,   emoji: "📝", title: "Submit Brief",   desc: "Ceritakan proyek Anda melalui formulir terstruktur. AI kami akan membaca dan memahami konteks bisnis Anda.",  time: "< 5 menit"  },
  { num: "02", icon: Brain,      emoji: "🤖", title: "AI Analysis",    desc: "Sistem AI menganalisis brief, menyusun tim virtual, dan memberikan estimasi scope dan biaya secara otomatis.", time: "< 2 jam"    },
  { num: "03", icon: Users,      emoji: "👨‍💼", title: "Human Review",  desc: "Spesialis manusia kami mereview hasil AI, memastikan kualitas dan akurasi sebelum dikirim ke Anda.",         time: "Termonitor" },
  { num: "04", icon: Boxes,      emoji: "📦", title: "Delivery",       desc: "Hasil kerja dikirim ke workspace Anda. Review, setujui, dan download aset siap pakai.",                      time: "On time"    },
];

/* ─── TESTIMONIALS ─── */
const TESTIMONIALS = [
  {
    quote: "Creative AI menghemat 320 jam kerja per bulan untuk tim marketing kami. Kualitasnya setara agency besar, dengan kecepatan yang tidak masuk akal.",
    name: "Sari Wulandari",
    title: "Head of Marketing",
    company: "PT Retail Indonesia",
    rating: 5,
    metrics: [
      { label: "Jam Dihemat", value: "320/bln" },
      { label: "Cost Reduction", value: "42%" },
    ],
  },
  {
    quote: "Dokumen customs yang dulu membutuhkan 3 hari pengerjaan, kini selesai dalam 4 jam. Akurasi HS Code-nya jauh lebih baik dari tim manual kami.",
    name: "Ahmad Fauzi",
    title: "Logistics Director",
    company: "PT Maju Freight",
    rating: 5,
    metrics: [
      { label: "Waktu Dihemat", value: "91%" },
      { label: "Akurasi", value: "99.2%" },
    ],
  },
  {
    quote: "Finance AI kami gunakan untuk menyusun laporan board setiap bulan. Analisisnya tajam, presentasinya eksekutif. CEO kami sangat terkesan.",
    name: "Dewi Kusuma",
    title: "Finance Director",
    company: "PT Sentosa Group",
    rating: 5,
    metrics: [
      { label: "ROI", value: "+38%" },
      { label: "Error Rate", value: "0.1%" },
    ],
  },
];

/* ─── TRUST STATS ─── */
const TRUST_STATS = [
  { value: 500,  suffix: "+", label: "Enterprise clients",      icon: Building2  },
  { value: 15,   suffix: "",  label: "Layanan AI profesional",  icon: Brain      },
  { value: 99,   suffix: "%", label: "Tingkat kepuasan klien",  icon: Star       },
  { value: 48000,suffix: "+", label: "Jam kerja dihemat/bulan", icon: Clock      },
];

/* ─── PRICING PLANS ─── */
const PLANS = [
  {
    name: "Starter",
    tag: null,
    price: "2.500.000",
    period: "/bulan",
    desc: "Untuk tim yang baru memulai transformasi AI",
    features: ["3 proyek aktif", "Creative & Marketing AI", "Support email", "Workspace dasar"],
    missing: ["Analytics lanjutan", "Priority support", "Multi-user"],
    cta: "Coba Gratis",
    ctaVariant: "ghost" as const,
    highlight: false,
  },
  {
    name: "Professional",
    tag: "Most Chosen · Best Value",
    price: "8.500.000",
    period: "/bulan",
    desc: "Paling populer untuk perusahaan berkembang",
    features: ["10 proyek aktif", "Semua 15 layanan AI", "Priority support", "Analytics & laporan", "Multi-user (5 seat)", "API access"],
    missing: [],
    cta: "Mulai Sekarang",
    ctaVariant: "primary" as const,
    highlight: true,
    badge: "Terpopuler",
  },
  {
    name: "Enterprise",
    tag: "Enterprise Choice",
    price: "Custom",
    period: "",
    desc: "Solusi enterprise dengan SLA dan integrasi khusus",
    features: ["Proyek tidak terbatas", "Dedicated AI team", "SLA 99.9%", "On-premise option", "Custom integrasi", "Account manager"],
    missing: [],
    cta: "Hubungi Sales",
    ctaVariant: "gold" as const,
    highlight: false,
  },
];

/* ─── CTA TRUST INDICATORS ─── */
const CTA_TRUST = [
  { icon: Brain,        label: "150+ AI Specialists" },
  { icon: CheckCircle2, label: "500+ Projects" },
  { icon: Star,         label: "98% Client Satisfaction" },
  { icon: Headphones,   label: "24/7 Support" },
  { icon: BadgeCheck,   label: "Commercial Ready" },
];

/* ════════════════════════════════════
   ANIMATED DASHBOARD MOCKUP
════════════════════════════════════ */
const ACTIVITY_FEED = [
  { agent: "Creative AI",   status: "Generating...", dot: "#7C6EFA" },
  { agent: "Finance AI",    status: "Completed",     dot: "#10B981" },
  { agent: "Legal AI",      status: "Reviewing...",  dot: "#F59E0B" },
  { agent: "Marketing AI",  status: "Processing...", dot: "#22D3EE" },
];

function DashboardMockup() {
  const [progressA, setProgressA] = useState(62);
  const [progressB, setProgressB] = useState(92);
  const [progressC, setProgressC] = useState(35);
  const [savedHours, setSavedHours] = useState(312);
  const [activityIdx, setActivityIdx] = useState(0);
  const [glowPulse, setGlowPulse] = useState(false);

  useEffect(() => {
    // Animate progress bars slowly
    const pid = setInterval(() => {
      setProgressA(p => p < 68 ? p + 0.08 : p);
      setProgressC(p => p < 48 ? p + 0.06 : p);
    }, 80);
    // Count up saved hours
    const cid = setInterval(() => {
      setSavedHours(h => h < 324 ? h + 1 : h);
    }, 250);
    // Cycle activity feed
    const aid = setInterval(() => {
      setActivityIdx(i => (i + 1) % ACTIVITY_FEED.length);
    }, 2200);
    // Glow pulse
    const gid = setInterval(() => {
      setGlowPulse(v => !v);
    }, 1800);
    return () => { clearInterval(pid); clearInterval(cid); clearInterval(aid); clearInterval(gid); };
  }, []);

  const PROJECTS = [
    { name: "Brand Refresh Q1",     status: "Produksi", pct: progressA, color: "#7C6EFA" },
    { name: "Marketing Campaign",   status: "Review",   pct: progressB, color: "#22D3EE" },
    { name: "Finance Report Q4",    status: "Analisis", pct: progressC, color: "#F59E0B" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative w-full max-w-2xl mx-auto rounded-2xl overflow-hidden"
      style={{
        background: "rgba(13, 21, 38, 0.85)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(46, 66, 112, 0.7)",
        boxShadow: `0 24px 80px rgba(6,11,24,0.85), 0 0 0 1px rgba(124,110,250,${glowPulse ? "0.18" : "0.08"}), 0 0 60px rgba(124,110,250,${glowPulse ? "0.12" : "0.05"})`,
        transform: "perspective(1200px) rotateX(3deg)",
        transition: "box-shadow 1.2s ease",
      }}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3" style={{ borderBottom: "1px solid rgba(46, 66, 112, 0.5)" }}>
        <div className="w-3 h-3 rounded-full" style={{ background: "#F43F5E" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#F59E0B" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#10B981" }} />
        <div className="ml-3 h-5 rounded flex-1" style={{ background: "rgba(46,66,112,0.4)", maxWidth: 180 }} />
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span style={{ fontSize: 11, color: "#4F6494" }}>Live</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Proyek Aktif",      value: "3",             color: "#7C6EFA" },
            { label: "Selesai Bulan Ini", value: "7",             color: "#10B981" },
            { label: "Jam Dihemat",       value: String(savedHours), color: "#F59E0B" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: "rgba(28,42,69,0.8)", border: "1px solid rgba(46,66,112,0.4)" }}>
              <div className="text-xs mb-1" style={{ color: "#8B9BC4" }}>{s.label}</div>
              <div className="text-xl font-display font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Projects */}
        <div className="space-y-2">
          {PROJECTS.map((p) => (
            <div key={p.name} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(19,30,53,0.8)", border: "1px solid rgba(46,66,112,0.3)" }}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate mb-1.5" style={{ color: "#F0F4FF" }}>{p.name}</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(46,66,112,0.5)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p.pct}%`, background: p.color }} />
                  </div>
                  <span className="text-xs font-mono" style={{ color: "#8B9BC4", minWidth: 32, textAlign: "right" }}>{Math.round(p.pct)}%</span>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}30` }}>
                {p.status}
              </span>
            </div>
          ))}
        </div>

        {/* Activity feed */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(46,66,112,0.4)" }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ background: "rgba(19,30,53,0.6)", borderBottom: "1px solid rgba(46,66,112,0.3)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span style={{ fontSize: 10, color: "#4F6494", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Activity Feed</span>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(46,66,112,0.2)" }}>
            {ACTIVITY_FEED.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 transition-all duration-700"
                style={{
                  background: i === activityIdx ? "rgba(124,110,250,0.06)" : "rgba(13,21,38,0.5)",
                  opacity: i === activityIdx ? 1 : 0.5,
                }}
              >
                <span style={{ fontSize: 11, color: "#8B9BC4" }}>{item.agent}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot, boxShadow: `0 0 4px ${item.dot}` }} />
                  <span style={{ fontSize: 11, color: item.dot, fontWeight: 500 }}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI insight */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.2)" }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#7C6EFA" }} />
          <span style={{ fontSize: 11, color: "#9D91FB" }}>✦ AI Insight: Campaign Anda memiliki potensi 2.3× lebih tinggi jika diluncurkan Selasa…</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ════════════════════════════════════
   TRUST STATS (animated count-up)
════════════════════════════════════ */
function TrustStats() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const v0 = useCountUp(TRUST_STATS[0].value, 1600, inView);
  const v1 = useCountUp(TRUST_STATS[1].value, 900,  inView);
  const v2 = useCountUp(TRUST_STATS[2].value, 1400, inView);
  const v3 = useCountUp(TRUST_STATS[3].value, 2000, inView);
  const vals = [v0, v1, v2, v3];

  return (
    <motion.section
      ref={ref}
      className="py-20 px-4"
      style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}
      initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}
    >
      <div className="container mx-auto max-w-5xl">
        <motion.p className="text-center text-xs font-semibold uppercase tracking-widest mb-10" style={{ color: "#4F6494" }} variants={fadeUp}>
          Hasil nyata yang sudah kami capai bersama klien
        </motion.p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {TRUST_STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label} className="flex flex-col items-center text-center gap-3" variants={fadeUp}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.15)" }}>
                  <Icon className="w-6 h-6" style={{ color: "#7C6EFA" }} />
                </div>
                <div>
                  <div className="font-display font-bold text-3xl" style={{ color: "#F0F4FF" }}>
                    {vals[i].toLocaleString("id-ID")}{s.suffix}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "#8B9BC4" }}>{s.label}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

/* ════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════ */
export default function LandingPage() {
  return (
    <Layout>

      {/* ════════════════════════════════════
          HERO
      ════════════════════════════════════ */}
      <section className="relative overflow-hidden" style={{ minHeight: "100vh", display: "flex", alignItems: "center" }}>
        {/* Layered mesh gradient background */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(150deg, #060B18 0%, #0D1526 55%, #0F1838 100%)" }} />
        {/* Violet radial glow top */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,110,250,0.20) 0%, transparent 70%)" }} />
        {/* Left cyan accent glow */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 40% 40% at 0% 60%, rgba(34,211,238,0.06) 0%, transparent 60%)" }} />
        {/* Right gold accent */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 35% 35% at 100% 30%, rgba(245,158,11,0.05) 0%, transparent 60%)" }} />
        {/* Grid texture */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "linear-gradient(rgba(124,110,250,1) 1px, transparent 1px), linear-gradient(90deg, rgba(124,110,250,1) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
        {/* Floating orbs */}
        <div className="pointer-events-none absolute" style={{ width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,110,250,0.07) 0%, transparent 70%)", top: "10%", right: "5%", filter: "blur(40px)" }} />
        <div className="pointer-events-none absolute" style={{ width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.05) 0%, transparent 70%)", bottom: "15%", left: "8%", filter: "blur(50px)" }} />

        <div className="relative z-10 container mx-auto px-4 md:px-8 max-w-7xl py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left copy */}
            <motion.div className="space-y-8 text-center lg:text-left" initial="hidden" animate="show" variants={stagger(0.12)}>
              {/* Announcement pill */}
              <motion.div variants={fadeUp}>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "rgba(28,42,69,0.9)", border: "1px solid rgba(46,66,112,0.7)", color: "#22D3EE" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  ✦ Baru: Customs &amp; PPJK AI kini tersedia
                  <ChevronRight className="w-3 h-3 opacity-60" />
                </div>
              </motion.div>

              {/* Heading */}
              <motion.div className="space-y-4" variants={fadeUp}>
                <h1 className="font-display font-bold leading-[1.06] tracking-tight text-balance" style={{ fontSize: "clamp(2.5rem, 5vw, 4.2rem)", color: "#F0F4FF" }}>
                  Transformasi Bisnis Anda dengan{" "}
                  <span className="text-gradient-primary">AI Enterprise</span>{" "}
                  yang Bekerja untuk Anda.
                </h1>
                <p className="text-lg leading-relaxed max-w-xl mx-auto lg:mx-0" style={{ color: "#8B9BC4" }}>
                  Dari kampanye kreatif hingga dokumen kepabeanan — tim AI profesional kami
                  menangani semuanya, dengan kualitas enterprise dan kecepatan yang belum pernah ada.
                </p>
              </motion.div>

              {/* CTAs */}
              <motion.div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start" variants={fadeUp}>
                <Link href="/services" className="btn-primary text-base py-3 px-6">
                  Mulai Sekarang <ArrowRight className="w-5 h-5" />
                </Link>
                <button className="btn-ghost text-base py-3 px-6">
                  <Play className="w-4 h-4" /> Lihat Demo
                </button>
              </motion.div>

              {/* Trust bar */}
              <motion.div className="flex flex-wrap justify-center lg:justify-start gap-x-7 gap-y-2 pt-3" style={{ borderTop: "1px solid rgba(46,66,112,0.4)" }} variants={fadeUp}>
                {[
                  { value: "500+", label: "Enterprise clients" },
                  { value: "15",   label: "Layanan AI" },
                  { value: "99.2%",label: "Kepuasan" },
                  { value: "4.8×", label: "Rata-rata ROI" },
                ].map((s) => (
                  <div key={s.label} className="flex items-baseline gap-1.5">
                    <span className="font-display font-bold text-xl" style={{ color: "#F0F4FF" }}>{s.value}</span>
                    <span className="text-xs" style={{ color: "#8B9BC4" }}>{s.label}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right — animated dashboard */}
            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════
          PARTNER LOGOS
      ════════════════════════════════════ */}
      <section className="py-8 border-y" style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "#4F6494" }}>
            Dipercaya oleh perusahaan terkemuka di Indonesia
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-14 opacity-35">
            {["PT Pertamina", "Bank Mandiri", "Unilever ID", "Astra Group", "Tokopedia", "BCA"].map((name) => (
              <span key={name} className="font-display font-bold text-sm tracking-tight" style={{ color: "#8B9BC4" }}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════
          TRUST STATS (count-up)
      ════════════════════════════════════ */}
      <TrustStats />

      {/* ════════════════════════════════════
          SERVICES GRID
      ════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-7xl">
          <motion.div className="text-center mb-16 space-y-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.2)", color: "#9D91FB" }}>
                <Sparkles className="w-3.5 h-3.5" />
                15 Layanan AI Profesional
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Semua layanan AI yang Anda butuhkan,<br />dalam satu platform.
            </motion.h2>
            <motion.p className="text-base max-w-xl mx-auto" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Dari kreatif hingga kepatuhan — setiap vertikal bisnis punya tim AI profesionalnya sendiri.
            </motion.p>
          </motion.div>

          <div className="space-y-4">
            {/* Featured row — 3 larger cards */}
            <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
              {SERVICES.filter(s => s.featured).map((svc) => {
                const Icon = svc.icon;
                return (
                  <motion.div key={svc.name} variants={fadeUp}>
                    <Link
                      href="/services"
                      className="group relative flex flex-col gap-4 p-6 rounded-2xl cursor-pointer"
                      style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))", transition: "all 150ms", display: "flex" }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "hsl(var(--surface-2))";
                        el.style.borderColor = "rgba(124,110,250,0.5)";
                        el.style.transform = "translateY(-3px)";
                        el.style.boxShadow = "0 8px 32px rgba(124,110,250,0.15)";
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "hsl(var(--surface-1))";
                        el.style.borderColor = "hsl(var(--border))";
                        el.style.transform = "translateY(0)";
                        el.style.boxShadow = "none";
                      }}
                    >
                      {svc.badge && (
                        <div className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: `${svc.badgeColor}18`, color: svc.badgeColor, border: `1px solid ${svc.badgeColor}35` }}>
                          {svc.badge}
                        </div>
                      )}
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110" style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.2)" }}>
                        <Icon className="w-7 h-7" style={{ color: "#7C6EFA" }} />
                      </div>
                      <div>
                        <div className="text-base font-semibold mb-1" style={{ color: "#F0F4FF" }}>{svc.name}</div>
                        <div className="text-sm" style={{ color: "#4F6494" }}>{svc.desc}</div>
                      </div>
                      <div className="mt-auto flex items-center gap-1.5 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#7C6EFA" }}>
                        Lihat layanan <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Regular grid */}
            <motion.div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.06)}>
              {SERVICES.filter(s => !s.featured).map((svc) => {
                const Icon = svc.icon;
                return (
                  <motion.div key={svc.name} variants={fadeUp}>
                    <Link
                      href="/services"
                      className="group relative flex flex-col gap-2.5 p-4 rounded-xl cursor-pointer"
                      style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))", transition: "all 150ms", display: "flex" }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "hsl(var(--surface-2))";
                        el.style.borderColor = "rgba(124,110,250,0.35)";
                        el.style.transform = "translateY(-2px)";
                        el.style.boxShadow = "0 4px 16px rgba(124,110,250,0.1)";
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "hsl(var(--surface-1))";
                        el.style.borderColor = "hsl(var(--border))";
                        el.style.transform = "translateY(0)";
                        el.style.boxShadow = "none";
                      }}
                    >
                      {svc.badge && (
                        <div className="absolute -top-2 -right-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${svc.badgeColor}22`, color: svc.badgeColor, border: `1px solid ${svc.badgeColor}30` }}>
                          {svc.badge}
                        </div>
                      )}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110" style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.12)" }}>
                        <Icon className="w-4.5 h-4.5" style={{ color: "#7C6EFA" }} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold leading-tight" style={{ color: "#F0F4FF" }}>{svc.name}</div>
                        <div className="text-xs mt-0.5 leading-snug" style={{ color: "#4F6494" }}>{svc.desc}</div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>

          <motion.div className="text-center mt-10" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 }}>
            <Link href="/services" className="btn-ghost inline-flex">
              Lihat semua layanan &amp; harga <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════
          AI WORKFORCE
      ════════════════════════════════════ */}
      <section className="py-24 px-4 relative overflow-hidden" style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}>
        {/* Background accent */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(124,110,250,0.05) 0%, transparent 70%)" }} />

        <div className="relative z-10 container mx-auto max-w-7xl">
          <motion.div className="text-center mb-16 space-y-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)", color: "#22D3EE" }}>
                <Cpu className="w-3.5 h-3.5" />
                AI Workforce
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Meet Your AI Workforce
            </motion.h2>
            <motion.p className="text-base max-w-lg mx-auto" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Rekrut tim AI kelas dunia yang bekerja 24/7 tanpa burnout, tanpa biaya rekrutmen, tanpa overhead.
            </motion.p>
          </motion.div>

          <motion.div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.08)}>
            {WORKFORCE.map((agent) => {
              const Icon = agent.icon;
              const cfg = STATUS_CONFIG[agent.status];
              return (
                <motion.div
                  key={agent.name}
                  className="flex flex-col gap-4 p-5 rounded-2xl transition-all duration-200"
                  style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                  variants={fadeUp}
                  whileHover={{ y: -3, boxShadow: "0 8px 32px rgba(124,110,250,0.12)", borderColor: "rgba(124,110,250,0.35)" }}
                >
                  {/* Avatar */}
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(124,110,250,0.12)", border: "1px solid rgba(124,110,250,0.2)" }}>
                      <Icon className="w-5 h-5" style={{ color: "#7C6EFA" }} />
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: cfg.bg, color: cfg.color }}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.pulse ? "animate-pulse" : ""}`} style={{ background: cfg.dot }} />
                      {agent.status}
                    </div>
                  </div>

                  {/* Info */}
                  <div>
                    <div className="text-sm font-semibold mb-0.5" style={{ color: "#F0F4FF" }}>{agent.name}</div>
                    <div className="text-xs" style={{ color: "#4F6494" }}>{agent.skill}</div>
                  </div>

                  {/* Current task */}
                  <div className="px-3 py-2 rounded-xl text-xs" style={{ background: "rgba(6,11,24,0.5)", color: "#8B9BC4", border: "1px solid rgba(46,66,112,0.3)" }}>
                    {agent.current}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          <motion.div className="text-center mt-10" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 }}>
            <Link href="/services" className="btn-primary inline-flex">
              Lihat Semua AI Specialist <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-6xl">
          <motion.div className="text-center mb-16 space-y-3" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Bagaimana Creative Studio Bekerja
            </motion.h2>
            <motion.p className="text-base" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Dari brief hingga deliverables — terstruktur, termonitor, dan on-time.
            </motion.p>
          </motion.div>

          {/* Steps — vertical on mobile, horizontal on desktop */}
          <div className="relative grid md:grid-cols-4 gap-8 md:gap-6">
            {/* Desktop connector */}
            <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(124,110,250,0.3) 20%, rgba(124,110,250,0.3) 80%, transparent)" }} />

            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.num}
                  className="relative flex flex-col items-center text-center gap-4"
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                >
                  {/* Circle */}
                  <div
                    className="relative z-10 w-20 h-20 rounded-2xl flex flex-col items-center justify-center gap-1"
                    style={{
                      background: i === 0 ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" : "hsl(var(--surface-1))",
                      border: i === 0 ? "none" : "1px solid hsl(var(--border))",
                      boxShadow: i === 0 ? "0 4px 24px rgba(124,110,250,0.35)" : "var(--shadow-sm)",
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{step.emoji}</span>
                    <span className="font-mono text-xs font-bold" style={{ color: i === 0 ? "rgba(255,255,255,0.7)" : "#4F6494" }}>{step.num}</span>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>{step.title}</div>
                    <div className="text-xs leading-relaxed" style={{ color: "#8B9BC4" }}>{step.desc}</div>
                    <div className="inline-block text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,211,238,0.08)", color: "#22D3EE", border: "1px solid rgba(34,211,238,0.15)" }}>
                      {step.time}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════
          TESTIMONIALS
      ════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}>
        <div className="container mx-auto max-w-6xl">
          <motion.div className="text-center mb-16 space-y-3" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Hasil Nyata dari Klien Kami
            </motion.h2>
            <motion.p className="text-base" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Bergabung dengan 500+ perusahaan yang sudah mentransformasi bisnis mereka.
            </motion.p>
          </motion.div>

          <motion.div className="grid md:grid-cols-3 gap-5" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                className="flex flex-col gap-4 p-6 rounded-2xl"
                style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                variants={fadeUp}
                whileHover={{ y: -3, borderColor: "rgba(124,110,250,0.3)", boxShadow: "0 8px 32px rgba(6,11,24,0.5)" }}
              >
                {/* Stars + verified */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-0.5">
                    {[...Array(t.rating)].map((_, j) => <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium" style={{ color: "#10B981" }}>
                    <BadgeCheck className="w-3.5 h-3.5" /> Verified Client
                  </div>
                </div>

                {/* Quote */}
                <div className="relative flex-1">
                  <Quote className="absolute -top-1 -left-1 w-5 h-5 opacity-15" style={{ color: "#7C6EFA" }} />
                  <p className="text-sm leading-relaxed pl-4" style={{ color: "#8B9BC4" }}>"{t.quote}"</p>
                </div>

                {/* Result metrics */}
                <div className="flex gap-2">
                  {t.metrics.map((m) => (
                    <div key={m.label} className="flex-1 px-3 py-2 rounded-xl text-center" style={{ background: "rgba(124,110,250,0.06)", border: "1px solid rgba(124,110,250,0.12)" }}>
                      <div className="text-sm font-bold font-display" style={{ color: "#9D91FB" }}>{m.value}</div>
                      <div style={{ fontSize: 10, color: "#4F6494" }}>{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Author */}
                <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm shrink-0"
                    style={{ background: `linear-gradient(135deg, hsl(${i * 60 + 246}, 70%, 30%), hsl(${i * 60 + 266}, 70%, 20%))`, color: "#fff" }}
                  >
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>{t.name}</div>
                    <div className="text-xs" style={{ color: "#4F6494" }}>{t.title} · {t.company}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════
          PRICING
      ════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-6xl">
          <motion.div className="text-center mb-16 space-y-3" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Harga Transparan, Tanpa Biaya Tersembunyi
            </motion.h2>
            <motion.p className="text-base" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Mulai gratis, scale sesuai kebutuhan bisnis Anda.
            </motion.p>
          </motion.div>

          <motion.div className="grid md:grid-cols-3 gap-5 items-start" initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
            {PLANS.map((plan) => (
              <motion.div
                key={plan.name}
                className="relative flex flex-col rounded-2xl p-6"
                style={{
                  background: plan.highlight ? "hsl(var(--surface-2))" : "hsl(var(--surface-1))",
                  border: plan.highlight ? "1px solid rgba(124,110,250,0.45)" : "1px solid hsl(var(--border))",
                  boxShadow: plan.highlight ? "0 0 0 1px rgba(124,110,250,0.08), 0 8px 40px rgba(124,110,250,0.1)" : "var(--shadow-sm)",
                }}
                variants={fadeUp}
                whileHover={{ y: -2, boxShadow: plan.highlight ? "0 0 0 1px rgba(124,110,250,0.15), 0 16px 48px rgba(124,110,250,0.15)" : "0 4px 20px rgba(6,11,24,0.4)" }}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff" }}>
                    {plan.badge}
                  </div>
                )}
                {plan.tag && (
                  <div className="mb-3 text-xs font-semibold" style={{ color: plan.highlight ? "#9D91FB" : "#4F6494" }}>
                    {plan.tag}
                  </div>
                )}
                <div className="space-y-1 mb-5">
                  <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>{plan.name}</div>
                  <div className="flex items-baseline gap-1">
                    {plan.price === "Custom" ? (
                      <span className="font-display font-bold text-3xl text-gradient-gold">Custom</span>
                    ) : (
                      <>
                        <span className="text-sm" style={{ color: "#8B9BC4" }}>Rp</span>
                        <span className="font-display font-bold text-3xl" style={{ color: "#F0F4FF" }}>{plan.price}</span>
                        <span className="text-sm" style={{ color: "#8B9BC4" }}>{plan.period}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "#4F6494" }}>{plan.desc}</p>
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm" style={{ color: "#8B9BC4" }}>
                      <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#10B981" }} /> {f}
                    </li>
                  ))}
                  {plan.missing.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm line-through" style={{ color: "#2E4270" }}>
                      <div className="w-4 h-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: "#243352" }}>
                        <div className="w-1.5 h-px" style={{ background: "#2E4270" }} />
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/services"
                  className={plan.ctaVariant === "primary" ? "btn-primary justify-center" : "btn-ghost justify-center"}
                  style={plan.ctaVariant === "gold" ? {
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: "10px 20px", borderRadius: 8,
                    background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: "#080D1B", fontWeight: 600, fontSize: 14,
                    textDecoration: "none", boxShadow: "0 4px 20px rgba(245,158,11,0.18)",
                  } : undefined}
                >
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════
          CTA BLOCK
      ════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))" }}>
        <div className="container mx-auto max-w-4xl">
          <motion.div
            className="relative overflow-hidden rounded-3xl p-10 md:p-16 text-center"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid rgba(46,66,112,0.6)", boxShadow: "0 0 80px rgba(124,110,250,0.07), inset 0 1px 0 rgba(255,255,255,0.04)" }}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 60% at 50% -10%, rgba(124,110,250,0.14) 0%, transparent 70%)" }} />

            <div className="relative z-10 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.2)", color: "#9D91FB" }}>
                <Cpu className="w-3.5 h-3.5" /> Mulai dalam 24 jam
              </div>
              <h2 className="font-display font-bold tracking-tight text-balance" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)", color: "#F0F4FF" }}>
                Siap memulai transformasi AI bisnis Anda?
              </h2>
              <p className="text-base max-w-md mx-auto" style={{ color: "#8B9BC4" }}>
                Konsultasi gratis, tanpa komitmen awal. Respon dalam 2 jam kerja.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/services" className="btn-primary text-base py-3 px-8">
                  Mulai Sekarang <ArrowRight className="w-5 h-5" />
                </Link>
                <Link href="/access" className="btn-ghost text-base py-3 px-8">
                  Hubungi Tim Sales
                </Link>
              </div>

              {/* Trust indicators */}
              <div className="flex flex-wrap justify-center gap-4 md:gap-6 pt-4" style={{ borderTop: "1px solid rgba(46,66,112,0.4)" }}>
                {CTA_TRUST.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-1.5 text-xs" style={{ color: "#4F6494" }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: "#7C6EFA" }} />
                      {item.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
