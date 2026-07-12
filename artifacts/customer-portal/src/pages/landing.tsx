import { Link } from "wouter";
import { Layout } from "@/components/layout";
import {
  ArrowRight, Sparkles, ChevronRight, Star, CheckCircle,
  Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3,
  Users, ShoppingCart, FileText, Headphones, Globe, Package,
  Cpu, Briefcase, Shield, Play, Quote
} from "lucide-react";

/* ─── SERVICE VERTICALS ─── */
const SERVICES = [
  { icon: Palette,     name: "Creative AI",       desc: "Brand, desain, konten kreatif" },
  { icon: TrendingUp,  name: "Marketing AI",       desc: "Campaign, digital, growth" },
  { icon: DollarSign,  name: "Sales AI",           desc: "Lead gen, proposal, CRM" },
  { icon: BarChart3,   name: "Finance AI",         desc: "Analisis, laporan, proyeksi" },
  { icon: FileText,    name: "Accounting AI",      desc: "Pembukuan, rekonsiliasi" },
  { icon: Shield,      name: "Tax AI",             desc: "Pajak, kepatuhan, SPT" },
  { icon: Users,       name: "HR & Payroll AI",    desc: "SDM, penggajian, kontrak" },
  { icon: Scale,       name: "Legal AI",           desc: "Kontrak, compliance, dokumen" },
  { icon: Truck,       name: "Logistics AI",       desc: "Rantai pasok, ekspedisi" },
  { icon: Globe,       name: "Customs & PPJK AI",  desc: "Kepabeanan, BC, dokumen" },
  { icon: ShoppingCart,name: "Procurement AI",     desc: "Pengadaan, vendor, tender" },
  { icon: Package,     name: "Trading AI",         desc: "Analisis pasar, arbitrase" },
  { icon: BarChart3,   name: "Data Analytics AI",  desc: "BI, dashboard, insight" },
  { icon: Briefcase,   name: "Executive AI",       desc: "Ringkasan eksekutif, strategi" },
  { icon: Headphones,  name: "Customer Service AI",desc: "Support, chatbot, eskalasi" },
];

/* ─── STEPS ─── */
const STEPS = [
  {
    num: "01",
    title: "Submit Brief",
    desc: "Ceritakan proyek Anda melalui formulir terstruktur. AI kami akan membaca dan memahami konteks bisnis Anda.",
    time: "< 5 menit",
  },
  {
    num: "02",
    title: "AI Analysis",
    desc: "Sistem AI menganalisis brief, menyusun tim virtual, dan memberikan estimasi scope dan biaya secara otomatis.",
    time: "< 2 jam",
  },
  {
    num: "03",
    title: "Production",
    desc: "Tim AI bekerja. Anda bisa memantau progres real-time di workspace, memberikan feedback kapan saja.",
    time: "Termonitor",
  },
  {
    num: "04",
    title: "Delivered",
    desc: "Hasil kerja dikirim ke workspace Anda. Review, setujui, dan download aset siap pakai.",
    time: "On time",
  },
];

/* ─── TESTIMONIALS ─── */
const TESTIMONIALS = [
  {
    quote: "Creative AI menghemat 320 jam kerja per bulan untuk tim marketing kami. Kualitasnya setara agency besar, dengan kecepatan yang tidak masuk akal.",
    name: "Sari Wulandari",
    title: "Head of Marketing, PT Retail Indonesia",
    rating: 5,
  },
  {
    quote: "Dokumen customs yang dulu membutuhkan 3 hari pengerjaan, kini selesai dalam 4 jam. Akurasi HS Code-nya jauh lebih baik dari tim manual kami.",
    name: "Ahmad Fauzi",
    title: "Logistics Director, PT Maju Freight",
    rating: 5,
  },
  {
    quote: "Finance AI kami gunakan untuk menyusun laporan board setiap bulan. Analisisnya tajam, presentasinya eksekutif. CEO kami sangat terkesan.",
    name: "Dewi Kusuma",
    title: "Finance Director, PT Sentosa Group",
    rating: 5,
  },
];

