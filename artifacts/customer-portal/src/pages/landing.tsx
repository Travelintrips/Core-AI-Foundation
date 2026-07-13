import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import {
  ArrowRight, Sparkles, ChevronRight, Star,
  Palette, TrendingUp, Users, FileText,
  Cpu, Briefcase, Play, Quote, Brain,
  Boxes, PieChart, Building2, Zap,
  CheckCircle2, Clock, BadgeCheck, ExternalLink,
  Lock, Award, Image, PenTool, Presentation, Package, Instagram,
} from "lucide-react";

/* ─── ANIMATION VARIANTS ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] } },
};
const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5 } },
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

/* ─── CREATIVE AI SERVICES ───
 * Only Creative AI sub-services are marketed on the public site. Every
 * other internal category lives behind the Internal AI Portal and must
 * never be named here — see the internal RBAC portal-separation task. */
const SERVICES = [
  { icon: Palette,      name: "Brand Identity",        desc: "Logo, warna, tipografi, panduan pakai",      badge: "Most Popular", badgeColor: "#F97316", featured: true },
  { icon: TrendingUp,   name: "Brand Strategy",        desc: "Positioning, USP, tone of voice",             badge: "Human Review", badgeColor: "#8B5CF6", featured: true },
  { icon: Instagram,    name: "Social Media Content",  desc: "Konten bulanan: ide, caption, visual",        badge: "Fast Delivery", badgeColor: "#22D3EE", featured: true },
  { icon: PenTool,      name: "Logo Concept AI",       desc: "3 konsep logo awal siap dikembangkan" },
  { icon: FileText,     name: "Copywriting",           desc: "Copy on-brand untuk caption & landing page" },
  { icon: Presentation, name: "Pitch Deck",             desc: "Pitch deck investor-ready" },
  { icon: Image,        name: "Image Generation",      desc: "Gambar AI untuk kampanye dan konten" },
  { icon: Package,      name: "Packaging Concept",     desc: "Konsep desain kemasan produk" },
  { icon: Boxes,        name: "Poster / Banner",       desc: "Desain poster, banner, dan brosur" },
  { icon: Briefcase,    name: "Company Profile",       desc: "Dokumen company profile profesional" },
  { icon: PieChart,     name: "Presentation Design",   desc: "Desain presentasi untuk audiens apa pun" },
  { icon: Users,        name: "Creative Consultation", desc: "Konsultasi kreatif strategis" },
];

/* ─── HOW IT WORKS ─── */
const STEPS = [
  { num: "01", icon: FileText, title: "Submit Brief",  desc: "Ceritakan proyek Anda melalui formulir terstruktur. AI kami akan membaca dan memahami konteks bisnis Anda.",  time: "< 5 menit", color: "#7C6EFA"  },
  { num: "02", icon: Brain,    title: "AI Analysis",   desc: "Sistem AI menganalisis brief, menyusun tim virtual, dan memberikan estimasi scope dan biaya secara otomatis.", time: "< 2 jam",   color: "#22D3EE"  },
  { num: "03", icon: Users,    title: "Human Review",  desc: "Spesialis manusia kami mereview hasil AI, memastikan kualitas dan akurasi sebelum dikirim ke Anda.",         time: "Termonitor", color: "#F59E0B" },
  { num: "04", icon: Boxes,    title: "Delivery",      desc: "Hasil kerja dikirim ke workspace Anda. Review, setujui, dan download aset siap pakai.",                      time: "On time",    color: "#10B981" },
];

/* ─── TESTIMONIALS ─── */
const TESTIMONIALS = [
  {
    quote: "Creative AI menghemat 320 jam kerja per bulan untuk tim marketing kami. Kualitasnya setara agency besar, dengan kecepatan yang tidak masuk akal.",
    name: "Sari Wulandari", title: "Head of Marketing", company: "PT Retail Indonesia",
    metrics: [{ label: "Jam Dihemat", value: "320/bln", color: "#7C6EFA" }, { label: "Cost Reduction", value: "42%", color: "#10B981" }],
    initials: "SW",
  },
  {
    quote: "Pitch deck yang dulu membutuhkan 3 hari pengerjaan, kini selesai dalam 4 jam. Kualitas visual dan storytelling-nya jauh lebih baik dari tim internal kami.",
    name: "Ahmad Fauzi", title: "Head of Growth", company: "PT Maju Freight",
    metrics: [{ label: "Waktu Dihemat", value: "91%", color: "#22D3EE" }, { label: "Kepuasan Klien", value: "99.2%", color: "#10B981" }],
    initials: "AF",
  },
  {
    quote: "Social Media Content Monthly kami gunakan untuk seluruh kalender konten brand kami. Konsistensinya tinggi, dan tim kreatifnya sangat responsif.",
    name: "Dewi Kusuma", title: "Marketing Director", company: "PT Sentosa Group",
    metrics: [{ label: "ROI Kampanye", value: "+38%", color: "#F59E0B" }, { label: "Revisi Rework", value: "0.1%", color: "#10B981" }],
    initials: "DK",
  },
];

