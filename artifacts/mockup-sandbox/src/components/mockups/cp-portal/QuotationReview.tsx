import "./_group.css";
import { CheckCircle, X, Clock, FileText, Shield, ChevronRight, Sparkles, AlertCircle, Download, MessageCircle, ArrowRight } from "lucide-react";
import { useState } from "react";

const LINE_ITEMS = [
  { desc: "Brand Identity Package — Professional", qty: 1, unit: "Rp 1.200.000", total: "Rp 1.200.000" },
  { desc: "Express Delivery (1–2 hari kerja)", qty: 1, unit: "Rp 360.000", total: "Rp 360.000" },
  { desc: "Revisi Unlimited (included)", qty: 1, unit: "Rp 0", total: "Rp 0" },
  { desc: "Social Media Kit Add-on", qty: 1, unit: "Rp 250.000", total: "Rp 250.000" },
];

const DELIVERABLES = [
  "Logo & 5 variasi logo (SVG, PNG, PDF, AI)",
  "Brand Color Palette + accessibility check",
  "Typography system (primary + secondary)",
  "Brand Voice & Tone guidelines",
  "Social media template (10 template)",
  "Brand guideline PDF (50+ halaman)",
  "Unlimited revisi hingga puas",
  "File source lengkap (AI, EPS, PSD)",
];

type Status = "pending" | "approved" | "rejected";

