import "./_group.css";
import { Search, SlidersHorizontal, Star, Clock, ChevronRight, Sparkles, Zap, ArrowRight, Palette, TrendingUp, DollarSign, Scale, Truck, BarChart3, Users, FileText, Shield, Globe, Headphones, Brain, BookOpen, Package } from "lucide-react";
import { useState } from "react";

const CATS = ["Semua", "Creative", "Finance", "Legal & Compliance", "Operations", "Strategy"];

const SERVICES = [
  { icon: Palette, name: "Creative AI", cat: "Creative", desc: "Brand identity, visual design, copywriting & konten kreatif end-to-end.", tags: ["Design", "Brand", "Content"], rating: 4.9, reviews: 248, time: "1–3 hari", priceFrom: "Rp 500rb", featured: true, badge: "Most Popular", badgeColor: "#7C6EFA" },
  { icon: TrendingUp, name: "Marketing AI", cat: "Creative", desc: "Campaign strategy, digital ads, SEO & growth hacking untuk bisnis Anda.", tags: ["Digital", "Ads", "SEO"], rating: 4.8, reviews: 186, time: "2–5 hari", priceFrom: "Rp 750rb", featured: true, badge: "Fast Delivery", badgeColor: "#22D3EE" },
  { icon: DollarSign, name: "Finance AI", cat: "Finance", desc: "Analisis keuangan, proyeksi, laporan board & investor deck berkualitas tinggi.", tags: ["Analisis", "Report", "Proyeksi"], rating: 4.9, reviews: 142, time: "3–7 hari", priceFrom: "Rp 1jt", featured: true, badge: "Enterprise", badgeColor: "#F59E0B" },
  { icon: FileText, name: "Accounting AI", cat: "Finance", desc: "Pembukuan, rekonsiliasi bank, payroll & laporan keuangan bulanan.", tags: ["Bookkeeping", "Payroll"], rating: 4.7, reviews: 98, time: "1–5 hari", priceFrom: "Rp 400rb", featured: false, badge: null, badgeColor: "" },
  { icon: Scale, name: "Legal AI", cat: "Legal & Compliance", desc: "Drafting kontrak, review perjanjian & advisory kepatuhan hukum Indonesia.", tags: ["Kontrak", "Compliance"], rating: 4.8, reviews: 115, time: "2–4 hari", priceFrom: "Rp 800rb", featured: false, badge: "Human Review", badgeColor: "#8B5CF6" },
  { icon: Shield, name: "Tax AI", cat: "Legal & Compliance", desc: "Perencanaan pajak, pengisian SPT & optimasi kewajiban fiskal perusahaan.", tags: ["SPT", "Pajak", "Fiskal"], rating: 4.9, reviews: 77, time: "3–5 hari", priceFrom: "Rp 600rb", featured: false, badge: null, badgeColor: "" },
  { icon: Truck, name: "Logistics AI", cat: "Operations", desc: "Optimasi rantai pasok, routing pengiriman & manajemen vendor logistik.", tags: ["Supply Chain", "Shipping"], rating: 4.6, reviews: 64, time: "2–5 hari", priceFrom: "Rp 900rb", featured: false, badge: null, badgeColor: "" },
  { icon: Globe, name: "Customs & PPJK AI", cat: "Operations", desc: "Dokumen kepabeanan, PIB, PEB & advisory impor-ekspor Indonesia.", tags: ["BC", "Bea Cukai", "Import"], rating: 4.8, reviews: 53, time: "1–3 hari", priceFrom: "Rp 1.2jt", featured: false, badge: "New", badgeColor: "#22D3EE" },
  { icon: Users, name: "HR & Payroll AI", cat: "Operations", desc: "Manajemen SDM, penggajian otomatis, kontrak kerja & KPI tracking.", tags: ["SDM", "Payroll", "KPI"], rating: 4.7, reviews: 89, time: "2–4 hari", priceFrom: "Rp 500rb", featured: false, badge: null, badgeColor: "" },
  { icon: BarChart3, name: "Sales AI", cat: "Strategy", desc: "Pipeline management, proposal generator & analisis win-rate penjualan.", tags: ["CRM", "Pipeline", "Proposal"], rating: 4.8, reviews: 131, time: "1–3 hari", priceFrom: "Rp 650rb", featured: false, badge: null, badgeColor: "" },
  { icon: Brain, name: "Executive AI", cat: "Strategy", desc: "Ringkasan eksekutif, strategic planning & board presentation deck.", tags: ["Strategy", "Board", "Planning"], rating: 4.9, reviews: 44, time: "3–7 hari", priceFrom: "Rp 2jt", featured: false, badge: "Enterprise", badgeColor: "#F59E0B" },
  { icon: Headphones, name: "Customer Service AI", cat: "Operations", desc: "Chatbot cerdas, sistem eskalasi & analisis kepuasan pelanggan.", tags: ["Chatbot", "Support", "CX"], rating: 4.6, reviews: 71, time: "Langsung", priceFrom: "Rp 350rb", featured: false, badge: null, badgeColor: "" },
];