/* ─── STATS ─── */
const STATS = [
  { value: "500+", label: "Enterprise clients" },
  { value: "15",   label: "Layanan AI" },
  { value: "99.2%",label: "Tingkat kepuasan" },
  { value: "4.8×", label: "Rata-rata ROI" },
];

/* ─── PRICING PLANS ─── */
const PLANS = [
  {
    name: "Starter",
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

/* ─── HERO DASHBOARD MOCKUP ─── */
function DashboardMockup() {
  return (
    <div
      className="relative w-full max-w-2xl mx-auto rounded-2xl overflow-hidden"
      style={{
        background: "rgba(13, 21, 38, 0.85)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(46, 66, 112, 0.6)",
        boxShadow: "0 24px 80px rgba(6,11,24,0.8), 0 0 0 1px rgba(124,110,250,0.1)",
        transform: "perspective(1200px) rotateX(3deg)",
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-1.5 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(46, 66, 112, 0.5)" }}
      >
        <div className="w-3 h-3 rounded-full" style={{ background: "#F43F5E" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#F59E0B" }} />
        <div className="w-3 h-3 rounded-full" style={{ background: "#10B981" }} />
        <div className="ml-3 flex-1 h-5 rounded" style={{ background: "rgba(46, 66, 112, 0.4)", maxWidth: 180 }} />
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Proyek Aktif", value: "3", color: "#7C6EFA" },
            { label: "Selesai Bulan Ini", value: "7", color: "#10B981" },
            { label: "Jam Dihemat", value: "320", color: "#F59E0B" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-3"
              style={{ background: "rgba(28, 42, 69, 0.8)", border: "1px solid rgba(46, 66, 112, 0.4)" }}
            >
              <div className="text-xs mb-1" style={{ color: "#8B9BC4" }}>{s.label}</div>
              <div className="text-xl font-display font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Active projects */}
        <div className="space-y-2">
          {[
            { name: "Brand Refresh Q1", status: "Produksi", pct: 62, color: "#7C6EFA" },
            { name: "Marketing Campaign", status: "Review",   pct: 92, color: "#22D3EE" },
            { name: "Finance Report Q4", status: "Analisis",  pct: 35, color: "#F59E0B" },
          ].map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "rgba(19, 30, 53, 0.8)", border: "1px solid rgba(46, 66, 112, 0.3)" }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate mb-1" style={{ color: "#F0F4FF" }}>{p.name}</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(46, 66, 112, 0.5)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${p.pct}%`, background: p.color }}
                    />
                  </div>
                  <span className="text-xs" style={{ color: "#8B9BC4" }}>{p.pct}%</span>
                </div>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{ background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}30` }}
              >
                {p.status}
              </span>
            </div>
          ))}
        </div>

        {/* AI Status */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: "rgba(124, 110, 250, 0.08)", border: "1px solid rgba(124, 110, 250, 0.2)" }}
        >
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#7C6EFA" }} />
          <span className="text-xs" style={{ color: "#9D91FB" }}>
            ✦ AI Insight: Campaign Anda memiliki potensi 2.3× lebih tinggi jika…
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function LandingPage() {
  return (
    <Layout>
      {/* ════════════════════════════════════════
          HERO
      ════════════════════════════════════════ */}
      <section
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(150deg, #060B18 0%, #0D1526 55%, #0F1838 100%)",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Radial glow top-center */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,110,250,0.18) 0%, transparent 70%)",
          }}
        />
        {/* Subtle grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(124,110,250,1) 1px, transparent 1px), linear-gradient(90deg, rgba(124,110,250,1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative z-10 container mx-auto px-4 md:px-8 max-w-7xl py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left — copy */}
            <div className="space-y-8 text-center lg:text-left">
              {/* Announcement pill */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: "rgba(28, 42, 69, 0.9)",
                  border: "1px solid rgba(46, 66, 112, 0.7)",
                  color: "#22D3EE",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                ✦ Baru: Customs & PPJK AI kini tersedia
                <ChevronRight className="w-3 h-3 opacity-60" />
              </div>

              {/* Heading */}
              <div className="space-y-3">
                <h1
                  className="font-display font-bold leading-[1.08] tracking-tight text-balance"
                  style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)", color: "#F0F4FF" }}
                >
                  Transformasi Bisnis Anda dengan{" "}
                  <span className="text-gradient-primary">AI Enterprise</span>{" "}
                  yang Bekerja untuk Anda.
                </h1>
                <p
                  className="text-lg leading-relaxed max-w-xl mx-auto lg:mx-0"
                  style={{ color: "#8B9BC4" }}
                >
                  Dari kampanye kreatif hingga dokumen kepabeanan — tim AI profesional kami
                  menangani semuanya, dengan kualitas enterprise dan kecepatan yang belum pernah ada.
                </p>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link href="/services" className="btn-primary text-base py-3 px-6">
                  Mulai Sekarang <ArrowRight className="w-5 h-5" />
                </Link>
                <button
                  className="btn-ghost text-base py-3 px-6"
                  onClick={() => {}}
                >
                  <Play className="w-4 h-4" />
                  Lihat Demo
                </button>
              </div>

              {/* Trust bar */}
              <div
                className="flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-2 pt-2"
                style={{ borderTop: "1px solid rgba(46, 66, 112, 0.4)" }}
              >
                {STATS.map((s) => (
                  <div key={s.label} className="flex items-baseline gap-1.5">
                    <span className="font-display font-bold text-lg" style={{ color: "#F0F4FF" }}>
                      {s.value}
                    </span>
                    <span className="text-xs" style={{ color: "#8B9BC4" }}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — dashboard preview */}
            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          PARTNER LOGOS
      ════════════════════════════════════════ */}
      <section
        className="py-8 border-y"
        style={{
          background: "hsl(var(--surface-1))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <p className="text-center text-xs font-medium uppercase tracking-widest mb-6" style={{ color: "#4F6494" }}>
            Dipercaya oleh perusahaan terkemuka di Indonesia
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-14 opacity-40">
            {["PT Pertamina", "Bank Mandiri", "Unilever ID", "Astra Group", "Tokopedia", "BCA"].map((name) => (
              <span
                key={name}
                className="font-display font-bold text-sm tracking-tight"
                style={{ color: "#8B9BC4" }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          SERVICES GRID
      ════════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-7xl">
          {/* Header */}
          <div className="text-center mb-16 space-y-4">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: "rgba(124, 110, 250, 0.1)",
                border: "1px solid rgba(124, 110, 250, 0.2)",
                color: "#9D91FB",
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              15 Layanan AI Profesional
            </div>
            <h2
              className="font-display font-bold tracking-tight"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }}
            >
              Semua layanan AI yang Anda butuhkan,
              <br />
              dalam satu platform.
            </h2>
            <p className="text-base max-w-xl mx-auto" style={{ color: "#8B9BC4" }}>
              Dari kreatif hingga kepatuhan — setiap vertikal bisnis kini punya tim AI profesionalnya sendiri.
            </p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {SERVICES.map((svc, i) => {
              const Icon = svc.icon;
              return (
                <Link
                  key={svc.name}
                  href="/services"
                  className="group flex flex-col gap-3 p-4 rounded-xl transition-all duration-150 cursor-pointer"
                  style={{
                    background: "hsl(var(--surface-1))",
                    border: "1px solid hsl(var(--border))",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "hsl(var(--surface-2))";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(124, 110, 250, 0.4)";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(124,110,250,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "hsl(var(--surface-1))";
                    (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--border))";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      background: `hsl(${(i * 23) % 360}, 70%, 15%)`,
                      border: "1px solid rgba(124, 110, 250, 0.15)",
                    }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "#7C6EFA" }} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-tight mb-0.5" style={{ color: "#F0F4FF" }}>
                      {svc.name}
                    </div>
                    <div className="text-xs leading-snug" style={{ color: "#4F6494" }}>
                      {svc.desc}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="text-center mt-8">
            <Link href="/services" className="btn-ghost inline-flex">
              Lihat semua layanan <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════ */}
      <section
        className="py-24 px-4"
        style={{
          background: "hsl(var(--surface-1))",
          borderTop: "1px solid hsl(var(--border))",
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-3">
            <h2
              className="font-display font-bold tracking-tight"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }}
            >
              Bagaimana Creative Studio Bekerja
            </h2>
            <p className="text-base" style={{ color: "#8B9BC4" }}>
              Dari brief hingga deliverables — semua terstruktur, termonitor, dan on-time.
            </p>
          </div>

          <div className="relative grid md:grid-cols-4 gap-6">
            {/* Connector line (desktop) */}
            <div
              className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px"
              style={{ background: "linear-gradient(90deg, transparent, #243352 20%, #243352 80%, transparent)" }}
            />

            {STEPS.map((step, i) => (
              <div key={step.num} className="relative flex flex-col items-center text-center gap-4">
                {/* Step circle */}
                <div
                  className="relative z-10 w-20 h-20 rounded-2xl flex flex-col items-center justify-center"
                  style={{
                    background: i === 0
                      ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)"
                      : "hsl(var(--surface-2))",
                    border: i === 0
                      ? "none"
                      : "1px solid hsl(var(--border))",
                    boxShadow: i === 0 ? "0 4px 20px rgba(124,110,250,0.3)" : "none",
                  }}
                >
                  <span
                    className="font-display font-bold text-2xl"
                    style={{ color: i === 0 ? "#FFF" : "#4F6494" }}
                  >
                    {step.num}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>
                    {step.title}
                  </div>
                  <div className="text-xs leading-relaxed" style={{ color: "#8B9BC4" }}>
                    {step.desc}
                  </div>
                  <div
                    className="inline-block text-xs px-2 py-0.5 rounded-full font-medium mt-1"
                    style={{
                      background: "rgba(34, 211, 238, 0.08)",
                      color: "#22D3EE",
                      border: "1px solid rgba(34, 211, 238, 0.15)",
                    }}
                  >
                    {step.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          TESTIMONIALS
      ════════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-3">
            <h2
              className="font-display font-bold tracking-tight"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }}
            >
              Hasil Nyata dari Klien Kami
            </h2>
            <p className="text-base" style={{ color: "#8B9BC4" }}>
              Bergabung dengan 500+ perusahaan yang sudah mentransformasi bisnis mereka.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                className="flex flex-col gap-5 p-6 rounded-2xl transition-all duration-150"
                style={{
                  background: "hsl(var(--surface-1))",
                  border: "1px solid hsl(var(--border))",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                {/* Stars */}
                <div className="flex gap-0.5">
                  {[...Array(t.rating)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>

                {/* Quote */}
                <div className="relative flex-1">
                  <Quote
                    className="absolute -top-1 -left-1 w-5 h-5 opacity-20"
                    style={{ color: "#7C6EFA" }}
                  />
                  <p className="text-sm leading-relaxed pl-4" style={{ color: "#8B9BC4" }}>
                    "{t.quote}"
                  </p>
                </div>

                {/* Author */}
                <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm shrink-0"
                    style={{
                      background: `linear-gradient(135deg, hsl(${i * 60 + 246}, 70%, 35%) 0%, hsl(${i * 60 + 266}, 70%, 25%) 100%)`,
                      color: "#fff",
                    }}
                  >
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>
                      {t.name}
                    </div>
                    <div className="text-xs" style={{ color: "#4F6494" }}>
                      {t.title}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          PRICING
      ════════════════════════════════════════ */}
      <section
        className="py-24 px-4"
        style={{
          background: "hsl(var(--surface-1))",
          borderTop: "1px solid hsl(var(--border))",
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-3">
            <h2
              className="font-display font-bold tracking-tight"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF" }}
            >
              Harga Transparan, Tanpa Biaya Tersembunyi
            </h2>
            <p className="text-base" style={{ color: "#8B9BC4" }}>
              Mulai gratis, scale sesuai kebutuhan bisnis Anda.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 items-start">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="relative flex flex-col rounded-2xl p-6 transition-all duration-150"
                style={{
                  background: plan.highlight ? "hsl(var(--surface-2))" : "hsl(var(--surface-1))",
                  border: plan.highlight
                    ? "1px solid rgba(124, 110, 250, 0.5)"
                    : "1px solid hsl(var(--border))",
                  boxShadow: plan.highlight ? "0 0 0 1px rgba(124,110,250,0.1), 0 8px 32px rgba(124,110,250,0.12)" : "var(--shadow-sm)",
                }}
              >
                {plan.badge && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff" }}
                  >
                    {plan.badge}
                  </div>
                )}

                <div className="space-y-1 mb-5">
                  <div className="text-sm font-semibold" style={{ color: "#F0F4FF" }}>{plan.name}</div>
                  <div className="flex items-baseline gap-1">
                    {plan.price === "Custom" ? (
                      <span className="font-display font-bold text-3xl" style={{ color: "#F59E0B" }}>
                        Custom
                      </span>
                    ) : (
                      <>
                        <span className="text-sm" style={{ color: "#8B9BC4" }}>Rp</span>
                        <span className="font-display font-bold text-3xl" style={{ color: "#F0F4FF" }}>
                          {plan.price}
                        </span>
                        <span className="text-sm" style={{ color: "#8B9BC4" }}>{plan.period}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "#4F6494" }}>{plan.desc}</p>
                </div>

                {/* Features */}
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm" style={{ color: "#8B9BC4" }}>
                      <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#10B981" }} />
                      {f}
                    </li>
                  ))}
                  {plan.missing.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm line-through" style={{ color: "#4F6494" }}>
                      <div className="w-4 h-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: "#243352" }}>
                        <div className="w-1.5 h-px" style={{ background: "#4F6494" }} />
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link
                  href="/services"
                  className={plan.ctaVariant === "primary" ? "btn-primary justify-center" : "btn-ghost justify-center"}
                  style={plan.ctaVariant === "gold" ? {
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: "10px 20px", borderRadius: 8,
                    background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: "#080D1B", fontWeight: 600, fontSize: 14,
                    textDecoration: "none", boxShadow: "0 4px 20px rgba(245,158,11,0.2)",
                  } : undefined}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          CTA BLOCK
      ════════════════════════════════════════ */}
      <section className="py-24 px-4" style={{ background: "hsl(var(--background))" }}>
        <div className="container mx-auto max-w-4xl">
          <div
            className="relative overflow-hidden rounded-3xl p-10 md:p-16 text-center"
            style={{
              background: "hsl(var(--surface-1))",
              border: "1px solid rgba(46, 66, 112, 0.6)",
              boxShadow: "0 0 80px rgba(124,110,250,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            {/* Glow */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: "radial-gradient(ellipse 70% 60% at 50% -10%, rgba(124,110,250,0.15) 0%, transparent 70%)",
              }}
            />

            <div className="relative z-10 space-y-6">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-2"
                style={{
                  background: "rgba(124, 110, 250, 0.1)",
                  border: "1px solid rgba(124, 110, 250, 0.2)",
                  color: "#9D91FB",
                }}
              >
                <Cpu className="w-3.5 h-3.5" />
                Mulai dalam 24 jam
              </div>

              <h2
                className="font-display font-bold tracking-tight text-balance"
                style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)", color: "#F0F4FF" }}
              >
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

              <p className="text-xs" style={{ color: "#4F6494" }}>
                No credit card required · Setup dalam 24 jam · SLA Enterprise tersedia
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
