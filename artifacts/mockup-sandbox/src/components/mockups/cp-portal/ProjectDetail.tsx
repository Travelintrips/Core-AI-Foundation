import "./_group.css";
import { ArrowLeft, Download, MessageCircle, CheckCircle2, Clock, FileText, Image, File, MoreHorizontal, Send, Sparkles, ChevronRight, Eye, Star } from "lucide-react";
import { useState } from "react";

const TIMELINE = [
  { phase: "Brief Diterima", date: "10 Des 2024", done: true, current: false },
  { phase: "Quotation Disetujui", date: "11 Des 2024", done: true, current: false },
  { phase: "AI Production", date: "12–13 Des 2024", done: true, current: false },
  { phase: "Human Review", date: "13 Des 2024", done: false, current: true },
  { phase: "Revisi & Finalisasi", date: "14 Des 2024", done: false, current: false },
  { phase: "Delivery", date: "15 Des 2024", done: false, current: false },
];

const FILES = [
  { name: "Brand_Guidelines_v2.pdf", size: "4.2 MB", type: "pdf", locked: false, ready: true },
  { name: "Logo_Package.ai", size: "8.6 MB", type: "ai", locked: false, ready: true },
  { name: "Color_Palette.pdf", size: "1.1 MB", type: "pdf", locked: false, ready: true },
  { name: "Typography_Guide.pdf", size: "2.3 MB", type: "pdf", locked: true, ready: false },
  { name: "Social_Media_Kit.zip", size: "24.8 MB", type: "zip", locked: true, ready: false },
];

const MESSAGES = [
  { from: "Tim Creative AI", avatar: "AI", msg: "Halo Budi! Brief Anda telah kami terima dan proses produksi sudah dimulai. Estimasi selesai 13 Desember.", time: "10 Des, 09:15", isAI: true },
  { from: "Budi Santoso", avatar: "BS", msg: "Terima kasih! Apakah bisa minta update progress hari ini?", time: "10 Des, 11:30", isAI: false },
  { from: "Tim Creative AI", avatar: "AI", msg: "Tentu! Progress saat ini 75%. Kami sedang finalisasi color palette dan typography system. Akan kami kirim preview dalam 2 jam.", time: "10 Des, 11:45", isAI: true },
  { from: "Budi Santoso", avatar: "BS", msg: "Siap, ditunggu ya!", time: "10 Des, 12:00", isAI: false },
];

const FILE_ICON_COLOR: Record<string, string> = { pdf: "#EF4444", ai: "#F97316", zip: "#8B5CF6", png: "#10B981" };

