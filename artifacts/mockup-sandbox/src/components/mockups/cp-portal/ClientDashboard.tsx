import "./_group.css";
import { FolderKanban, Clock, CheckCircle2, Wallet, Download, Palette, ArrowRight, Bell, Settings, LogOut, ChevronRight, Sparkles, Activity, TrendingUp, FileText, MessageCircle, MoreHorizontal, Plus } from "lucide-react";

const PROJECTS = [
  { name: "Brand Refresh Q1", service: "Creative AI", status: "in_production", pct: 63, updated: "2 jam lalu", color: "#F97316" },
  { name: "Marketing Campaign Dec", service: "Marketing AI", status: "review", pct: 92, updated: "4 jam lalu", color: "#22D3EE" },
  { name: "Laporan Keuangan Q4", service: "Finance AI", status: "in_analysis", pct: 36, updated: "1 hari lalu", color: "#F59E0B" },
  { name: "Kontrak Vendor 2025", service: "Legal AI", status: "pending", pct: 10, updated: "2 hari lalu", color: "#8B5CF6" },
];

const ACTIVITY = [
  { icon: CheckCircle2, msg: "Marketing Campaign: Draft 2 siap direview", time: "2 jam lalu", color: "#10B981" },
  { icon: FileText, msg: "Invoice #INV-2024-089 telah diterbitkan", time: "5 jam lalu", color: "#3B82F6" },
  { icon: MessageCircle, msg: "Pesan baru dari Tim Creative AI", time: "8 jam lalu", color: "#F97316" },
  { icon: Download, msg: "Brand guideline v2 siap diunduh", time: "1 hari lalu", color: "#8B5CF6" },
  { icon: TrendingUp, msg: "Finance AI: Analisis selesai", time: "2 hari lalu", color: "#10B981" },
  { icon: Activity, msg: "Laporan bulanan November tersedia", time: "3 hari lalu", color: "#94A3B8" },
];

const STAT_CARDS = [
  { label: "Proyek Aktif", value: "3", icon: FolderKanban, iconColor: "#F97316", iconBg: "rgba(249,115,22,0.1)" },
  { label: "Menunggu Review", value: "1", icon: Clock, iconColor: "#F59E0B", iconBg: "rgba(245,158,11,0.1)" },
  { label: "Selesai Bulan Ini", value: "7", icon: CheckCircle2, iconColor: "#10B981", iconBg: "rgba(16,185,129,0.1)" },
  { label: "Outstanding", value: "Rp 1.5jt", icon: Wallet, iconColor: "#EF4444", iconBg: "rgba(239,68,68,0.1)" },
  { label: "File Siap Unduh", value: "4", icon: Download, iconColor: "#3B82F6", iconBg: "rgba(59,130,246,0.1)" },
  { label: "Brand Assets", value: "12", icon: Palette, iconColor: "#8B5CF6", iconBg: "rgba(139,92,246,0.1)" },
];

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  in_production: { label: "Produksi", color: "#F97316", bg: "rgba(249,115,22,0.1)" },
  review: { label: "Review", color: "#22D3EE", bg: "rgba(34,211,238,0.1)" },
  in_analysis: { label: "Analisis", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  pending: { label: "Menunggu", color: "#94A3B8", bg: "rgba(148,163,184,0.1)" },
};

