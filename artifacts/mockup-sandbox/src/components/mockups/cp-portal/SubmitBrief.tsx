import "./_group.css";
import { ArrowRight, ArrowLeft, CheckCircle, Sparkles, FileText, User, Briefcase, Clock, Zap, ChevronDown, Upload } from "lucide-react";
import { useState } from "react";

const STEPS = [
  { n: 1, label: "Pilih Layanan", icon: Briefcase },
  { n: 2, label: "Informasi Brief", icon: FileText },
  { n: 3, label: "Detail & Referensi", icon: Zap },
  { n: 4, label: "Konfirmasi", icon: CheckCircle },
];

const SERVICES = [
  { id: "creative", name: "Creative AI", desc: "Brand, desain & konten kreatif", color: "#7C6EFA", icon: "🎨" },
  { id: "marketing", name: "Marketing AI", desc: "Campaign, digital & growth", color: "#22D3EE", icon: "📈" },
  { id: "finance", name: "Finance AI", desc: "Analisis, laporan & proyeksi", color: "#F59E0B", icon: "💰" },
  { id: "legal", name: "Legal AI", desc: "Kontrak & compliance", color: "#8B5CF6", icon: "⚖️" },
  { id: "hr", name: "HR & Payroll AI", desc: "SDM & penggajian", color: "#10B981", icon: "👥" },
  { id: "tax", name: "Tax AI", desc: "Pajak & kepatuhan", color: "#EF4444", icon: "📋" },
];

const URGENCY = [
  { id: "standard", label: "Standard", desc: "3–5 hari kerja", price: "Normal rate" },
  { id: "express", label: "Express", desc: "1–2 hari kerja", price: "+30%", highlight: true },
  { id: "urgent", label: "Urgent", desc: "< 24 jam", price: "+60%" },
];

