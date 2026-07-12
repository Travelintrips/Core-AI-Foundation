import "./_group.css";
import { ArrowRight, Sparkles, Star, CheckCircle, Play, Zap, Shield, Clock, Users, Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3, ChevronRight, Globe, FileText, Headphones, Brain, BadgeCheck } from "lucide-react";

const SERVICES = [
  { icon: Palette, name: "Creative AI", desc: "Brand, desain & konten kreatif", badge: "Most Popular", badgeColor: "#7C6EFA", featured: true },
  { icon: TrendingUp, name: "Marketing AI", desc: "Campaign, digital & growth", badge: "Fast Delivery", badgeColor: "#22D3EE", featured: true },
  { icon: DollarSign, name: "Finance AI", desc: "Analisis, laporan & proyeksi", badge: "Enterprise", badgeColor: "#F59E0B", featured: true },
  { icon: BarChart3, name: "Sales AI", desc: "Lead gen, proposal & CRM", badge: null, badgeColor: "", featured: false },
  { icon: FileText, name: "Accounting AI", desc: "Pembukuan & rekonsiliasi", badge: "New", badgeColor: "#10B981", featured: false },
  { icon: Shield, name: "Legal AI", desc: "Kontrak & compliance", badge: "Human Review", badgeColor: "#8B5CF6", featured: false },
  { icon: Users, name: "HR & Payroll AI", desc: "SDM, penggajian & kontrak", badge: null, badgeColor: "", featured: false },
  { icon: Scale, name: "Tax AI", desc: "Pajak, kepatuhan & SPT", badge: null, badgeColor: "", featured: false },
  { icon: Truck, name: "Logistics AI", desc: "Rantai pasok & ekspedisi", badge: null, badgeColor: "", featured: false },
  { icon: Globe, name: "Customs & PPJK", desc: "Kepabeanan & dokumen BC", badge: "New", badgeColor: "#22D3EE", featured: false },
  { icon: Headphones, name: "Customer Service AI", desc: "Support & chatbot", badge: null, badgeColor: "", featured: false },
  { icon: Brain, name: "Executive AI", desc: "Ringkasan eksekutif & strategi", badge: "Enterprise", badgeColor: "#F59E0B", featured: false },
];

const TESTIMONIALS = [
  { name: "Budi Santoso", role: "CEO, TechVenture ID", text: "Platform ini mengubah cara kami bekerja. Tim AI mereka seperti CFO virtual yang selalu siap.", avatar: "BS", rating: 5 },
  { name: "Rina Dewi", role: "Marketing Director, GrowthCo", text: "Creative AI menghasilkan konten brand kami 10x lebih cepat dengan kualitas enterprise.", avatar: "RD", rating: 5 },
  { name: "Ahmad Fauzi", role: "Founder, LogisSmart", text: "Legal AI membantu kami review 200+ kontrak dalam seminggu. Luar biasa efisiennya.", avatar: "AF", rating: 5 },
];

const STATS = [
  { value: "2,400+", label: "Proyek Selesai" },
  { value: "98%", label: "Client Satisfaction" },
  { value: "10x", label: "Lebih Cepat" },
  { value: "60+", label: "AI Specialists" },
];