export function ClientDashboard() {
  return (
    <div className="cp-root" style={{ fontFamily: "var(--cp-sans)", background: "var(--cp-warm)", minHeight: "100vh", display: "flex" }}>
      {/* SIDEBAR */}
      <aside style={{ width: 240, background: "var(--cp-navy)", flexShrink: 0, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={15} color="#fff" /></div>
            <span style={{ fontFamily: "var(--cp-serif)", fontWeight: 700, fontSize: 16, color: "#fff" }}>Creative Studio</span>
          </div>
        </div>

        {/* User */}
        <div style={{ padding: "20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#F97316,#EA580C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>BS</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Budi Santoso</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>budi@techventure.id</div>
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {[
            { icon: Activity, label: "Dashboard", active: true },
            { icon: FolderKanban, label: "Proyek Saya", active: false },
            { icon: Download, label: "File & Download", active: false },
            { icon: FileText, label: "Invoice", active: false },
            { icon: Palette, label: "Brand Kit", active: false },
            { icon: MessageCircle, label: "Pesan", active: false },
            { icon: Bell, label: "Notifikasi", active: false, badge: "3" },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, marginBottom: 4, background: item.active ? "rgba(249,115,22,0.15)" : "transparent", cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={e => { if (!item.active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!item.active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <item.icon size={16} color={item.active ? "#F97316" : "rgba(255,255,255,0.45)"} />
                <span style={{ fontSize: 13, fontWeight: item.active ? 600 : 400, color: item.active ? "#fff" : "rgba(255,255,255,0.45)" }}>{item.label}</span>
              </div>
              {(item as any).badge && (
                <span style={{ background: "#F97316", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99 }}>{(item as any).badge}</span>
              )}
            </div>
          ))}
        </nav>

        <div style={{ padding: "16px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          {[
            { icon: Settings, label: "Pengaturan" },
            { icon: LogOut, label: "Keluar" },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 2 }}>
              <item.icon size={15} color="rgba(255,255,255,0.35)" />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, padding: "32px 36px", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <h1 className="cp-h2" style={{ marginBottom: 6, fontSize: 28 }}>Selamat datang, Budi 👋</h1>
            <p style={{ color: "var(--cp-navy-lt)", fontSize: 14 }}>Berikut ringkasan proyek dan aktivitas terbaru Anda.</p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="cp-tooltip-wrap">
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff", border: "1px solid rgba(15,23,42,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
                <Bell size={16} color="var(--cp-navy-lt)" />
                <span style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: "#F97316", border: "2px solid #fff" }} />
              </div>
              <span className="cp-tooltip">3 notifikasi baru</span>
            </div>
            <button className="cp-btn cp-btn-primary" style={{ fontSize: 13, padding: "9px 18px" }}>
              <Plus size={14} /> Proyek Baru
            </button>
          </div>
        </div>

        {/* STAT CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {STAT_CARDS.map(c => (
            <div key={c.label} className="cp-stat" style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: c.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <c.icon size={20} color={c.iconColor} />
              </div>
              <div>
                <div style={{ fontFamily: "var(--cp-serif)", fontSize: 24, fontWeight: 700, color: "var(--cp-navy)", lineHeight: 1 }}>{c.value}</div>
                <div style={{ fontSize: 12, color: "var(--cp-navy-lt)", marginTop: 4 }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
          {/* PROJECTS */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 className="cp-h3" style={{ fontSize: 17 }}>Proyek Aktif</h3>
              <button className="cp-btn cp-btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }}>Lihat Semua <ChevronRight size={12} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PROJECTS.map(p => {
                const s = STATUS_MAP[p.status];
                return (
                  <div key={p.name} className="cp-card" style={{ padding: "18px 20px", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, boxShadow: `0 0 0 3px ${p.color}22`, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cp-navy)" }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "var(--cp-navy-lt)", marginTop: 2 }}>{p.service}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span className="cp-badge" style={{ background: s.bg, color: s.color, fontSize: 10 }}>{s.label}</span>
                        <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cp-navy-lt)", padding: 4 }}><MoreHorizontal size={15} /></button>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--cp-navy-lt)" }}>Progress</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cp-navy)" }}>{p.pct}%</span>
                    </div>
                    <div className="cp-progress-track">
                      <div className="cp-progress-fill" style={{ width: `${p.pct}%`, background: p.color }} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cp-navy-lt)", marginTop: 10 }}>Diupdate {p.updated}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ACTIVITY + QUICK ACTIONS */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Quick actions */}
            <div className="cp-card" style={{ padding: 20 }}>
              <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Aksi Cepat</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Proyek Baru", icon: Plus, color: "#F97316" },
                  { label: "Download File", icon: Download, color: "#3B82F6" },
                  { label: "Lihat Invoice", icon: FileText, color: "#8B5CF6" },
                  { label: "Hubungi Tim", icon: MessageCircle, color: "#10B981" },
                ].map(a => (
                  <button key={a.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 10px", borderRadius: 12, border: "1.5px solid rgba(15,23,42,0.07)", background: "#fff", cursor: "pointer", fontFamily: "var(--cp-sans)", transition: "all 0.18s" }}
                    onMouseEnter={e => { (e.currentTarget.style.borderColor = `${a.color}50`); (e.currentTarget.style.background = `${a.color}08`); }}
                    onMouseLeave={e => { (e.currentTarget.style.borderColor = "rgba(15,23,42,0.07)"); (e.currentTarget.style.background = "#fff"); }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${a.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <a.icon size={16} color={a.color} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cp-navy-lt)" }}>{a.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Activity feed */}
            <div className="cp-card" style={{ padding: 20, flex: 1 }}>
              <h4 style={{ fontFamily: "var(--cp-serif)", fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Aktivitas Terbaru</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {ACTIVITY.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: i < ACTIVITY.length - 1 ? 14 : 0, marginBottom: i < ACTIVITY.length - 1 ? 14 : 0, borderBottom: i < ACTIVITY.length - 1 ? "1px solid rgba(15,23,42,0.05)" : "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${a.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <a.icon size={13} color={a.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--cp-navy)", lineHeight: 1.5, fontWeight: 500 }}>{a.msg}</div>
                      <div style={{ fontSize: 11, color: "var(--cp-navy-lt)", marginTop: 3 }}>{a.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
