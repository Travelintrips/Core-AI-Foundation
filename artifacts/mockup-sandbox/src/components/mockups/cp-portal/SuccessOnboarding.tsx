import "./_group.css";
import { CheckCircle, ArrowRight, Download, MessageCircle, Calendar, Sparkles, Star, ChevronRight, Bell, Rocket, Clock, Users, Shield } from "lucide-react";
import { useEffect, useState } from "react";

const CONFETTI_COLORS = ["#F97316", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"];

function Particle({ index }: { index: number }) {
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const left = `${(index * 13 + 7) % 100}%`;
  const delay = `${(index * 0.15) % 2}s`;
  const size = 6 + (index % 4);
  return (
    <div style={{ position: "absolute", top: 0, left, width: size, height: size, borderRadius: index % 3 === 0 ? "50%" : 2, background: color, animation: `fall ${1.5 + (index % 10) * 0.2}s ${delay} ease-in forwards`, opacity: 0.85 }} />
  );
}

const NEXT_STEPS = [
  { n: "01", title: "Cek Email Konfirmasi", desc: "Kami telah mengirim ringkasan brief & estimasi ke email Anda.", done: true, icon: Bell },
  { n: "02", title: "Tunggu Quotation", desc: "Tim kami akan mengirim penawaran harga dalam 1–4 jam kerja.", done: false, current: true, icon: Clock },
  { n: "03", title: "Setujui & Bayar DP", desc: "Review penawaran dan lakukan pembayaran DP 50% untuk memulai.", done: false, icon: Shield },
  { n: "04", title: "Pantau Progress", desc: "Ikuti perkembangan proyek real-time di dashboard Anda.", done: false, icon: Rocket },
  { n: "05", title: "Terima Hasil Akhir", desc: "Unduh semua file dan lakukan revisi hingga puas.", done: false, icon: Download },
];

const TEAM = [
  { name: "Arif Wicaksono", role: "Creative Director", avatar: "AW", rating: "4.9", projects: "230+" },
  { name: "Dina Pratiwi", role: "Brand Strategist", avatar: "DP", rating: "4.8", projects: "180+" },
  { name: "Creative AI Engine", role: "AI Production", avatar: "AI", rating: "4.9", projects: "2,400+" },
];

export function SuccessOnboarding() {
  const [showConfetti, setShowConfetti] = useState(true);
  const [confettiCount] = useState(32);

  useEffect(() => {
    const t = setTimeout(() => setShowConfetti(false), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <style>{`
        @keyframes fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(600px) rotate(720deg); opacity: 0; }
        }
        @keyframes pop-in {
          0% { opacity: 0; transform: scale(0.85) translateY(12px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .anim-pop { animation: pop-in 0.5s ease forwards; }
        .pulse-ring { animation: pulse-ring 1.5s ease-out infinite; }
      `}</style>

      <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)", minHeight: "100vh", overflow: "hidden" }}>
        {/* NAV */}
        <nav className="cp-nav">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={14} color="#fff" /></div>
            <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>Order #PRJ-2024-090</div>
          <button className="cp-btn cp-btn-primary" style={{ fontSize: 13, padding: "8px 16px" }}>Dashboard Saya <ArrowRight size={13} /></button>
        </nav>

        {/* CONFETTI */}
        {showConfetti && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "100%", pointerEvents: "none", overflow: "hidden", zIndex: 999 }}>
            {Array.from({ length: confettiCount }).map((_, i) => <Particle key={i} index={i} />)}
          </div>
        )}

        {/* HERO SUCCESS */}
        <div className="cp-grad-hero" style={{ padding: "72px 48px 56px", textAlign: "center", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 30%, rgba(249,115,22,0.1) 0%, transparent 60%)", pointerEvents: "none" }} />

          <div className="anim-pop" style={{ position: "relative", display: "inline-block", marginBottom: 24 }}>
            <div style={{ width: 96, height: 96, borderRadius: "50%", background: "#10B981", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", position: "relative", zIndex: 1 }}>
              <CheckCircle size={48} color="#fff" />
            </div>
            <div className="pulse-ring" style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "3px solid rgba(16,185,129,0.4)", top: -8, left: "50%", transform: "translateX(-50%)", width: 96, height: 96 }} />
          </div>

          <div className="anim-pop" style={{ animationDelay: "0.15s", opacity: 0 }}>
            <div className="cp-badge" style={{ background: "rgba(16,185,129,0.1)", color: "#10B981", border: "1px solid rgba(16,185,129,0.3)", marginBottom: 16, display: "inline-flex", fontSize: 12 }}>
              <CheckCircle size={11} /> Brief Berhasil Dikirim!
            </div>
            <h1 className="cp-h1" style={{ marginBottom: 16, fontSize: 48 }}>
              Selamat,{" "}
              <span style={{ color: "var(--cp-orange)", fontStyle: "italic" }}>Budi!</span> 🎉
            </h1>
            <p style={{ fontSize: 17, color: "var(--cp-navy-lt)", maxWidth: 520, margin: "0 auto 32px", lineHeight: 1.7 }}>
              Brief Anda telah diterima. Tim Creative AI kami akan segera mulai bekerja. Estimasi quotation: <strong style={{ color: "var(--cp-navy)" }}>1–4 jam</strong>.
            </p>
          </div>

          {/* Summary card */}
          <div className="anim-pop cp-glass" style={{ animationDelay: "0.3s", opacity: 0, maxWidth: 560, margin: "0 auto", borderRadius: 20, padding: "24px 32px", boxShadow: "var(--cp-shadow-lg)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {[
                { label: "Layanan", value: "Creative AI", icon: "🎨" },
                { label: "Paket", value: "Professional", icon: "⭐" },
                { label: "Estimasi", value: "2 hari", icon: "⚡" },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 16, color: "var(--cp-navy)" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--cp-navy-lt)", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 48px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 40 }}>
            {/* NEXT STEPS */}
            <div>
              <h2 className="cp-h2" style={{ marginBottom: 8, fontSize: 26 }}>Langkah Selanjutnya</h2>
              <p style={{ color: "var(--cp-navy-lt)", fontSize: 14, marginBottom: 32 }}>Ikuti proses ini untuk mendapatkan hasil terbaik dari layanan kami.</p>

              <div style={{ position: "relative" }}>
                {NEXT_STEPS.map((step, i) => (
                  <div key={step.n} style={{ display: "flex", gap: 20, marginBottom: i < NEXT_STEPS.length - 1 ? 0 : 0, position: "relative" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{ width: 44, height: 44, borderRadius: "50%", background: step.done ? "#10B981" : (step as any).current ? "var(--cp-orange)" : "#fff", border: `2px solid ${step.done ? "#10B981" : (step as any).current ? "var(--cp-orange)" : "rgba(15,23,42,0.12)"}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: (step as any).current ? "0 0 0 6px rgba(249,115,22,0.15)" : "none", transition: "all 0.3s", zIndex: 1 }}>
                        {step.done ? <CheckCircle size={20} color="#fff" /> : <step.icon size={18} color={(step as any).current ? "#fff" : "rgba(15,23,42,0.35)"} />}
                      </div>
                      {i < NEXT_STEPS.length - 1 && (
                        <div style={{ width: 2, height: 56, background: step.done ? "#10B981" : "rgba(15,23,42,0.1)", borderRadius: 99, margin: "4px 0" }} />
                      )}
                    </div>
                    <div style={{ paddingTop: 10, paddingBottom: i < NEXT_STEPS.length - 1 ? 56 : 0 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, color: step.done ? "var(--cp-navy)" : (step as any).current ? "var(--cp-orange)" : "rgba(15,23,42,0.4)" }}>{step.title}</span>
                        {step.done && <span className="cp-badge" style={{ background: "rgba(16,185,129,0.1)", color: "#10B981", fontSize: 9 }}>Selesai</span>}
                        {(step as any).current && <span className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange)", fontSize: 9 }}>Menunggu</span>}
                      </div>
                      <p style={{ fontSize: 13, color: "var(--cp-navy-lt)", lineHeight: 1.6 }}>{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT PANEL */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Meet the team */}
              <div className="cp-card" style={{ padding: 24 }}>
                <h3 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Tim Anda</h3>
                {TEAM.map(m => (
                  <div key={m.name} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: "var(--cp-warm)", border: "1px solid rgba(15,23,42,0.05)" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: m.avatar === "AI" ? "linear-gradient(135deg,#F97316,#EA580C)" : `hsl(${m.name.charCodeAt(0) * 20},55%,50%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                      {m.avatar === "AI" ? <Sparkles size={16} color="#fff" /> : m.avatar}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--cp-navy)" }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: "var(--cp-navy-lt)" }}>{m.role}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "flex-end" }}>
                        <Star size={11} fill="#F97316" color="#F97316" />
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cp-navy)" }}>{m.rating}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--cp-navy-lt)" }}>{m.projects} proyek</div>
                    </div>
                  </div>
                ))}
                <button className="cp-btn" style={{ width: "100%", justifyContent: "center", background: "#fff", border: "1.5px solid rgba(15,23,42,0.1)", color: "var(--cp-navy)", fontSize: 13, marginTop: 4 }}>
                  <MessageCircle size={14} /> Chat dengan Tim
                </button>
              </div>

              {/* Quick actions */}
              <div className="cp-card" style={{ padding: 24 }}>
                <h3 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Aksi Cepat</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Buka Dashboard", icon: Rocket, primary: true },
                    { label: "Download Brief PDF", icon: Download, primary: false },
                    { label: "Tambah ke Kalender", icon: Calendar, primary: false },
                    { label: "Referral & Hemat 15%", icon: Users, primary: false },
                  ].map(a => (
                    <button key={a.label} className={`cp-btn ${a.primary ? "cp-btn-primary" : ""}`}
                      style={{ width: "100%", justifyContent: "space-between", background: a.primary ? "var(--cp-orange)" : "#fff", border: a.primary ? "none" : "1.5px solid rgba(15,23,42,0.1)", color: a.primary ? "#fff" : "var(--cp-navy)", fontSize: 13, padding: "11px 16px" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <a.icon size={15} />
                        {a.label}
                      </div>
                      <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Social proof */}
              <div style={{ background: "var(--cp-navy)", borderRadius: 16, padding: "20px 24px", textAlign: "center" }}>
                <div style={{ display: "flex", gap: 2, justifyContent: "center", marginBottom: 10 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={16} fill="#F97316" color="#F97316" />)}
                </div>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontStyle: "italic" }}>
                  "Team Creative AI mereka luar biasa. Hasil brand refresh kami melebihi ekspektasi dalam waktu 2 hari!"
                </p>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 10 }}>— Rina D., Marketing Director</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