/* ─── TRUST STATS ─── */
const TRUST_STATS = [
  { value: 500,   suffix: "+", label: "Enterprise clients",      icon: Building2,  color: "#7C6EFA" },
  { value: 12,    suffix: "",  label: "Layanan Creative AI",     icon: Brain,      color: "#22D3EE" },
  { value: 99,    suffix: "%", label: "Tingkat kepuasan klien",  icon: Star,       color: "#F59E0B" },
  { value: 48000, suffix: "+", label: "Jam kerja dihemat/bulan", icon: Clock,      color: "#10B981" },
];

/* ─── PARTNER COMPANIES ─── */
const PARTNERS = [
  { name: "PT Pertamina",   initials: "PT" },
  { name: "Bank Mandiri",   initials: "BM" },
  { name: "Unilever ID",    initials: "UL" },
  { name: "Astra Group",    initials: "AG" },
  { name: "Tokopedia",      initials: "TP" },
  { name: "BCA",            initials: "BC" },
  { name: "Gojek",          initials: "GJ" },
  { name: "Telkom",         initials: "TK" },
];

/* ─── ACTIVITY FEED DATA ─── */
const ACTIVITY_FEED = [
  { agent: "Brand Identity",   status: "Generating...", dot: "#F97316" },
  { agent: "Social Media",     status: "Completed",     dot: "#10B981" },
  { agent: "Pitch Deck",       status: "Reviewing...",  dot: "#F59E0B" },
  { agent: "Copywriting",      status: "Processing...", dot: "#22D3EE" },
];

/* ─── NOISE TEXTURE (film grain feel) ─── */
function NoiseTexture() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ opacity: 0.028, mixBlendMode: "overlay" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <filter id="ln-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="4" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#ln-noise)" />
    </svg>
  );
}