export function ProjectDetail() {
  const [activeTab, setActiveTab] = useState("overview");
  const [msgText, setMsgText] = useState("");
  const [rating, setRating] = useState(0);

  return (
    <div className="cp-root" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--cp-navy-lt)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--cp-sans)" }}>
            <ArrowLeft size={15} /> Kembali
          </button>
          <div className="cp-divider" style={{ width: 1, height: 20 }} />
          <div style={{ display: "flex", gap: 6, fontSize: 13, color: "var(--cp-navy-lt)", alignItems: "center" }}>
            Proyek Saya <ChevronRight size={13} /> <span style={{ color: "var(--cp-navy)", fontWeight: 500 }}>Brand Refresh Q1</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={14} color="#fff" /></div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", fontSize: 13, padding: "8px 16px" }}>
            <MessageCircle size={14} /> Chat
          </button>
          <button className="cp-btn cp-btn-primary" style={{ fontSize: 13, padding: "8px 16px" }}>
            <Download size={14} /> Download Semua
          </button>
        </div>
      </nav>

      {/* PROJECT HEADER */}
      <div style={{ background: "linear-gradient(135deg, #FFF7ED 0%, var(--cp-warm) 100%)", padding: "32px 48px", borderBottom: "1px solid rgba(15,23,42,0.07)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
                <span className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange)", border: "1px solid rgba(249,115,22,0.25)" }}>Creative AI</span>
                <span className="cp-badge" style={{ background: "rgba(34,211,238,0.1)", color: "#22D3EE", border: "1px solid rgba(34,211,238,0.25)" }}>Human Review</span>
              </div>
              <h1 className="cp-h2" style={{ marginBottom: 8, fontSize: 30 }}>Brand Refresh Q1 — 2025</h1>
              <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--cp-navy-lt)", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Clock size={13} /> Dimulai 10 Des 2024</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} color="#10B981" /> Estimasi 15 Des 2024</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><FileText size={13} /> #PRJ-2024-089</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--cp-serif)", fontSize: 28, fontWeight: 700, color: "var(--cp-navy)" }}>63%</div>
              <div style={{ fontSize: 12, color: "var(--cp-navy-lt)", marginBottom: 8 }}>Progress</div>
              <div style={{ width: 160 }}>
                <div className="cp-progress-track">
                  <div className="cp-progress-fill" style={{ width: "63%" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: "#fff", borderBottom: "1px solid rgba(15,23,42,0.07)", padding: "0 48px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 0 }}>
          {["overview", "files", "messages", "timeline"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "14px 20px", fontSize: 13, fontWeight: 600, background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab ? "var(--cp-orange)" : "transparent"}`, color: activeTab === tab ? "var(--cp-orange)" : "var(--cp-navy-lt)", cursor: "pointer", fontFamily: "var(--cp-sans)", transition: "all 0.18s", textTransform: "capitalize" }}>
              {tab === "overview" ? "Overview" : tab === "files" ? "File & Download" : tab === "messages" ? "Pesan" : "Timeline"}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, padding: "32px 48px", maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {activeTab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
            <div>
              {/* Deliverables */}
              <div className="cp-card" style={{ padding: 28, marginBottom: 20 }}>
                <h3 className="cp-h3" style={{ fontSize: 17, marginBottom: 20 }}>Deliverables</h3>
                {[
                  { item: "Logo & Logo Variants", done: true },
                  { item: "Color Palette System", done: true },
                  { item: "Typography Guide", done: true },
                  { item: "Brand Voice & Tone", done: false, inProgress: true },
                  { item: "Social Media Templates", done: false },
                  { item: "Brand Guideline PDF", done: false },
                ].map(d => (
                  <div key={d.item} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: d.done ? "rgba(16,185,129,0.1)" : "rgba(15,23,42,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {d.done ? <CheckCircle2 size={13} color="#10B981" /> : (d as any).inProgress ? <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F97316" }} /> : <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E2E8F0" }} />}
                    </div>
                    <span style={{ fontSize: 14, color: d.done ? "var(--cp-navy)" : (d as any).inProgress ? "var(--cp-orange)" : "rgba(15,23,42,0.45)", fontWeight: d.done ? 500 : 400 }}>{d.item}</span>
                    {(d as any).inProgress && <span className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange)", fontSize: 10, marginLeft: "auto" }}>Dalam Proses</span>}
                  </div>
                ))}
              </div>

              {/* Rate project */}
              <div className="cp-card" style={{ padding: 24, background: "rgba(249,115,22,0.03)", borderColor: "rgba(249,115,22,0.15)" }}>
                <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Bagaimana pengalaman Anda?</h4>
                <p style={{ fontSize: 13, color: "var(--cp-navy-lt)", marginBottom: 14 }}>Bantu kami meningkatkan layanan dengan memberikan rating.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} size={28} onClick={() => setRating(s)} color={s <= rating ? "#F97316" : "#E2E8F0"} fill={s <= rating ? "#F97316" : "none"} style={{ cursor: "pointer", transition: "all 0.15s" }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="cp-card" style={{ padding: 22 }}>
                <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Detail Proyek</h4>
                {[
                  { label: "Paket", value: "Professional" },
                  { label: "Nilai", value: "Rp 1.500.000" },
                  { label: "PIC", value: "Arif Wicaksono, CD" },
                  { label: "Revisi Tersisa", value: "Unlimited" },
                ].map(d => (
                  <div key={d.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
                    <span style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>{d.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cp-navy)" }}>{d.value}</span>
                  </div>
                ))}
              </div>
              <div className="cp-card" style={{ padding: 22 }}>
                <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, marginBottom: 14 }}>File Tersedia (3)</h4>
                {FILES.filter(f => !f.locked).slice(0,3).map(f => (
                  <div key={f.name} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${FILE_ICON_COLOR[f.type] || "#94A3B8"}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <FileText size={14} color={FILE_ICON_COLOR[f.type] || "#94A3B8"} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--cp-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "var(--cp-navy-lt)" }}>{f.size}</div>
                    </div>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cp-orange)" }}><Download size={14} /></button>
                  </div>
                ))}
                <button className="cp-btn cp-btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px 0", marginTop: 4 }}>Lihat Semua File</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "messages" && (
          <div className="cp-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: 520 }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(15,23,42,0.07)", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sparkles size={15} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Tim Creative AI</div>
                <div style={{ fontSize: 11, color: "#10B981", display: "flex", alignItems: "center", gap: 4 }}><span className="cp-dot cp-dot-green" style={{ width: 6, height: 6 }} /> Online</div>
              </div>
            </div>
            <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              {MESSAGES.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 12, justifyContent: m.isAI ? "flex-start" : "flex-end" }}>
                  {m.isAI && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{m.avatar}</div>}
                  <div style={{ maxWidth: "68%" }}>
                    <div style={{ background: m.isAI ? "#fff" : "var(--cp-orange)", color: m.isAI ? "var(--cp-navy)" : "#fff", padding: "12px 16px", borderRadius: m.isAI ? "4px 14px 14px 14px" : "14px 4px 14px 14px", fontSize: 13, lineHeight: 1.6, border: m.isAI ? "1px solid rgba(15,23,42,0.08)" : "none", boxShadow: "var(--cp-shadow-sm)" }}>{m.msg}</div>
                    <div style={{ fontSize: 11, color: "var(--cp-navy-lt)", marginTop: 4, textAlign: m.isAI ? "left" : "right" }}>{m.time}</div>
                  </div>
                  {!m.isAI && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--cp-navy-mid)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{m.avatar}</div>}
                </div>
              ))}
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(15,23,42,0.07)", display: "flex", gap: 12 }}>
              <input className="cp-input" placeholder="Tulis pesan..." value={msgText} onChange={e => setMsgText(e.target.value)} style={{ flex: 1 }} />
              <button className="cp-btn cp-btn-primary" style={{ padding: "10px 18px" }}><Send size={15} /></button>
            </div>
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="cp-card" style={{ padding: 36, maxWidth: 640 }}>
            <h3 className="cp-h3" style={{ marginBottom: 32, fontSize: 18 }}>Timeline Proyek</h3>
            {TIMELINE.map((t, i) => (
              <div key={t.phase} style={{ display: "flex", gap: 20, marginBottom: i < TIMELINE.length - 1 ? 0 : 0, position: "relative" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.done ? "#10B981" : t.current ? "var(--cp-orange)" : "#fff", border: `2px solid ${t.done ? "#10B981" : t.current ? "var(--cp-orange)" : "rgba(15,23,42,0.15)"}`, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, boxShadow: t.current ? "0 0 0 6px rgba(249,115,22,0.15)" : "none" }}>
                    {t.done ? <CheckCircle2 size={17} color="#fff" /> : t.current ? <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff" }} /> : <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E2E8F0" }} />}
                  </div>
                  {i < TIMELINE.length - 1 && <div style={{ width: 2, height: 48, background: t.done ? "#10B981" : "rgba(15,23,42,0.1)", margin: "4px 0", borderRadius: 99 }} />}
                </div>
                <div style={{ paddingTop: 6, paddingBottom: i < TIMELINE.length - 1 ? 48 : 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: t.done ? "var(--cp-navy)" : t.current ? "var(--cp-orange)" : "rgba(15,23,42,0.45)", marginBottom: 3 }}>{t.phase}</div>
                  <div style={{ fontSize: 12, color: t.done ? "#10B981" : t.current ? "var(--cp-orange)" : "rgba(15,23,42,0.35)" }}>{t.date}</div>
                  {t.current && <div className="cp-badge" style={{ background: "rgba(249,115,22,0.1)", color: "var(--cp-orange)", fontSize: 10, marginTop: 6, display: "inline-flex" }}>Sedang Berlangsung</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
