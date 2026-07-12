import { Link, useLocation } from "wouter";
import { ArrowRight, Sparkles, Menu, X, Cpu } from "lucide-react";
import { useState, useEffect } from "react";

const NAV_LINKS = [
  { href: "/services", label: "Layanan" },
  { href: "/portfolio", label: "Portfolio" },
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

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: "hsl(var(--background))" }}>
      {/* ── TOP NAV ── */}
      <header
        className="sticky top-0 z-50 w-full transition-all duration-200"
        style={{
          background: scrolled
            ? "rgba(6, 11, 24, 0.90)"
            : "rgba(6, 11, 24, 0.60)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: scrolled
            ? "1px solid hsl(var(--border))"
            : "1px solid transparent",
        }}
      >
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between max-w-7xl">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
            >
              <Cpu className="w-4 h-4 text-white" />
            </div>
            <span
              className="font-display font-semibold text-lg tracking-tight"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Creative Studio
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link">
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/access" className="nav-link">
              Client Login
            </Link>
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
          <div
            className="md:hidden border-t"
            style={{
              background: "rgba(13, 21, 38, 0.98)",
              backdropFilter: "blur(20px)",
              borderColor: "hsl(var(--border))",
            }}
          >
            <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/access"
                className="px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
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
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {/* ── FOOTER ── */}
      <footer
        className="mt-auto"
        style={{
          background: "hsl(var(--surface-1))",
          borderTop: "1px solid hsl(var(--border))",
        }}
      >
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          {/* Footer top */}
          <div className="py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
                >
                  <Cpu className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-display font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
                  Creative Studio
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
                Platform AI Enterprise terdepan untuk layanan profesional bisnis di Indonesia.
              </p>
            </div>

            {/* Layanan */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Layanan
              </h4>
              <ul className="space-y-2.5">
                {["Creative AI", "Marketing AI", "Finance AI", "Legal AI", "Logistics AI"].map((s) => (
                  <li key={s}>
                    <Link href="/services" className="text-xs transition-colors hover:text-foreground" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {s}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Perusahaan */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Perusahaan
              </h4>
              <ul className="space-y-2.5">
                {["Tentang Kami", "Portfolio", "Blog", "Karir", "Kontak"].map((s) => (
                  <li key={s}>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Legal
              </h4>
              <ul className="space-y-2.5">
                {["Syarat & Ketentuan", "Kebijakan Privasi", "SLA", "Keamanan"].map((s) => (
                  <li key={s}>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Footer bottom */}
          <div
            className="py-5 flex flex-col sm:flex-row items-center justify-between gap-3"
            style={{ borderTop: "1px solid hsl(var(--border))" }}
          >
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              © {new Date().getFullYear()} Creative Studio · All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  color: "#10B981",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                }}
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
