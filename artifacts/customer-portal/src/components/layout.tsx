import { Link, useLocation } from "wouter";
import { ArrowRight, Menu, X, Diamond, Twitter, Linkedin, Github, Mail, Shield, FileText, Globe } from "lucide-react";
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
    links: ["Brand Identity", "Social Media Content", "Copywriting", "Pitch Deck", "Packaging & Design", "Creative Consultation"],
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
    <div className="min-h-[100dvh] flex flex-col" style={{ background: '#060B18' }}>
      {/* ── TOP NAV ── */}
      <header
        className="sticky top-0 z-50 w-full transition-all duration-300"
        style={{
          background: scrolled
            ? 'rgba(6,11,24,0.96)'
            : 'rgba(6,11,24,0.78)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          borderBottom: scrolled ? '1px solid rgba(30,48,87,0.80)' : '1px solid transparent',
          boxShadow: scrolled ? '0 4px 32px rgba(6,11,24,0.65), 0 1px 0 rgba(124,110,250,0.06)' : 'none',
        }}
      >
        {/* Rainbow top accent line */}
        <div className="absolute top-0 inset-x-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(to right, transparent 0%, rgba(124,110,250,0.60) 25%, rgba(34,211,238,0.40) 60%, rgba(16,185,129,0.30) 85%, transparent 100%)', opacity: scrolled ? 1 : 0.5, transition: 'opacity 300ms' }} />
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between max-w-7xl">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 2px 12px rgba(124,110,250,0.40)' }}
            >
              <Diamond className="w-4 h-4 text-white" />
            </div>
            <span
              className="font-semibold text-base tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
            >
              Creative Studio
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Main navigation">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm font-medium transition-colors"
                style={{ color: '#8B9BC4' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#F0F4FF')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#8B9BC4')}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/access"
              className="text-sm font-medium transition-colors"
              style={{ color: '#8B9BC4' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#F0F4FF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#8B9BC4')}
            >
              Client Login
            </Link>
            <Link href="/services" className="btn-primary text-sm py-2 px-4">
              Mulai Proyek <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{ color: '#8B9BC4' }}
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
              className="md:hidden overflow-hidden"
              style={{ background: 'rgba(6,11,24,0.98)', backdropFilter: 'blur(20px)', borderTop: '1px solid #1E3057' }}
            >
              <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    style={{ color: '#8B9BC4' }}
                  >
                    {l.label}
                  </Link>
                ))}
                <Link
                  href="/access"
                  className="px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ color: '#8B9BC4' }}
                >
                  Client Login
                </Link>
                <div className="pt-2 mt-1" style={{ borderTop: '1px solid #1E3057' }}>
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
      <footer className="mt-auto" style={{ background: '#0A1020', borderTop: '1px solid #1E3057' }}>
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">

          {/* Top: brand + cols */}
          <div className="py-14 grid grid-cols-2 md:grid-cols-6 gap-8">
            {/* Brand column */}
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)' }}
                >
                  <Diamond className="w-3.5 h-3.5 text-white" />
                </div>
                <span
                  className="font-semibold text-sm"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
                >
                  Creative Studio
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#4F6494' }}>
                Platform AI Enterprise terdepan untuk layanan profesional bisnis di Indonesia.
              </p>
              <div className="flex flex-col gap-1.5">
                {TRUST_BADGES.map((b) => {
                  const Icon = b.icon;
                  return (
                    <div key={b.label} className="flex items-center gap-1.5 text-xs" style={{ color: '#4F6494' }}>
                      <Icon className="w-3 h-3" style={{ color: '#7C6EFA' }} />
                      {b.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer link columns */}
            {FOOTER_COLS.map((col) => (
              <div key={col.heading}>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#8B9BC4' }}>
                  {col.heading}
                </h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a
                        href="#"
                        className="text-xs transition-colors"
                        style={{ color: '#4F6494', textDecoration: 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#8B9BC4')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#4F6494')}
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Newsletter strip */}
          <div
            className="py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8"
            style={{ borderTop: '1px solid #1E3057', borderBottom: '1px solid #1E3057' }}
          >
            <div className="shrink-0">
              <div className="text-xs font-semibold mb-0.5" style={{ color: '#F0F4FF' }}>AI Insight Newsletter</div>
              <div className="text-xs" style={{ color: '#4F6494' }}>Update terbaru AI enterprise, tips, dan case study</div>
            </div>
            <div className="flex gap-2 flex-1 max-w-sm">
              <input
                type="email"
                placeholder="email@perusahaan.com"
                className="flex-1 text-xs rounded-lg px-3 py-2 outline-none"
                style={{
                  background: 'rgba(240,244,255,0.04)',
                  border: '1px solid #1E3057',
                  color: '#F0F4FF',
                }}
              />
              <button
                className="px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
                style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', color: '#fff' }}
              >
                Subscribe
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs" style={{ color: '#4F6494' }}>
              © {new Date().getFullYear()} Creative Studio · All rights reserved · PT Creative Studio Indonesia
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                {[Twitter, Linkedin, Github, Mail].map((Icon, i) => (
                  <button
                    key={i}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                    style={{ color: '#4F6494' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(240,244,255,0.06)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: 'rgba(16,185,129,0.10)', color: '#10B981', border: '1px solid rgba(16,185,129,0.20)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10B981' }} />
                Sistem Online
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