export function ServicesCatalog() {
  const [activecat, setActivecat] = useState("Semua");
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);

  const filtered = SERVICES.filter(s =>
    (activecat === "Semua" || s.cat === activecat) &&
    (query === "" || s.name.toLowerCase().includes(query.toLowerCase()) || s.desc.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={14} color="#fff" />
          </div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ display: "flex", gap: 28, fontSize: 14, fontWeight: 500, color: "var(--cp-navy-lt)" }}>
          {["Layanan", "Portfolio", "Harga"].map(l => <span key={l} style={{ cursor: "pointer" }}>{l}</span>)}
        </div>
        <button className="cp-btn cp-btn-primary" style={{ padding: "9px 18px", fontSize: 13 }}>Mulai Proyek <ArrowRight size={13} /></button>
      </nav>

      {/* HERO SEARCH BAR */}
      <div style={{ background: "linear-gradient(135deg, #FFF7ED 0%, var(--cp-warm) 60%)", padding: "56px 48px 0", textAlign: "center" }}>
        <div className="cp-badge" style={{ background: "rgba(249,115,22,0.08)", color: "var(--cp-orange-dk)", border: "1px solid rgba(249,115,22,0.2)", marginBottom: 16, display: "inline-flex" }}>
          <Zap size={11} /> 15 Layanan AI Tersedia
        </div>
        <h1 className="cp-h2" style={{ marginBottom: 8 }}>Temukan Layanan AI yang Tepat</h1>
        <p style={{ color: "var(--cp-navy-lt)", fontSize: 15, marginBottom: 32 }}>Dari creative hingga enterprise, semua ada di sini.</p>

        {/* Search + Filter */}
        <div style={{ maxWidth: 600, margin: "0 auto 40px", display: "flex", gap: 12 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={16} color="#94A3B8" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
            <input className="cp-input" placeholder="Cari layanan AI..." style={{ paddingLeft: 40 }}
              value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", gap: 8, padding: "10px 18px", boxShadow: "var(--cp-shadow-sm)", whiteSpace: "nowrap" }}>
            <SlidersHorizontal size={15} /> Filter
          </button>
        </div>

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", paddingBottom: 0, flexWrap: "wrap" }}>
          {CATS.map(c => (
            <button key={c} onClick={() => setActivecat(c)}
              style={{ padding: "8px 20px", borderRadius: 99, border: activecat === c ? "none" : "1.5px solid rgba(15,23,42,0.1)", background: activecat === c ? "var(--cp-orange)" : "#fff", color: activecat === c ? "#fff" : "var(--cp-navy-lt)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cp-sans)", transition: "all 0.18s", boxShadow: activecat === c ? "0 2px 8px rgba(249,115,22,0.3)" : "none" }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* TAB UNDERLINE */}
      <div style={{ background: "linear-gradient(to bottom, rgba(249,115,22,0.04), transparent)", height: 24 }} />

      {/* RESULTS */}
      <div style={{ padding: "8px 48px 80px", maxWidth: 1296, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <p style={{ fontSize: 14, color: "var(--cp-navy-lt)" }}>
            Menampilkan <strong style={{ color: "var(--cp-navy)" }}>{filtered.length}</strong> layanan
          </p>
          <select style={{ fontSize: 13, color: "var(--cp-navy-lt)", border: "1.5px solid rgba(15,23,42,0.1)", borderRadius: 8, padding: "7px 12px", background: "#fff", fontFamily: "var(--cp-sans)", cursor: "pointer" }}>
            <option>Paling Populer</option>
            <option>Harga Terendah</option>
            <option>Rating Tertinggi</option>
            <option>Terbaru</option>
          </select>
        </div>

        {/* Featured row */}
        {activecat === "Semua" && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Star size={14} fill="#F97316" color="#F97316" />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cp-orange)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Featured Services</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {SERVICES.filter(s => s.featured).map(s => (
                <ServiceCard key={s.name} s={s} featured hovered={hovered === s.name} onHover={setHovered} />
              ))}
            </div>
          </div>
        )}

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {filtered.filter(s => activecat !== "Semua" || !s.featured).map(s => (
            <ServiceCard key={s.name} s={s} featured={false} hovered={hovered === s.name} onHover={setHovered} />
          ))}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <h3 className="cp-h3" style={{ marginBottom: 8 }}>Layanan tidak ditemukan</h3>
            <p style={{ color: "var(--cp-navy-lt)", fontSize: 14 }}>Coba kata kunci lain atau pilih kategori berbeda.</p>
            <button className="cp-btn cp-btn-ghost" style={{ marginTop: 20 }} onClick={() => { setQuery(""); setActivecat("Semua"); }}>Reset Filter</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceCard({ s, featured, hovered, onHover }: { s: (typeof SERVICES)[0]; featured: boolean; hovered: boolean; onHover: (n: string | null) => void }) {
  return (
    <div className="cp-card" style={{ padding: featured ? 24 : 18, cursor: "pointer", position: "relative", transition: "all 0.22s", boxShadow: hovered ? "var(--cp-shadow-md)" : "var(--cp-shadow-sm)", transform: hovered ? "translateY(-3px)" : "translateY(0)", borderColor: hovered ? "rgba(249,115,22,0.25)" : "rgba(15,23,42,0.07)" }}
      onMouseEnter={() => onHover(s.name)} onMouseLeave={() => onHover(null)}>
      {s.badge && (
        <span className="cp-badge" style={{ position: "absolute", top: featured ? 16 : 12, right: featured ? 16 : 12, background: `${s.badgeColor}18`, color: s.badgeColor, fontSize: 10 }}>{s.badge}</span>
      )}
      <div style={{ width: featured ? 48 : 40, height: featured ? 48 : 40, borderRadius: 14, background: "linear-gradient(135deg, rgba(249,115,22,0.1), rgba(249,115,22,0.05))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <s.icon size={featured ? 22 : 18} color="var(--cp-orange)" />
      </div>
      <h3 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: featured ? 17 : 14, color: "var(--cp-navy)", marginBottom: 6 }}>{s.name}</h3>
      <p style={{ fontSize: featured ? 13 : 12, color: "var(--cp-navy-lt)", lineHeight: 1.6, marginBottom: 14 }}>{s.desc}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
        {s.tags.map(t => <span key={t} className="cp-tag" style={{ fontSize: 10 }}>{t}</span>)}
      </div>
      <div className="cp-divider" style={{ marginBottom: 14 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--cp-navy-lt)", marginBottom: 2 }}>Mulai dari</div>
          <div style={{ fontSize: featured ? 16 : 13, fontWeight: 700, color: "var(--cp-navy)" }}>{s.priceFrom}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end", marginBottom: 2 }}>
            <Star size={11} fill="#F97316" color="#F97316" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cp-navy)" }}>{s.rating}</span>
            <span style={{ fontSize: 11, color: "var(--cp-navy-lt)" }}>({s.reviews})</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--cp-navy-lt)", justifyContent: "flex-end" }}>
            <Clock size={10} /> {s.time}
          </div>
        </div>
      </div>
      {hovered && (
        <div style={{ marginTop: 14 }}>
          <button className="cp-btn cp-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "9px 0", fontSize: 13 }}>
            Mulai Sekarang <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