export function Landing() {
  return (
    <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #F97316, #EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 18, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ display: "flex", gap: 32, fontSize: 14, fontWeight: 500, color: "var(--cp-navy-lt)" }}>
          {["Layanan", "Portfolio", "Harga", "Blog"].map(l => (
            <span key={l} style={{ cursor: "pointer", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--cp-orange)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--cp-navy-lt)")}>{l}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cp-navy-lt)", cursor: "pointer" }}>Masuk</span>
          <button className="cp-btn cp-btn-primary" style={{ padding: "9px 20px", fontSize: 13 }}>
            Mulai Sekarang <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="cp-grad-hero" style={{ padding: "96px 48px 80px", position: "relative", overflow: "hidden" }}>
        {/* Background orbs */}
        <div style={{ position: "absolute", top: -80, right: -80, width: 480, height: 480, background: "radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -60, left: -40, width: 320, height: 320, background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />

        <div style={{ maxWidth: 720, position: "relative" }}>
          <div className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange-dk)", border: "1px solid rgba(249,115,22,0.25)", marginBottom: 24, fontSize: 12 }}>
            <span className="cp-dot cp-dot-green" style={{ width: 6, height: 6 }} />
            ✦ Baru: Customs &amp; PPJK AI kini tersedia
            <ChevronRight size={12} />
          </div>

          <h1 className="cp-h1" style={{ marginBottom: 24, color: "var(--cp-navy)" }}>
            Transformasi Bisnis Anda dengan{" "}
            <span style={{ color: "var(--cp-orange)", fontStyle: "italic" }}>AI Enterprise</span>{" "}
            yang Bekerja untuk Anda.
          </h1>

          <p style={{ fontSize: 18, lineHeight: 1.7, color: "var(--cp-navy-lt)", marginBottom: 40, maxWidth: 560 }}>
            Dari kampanye kreatif hingga dokumen kepabeanan — tim AI profesional kami menangani semuanya, dengan kualitas enterprise dan kecepatan yang belum pernah ada.
          </p>

          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <button className="cp-btn cp-btn-primary" style={{ fontSize: 15, padding: "13px 28px" }}>
              Mulai Sekarang <ArrowRight size={16} />
            </button>
            <button className="cp-btn" style={{ background: "transparent", border: "1.5px solid rgba(15,23,42,0.15)", color: "var(--cp-navy)", fontSize: 15, padding: "12px 24px" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--cp-orange)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Play size={10} color="#fff" fill="#fff" />
              </div>
              Lihat Demo
            </button>
          </div>

          <div style={{ marginTop: 40, display: "flex", gap: 24, alignItems: "center" }}>
            <div style={{ display: "flex" }}>
              {["BS", "RD", "AF", "MK"].map((a, i) => (
                <div key={a} style={{ width: 36, height: 36, borderRadius: "50%", background: `hsl(${i * 60 + 200},60%,55%)`, border: "2.5px solid #fff", marginLeft: i === 0 ? 0 : -10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>{a}</div>
              ))}
            </div>
            <div>
              <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
                {[1,2,3,4,5].map(s => <Star key={s} size={13} fill="#F97316" color="#F97316" />)}
              </div>
              <p style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>Dipercaya <strong style={{ color: "var(--cp-navy)" }}>2,400+</strong> klien enterprise</p>
            </div>
          </div>
        </div>

        {/* Hero Visual — Dashboard mockup card */}
        <div style={{ position: "absolute", right: 48, top: "50%", transform: "translateY(-50%)", width: 460 }}>
          <div className="cp-glass" style={{ borderRadius: 20, padding: 24, boxShadow: "0 24px 64px rgba(15,23,42,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15 }}>Project Overview</span>
              <div style={{ display: "flex", gap: 6 }}>
                <span className="cp-dot cp-dot-green" />
                <span style={{ fontSize: 11, color: "#10B981", fontWeight: 600 }}>Live</span>
              </div>
            </div>
            {[
              { label: "Proyek Aktif", val: "3", color: "#F97316" },
              { label: "Selesai Bulan Ini", val: "7", color: "#10B981" },
              { label: "Jam Dihemat", val: "315", color: "#3B82F6" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, padding: "12px 16px", background: "rgba(255,255,255,0.6)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.8)" }}>
                <span style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>{s.label}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "var(--cp-serif)" }}>{s.val}</span>
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              {[
                { name: "Brand Refresh Q1", pct: 63, status: "Produksi", color: "#F97316" },
                { name: "Marketing Campaign", pct: 92, status: "Review", color: "#22D3EE" },
                { name: "Finance Report Q4", pct: 36, status: "Analisis", color: "#F59E0B" },
              ].map(p => (
                <div key={p.name} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--cp-navy)" }}>{p.name}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--cp-navy-lt)" }}>{p.pct}%</span>
                      <span className="cp-badge" style={{ background: `${p.color}18`, color: p.color, fontSize: 10, padding: "2px 8px" }}>{p.status}</span>
                    </div>
                  </div>
                  <div className="cp-progress-track">
                    <div className="cp-progress-fill" style={{ width: `${p.pct}%`, background: p.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* STATS BAR */}
      <section style={{ background: "var(--cp-navy)", padding: "32px 48px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
          {STATS.map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--cp-serif)", fontSize: 40, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 6, fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SERVICES GRID */}
      <section style={{ padding: "80px 48px", background: "var(--cp-warm)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="cp-badge" style={{ background: "rgba(249,115,22,0.08)", color: "var(--cp-orange)", border: "1px solid rgba(249,115,22,0.2)", marginBottom: 16 }}>
              15 Layanan AI
            </div>
            <h2 className="cp-h2" style={{ marginBottom: 16 }}>Satu Platform,<br />Semua Kebutuhan Bisnis</h2>
            <p style={{ color: "var(--cp-navy-lt)", fontSize: 16, maxWidth: 480, margin: "0 auto", lineHeight: 1.7 }}>
              Setiap layanan dijalankan oleh AI specialist yang terlatih khusus bidangnya, diawasi tim ahli manusia.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {SERVICES.map(s => (
              <div key={s.name} className="cp-card" style={{ padding: 20, cursor: "pointer", position: "relative" }}
                onMouseEnter={e => { (e.currentTarget.style.boxShadow = "var(--cp-shadow-md)"); (e.currentTarget.style.transform = "translateY(-3px)"); }}
                onMouseLeave={e => { (e.currentTarget.style.boxShadow = "var(--cp-shadow-sm)"); (e.currentTarget.style.transform = "translateY(0)"); }}>
                {s.badge && (
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <span className="cp-badge" style={{ background: `${s.badgeColor}18`, color: s.badgeColor, fontSize: 10 }}>{s.badge}</span>
                  </div>
                )}
                <div style={{ width: 40, height: 40, borderRadius: 12, background: s.featured ? "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.06))" : "rgba(15,23,42,0.04)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <s.icon size={20} color={s.featured ? "var(--cp-orange)" : "var(--cp-navy-lt)"} />
                </div>
                <div style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, color: "var(--cp-navy)", marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "var(--cp-navy-lt)", lineHeight: 1.5 }}>{s.desc}</div>
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--cp-orange)" }}>
                  Lihat Detail <ChevronRight size={12} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY US — 3 pillars */}
      <section className="cp-grad-subtle" style={{ padding: "80px 48px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 className="cp-h2" style={{ marginBottom: 12 }}>Mengapa Creative Studio?</h2>
            <p style={{ color: "var(--cp-navy-lt)", fontSize: 16, maxWidth: 440, margin: "0 auto" }}>Bukan sekadar software. Kami adalah tim AI specialist Anda.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {[
              { icon: Zap, title: "10x Lebih Cepat", desc: "Workflow AI kami menyelesaikan pekerjaan yang butuh seminggu menjadi hitungan jam.", color: "#F97316" },
              { icon: BadgeCheck, title: "Human-in-the-Loop", desc: "Setiap output AI direview oleh specialist manusia sebelum diserahkan ke Anda.", color: "#10B981" },
              { icon: Shield, title: "Enterprise-Grade Security", desc: "Data Anda terenkripsi end-to-end. SOC 2 compliant. Zero-knowledge architecture.", color: "#3B82F6" },
            ].map(p => (
              <div key={p.title} className="cp-card" style={{ padding: 32, textAlign: "center" }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: `${p.color}15`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                  <p.icon size={26} color={p.color} />
                </div>
                <h3 className="cp-h3" style={{ marginBottom: 10, fontSize: 20 }}>{p.title}</h3>
                <p style={{ fontSize: 14, color: "var(--cp-navy-lt)", lineHeight: 1.7 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{ padding: "80px 48px", background: "var(--cp-warm)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h2 className="cp-h2" style={{ textAlign: "center", marginBottom: 48 }}>Kata Mereka</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="cp-card" style={{ padding: 28 }}>
                <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={14} fill="#F97316" color="#F97316" />)}
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.8, color: "var(--cp-navy-lt)", marginBottom: 20, fontStyle: "italic" }}>"{t.text}"</p>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #F97316, #EA580C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{t.avatar}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cp-navy)" }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "var(--cp-navy)", padding: "80px 48px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 600, background: "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <h2 className="cp-h2" style={{ color: "#fff", marginBottom: 16 }}>Siap Transformasi Bisnis Anda?</h2>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 16, marginBottom: 36, lineHeight: 1.7 }}>Mulai dengan konsultasi gratis. Tidak ada komitmen, tidak ada kartu kredit.</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            <button className="cp-btn cp-btn-primary" style={{ fontSize: 15, padding: "13px 32px" }}>Mulai Gratis <ArrowRight size={16} /></button>
            <button className="cp-btn" style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontSize: 15, padding: "12px 28px" }}>Jadwalkan Demo</button>
          </div>
          <div style={{ marginTop: 28, display: "flex", gap: 24, justifyContent: "center" }}>
            {["Setup gratis", "Tidak ada kontrak", "Cancel kapan saja"].map(f => (
              <div key={f} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                <CheckCircle size={14} color="#10B981" /> {f}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: "#060B18", padding: "40px 48px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #F97316, #EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={13} color="#fff" />
          </div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, color: "#fff", fontSize: 16 }}>Creative Studio</span>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>© 2025 Creative Studio AI. All rights reserved.</p>
      </footer>
    </div>
  );
}