export function QuotationReview() {
  const [status, setStatus] = useState<Status>("pending");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="cp-root cp-page" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)", minHeight: "100vh" }}>
      {/* NAV */}
      <nav className="cp-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={14} color="#fff" /></div>
          <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 17, color: "var(--cp-navy)" }}>Creative Studio</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--cp-navy-lt)", display: "flex", gap: 6, alignItems: "center" }}>
          Quotation <ChevronRight size={12} /> <span style={{ color: "var(--cp-navy)", fontWeight: 500 }}>#QT-2024-089</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", fontSize: 12, padding: "8px 14px" }}><Download size={13} /> PDF</button>
          <button className="cp-btn" style={{ background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", fontSize: 12, padding: "8px 14px" }}><MessageCircle size={13} /> Tanya Tim</button>
        </div>
      </nav>

      {/* STATUS BANNER */}
      {status === "approved" && (
        <div style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.12), rgba(16,185,129,0.06))", borderBottom: "1px solid rgba(16,185,129,0.25)", padding: "14px 48px", display: "flex", gap: 12, alignItems: "center" }}>
          <CheckCircle size={18} color="#10B981" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#10B981" }}>Quotation telah disetujui! Tim kami akan segera memulai pekerjaan.</span>
        </div>
      )}
      {status === "rejected" && (
        <div style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))", borderBottom: "1px solid rgba(239,68,68,0.2)", padding: "14px 48px", display: "flex", gap: 12, alignItems: "center" }}>
          <X size={18} color="#EF4444" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#EF4444" }}>Quotation ditolak. Tim kami akan menghubungi Anda untuk revisi penawaran.</span>
        </div>
      )}
      {status === "pending" && (
        <div style={{ background: "linear-gradient(90deg, rgba(245,158,11,0.1), rgba(245,158,11,0.04))", borderBottom: "1px solid rgba(245,158,11,0.2)", padding: "12px 48px", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertCircle size={16} color="#F59E0B" />
          <span style={{ fontSize: 13, color: "#92400E" }}>Quotation ini berlaku hingga <strong>17 Desember 2024</strong>. Harap konfirmasi sebelum tenggat waktu.</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#F59E0B" }}>
            <Clock size={13} /> 3 hari 14 jam tersisa
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 48px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, alignItems: "start" }}>
          {/* LEFT: Quotation detail */}
          <div>
            {/* Header */}
            <div className="cp-card" style={{ padding: 32, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div>
                  <h1 className="cp-h2" style={{ fontSize: 26, marginBottom: 6 }}>Penawaran Harga</h1>
                  <div style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>
                    #QT-2024-089 · Diterbitkan 12 Desember 2024
                  </div>
                </div>
                <span className="cp-badge" style={{
                  background: status === "approved" ? "rgba(16,185,129,0.1)" : status === "rejected" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                  color: status === "approved" ? "#10B981" : status === "rejected" ? "#EF4444" : "#F59E0B",
                  border: `1px solid ${status === "approved" ? "rgba(16,185,129,0.3)" : status === "rejected" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.3)"}`,
                  fontSize: 12, padding: "5px 14px"
                }}>
                  {status === "approved" ? "✓ Disetujui" : status === "rejected" ? "✗ Ditolak" : "Menunggu Konfirmasi"}
                </span>
              </div>

              {/* Client & Vendor info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: "20px 0", borderTop: "1px solid rgba(15,23,42,0.07)", borderBottom: "1px solid rgba(15,23,42,0.07)", marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--cp-navy-lt)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Dari</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cp-navy)", marginBottom: 2 }}>Creative Studio AI</div>
                  <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>info@creativestudio.ai</div>
                  <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>Jakarta, Indonesia</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--cp-navy-lt)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Kepada</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cp-navy)", marginBottom: 2 }}>PT TechVenture Indonesia</div>
                  <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>budi@techventure.id</div>
                  <div style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>Jakarta Selatan, Indonesia</div>
                </div>
              </div>

              {/* Line items */}
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 24px", padding: "8px 0", borderBottom: "1.5px solid rgba(15,23,42,0.1)", marginBottom: 4 }}>
                  {["Deskripsi", "Qty × Satuan", "Subtotal"].map(h => (
                    <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--cp-navy-lt)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: h === "Subtotal" ? "right" : "left" }}>{h}</div>
                  ))}
                </div>
                {LINE_ITEMS.map((item, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 24px", padding: "14px 0", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
                    <span style={{ fontSize: 14, color: "var(--cp-navy)", fontWeight: 500 }}>{item.desc}</span>
                    <span style={{ fontSize: 13, color: "var(--cp-navy-lt)", whiteSpace: "nowrap" }}>{item.qty} × {item.unit}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cp-navy)", textAlign: "right", whiteSpace: "nowrap" }}>{item.total}</span>
                  </div>
                ))}

                {/* Totals */}
                <div style={{ marginTop: 16, padding: "16px 0", borderTop: "1.5px solid rgba(15,23,42,0.1)" }}>
                  {[
                    { label: "Subtotal", value: "Rp 1.810.000" },
                    { label: "Diskon (10% Early Bird)", value: "−Rp 181.000", color: "#10B981" },
                    { label: "PPN 11%", value: "Rp 178.189" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: r.color || "var(--cp-navy)" }}>{r.value}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 20px", background: "linear-gradient(135deg, rgba(249,115,22,0.06), rgba(249,115,22,0.02))", border: "1.5px solid rgba(249,115,22,0.2)", borderRadius: 12, marginTop: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cp-navy)" }}>Total</span>
                    <span style={{ fontFamily: "var(--cp-serif)", fontSize: 22, fontWeight: 700, color: "var(--cp-orange)" }}>Rp 1.807.189</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Deliverables */}
            <div className="cp-card" style={{ padding: 28 }}>
              <h3 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 16, marginBottom: 18 }}>Yang Anda Dapatkan</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                {DELIVERABLES.map(d => (
                  <div key={d} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <CheckCircle size={15} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 13, color: "var(--cp-navy)", lineHeight: 1.5 }}>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Action panel */}
          <div style={{ position: "sticky", top: 80 }}>
            <div className="cp-card" style={{ padding: 28, boxShadow: "var(--cp-shadow-lg)", marginBottom: 16 }}>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontFamily: "var(--cp-serif)", fontSize: 36, fontWeight: 700, color: "var(--cp-navy)", marginBottom: 4 }}>Rp 1.807.189</div>
                <div style={{ fontSize: 13, color: "var(--cp-navy-lt)" }}>Total termasuk PPN</div>
              </div>

              {status === "pending" && !showReject && (
                <>
                  <button onClick={() => setStatus("approved")} className="cp-btn cp-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "14px 0", fontSize: 15, marginBottom: 12 }}>
                    <CheckCircle size={17} /> Setujui Penawaran
                  </button>
                  <button onClick={() => setShowReject(true)} className="cp-btn" style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14, background: "#fff", border: "1.5px solid rgba(239,68,68,0.3)", color: "#EF4444" }}>
                    <X size={15} /> Tolak / Minta Revisi
                  </button>
                </>
              )}

              {showReject && status === "pending" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-navy)", marginBottom: 8 }}>Alasan Penolakan</div>
                  <textarea className="cp-input" rows={3} placeholder="Ceritakan apa yang perlu direvisi..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} style={{ resize: "none", marginBottom: 12 }} />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setShowReject(false)} className="cp-btn" style={{ flex: 1, justifyContent: "center", background: "#fff", border: "1.5px solid rgba(15,23,42,0.12)", color: "var(--cp-navy)", fontSize: 13 }}>Batal</button>
                    <button onClick={() => setStatus("rejected")} className="cp-btn" style={{ flex: 1, justifyContent: "center", background: "#EF4444", color: "#fff", fontSize: 13 }}>Kirim <ArrowRight size={13} /></button>
                  </div>
                </div>
              )}

              {status === "approved" && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(16,185,129,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <CheckCircle size={28} color="#10B981" />
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#10B981", marginBottom: 4 }}>Penawaran Disetujui</p>
                  <p style={{ fontSize: 12, color: "var(--cp-navy-lt)", marginBottom: 20 }}>Tim kami akan mulai bekerja dalam 30 menit.</p>
                  <button className="cp-btn cp-btn-primary" style={{ width: "100%", justifyContent: "center", fontSize: 13 }}>Lanjut ke Pembayaran <ArrowRight size={13} /></button>
                </div>
              )}

              <div className="cp-divider" style={{ margin: "20px 0" }} />
              <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--cp-navy-lt)" }}>
                <Shield size={13} /> Pembayaran aman & terenkripsi
              </div>
            </div>

            {/* Terms */}
            <div className="cp-card" style={{ padding: 20 }}>
              <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Syarat & Ketentuan</h4>
              {[
                "Pembayaran 50% di muka setelah persetujuan",
                "Sisa 50% setelah delivery final",
                "Revisi unlimited selama masa pengerjaan",
                "File source diserahkan setelah lunas",
              ].map(t => (
                <div key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cp-orange)", marginTop: 6, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--cp-navy-lt)", lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