/* ─── DASHBOARD MOCKUP (dark, live-animated) ─── */
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
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-lg mx-auto"
    >
      {/* Glow under mockup */}
      <div className="absolute -inset-4 rounded-3xl pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(124,110,250,0.20) 0%, transparent 70%)" }} />

      <div className="relative rounded-2xl overflow-hidden"
        style={{
          background: "#0D1526",
          border: "1px solid rgba(124,110,250,0.22)",
          boxShadow: "0 32px 80px rgba(6,11,24,0.80), 0 0 0 1px rgba(124,110,250,0.10), 0 0 60px rgba(124,110,250,0.10)",
          transform: "perspective(1200px) rotateX(2deg) rotateY(-1deg)",
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
                style={{ background: i === activityIdx ? "rgba(124,110,250,0.06)" : "#0D1526", opacity: i === activityIdx ? 1 : 0.45 }}>
                <span className="text-xs" style={{ color: "#8B9BC4" }}>{item.agent}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                  <span className="text-xs font-medium" style={{ color: item.dot }}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>

          {/* AI insight */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.20)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "#7C6EFA" }} />
            <span className="text-xs" style={{ color: "#9D91FB" }}>✦ AI: Campaign Anda memiliki potensi 2.3× lebih tinggi jika diluncurkan Selasa…</span>
          </div>
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
      className="py-20 px-4 relative overflow-hidden"
      style={{ background: "#0D1526", borderTop: "1px solid #243352", borderBottom: "1px solid #243352" }}
      initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}
    >
      {/* Subtle background aura */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 80% at 50% 50%, rgba(124,110,250,0.05) 0%, transparent 70%)" }} />

      <div className="relative container mx-auto max-w-5xl">
        <motion.p className="text-center text-xs font-semibold uppercase tracking-widest mb-12" style={{ color: "#4F6494" }} variants={fadeUp}>
          Hasil nyata yang sudah kami capai bersama klien
        </motion.p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 md:gap-6">
          {TRUST_STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label}
                className="flex flex-col items-center text-center gap-4 p-6 rounded-2xl"
                style={{
                  background: "rgba(13,21,38,0.80)",
                  border: "1px solid #243352",
                  boxShadow: "0 2px 8px rgba(6,11,24,0.40)",
                }}
                variants={fadeUp}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: `${s.color}14`,
                    border: `1px solid ${s.color}28`,
                    boxShadow: `0 0 20px ${s.color}10`,
                  }}>
                  <Icon className="w-5 h-5" style={{ color: s.color }} />
                </div>
                <div>
                  <div className="font-display font-bold text-3xl md:text-4xl" style={{ color: "#F0F4FF" }}>
                    {vals[i].toLocaleString("id-ID")}{s.suffix}
                  </div>
                  <div className="text-xs mt-1.5 leading-relaxed" style={{ color: "#8B9BC4" }}>{s.label}</div>
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
        {/* Noise texture */}
        <NoiseTexture />

        {/* Glow layer 1 — violet top-right */}
        <div className="pointer-events-none absolute" style={{
          top: "-10%", right: "-5%", width: "55%", height: "65%",
          background: "radial-gradient(ellipse at center, rgba(124,110,250,0.16) 0%, transparent 70%)",
        }} />
        {/* Glow layer 2 — cyan bottom-left */}
        <div className="pointer-events-none absolute" style={{
          bottom: "0%", left: "-5%", width: "40%", height: "50%",
          background: "radial-gradient(ellipse at center, rgba(34,211,238,0.07) 0%, transparent 65%)",
        }} />
        {/* Glow layer 3 — violet center-bottom (hero warmth) */}
        <div className="pointer-events-none absolute" style={{
          bottom: "-15%", left: "30%", width: "40%", height: "60%",
          background: "radial-gradient(ellipse at center, rgba(95,82,208,0.10) 0%, transparent 70%)",
        }} />

        {/* Floating orbs */}
        <div className="pointer-events-none absolute animate-float-orb" style={{ top: "18%", right: "28%", width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,110,250,0.07) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute animate-float-orb-b" style={{ top: "55%", right: "12%", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.05) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute animate-float-orb-c" style={{ top: "30%", left: "5%", width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.04) 0%, transparent 70%)" }} />

        {/* Grid texture */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: "linear-gradient(rgba(240,244,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,255,0.025) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }} />

        <div className="relative z-10 container mx-auto px-4 md:px-8 max-w-7xl py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* Left copy */}
            <motion.div className="space-y-8 text-center lg:text-left" initial="hidden" animate="show" variants={stagger(0.12)}>
              {/* Announcement pill */}
              <motion.div variants={fadeUp}>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
                  style={{
                    background: "rgba(124,110,250,0.08)",
                    border: "1px solid rgba(124,110,250,0.28)",
                    color: "#A89EFC",
                    boxShadow: "0 0 20px rgba(124,110,250,0.10)",
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#7C6EFA" }} />
                  ✦ Baru: Image Generation AI kini tersedia
                  <ChevronRight className="w-3 h-3 opacity-50" />
                </div>
              </motion.div>

              {/* Heading */}
              <motion.div className="space-y-5" variants={fadeUp}>
                <h1 className="font-display font-bold leading-[1.06] tracking-tight"
                  style={{ fontSize: "clamp(2.6rem, 5.5vw, 4.25rem)", color: "#F0F4FF", letterSpacing: "-0.03em" }}>
                  Transformasi Bisnis<br />
                  Anda dengan{" "}
                  <span className="text-gradient-primary italic">AI Enterprise</span>
                  {" "}yang Bekerja.
                </h1>
                <p className="text-lg leading-relaxed max-w-xl mx-auto lg:mx-0" style={{ color: "#6B7FA8" }}>
                  Dari brand identity hingga konten sosial media — tim Creative AI profesional kami
                  menangani semuanya, dengan kualitas enterprise dan kecepatan yang belum pernah ada.
                </p>
              </motion.div>

              {/* CTAs — pill shape */}
              <motion.div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start" variants={fadeUp}>
                <Link href="/services"
                  className="inline-flex items-center justify-center gap-2 font-semibold text-base text-white rounded-full transition-all"
                  style={{
                    padding: "14px 28px",
                    background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)",
                    boxShadow: "0 4px 24px rgba(124,110,250,0.40), 0 1px 0 rgba(255,255,255,0.10) inset",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(124,110,250,0.55), 0 1px 0 rgba(255,255,255,0.10) inset"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ""; (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(124,110,250,0.40), 0 1px 0 rgba(255,255,255,0.10) inset"; }}
                >
                  Mulai Sekarang <ArrowRight className="w-5 h-5" />
                </Link>
                <button
                  className="inline-flex items-center justify-center gap-2 font-semibold text-base rounded-full transition-all"
                  style={{
                    padding: "14px 28px",
                    color: "#C8D0E8",
                    border: "1.5px solid rgba(240,244,255,0.14)",
                    background: "rgba(240,244,255,0.03)",
                  }}
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.40)"; (e.currentTarget as HTMLElement).style.color = "#F0F4FF"; (e.currentTarget as HTMLElement).style.background = "rgba(124,110,250,0.06)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.14)"; (e.currentTarget as HTMLElement).style.color = "#C8D0E8"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.03)"; }}
                >
                  <Play className="w-4 h-4" /> Lihat Demo
                </button>
              </motion.div>

              {/* Trust bar — icons only, no emoji */}
              <motion.div
                className="flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 pt-5"
                style={{ borderTop: "1px solid rgba(36,51,82,0.70)" }}
                variants={fadeUp}
              >
                {[
                  { icon: Building2, value: "2,400+", label: "Klien enterprise" },
                  { icon: Sparkles,  value: "15",     label: "Layanan AI" },
                  { icon: CheckCircle2, value: "99.2%", label: "Kepuasan" },
                  { icon: TrendingUp,  value: "4.8×",  label: "Rata-rata ROI" },
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

            {/* Right — animated dashboard mockup */}
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
            Dipercaya oleh perusahaan terkemuka di Indonesia
          </p>
        </div>
        {/* Marquee track */}
        <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
          <div className="flex gap-4 animate-marquee shrink-0" aria-hidden>
            {[...PARTNERS, ...PARTNERS].map((p, i) => (
              <div key={i}
                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full shrink-0 select-none"
                style={{
                  background: "rgba(240,244,255,0.03)",
                  border: "1px solid rgba(240,244,255,0.07)",
                }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: "rgba(124,110,250,0.12)", color: "#9D91FB", border: "1px solid rgba(124,110,250,0.18)", fontFamily: "var(--app-font-display)" }}>
                  {p.initials}
                </div>
                <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "#6B7FA8", fontFamily: "var(--app-font-display)" }}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>
          {/* Duplicate for seamless loop */}
          <div className="flex gap-4 animate-marquee shrink-0" aria-hidden>
            {[...PARTNERS, ...PARTNERS].map((p, i) => (
              <div key={`b-${i}`}
                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full shrink-0 select-none"
                style={{
                  background: "rgba(240,244,255,0.03)",
                  border: "1px solid rgba(240,244,255,0.07)",
                }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: "rgba(124,110,250,0.12)", color: "#9D91FB", border: "1px solid rgba(124,110,250,0.18)", fontFamily: "var(--app-font-display)" }}>
                  {p.initials}
                </div>
                <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "#6B7FA8", fontFamily: "var(--app-font-display)" }}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST STATS ───────────────────────────── */}
      <TrustStats />

      {/* ── SERVICES GRID ─────────────────────────── */}
      <section className="py-24 px-4 relative overflow-hidden" style={{ background: "#060B18" }}>
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 100%, rgba(124,110,250,0.06) 0%, transparent 70%)" }} />

        <div className="relative container mx-auto max-w-7xl">
          <motion.div className="text-center mb-16 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.22)", color: "#9D91FB" }}>
                <Sparkles className="w-3 h-3" />
                Layanan Creative AI Profesional
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              Semua kebutuhan kreatif Anda,<br className="hidden md:block" />
              dalam satu platform.
            </motion.h2>
            <motion.p className="text-base max-w-xl mx-auto leading-relaxed" style={{ color: "#6B7FA8" }} variants={fadeUp}>
              Dari brand identity hingga konten sosial media — tim Creative AI profesional kami siap membantu.
            </motion.p>
          </motion.div>

          {/* Featured row */}
          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            {SERVICES.filter(s => s.featured).map((svc) => {
              const Icon = svc.icon;
              return (
                <motion.div key={svc.name} variants={fadeUp}>
                  <Link href="/services" className="service-card-featured group relative flex flex-col gap-4 p-6 rounded-2xl cursor-pointer" style={{ display: "flex" }}>
                    {svc.badge && (
                      <div className="absolute top-4 right-4 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: `${svc.badgeColor}14`, color: svc.badgeColor, border: `1px solid ${svc.badgeColor}28` }}>
                        {svc.badge}
                      </div>
                    )}
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, rgba(124,110,250,0.18) 0%, rgba(95,82,208,0.10) 100%)",
                        border: "1px solid rgba(124,110,250,0.22)",
                        boxShadow: "0 0 16px rgba(124,110,250,0.10)",
                      }}>
                      <Icon className="w-5 h-5" style={{ color: "#9D91FB" }} />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-base mb-1.5" style={{ color: "#F0F4FF" }}>
                        {svc.name}
                      </h3>
                      <p className="text-sm leading-relaxed" style={{ color: "#6B7FA8" }}>{svc.desc}</p>
                    </div>
                    <div className="mt-auto pt-3 flex items-center gap-1 text-xs font-semibold transition-all duration-200 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0"
                      style={{ borderTop: "1px solid rgba(36,51,82,0.80)", color: "#9D91FB" }}>
                      Lihat Layanan <ArrowRight className="w-3.5 h-3.5" />
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
                  <Link href="/services" className="service-card-sm group flex flex-col items-center gap-2 p-4 rounded-xl text-center cursor-pointer" style={{ display: "flex" }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.16)" }}>
                      <Icon className="w-4 h-4" style={{ color: "#9D91FB" }} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold leading-snug" style={{ color: "#C8D0E8" }}>{svc.name}</div>
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

          <div className="text-center mt-12">
            <Link href="/services"
              className="inline-flex items-center gap-2 font-semibold text-sm rounded-full transition-all"
              style={{ padding: "12px 24px", border: "1.5px solid rgba(124,110,250,0.30)", color: "#9D91FB", background: "rgba(124,110,250,0.06)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(124,110,250,0.12)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.50)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(124,110,250,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.30)"; }}
            >
              Lihat Semua Layanan <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────── */}
      <section id="how-it-works" className="py-24 px-4 relative overflow-hidden" style={{ background: "#0D1526", borderTop: "1px solid #1C2A40" }}>
        {/* Background grid */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: "linear-gradient(rgba(240,244,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,255,0.015) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

        <div className="relative container mx-auto max-w-5xl">
          <motion.div className="text-center mb-16 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)", color: "#22D3EE" }}>
                <Zap className="w-3 h-3" /> Cara Kerja
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              Dari Brief ke Hasil dalam Hitungan Jam
            </motion.h2>
            <motion.p className="text-base max-w-lg mx-auto" style={{ color: "#6B7FA8" }} variants={fadeUp}>
              Proses end-to-end yang transparan — Anda selalu tahu di mana proyek Anda berada.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div key={step.num}
                  initial={{ opacity: 0, y: 28 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.10, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  viewport={{ once: true }}
                  className="relative"
                >
                  {/* Connector line */}
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-9 left-[calc(50%+36px)] right-[-8px] h-px"
                      style={{ background: `linear-gradient(to right, ${step.color}40, rgba(36,51,82,0.40))` }} />
                  )}

                  <div className="flex flex-col items-center text-center gap-4 p-5 rounded-2xl h-full"
                    style={{
                      background: "rgba(13,21,38,0.60)",
                      border: "1px solid #1C2A40",
                      boxShadow: "0 2px 8px rgba(6,11,24,0.40)",
                    }}>
                    {/* Step icon */}
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                        style={{ background: `${step.color}12`, border: `1px solid ${step.color}22` }}>
                        <Icon className="w-7 h-7" style={{ color: step.color }} />
                      </div>
                      {/* Step number badge */}
                      <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: step.color, color: "#060B18" }}>
                        {i + 1}
                      </div>
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
        {/* Subtle background glow */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(245,158,11,0.04) 0%, transparent 70%)" }} />

        <div className="relative container mx-auto max-w-5xl">
          <motion.div className="text-center mb-14 space-y-4"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.1)}>
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "#F59E0B" }}>
                <Star className="w-3 h-3 fill-amber-500" /> Testimoni
              </div>
            </motion.div>
            <motion.h2 className="font-display font-bold" style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", color: "#F0F4FF", letterSpacing: "-0.025em" }} variants={fadeUp}>
              Apa Kata Klien Enterprise Kami
            </motion.h2>
          </motion.div>

          <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-5"
            initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger(0.12)}>
            {TESTIMONIALS.map((t) => (
              <motion.div key={t.name} variants={fadeUp}
                className="relative rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:-translate-y-1"
                style={{
                  background: "#0D1526",
                  border: "1px solid #1C2A40",
                  boxShadow: "0 2px 8px rgba(6,11,24,0.50)",
                }}>
                {/* Decorative quote mark */}
                <div className="absolute top-3 right-5 font-display font-bold leading-none select-none"
                  style={{ fontSize: "5rem", color: "rgba(124,110,250,0.07)", lineHeight: 1 }}>
                  "
                </div>

                {/* Stars */}
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>

                <p className="text-sm leading-relaxed flex-1" style={{ color: "#8B9BC4" }}>"{t.quote}"</p>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-2">
                  {t.metrics.map((m) => (
                    <div key={m.label} className="text-center rounded-xl p-2.5"
                      style={{
                        background: `${m.color}08`,
                        border: `1px solid ${m.color}18`,
                      }}>
                      <div className="font-display font-bold text-lg" style={{ color: m.color }}>{m.value}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: "#6B7FA8" }}>{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Author */}
                <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid rgba(36,51,82,0.70)" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                    style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", boxShadow: "0 2px 8px rgba(124,110,250,0.30)" }}>
                    {t.initials}
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "#F0F4FF" }}>{t.name}</div>
                    <div className="text-xs" style={{ color: "#6B7FA8" }}>{t.title} · {t.company}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA FINAL ─────────────────────────────── */}
      <section className="py-28 px-4 relative overflow-hidden" style={{ background: "#0A0F1E" }}>
        {/* Multi-layer gradient mesh */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 70% at 50% 110%, rgba(124,110,250,0.18) 0%, transparent 65%)" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 40% 50% at 20% 50%, rgba(34,211,238,0.06) 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 40% 50% at 80% 50%, rgba(95,82,208,0.08) 0%, transparent 70%)" }} />
        <NoiseTexture />

        {/* Top border line */}
        <div className="absolute top-0 inset-x-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(124,110,250,0.50) 30%, rgba(34,211,238,0.30) 70%, transparent)" }} />

        <div className="relative z-10 container mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            viewport={{ once: true }}
            className="space-y-7">

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
              style={{ background: "rgba(124,110,250,0.10)", border: "1px solid rgba(124,110,250,0.28)", color: "#9D91FB" }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: "#7C6EFA" }} />
              Mulai transformasi bisnis Anda hari ini
            </div>

            <h2 className="font-display font-bold" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)", color: "#F0F4FF", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              Siap Merasakan Kekuatan{" "}
              <span className="text-gradient-primary italic">AI Enterprise?</span>
            </h2>

            <p className="text-lg max-w-xl mx-auto leading-relaxed" style={{ color: "#6B7FA8" }}>
              Bergabung dengan 500+ enterprise yang telah menghemat ribuan jam kerja dengan platform kami.
            </p>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Link href="/services"
                className="inline-flex items-center justify-center gap-2 font-semibold text-base text-white rounded-full transition-all"
                style={{
                  padding: "15px 32px",
                  background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)",
                  boxShadow: "0 4px 24px rgba(124,110,250,0.45), 0 1px 0 rgba(255,255,255,0.10) inset",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(1.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(124,110,250,0.60), 0 1px 0 rgba(255,255,255,0.10) inset"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ""; (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(124,110,250,0.45), 0 1px 0 rgba(255,255,255,0.10) inset"; }}
              >
                Mulai Proyek Sekarang <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/access"
                className="inline-flex items-center justify-center gap-2 font-semibold text-base rounded-full transition-all"
                style={{ padding: "15px 32px", color: "#C8D0E8", border: "1.5px solid rgba(240,244,255,0.14)", background: "rgba(240,244,255,0.03)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.28)"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#F0F4FF"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(240,244,255,0.14)"; (e.currentTarget as HTMLElement).style.background = "rgba(240,244,255,0.03)"; (e.currentTarget as HTMLElement).style.color = "#C8D0E8"; }}
              >
                <ExternalLink className="w-4 h-4" /> Client Login
              </Link>
            </div>

            {/* Enterprise trust badges */}
            <div className="flex flex-wrap justify-center gap-3 pt-4">
              {[
                { icon: Brain,        label: "150+ AI Specialists" },
                { icon: CheckCircle2, label: "500+ Projects Delivered" },
                { icon: Lock,         label: "Enterprise Security" },
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
