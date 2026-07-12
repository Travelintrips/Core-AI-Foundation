import "./_group.css";
import { ArrowRight, Star, Clock, CheckCircle, Users, Sparkles, ChevronRight, Play, Shield, Zap, BadgeCheck, FileText, MessageCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

const STEPS = [
  { n: "01", title: "Brief & Discovery", desc: "Anda isi brief detail via form kami. AI menganalisis kebutuhan dan mencocokkan dengan specialist.", time: "30 menit" },
  { n: "02", title: "Quotation & Approval", desc: "Kami kirim penawaran terperinci. Anda review dan setujui — tidak ada biaya tersembunyi.", time: "1–4 jam" },
  { n: "03", title: "AI Production", desc: "Tim AI specialist kami mulai bekerja. Progress real-time tersedia di dashboard Anda.", time: "1–3 hari" },
  { n: "04", title: "Human Review", desc: "Output AI direview dan difinalisasi oleh Creative Director berpengalaman.", time: "4–8 jam" },
  { n: "05", title: "Delivery & Revisi", desc: "Anda terima hasil di workspace. Revisi tak terbatas hingga Anda puas.", time: "Included" },
];

const PACKAGES = [
  { name: "Starter", price: "Rp 500.000", features: ["Brand guideline basic", "5 asset desain", "1 round revisi", "Delivery 3 hari", "File source tersedia"], popular: false },
  { name: "Professional", price: "Rp 1.500.000", features: ["Brand guideline lengkap", "15 asset desain", "Unlimited revisi", "Delivery 2 hari", "File source tersedia", "Social media kit", "Priority support"], popular: true },
  { name: "Enterprise", price: "Custom", features: ["Brand system complete", "Unlimited asset", "Dedicated specialist", "Delivery express", "Annual license", "Strategy session", "White-label option"], popular: false },
];

const PORTFOLIO = [
  { title: "Rebrand PT Maju Jaya", cat: "Brand Identity", color: "#F97316" },
  { title: "Kampanye Digital GreenCo", cat: "Marketing Creative", color: "#10B981" },
  { title: "Annual Report TechID 2024", cat: "Corporate Design", color: "#3B82F6" },
];

const FAQS = [
  { q: "Berapa lama proses pengerjaan?", a: "Tergantung paket: Starter 3 hari, Professional 2 hari, Enterprise bisa express 1 hari. Semua termasuk revisi." },
  { q: "Berapa kali bisa revisi?", a: "Paket Starter 1x revisi, Professional & Enterprise unlimited hingga Anda puas." },
  { q: "Siapa yang mengerjakan proyek saya?", a: "Tim AI specialist kami yang dilatih khusus bidang creative, diawasi Creative Director berpengalaman 10+ tahun." },
  { q: "Apakah saya bisa minta format file tertentu?", a: "Ya, kami deliver dalam semua format standar: AI, EPS, PDF, PNG, SVG, MP4, dan lainnya sesuai kebutuhan." },
];

export function ServiceDetail() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [selectedPkg, setSelectedPkg] = useState(1);

  return (
    <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={14} color="#fff" /></div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ display: "flex", gap: 6, fontSize: 13, color: "var(--cp-navy-lt)", alignItems: "center" }}>
          <span style={{ cursor: "pointer" }}>Layanan</span>
          <ChevronRight size={13} />
          <span style={{ cursor: "pointer" }}>Creative AI</span>
          <ChevronRight size={13} />
          <span style={{ color: "var(--cp-orange)", fontWeight: 500 }}>Brand Identity</span>
        </div>
        <button className="cp-btn cp-btn-primary" style={{ padding: "9px 18px", fontSize: 13 }}>Order Sekarang <ArrowRight size={13} /></button>
      </nav>

      {/* HERO */}
      <div style={{ background: "linear-gradient(135deg, #FFF7ED 0%, var(--cp-warm) 100%)", padding: "56px 48px 48px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 420px", gap: 64, alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <span className="cp-badge" style={{ background: "rgba(124,110,250,0.1)", color: "#7C6EFA", border: "1px solid rgba(124,110,250,0.25)" }}>Creative AI</span>
              <span className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange)", border: "1px solid rgba(249,115,22,0.25)" }}>Most Popular</span>
            </div>
            <h1 className="cp-h1" style={{ marginBottom: 20, fontSize: 44 }}>
              Brand Identity &<br />
              <span style={{ color: "var(--cp-orange)", fontStyle: "italic" }}>Visual Design</span>
            </h1>
            <p style={{ fontSize: 16, lineHeight: 1.8, color: "var(--cp-navy-lt)", marginBottom: 28, maxWidth: 520 }}>
              Bangun identitas brand yang kuat dan konsisten. Tim Creative AI kami membuat brand guideline, visual system, dan aset desain yang mencerminkan nilai perusahaan Anda.
            </p>

            <div style={{ display: "flex", gap: 28, marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Star size={16} fill="#F97316" color="#F97316" />
                <span style={{ fontWeight: 700, color: "var(--cp-navy)" }}>4.9</span>
                <span style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>(248 ulasan)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--cp-navy-lt)" }}>
                <Users size={14} /> 1,240+ proyek selesai
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--cp-navy-lt)" }}>
                <Clock size={14} /> Delivery 1–3 hari
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button className="cp-btn cp-btn-primary" style={{ fontSize: 15, padding: "12px 28px" }}>Mulai Proyek <ArrowRight size={16} /></button>
              <button className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", padding: "11px 20px" }}>
                <Play size={14} fill="var(--cp-orange)" color="var(--cp-orange)" /> Lihat Portfolio
              </button>
            </div>
          </div>

          {/* Package selector card */}
          <div className="cp-card" style={{ padding: 28, boxShadow: "var(--cp-shadow-lg)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--cp-navy-lt)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>Pilih Paket</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {PACKAGES.map((p, i) => (
                <button key={p.name} onClick={() => setSelectedPkg(i)}
                  style={{ flex: 1, padding: "8px 4px", borderRadius: 10, border: selectedPkg === i ? "none" : "1.5px solid rgba(15,23,42,0.1)", background: selectedPkg === i ? "var(--cp-orange)" : "#fff", color: selectedPkg === i ? "#fff" : "var(--cp-navy-lt)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cp-sans)", transition: "all 0.18s", position: "relative" }}>
                  {p.popular && selectedPkg !== i && <span style={{ position: "absolute", top: -8, right: -4, background: "#F97316", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99 }}>Best</span>}
                  {p.name}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "var(--cp-serif)", fontSize: 32, fontWeight: 700, color: "var(--cp-navy)", marginBottom: 4 }}>
                {PACKAGES[selectedPkg].price}
                {PACKAGES[selectedPkg].price !== "Custom" && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--cp-navy-lt)" }}>/proyek</span>}
              </div>
              {PACKAGES[selectedPkg].price === "Custom" && <p style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>Harga disesuaikan kebutuhan enterprise</p>}
            </div>

            <div style={{ marginBottom: 20 }}>
              {PACKAGES[selectedPkg].features.map(f => (
                <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <CheckCircle size={15} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 13, color: "var(--cp-navy)" }}>{f}</span>
                </div>
              ))}
            </div>

            <button className="cp-btn cp-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
              Pesan {PACKAGES[selectedPkg].name} <ArrowRight size={14} />
            </button>

            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 14, fontSize: 12, color: "var(--cp-navy-lt)" }}>
              <Shield size={13} /> Garansi revisi · Pembayaran aman
            </div>
          </div>
        </div>
      </div>

      {/* WORKFLOW STEPS */}
      <div style={{ padding: "64px 48px", background: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h2 className="cp-h2" style={{ textAlign: "center", marginBottom: 48 }}>Bagaimana Prosesnya?</h2>
          <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
            {STEPS.map((step, i) => (
              <div key={step.n} style={{ flex: 1, display: "flex", alignItems: "flex-start", gap: 0 }}>
                <div style={{ flex: 1, textAlign: "center", padding: "0 8px" }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: i === 0 ? "var(--cp-orange)" : "rgba(249,115,22,0.1)", color: i === 0 ? "#fff" : "var(--cp-orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, margin: "0 auto 16px", boxShadow: i === 0 ? "0 4px 16px rgba(249,115,22,0.35)" : "none" }}>
                    {step.n}
                  </div>
                  <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, color: "var(--cp-navy)", marginBottom: 8 }}>{step.title}</h4>
                  <p style={{ fontSize: 12, color: "var(--cp-navy-lt)", lineHeight: 1.6, marginBottom: 8 }}>{step.desc}</p>
                  <span className="cp-badge" style={{ background: "rgba(249,115,22,0.08)", color: "var(--cp-orange)", border: "1px solid rgba(249,115,22,0.15)", fontSize: 10 }}>
                    <Clock size={9} /> {step.time}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ width: 40, height: 1, background: "linear-gradient(90deg, rgba(249,115,22,0.4), rgba(249,115,22,0.1))", marginTop: 24, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PORTFOLIO PREVIEW */}
      <div style={{ padding: "64px 48px", background: "var(--cp-warm)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <h2 className="cp-h2">Portfolio Terbaru</h2>
            <button className="cp-btn cp-btn-ghost" style={{ fontSize: 13 }}>Lihat Semua <ChevronRight size={13} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {PORTFOLIO.map(p => (
              <div key={p.title} className="cp-card" style={{ overflow: "hidden", cursor: "pointer" }}>
                <div style={{ height: 160, background: `linear-gradient(135deg, ${p.color}22, ${p.color}44)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, background: p.color, opacity: 0.15 }} />
                  <div style={{ position: "absolute", width: 40, height: 40, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <FileText size={18} color="#fff" />
                  </div>
                </div>
                <div style={{ padding: "16px 18px" }}>
                  <span className="cp-tag" style={{ fontSize: 10, marginBottom: 8, display: "inline-flex" }}>{p.cat}</span>
                  <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, color: "var(--cp-navy)" }}>{p.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: "64px 48px", background: "#fff" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2 className="cp-h2" style={{ textAlign: "center", marginBottom: 40 }}>FAQ</h2>
          {FAQS.map((faq, i) => (
            <div key={i} style={{ borderBottom: "1px solid rgba(15,23,42,0.07)", marginBottom: 0 }}>
              <button onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cp-sans)" }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cp-navy)", textAlign: "left" }}>{faq.q}</span>
                <ChevronDown size={18} color="var(--cp-navy-lt)" style={{ transform: activeFaq === i ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }} />
              </button>
              {activeFaq === i && (
                <div style={{ paddingBottom: 20, fontSize: 14, color: "var(--cp-navy-lt)", lineHeight: 1.7 }}>{faq.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* BOTTOM CTA */}
      <div style={{ background: "var(--cp-navy)", padding: "48px", textAlign: "center" }}>
        <h2 className="cp-h2" style={{ color: "#fff", marginBottom: 12, fontSize: 28 }}>Siap Mulai?</h2>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: 28, fontSize: 15 }}>Konsultasi gratis, tanpa komitmen.</p>
        <button className="cp-btn cp-btn-primary" style={{ fontSize: 15, padding: "13px 32px" }}>Order Sekarang <ArrowRight size={16} /></button>
      </div>
    </div>
  );
}
