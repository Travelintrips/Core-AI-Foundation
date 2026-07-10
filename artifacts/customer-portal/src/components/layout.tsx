import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="font-serif font-semibold text-lg tracking-tight">Creative Studio</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/services" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
              Services & Pricing
            </Link>
            <Link href="/access" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Client Login
            </Link>
            <Link href="/submit" className="text-sm font-medium bg-foreground text-background px-4 py-2 rounded-full hover:bg-foreground/90 transition-colors hidden sm:inline-flex items-center gap-2">
              Start Project <ArrowRight className="w-4 h-4" />
            </Link>
          </nav>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <footer className="border-t border-border/40 bg-muted/30 py-8 md:py-12 mt-auto">
        <div className="container mx-auto px-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            <span className="font-serif text-sm">Creative Studio by AI Platform</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
