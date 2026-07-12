import { Link, useLocation } from "wouter";
import { ArrowRight, Menu, X, Cpu, Twitter, Linkedin, Github, Mail, Shield, FileText, Globe } from "lucide-react";
import { useState, useEffect } from "react";

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
    const onScroll = () => setScrolled(window.scrollY > 64);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: "hsl(var(--background))" }}>
      {/* ── TOP NAV ── */}
      <header
        className="sticky top-0 z-50 w-full transition-all duration-200"
        style={{
          background: scrolled ? "rgba(6,11,24,0.92)" : "rgba(6,11,24,0.60)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: scrolled ? "1px solid hsl(var(--border))" : "1px solid transparent",
        }}
      >
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between max-w-7xl">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
              <Cpu className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-semibold text-lg tracking-tight" style={{ color: "hsl(var(--foreground))" }}>
              Creative Studio
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
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
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{ color: "hsl(var(--muted-foreground))" }}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="md:hidden border-t" style={{ background: "rgba(13,21,38,0.98)", backdropFilter: "blur(20px)", borderColor: "hsl(var(--border))" }}>
            <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {l.label}
                </Link>
              ))}
              <Link href="/access" className="px-3 py-2.5 rounded-lg text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                Client Login
              </Link>
              <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                <Link href="/services" className="btn-primary w-full justify-center">
                  Mulai Proyek <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col">{children}</main>

      {/* ── FOOTER ── */}
      <footer className="mt-auto" style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))" }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">

          {/* Top: brand + newsletter + cols */}
          <div className="py-14 grid grid-cols-2 md:grid-cols-6 gap-8">
            {/* Brand column — 1 of 6 */}
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
                  <Cpu className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-display font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>Creative Studio</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
                Platform AI Enterprise terdepan untuk layanan profesional bisnis di Indonesia.
              </p>
              {/* Trust badges */}
              <div className="flex flex-col gap-1.5">
                {TRUST_BADGES.map((b) => {
                  const Icon = b.icon;
                  return (
                    <div key={b.label} className="flex items-center gap-1.5 text-xs" style={{ color: "#4F6494" }}>
                      <Icon className="w-3 h-3" style={{ color: "#7C6EFA" }} />
                      {b.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer link columns */}
            {FOOTER_COLS.map((col) => (
              <div key={col.heading}>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {col.heading}
                </h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <span className="text-xs cursor-pointer hover:text-foreground transition-colors" style={{ color: "#4F6494" }}>
                        {link}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Newsletter strip */}
          <div
            className="py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8"
            style={{ borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }}
          >
            <div className="shrink-0">
              <div className="text-xs font-semibold mb-0.5" style={{ color: "hsl(var(--foreground))" }}>AI Insight Newsletter</div>
              <div className="text-xs" style={{ color: "#4F6494" }}>Update terbaru AI enterprise, tips, dan case study</div>
            </div>
            <div className="flex gap-2 flex-1 max-w-sm">
              <input
                type="email"
                placeholder="email@perusahaan.com"
                className="flex-1 text-xs rounded-lg px-3 py-2 outline-none"
                style={{
                  background: "hsl(var(--surface-2))",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
              <button
                className="px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap"
                style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff" }}
              >
                Subscribe
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs" style={{ color: "#4F6494" }}>
              © {new Date().getFullYear()} Creative Studio · All rights reserved · PT Creative Studio Indonesia
            </p>
            <div className="flex items-center gap-4">
              {/* Social icons */}
              <div className="flex items-center gap-3">
                {[Twitter, Linkedin, Github, Mail].map((Icon, i) => (
                  <button key={i} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-violet-500/10" style={{ color: "#4F6494" }}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              {/* System status */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: "rgba(16,185,129,0.1)", color: "#10B981", border: "1px solid rgba(16,185,129,0.2)" }}
              >
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
