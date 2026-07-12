import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import {
  ArrowRight, Sparkles, ChevronRight, Star,
  Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3,
  Users, ShoppingCart, FileText, Headphones, Globe, Package,
  Cpu, Briefcase, Shield, Play, Quote, Brain,
  FileCheck, Boxes, PieChart, Building2, Zap,
  CheckCircle2, Clock, BadgeCheck, ExternalLink,
} from "lucide-react";

/* ─── ANIMATION VARIANTS ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as [number,number,number,number] } },
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

/* ─── SERVICE VERTICALS ─── */
const SERVICES = [
  { icon: Palette,      name: "Creative AI",        desc: "Brand, desain, konten kreatif",    badge: "Most Popular", badgeColor: "#F97316", featured: true },
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

/* ─── HOW IT WORKS ─── */
const STEPS = [
  { num: "01", icon: FileText, title: "Submit Brief",  desc: "Ceritakan proyek Anda melalui formulir terstruktur. AI kami akan membaca dan memahami konteks bisnis Anda.",  time: "< 5 menit"  },
  { num: "02", icon: Brain,    title: "AI Analysis",   desc: "Sistem AI menganalisis brief, menyusun tim virtual, dan memberikan estimasi scope dan biaya secara otomatis.", time: "< 2 jam"    },
  { num: "03", icon: Users,    title: "Human Review",  desc: "Spesialis manusia kami mereview hasil AI, memastikan kualitas dan akurasi sebelum dikirim ke Anda.",         time: "Termonitor" },
  { num: "04", icon: Boxes,    title: "Delivery",      desc: "Hasil kerja dikirim ke workspace Anda. Review, setujui, dan download aset siap pakai.",                      time: "On time"    },
];

/* ─── TESTIMONIALS ─── */
const TESTIMONIALS = [
  {
    quote: "Creative AI menghemat 320 jam kerja per bulan untuk tim marketing kami. Kualitasnya setara agency besar, dengan kecepatan yang tidak masuk akal.",
    name: "Sari Wulandari", title: "Head of Marketing", company: "PT Retail Indonesia",
    metrics: [{ label: "Jam Dihemat", value: "320/bln" }, { label: "Cost Reduction", value: "42%" }],
  },
  {
    quote: "Dokumen customs yang dulu membutuhkan 3 hari pengerjaan, kini selesai dalam 4 jam. Akurasi HS Code-nya jauh lebih baik dari tim manual kami.",
    name: "Ahmad Fauzi", title: "Logistics Director", company: "PT Maju Freight",
    metrics: [{ label: "Waktu Dihemat", value: "91%" }, { label: "Akurasi", value: "99.2%" }],
  },
  {
    quote: "Finance AI kami gunakan untuk menyusun laporan board setiap bulan. Analisisnya tajam, presentasinya eksekutif. CEO kami sangat terkesan.",
    name: "Dewi Kusuma", title: "Finance Director", company: "PT Sentosa Group",
    metrics: [{ label: "ROI", value: "+38%" }, { label: "Error Rate", value: "0.1%" }],
  },
];

/* ─── TRUST STATS ─── */
const TRUST_STATS = [
  { value: 500,   suffix: "+", label: "Enterprise clients",      icon: Building2  },
  { value: 15,    suffix: "",  label: "Layanan AI profesional",  icon: Brain      },
  { value: 99,    suffix: "%", label: "Tingkat kepuasan klien",  icon: Star       },
  { value: 48000, suffix: "+", label: "Jam kerja dihemat/bulan", icon: Clock      },
];

/* ─── ACTIVITY FEED DATA ─── */
const ACTIVITY_FEED = [
  { agent: "Creative AI",  status: "Generating...", dot: "#F97316" },
  { agent: "Finance AI",   status: "Completed",     dot: "#10B981" },
  { agent: "Legal AI",     status: "Reviewing...",  dot: "#F59E0B" },
  { agent: "Marketing AI", status: "Processing...", dot: "#22D3EE" },
];

/* ─── DASHBOARD MOCKUP (dark) ─── */
function DashboardMockup() {
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
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative w-full max-w-lg mx-auto rounded-2xl overflow-hidden"
      style={{
        background: "#0D1526",
        border: "1px solid rgba(124,110,250,0.20)",
        boxShadow: "0 24px 80px rgba(6,11,24,0.70), 0 0 0 1px rgba(124,110,250,0.10), 0 0 60px rgba(124,110,250,0.08)",
        transform: "perspective(1200px) rotateX(2deg)",
      }}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3" style={{ borderBottom: "1px solid rgba(36,51,82,0.80)", background: "#060B18" }}>
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-display font-bold" style={{ color: "#F0F4FF" }}>Project Overview</div>
            <div className="text-xs" style={{ color: "#8B9BC4" }}>Aktif & terkini</div>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Proyek Aktif",      value: "3",             color: "#F97316" },
            { label: "Selesai Bulan Ini", value: "7",             color: "#10B981" },
            { label: "Jam Dihemat",       value: String(savedHours), color: "#F59E0B" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: "#131E35", border: "1px solid #243352" }}>
              <div className="text-xs mb-1" style={{ color: "#8B9BC4" }}>{s.label}</div>
              <div className="text-xl font-display font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Projects */}
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

        {/* Activity feed */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #243352" }}>
          <div className="px-3 py-2 flex items-center gap-2" style={{ background: "#060B18", borderBottom: "1px solid #243352" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#8B9BC4" }}>Activity Feed</span>
          </div>
          {ACTIVITY_FEED.map((item, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 transition-all duration-700"
              style={{ background: i === activityIdx ? "rgba(124,110,250,0.06)" : "#0D1526", opacity: i === activityIdx ? 1 : 0.5 }}>
              <span className="text-xs" style={{ color: "#8B9BC4" }}>{item.agent}</span>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                <span className="text-xs font-medium" style={{ color: item.dot }}>{item.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* AI insight */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.18)" }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#7C6EFA" }} />
          <span className="text-xs" style={{ color: "#9D91FB" }}>✦ AI: Campaign Anda memiliki potensi 2.3× lebih tinggi jika diluncurkan Selasa…</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── TRUST STATS SECTION ─── */
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
      style={{ background: "#0D1526", borderTop: "1px solid #243352", borderBottom: "1px solid #243352" }}
      initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}
    >
      <div className="container mx-auto max-w-5xl">
        <motion.p className="text-center text-xs font-semibold uppercase tracking-widest mb-10" style={{ color: "#8B9BC4" }} variants={fadeUp}>
          Hasil nyata yang sudah kami capai bersama klien
        </motion.p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {TRUST_STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label} className="flex flex-col items-center text-center gap-3" variants={fadeUp}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.20)" }}>
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

/* ═══════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════ */
export default function LandingPage() {
  return (
    <Layout>

      {/* ── HERO ──────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ minHeight: "100vh", display: "flex", alignItems: "center", background: "#060B18" }}>
        {/* Violet aura top-right */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 60% 50% at 85% 20%, rgba(124,110,250,0.12) 0%, transparent 70%)" }} />
        {/* Subtle blue glow bottom-left */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 40% 40% at 10% 80%, rgba(34,211,238,0.05) 0%, transparent 60%)" }} />
        {/* Grid texture */}
        <div className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(rgba(240,244,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,255,0.03) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }} />

        <div className="relative z-10 container mx-auto px-4 md:px-8 max-w-7xl py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* Left copy */}
            <motion.div className="space-y-8 text-center lg:text-left" initial="hidden" animate="show" variants={stagger(0.12)}>
              {/* Announcement pill */}
              <motion.div variants={fadeUp}>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.25)", color: "#9D91FB" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                  ✦ Baru: Customs &amp; PPJK AI kini tersedia
                  <ChevronRight className="w-3 h-3 opacity-60" />
                </div>
              </motion.div>

              {/* Heading */}
              <motion.div className="space-y-4" variants={fadeUp}>
                <h1 className="font-display font-bold leading-[1.08] tracking-tight text-balance"
                  style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)", color: "#F0F4FF" }}>
                  Transformasi Bisnis Anda dengan{" "}
                  <span className="text-gradient-primary italic">AI Enterprise</span>{" "}
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
                <button
                  className="btn-ghost text-base py-3 px-6"
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <Play className="w-4 h-4" /> Lihat Demo
                </button>
              </motion.div>

              {/* Trust bar */}
              <motion.div
                className="flex flex-wrap justify-center lg:justify-start gap-x-7 gap-y-2 pt-4"
                style={{ borderTop: "1px solid rgba(36,51,82,0.80)" }}
                variants={fadeUp}
              >
                {[
                  { icon: "⭐", value: "2,400+", label: "Klien enterprise" },
                  { icon: "⚡", value: "15",     label: "Layanan AI" },
                  { icon: "✓",  value: "99.2%",  label: "Kepuasan" },
                  { icon: "📈", value: "4.8×",   label: "Rata-rata ROI" },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <span className="font-display font-bold text-xl" style={{ color: "#F0F4FF" }}>{s.value}</span>
                    <span className="text-xs" style={{ color: "#8B9BC4" }}>{s.label}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right — animated dashboard mockup */}
            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── PARTNER LOGOS ─────────────────────────── */}
      <section className="py-8" style={{ background: "#0D1526", borderTop: "1px solid #243352", borderBottom: "1px solid #243352" }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "#8B9BC4" }}>
            Dipercaya oleh perusahaan terkemuka di Indonesia
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-14 opacity-40">
            {["PT Pertamina", "Bank Mandiri", "Unilever ID", "Astra Group", "Tokopedia", "BCA"].map((name) => (
              <span key={name} className="font-display font-bold text-sm tracking-tight" style={{ color: "#8B9BC4" }}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST STATS ───────────────────────────── */}
      <TrustStats />

      {/* ── SERVICES GRID ─────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "#060B18" }}>
        <div className="container mx-auto max-w-7xl">
          <motion.div className="text-center mb-16 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.20)", color: "#9D91FB" }}>
                <Sparkles className="w-3 h-3" />
                15 Layanan AI Profesional
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Semua layanan AI yang Anda butuhkan,<br className="hidden md:block" />
              dalam satu platform.
            </motion.h2>
            <motion.p className="text-base max-w-xl mx-auto" style={{ color: "#8B9BC4" }} variants={fadeUp}>
              Dari kreatif hingga kepatuhan — setiap vertikal bisnis punya tim AI profesionalnya sendiri.
            </motion.p>
          </motion.div>

          {/* Featured row */}
          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            {SERVICES.filter(s => s.featured).map((svc) => {
              const Icon = svc.icon;
              return (
                <motion.div key={svc.name} variants={fadeUp}>
                  <Link href="/services"
                    className="group relative flex flex-col gap-4 p-6 rounded-2xl cursor-pointer transition-all duration-200 hover:-translate-y-1"
                    style={{
                      display: "flex",
                      background: "#0D1526",
                      border: "1px solid #243352",
                      boxShadow: "0 2px 8px rgba(6,11,24,0.50)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.35)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(6,11,24,0.60), 0 0 0 1px rgba(124,110,250,0.10)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#243352"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(6,11,24,0.50)"; }}
                  >
                    {svc.badge && (
                      <div className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: `${svc.badgeColor}14`, color: svc.badgeColor, border: `1px solid ${svc.badgeColor}30` }}>
                        {svc.badge}
                      </div>
                    )}
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.18)" }}>
                      <Icon className="w-5 h-5" style={{ color: "#7C6EFA" }} />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-base mb-1 transition-colors" style={{ color: "#F0F4FF" }}>
                        {svc.name}
                      </h3>
                      <p className="text-sm" style={{ color: "#8B9BC4" }}>{svc.desc}</p>
                    </div>
                    <div className="mt-auto pt-3 flex items-center gap-1 text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ borderTop: "1px solid #243352", color: "#7C6EFA" }}>
                      Lihat Layanan <ArrowRight className="w-3 h-3" />
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
              return (
                <motion.div key={svc.name} variants={fadeUp}>
                  <Link href="/services"
                    className="group flex flex-col items-center gap-2 p-4 rounded-xl text-center cursor-pointer transition-all duration-150 hover:-translate-y-0.5"
                    style={{ display: "flex", background: "#0D1526", border: "1px solid #243352" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.30)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#243352"; }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(124,110,250,0.08)" }}>
                      <Icon className="w-4.5 h-4.5" style={{ color: "#7C6EFA" }} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold leading-snug" style={{ color: "#F0F4FF" }}>{svc.name}</div>
                      {svc.badge && (
                        <div className="mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block"
                          style={{ background: `${svc.badgeColor}12`, color: svc.badgeColor }}>
                          {svc.badge}
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>

          <div className="text-center mt-10">
            <Link href="/services" className="btn-ghost">
              Lihat Semua Layanan <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────── */}
      <section id="how-it-works" className="py-24 px-4" style={{ background: "#0D1526", borderTop: "1px solid #243352" }}>
        <div className="container mx-auto max-w-5xl">
          <motion.div className="text-center mb-16 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)", color: "#22D3EE" }}>
                <Zap className="w-3 h-3" />Cara Kerja
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Dari Brief ke Hasil dalam Hitungan Jam
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div key={step.num}
                  initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.12, duration: 0.5 }} viewport={{ once: true }}
                  className="relative text-center">
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[calc(50%+28px)] right-0 h-px"
                      style={{ borderTop: "2px dashed rgba(124,110,250,0.25)" }} />
                  )}
                  <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.20)" }}>
                    <Icon className="w-7 h-7" style={{ color: "#7C6EFA" }} />
                  </div>
                  <div className="text-xs font-bold mb-1" style={{ color: "#7C6EFA" }}>{step.num}</div>
                  <h3 className="font-display font-bold text-base mb-2" style={{ color: "#F0F4FF" }}>{step.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#8B9BC4" }}>{step.desc}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full"
                    style={{ background: "rgba(124,110,250,0.08)", color: "#9D91FB", border: "1px solid rgba(124,110,250,0.15)" }}>
                    <Clock className="w-3 h-3" /> {step.time}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "#060B18", borderTop: "1px solid #243352" }}>
        <div className="container mx-auto max-w-5xl">
          <motion.div className="text-center mb-14 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.20)", color: "#F59E0B" }}>
                <Quote className="w-3 h-3" />Testimoni
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", color: "#F0F4FF" }} variants={fadeUp}>
              Apa Kata Klien Enterprise Kami
            </motion.h2>
          </motion.div>

          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-6"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
            {TESTIMONIALS.map((t) => (
              <motion.div key={t.name} variants={fadeUp}
                className="rounded-2xl p-6 transition-all duration-200 hover:-translate-y-1"
                style={{ background: "#0D1526", border: "1px solid #243352", boxShadow: "0 2px 8px rgba(6,11,24,0.50)" }}>
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed mb-5 italic" style={{ color: "#8B9BC4" }}>"{t.quote}"</p>
                <div className="flex items-center gap-3 pt-4" style={{ borderTop: "1px solid #243352" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white"
                    style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)" }}>
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "#F0F4FF" }}>{t.name}</div>
                    <div className="text-xs" style={{ color: "#8B9BC4" }}>{t.title} · {t.company}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {t.metrics.map((m) => (
                    <div key={m.label} className="text-center rounded-xl p-2.5"
                      style={{ background: "rgba(124,110,250,0.06)", border: "1px solid rgba(124,110,250,0.12)" }}>
                      <div className="font-display font-bold text-lg" style={{ color: "#9D91FB" }}>{m.value}</div>
                      <div className="text-xs" style={{ color: "#8B9BC4" }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA FINAL ─────────────────────────────── */}
      <section className="py-24 px-4 relative overflow-hidden" style={{ background: "#0D1526", borderTop: "1px solid #243352" }}>
        {/* Violet glow */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 50% 60% at 50% 100%, rgba(124,110,250,0.12) 0%, transparent 70%)" }} />
        <div className="relative z-10 container mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }} viewport={{ once: true }}
            className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.25)", color: "#9D91FB" }}>
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              Mulai transformasi bisnis Anda hari ini
            </div>
            <h2 className="font-display font-bold" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: "#F0F4FF" }}>
              Siap Merasakan Kekuatan <span className="text-gradient-primary italic">AI Enterprise?</span>
            </h2>
            <p className="text-lg max-w-xl mx-auto" style={{ color: "#8B9BC4" }}>
              Bergabung dengan 500+ enterprise yang telah menghemat ribuan jam kerja dengan platform kami.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Link href="/services" className="btn-primary text-base py-3.5 px-8">
                Mulai Proyek Sekarang <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/access" className="inline-flex items-center gap-2 py-3.5 px-8 rounded-lg font-semibold text-base transition-all"
                style={{ color: "#F0F4FF", border: "1px solid rgba(240,244,255,0.15)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.30)"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.04)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.15)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <ExternalLink className="w-4 h-4" />
                Client Login
              </Link>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              {[
                { icon: Brain,        label: "150+ AI Specialists" },
                { icon: CheckCircle2, label: "500+ Projects" },
                { icon: Star,         label: "98% Satisfaction" },
                { icon: BadgeCheck,   label: "Commercial Ready" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs" style={{ color: "#8B9BC4" }}>
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