export function SubmitBrief() {
  const [step, setStep] = useState(2);
  const [selected, setSelected] = useState("creative");
  const [urgency, setUrgency] = useState("standard");
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)", minHeight: "100vh" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={14} color="#fff" /></div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--cp-navy-lt)" }}>
          <User size={14} />
          <span>Budi Santoso</span>
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 className="cp-h2" style={{ marginBottom: 10, fontSize: 34 }}>Mulai Proyek Baru</h1>
          <p style={{ color: "var(--cp-navy-lt)", fontSize: 15 }}>Isi brief Anda dan tim AI kami akan segera bekerja.</p>
        </div>

        {/* STEPPER */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 48, position: "relative" }}>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{ flex: 1, display: "flex", alignItems: "center", flexDirection: i < STEPS.length - 1 ? "row" : "column" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: step > s.n ? "#10B981" : step === s.n ? "var(--cp-orange)" : "#fff", border: step <= s.n ? `2px solid ${step === s.n ? "var(--cp-orange)" : "rgba(15,23,42,0.15)"}` : "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: step === s.n ? "0 4px 16px rgba(249,115,22,0.35)" : "none", transition: "all 0.3s" }}>
                  {step > s.n ? <CheckCircle size={18} color="#fff" /> : <span style={{ fontSize: 13, fontWeight: 700, color: step === s.n ? "#fff" : "rgba(15,23,42,0.35)" }}>{s.n}</span>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, marginTop: 8, color: step === s.n ? "var(--cp-orange)" : step > s.n ? "#10B981" : "rgba(15,23,42,0.4)", textAlign: "center", whiteSpace: "nowrap" }}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: step > s.n ? "#10B981" : "rgba(15,23,42,0.1)", margin: "0 8px", marginBottom: 24, borderRadius: 99, transition: "background 0.3s" }} />
              )}
            </div>
          ))}
        </div>

        {/* STEP CONTENT */}
        <div className="cp-card" style={{ padding: 40, boxShadow: "var(--cp-shadow-lg)" }}>
          {step === 1 && (
            <div>
              <h3 className="cp-h3" style={{ marginBottom: 6 }}>Pilih Layanan AI</h3>
              <p style={{ color: "var(--cp-navy-lt)", fontSize: 14, marginBottom: 28 }}>Layanan mana yang sesuai dengan kebutuhan Anda?</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                {SERVICES.map(s => (
                  <div key={s.id} onClick={() => setSelected(s.id)}
                    style={{ padding: "20px 16px", borderRadius: 14, border: `2px solid ${selected === s.id ? s.color : "rgba(15,23,42,0.08)"}`, background: selected === s.id ? `${s.color}08` : "#fff", cursor: "pointer", transition: "all 0.18s", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>{s.icon}</div>
                    <div style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, color: "var(--cp-navy)", marginBottom: 4 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>{s.desc}</div>
                    {selected === s.id && <div style={{ marginTop: 10 }}><CheckCircle size={16} color={s.color} /></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 className="cp-h3" style={{ marginBottom: 6 }}>Informasi Brief</h3>
              <p style={{ color: "var(--cp-navy-lt)", fontSize: 14, marginBottom: 28 }}>Ceritakan kebutuhan Anda. Semakin detail, semakin baik hasilnya.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 8 }}>Nama Proyek *</label>
                  <input className="cp-input" defaultValue="Brand Refresh Creative Studio" />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 8 }}>Industri *</label>
                  <div style={{ position: "relative" }}>
                    <select className="cp-input" style={{ appearance: "none" }}>
                      <option>Technology</option>
                      <option>Finance</option>
                      <option>Retail</option>
                    </select>
                    <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 8 }}>Deskripsi Kebutuhan *</label>
                <textarea className="cp-input" rows={4} defaultValue="Kami membutuhkan brand identity yang modern dan profesional untuk perusahaan teknologi. Target pasar adalah B2B enterprise di Indonesia. Tolong sertakan logo, color palette, typography, dan brand guideline lengkap." style={{ resize: "vertical" }} />
                <div style={{ fontSize: 11, color: "var(--cp-navy-lt)", marginTop: 4 }}>AI kami akan menganalisis brief ini untuk memberikan hasil terbaik.</div>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 8 }}>Tujuan Utama *</label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {["Meningkatkan Brand Awareness", "Repositioning Brand", "Ekspansi Pasar", "Launch Produk Baru", "Investor Presentation"].map(g => (
                    <button key={g} style={{ padding: "7px 14px", borderRadius: 8, border: "1.5px solid rgba(15,23,42,0.1)", background: "#fff", fontSize: 12, color: "var(--cp-navy-lt)", cursor: "pointer", fontFamily: "var(--cp-sans)", transition: "all 0.18s" }}
                      onMouseEnter={e => { (e.currentTarget.style.borderColor = "var(--cp-orange)"); (e.currentTarget.style.color = "var(--cp-orange)"); (e.currentTarget.style.background = "rgba(249,115,22,0.05)"); }}
                      onMouseLeave={e => { (e.currentTarget.style.borderColor = "rgba(15,23,42,0.1)"); (e.currentTarget.style.color = "var(--cp-navy-lt)"); (e.currentTarget.style.background = "#fff"); }}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h3 className="cp-h3" style={{ marginBottom: 6 }}>Detail & Referensi</h3>
              <p style={{ color: "var(--cp-navy-lt)", fontSize: 14, marginBottom: 28 }}>Upload referensi dan atur prioritas pengerjaan.</p>

              {/* Urgency selector */}
              <div style={{ marginBottom: 28 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 12 }}>Urgensi Pengerjaan</label>
                <div style={{ display: "flex", gap: 12 }}>
                  {URGENCY.map(u => (
                    <div key={u.id} onClick={() => setUrgency(u.id)}
                      style={{ flex: 1, padding: "16px", borderRadius: 14, border: `2px solid ${urgency === u.id ? "var(--cp-orange)" : "rgba(15,23,42,0.1)"}`, background: urgency === u.id ? "rgba(249,115,22,0.05)" : "#fff", cursor: "pointer", transition: "all 0.18s", textAlign: "center", position: "relative" }}>
                      {u.highlight && <span style={{ position: "absolute", top: -8, right: -4, background: "var(--cp-orange)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99 }}>Rekomendasi</span>}
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cp-navy)", marginBottom: 4 }}>{u.label}</div>
                      <div style={{ fontSize: 12, color: "var(--cp-navy-lt)", marginBottom: 6 }}>{u.desc}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: urgency === u.id ? "var(--cp-orange)" : "var(--cp-navy-lt)" }}>{u.price}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* File upload */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", display: "block", marginBottom: 12 }}>Upload Referensi (opsional)</label>
                <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={() => setDragOver(false)}
                  style={{ border: `2px dashed ${dragOver ? "var(--cp-orange)" : "rgba(15,23,42,0.15)"}`, borderRadius: 16, padding: "40px 24px", textAlign: "center", background: dragOver ? "rgba(249,115,22,0.04)" : "#fff", transition: "all 0.2s", cursor: "pointer" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(249,115,22,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <Upload size={22} color="var(--cp-orange)" />
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: "var(--cp-navy)", marginBottom: 6 }}>Drop file atau klik untuk upload</p>
                  <p style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>PNG, JPG, PDF, AI, PSD · Max 50MB</p>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(16,185,129,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
                <CheckCircle size={40} color="#10B981" />
              </div>
              <h3 className="cp-h3" style={{ marginBottom: 8, fontSize: 24 }}>Brief Siap Dikirim!</h3>
              <p style={{ color: "var(--cp-navy-lt)", fontSize: 14, marginBottom: 32, maxWidth: 400, margin: "0 auto 32px" }}>Review ringkasan proyek Anda sebelum submit. Tim kami akan membalas dalam 1–4 jam.</p>
              <div className="cp-card" style={{ textAlign: "left", padding: 24, maxWidth: 480, margin: "0 auto 32px" }}>
                {[
                  { label: "Layanan", value: "Creative AI — Brand Identity" },
                  { label: "Proyek", value: "Brand Refresh Creative Studio" },
                  { label: "Urgensi", value: "Express (1–2 hari)" },
                  { label: "Paket", value: "Professional" },
                  { label: "Estimasi Harga", value: "Rp 1.500.000" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                    <span style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)" }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NAVIGATION */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 36, paddingTop: 28, borderTop: "1px solid rgba(15,23,42,0.07)" }}>
            <button onClick={() => setStep(Math.max(1, step - 1))} className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", visibility: step === 1 ? "hidden" : "visible" }}>
              <ArrowLeft size={14} /> Kembali
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {STEPS.map(s => (
                <div key={s.n} style={{ width: 8, height: 8, borderRadius: "50%", background: step === s.n ? "var(--cp-orange)" : step > s.n ? "#10B981" : "rgba(15,23,42,0.15)", transition: "all 0.2s" }} />
              ))}
            </div>
            <button onClick={() => setStep(Math.min(4, step + 1))} className="cp-btn cp-btn-primary">
              {step === 4 ? "Submit Brief" : "Lanjut"} <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* AI hint */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20, padding: "14px 20px", background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)", borderRadius: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Sparkles size={14} color="#fff" />
          </div>
          <p style={{ fontSize: 13, color: "var(--cp-navy-lt)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--cp-orange)" }}>AI Tip:</strong> Brief yang detail menghasilkan output 3x lebih akurat. Sertakan contoh referensi dan target audiens spesifik untuk hasil terbaik.
          </p>
        </div>
      </div>
    </div>
  );
}
