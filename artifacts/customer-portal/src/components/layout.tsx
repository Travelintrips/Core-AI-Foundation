import { Link, useLocation } from "wouter";
import { ArrowRight, Menu, X, Sparkles, Twitter, Linkedin, Github, Mail, Shield, FileText, Globe } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const NAV_LINKS = [
  { href: "/services",  label: "Layanan" },
  { href: "/portfolio", label: "Portfolio" },
];

const FOOTER_COLS = [
  {
    heading: "Product",
    links: ["AI Service Catalog", "Workspace Dashboard", "Analytics", "API Access", "Integrations", "Changelog"],
  },
  {
    heading: "Solutions",
    links: ["Creative & Marketing", "Finance & Tax", "Legal & Compliance", "HR & Payroll", "Logistics & Customs", "Enterprise Custom"],
  },
  {
    heading: "Resources",
    links: ["Documentation", "API Reference", "Case Studies", "Blog & Insights", "Webinar", "Community"],
  },
  {
    heading: "Company",
    links: ["Tentang Kami", "Karir", "Press", "Partner Program", "Affiliate", "Kontak Sales"],
  },
  {
    heading: "Legal & Trust",
    links: ["Privacy Policy", "Terms of Service", "Security", "ISO 27001", "SLA", "Compliance"],
  },
];

const TRUST_BADGES = [
  { icon: Shield,   label: "SOC 2 Type II" },
  { icon: FileText, label: "ISO 27001" },
  { icon: Globe,    label: "GDPR Ready" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* ── TOP NAV ── */}
      <header
        className="sticky top-0 z-50 w-full transition-all duration-300"
        style={{
          background: scrolled ? "rgba(250,250,247,0.95)" : "rgba(250,250,247,0.80)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: scrolled ? "1px solid hsl(220 18% 88%)" : "1px solid transparent",
          boxShadow: scrolled ? "0 2px 16px rgba(15,23,42,0.06)" : "none",
        }}
      >
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between max-w-7xl">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
              style={{ background: "linear-gradient(135deg, #F97316 0%, #EA580C 100%)" }}>
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-foreground">
              Creative Studio
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Main navigation">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link">{l.label}</Link>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/access" className="nav-link">Client Login</Link>
            <Link href="/services" className="btn-primary text-sm py-2 px-4">
              Mulai Proyek <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden border-t border-border overflow-hidden"
              style={{ background: "rgba(250,250,247,0.98)", backdropFilter: "blur(20px)" }}
            >
              <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
                {NAV_LINKS.map((l) => (
                  <Link key={l.href} href={l.href}
                    className="px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors">
                    {l.label}
                  </Link>
                ))}
                <Link href="/access"
                  className="px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors">
                  Client Login
                </Link>
                <div className="pt-2 border-t border-border mt-1">
                  <Link href="/services" className="btn-primary w-full justify-center">
                    Mulai Proyek <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col">{children}</main>

      {/* ── FOOTER ── */}
      <footer className="mt-auto" style={{ background: "#0F172A", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">

          {/* Top: brand + cols */}
          <div className="py-14 grid grid-cols-2 md:grid-cols-6 gap-8">
            {/* Brand column */}
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#F97316,#EA580C)" }}>
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-display font-bold text-sm text-white">Creative Studio</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#94A3B8" }}>
                Platform AI Enterprise terdepan untuk layanan profesional bisnis di Indonesia.
              </p>
              <div className="flex flex-col gap-1.5">
                {TRUST_BADGES.map((b) => {
                  const Icon = b.icon;
                  return (
                    <div key={b.label} className="flex items-center gap-1.5 text-xs" style={{ color: "#64748B" }}>
                      <Icon className="w-3 h-3 text-orange-400" />
                      {b.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer link columns */}
            {FOOTER_COLS.map((col) => (
              <div key={col.heading}>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "#94A3B8" }}>
                  {col.heading}
                </h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <span className="text-xs cursor-pointer hover:text-white transition-colors" style={{ color: "#64748B" }}>
                        {link}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Newsletter strip */}
          <div className="py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="shrink-0">
              <div className="text-xs font-semibold mb-0.5 text-white">AI Insight Newsletter</div>
              <div className="text-xs" style={{ color: "#64748B" }}>Update terbaru AI enterprise, tips, dan case study</div>
            </div>
            <div className="flex gap-2 flex-1 max-w-sm">
              <input
                type="email"
                placeholder="email@perusahaan.com"
                className="flex-1 text-xs rounded-lg px-3 py-2 outline-none text-white"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
              />
              <button className="px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
                style={{ background: "linear-gradient(135deg,#F97316,#EA580C)", color: "#fff" }}>
                Subscribe
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs" style={{ color: "#64748B" }}>
              © {new Date().getFullYear()} Creative Studio · All rights reserved · PT Creative Studio Indonesia
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                {[Twitter, Linkedin, Github, Mail].map((Icon, i) => (
                  <button key={i} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
                    style={{ color: "#64748B" }}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: "rgba(16,185,129,0.12)", color: "#10B981", border: "1px solid rgba(16,185,129,0.20)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sistem Online
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
