import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams, useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import {
  useServiceDetail,
  useQuoteCalculator,
  useRequestService,
  type QuoteSelections,
  type PricingBreakdown,
} from "@/hooks/use-catalog";
import { useServiceShowcase, type ContinueConceptResult } from "@/hooks/use-portfolio";
import { PortfolioGallery } from "@/components/portfolio-gallery";
import { PortfolioReviews } from "@/components/portfolio-reviews";
import { ServiceFaqSection } from "@/components/service-faq";
import { RelatedServices } from "@/components/related-services";
import { LiveAiPreview } from "@/components/live-ai-preview";
import { ServiceWorkflow } from "@/components/service-workflow";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ArrowLeft, CheckCircle2, Sparkles, Star, Clock, Shield,
  Zap, ChevronRight, Users, Award, Cpu, Package, Settings2,
  Receipt, HelpCircle, LayoutGrid, Check, FileText, Globe,
  RefreshCw, Lock, BadgeCheck, CreditCard, X,
} from "lucide-react";

// ── Lazy AI Workforce (below-fold, safe to defer) ─────────────────────────────
const AiWorkforceSection = lazy(() =>
  import("@/components/ai-workforce").then((m) => ({ default: m.AiWorkforceSection }))
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(value: number, currency: string) {
  if (currency === "IDR") return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
  return `$${value.toLocaleString()}`;
}

function flowLabel(flow: string) {
  if (flow === "fixed_price") return "Fixed Price";
  if (flow === "custom_project") return "Custom Project";
  return "Enterprise";
}

function flowColor(flow: string) {
  if (flow === "enterprise") return "bg-gold/10 text-gold border-gold/30";
  if (flow === "custom_project") return "bg-cyan/10 text-cyan border-cyan/30";
  return "bg-violet/10 text-violet border-violet/30";
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ icon: Icon, title, id }: { icon: React.ElementType; title: string; id?: string }) {
  return (
    <div className="flex items-center gap-3 mb-6" id={id}>
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet/20 to-cyan/10 border border-violet/20 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-violet" />
      </div>
      <h2 className="font-bold text-lg text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</h2>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <Layout>
      <div className="border-b border-border/40 bg-surface-1/60">
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <FlowStepper currentStep="harga" />
        </div>
      </div>
      <div className="container mx-auto px-4 md:px-8 py-12 max-w-7xl">
        <div className="skeleton h-4 w-24 rounded mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-6">
            <div className="space-y-3">
              <div className="skeleton h-8 w-2/3 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-4/5 rounded" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
            </div>
          </div>
          <div className="skeleton h-96 rounded-2xl" />
        </div>
      </div>
    </Layout>
  );
}

// ── Mobile sticky quote bar ───────────────────────────────────────────────────

function MobileStickyBar({
  service,
  breakdown,
  selections,
  isPending,
  onSubmit,
  submitting,
}: {
  service: { serviceName: string; startingPrice: string; currency: string; serviceFlow: string };
  breakdown: PricingBreakdown | undefined;
  selections: QuoteSelections;
  isPending: boolean;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const total = breakdown?.total ?? Number(service.startingPrice);
  const currency = breakdown?.currency ?? service.currency;

  return (
    <>
      {/* Bar */}
      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t"
        style={{ background: "rgba(6,11,24,0.97)", borderColor: "rgba(46,66,112,0.6)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setSheetOpen(true)}
            className="flex-1 text-left min-w-0"
            aria-label="View quote details"
          >
            <p className="text-[11px] text-[#8B9BC4] mb-0.5">
              {isPending ? "Calculating…" : breakdown ? "Your quote" : "Starting from"}
            </p>
            <p className="font-bold text-lg text-[#F0F4FF] leading-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {formatMoney(total, currency)}
              {isPending && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-[#8B9BC4]" />}
            </p>
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="btn-primary shrink-0 px-5 py-2.5 text-sm disabled:opacity-60"
            aria-label="Continue to brief"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue →"}
          </button>
        </div>
      </div>

      {/* Sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-50 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              className="lg:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl p-6 space-y-4"
              style={{ background: "rgba(10,18,37,0.98)", border: "1px solid rgba(46,66,112,0.7)", maxHeight: "80vh", overflowY: "auto" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 350 }}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-base text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Quote Summary
                </h3>
                <button
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                  className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10"
                >
                  <X className="w-4 h-4 text-[#8B9BC4]" />
                </button>
              </div>
              {breakdown ? (
                <div className="space-y-2.5">
                  {breakdown.lineItems.map((li) => (
                    <div key={li.code} className="flex justify-between text-sm">
                      <span className="text-[#8B9BC4]">{li.label}</span>
                      <span className="font-medium text-[#F0F4FF]">{formatMoney(li.amount, breakdown.currency)}</span>
                    </div>
                  ))}
                  {breakdown.discount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-400">
                      <span>Discount</span>
                      <span>−{formatMoney(breakdown.discount, breakdown.currency)}</span>
                    </div>
                  )}
                  {breakdown.tax > 0 && (
                    <div className="flex justify-between text-sm text-[#8B9BC4]">
                      <span>Tax ({breakdown.taxPercent}%)</span>
                      <span>{formatMoney(breakdown.tax, breakdown.currency)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 mt-2 flex justify-between items-baseline" style={{ borderColor: "rgba(46,66,112,0.5)" }}>
                    <span className="font-bold text-[#F0F4FF]">Total</span>
                    <span className="font-bold text-xl text-gradient-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {formatMoney(breakdown.total, breakdown.currency)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#8B9BC4]">
                  Select a package and options above to calculate your exact price.
                </p>
              )}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] text-[#8B9BC4] flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-400" /> No hidden fees
                </div>
                <div className="text-[11px] text-[#8B9BC4] flex items-center gap-1.5">
                  <CreditCard className="w-3 h-3 text-violet" />
                  {service.serviceFlow === "fixed_price"
                    ? "Instant checkout after brief"
                    : "Commercial verification before production"}
                </div>
              </div>
              <button
                onClick={() => { setSheetOpen(false); onSubmit(); }}
                disabled={submitting}
                className="btn-primary w-full justify-center mt-2 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {submitting ? "Submitting…" : "Request This Service"}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const serviceId = Number(params.id);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const { data: service, isLoading } = useServiceDetail(
    Number.isFinite(serviceId) ? serviceId : undefined,
  );
  const { data: showcase } = useServiceShowcase(
    Number.isFinite(serviceId) ? serviceId : undefined,
  );
  const quote = useQuoteCalculator(Number.isFinite(serviceId) ? serviceId : undefined);
  const requestService = useRequestService(Number.isFinite(serviceId) ? serviceId : undefined);

  const [selections, setSelections] = useState<QuoteSelections>({ quantity: 1 });
  const [contact, setContact] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    companyName: "",
    notes: "",
  });
  const [seededConcept, setSeededConcept] = useState<ContinueConceptResult | null>(null);
  const [activeSection, setActiveSection] = useState<string>("overview");
  // Keep prev breakdown so there's no flash-of-blank while recalculating
  const prevBreakdownRef = useRef<PricingBreakdown | undefined>(undefined);
  if (quote.data) prevBreakdownRef.current = quote.data;
  const displayBreakdown = quote.isPending ? prevBreakdownRef.current : quote.data;

  // Arriving from "Continue With This Concept"
  useEffect(() => {
    const p = new URLSearchParams(search);
    if (p.get("seedPreview")) {
      const raw = sessionStorage.getItem("live-preview-seed");
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as ContinueConceptResult;
          setSeededConcept(parsed);
          setContact((c) => ({ ...c, notes: parsed.seed.notes }));
        } catch { /* ignore */ }
      }
    }
  }, [search]);

  // Arriving from the Template Gallery's "Use This Template" CTA — carry the
  // template reference into the brief notes so the draft request is tied to it.
  useEffect(() => {
    const raw = sessionStorage.getItem("template-selection-seed");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { templateId: number; templateName: string; category: string; style: string };
      setContact((c) => (c.notes
        ? c
        : { ...c, notes: `Referensi template: ${parsed.templateName} (${parsed.category} · ${parsed.style})` }));
    } catch { /* ignore */ }
    // Consumed once per service-detail visit; clear so it doesn't leak into unrelated requests later.
    sessionStorage.removeItem("template-selection-seed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runQuote = (next: QuoteSelections) => {
    setSelections(next);
    quote.mutate(next);
  };

  const onSubmitRequest = () => {
    if (!contact.customerName || !contact.customerEmail) {
      toast({
        title: "Missing details",
        description: "Please provide your name and email.",
        variant: "destructive",
      });
      return;
    }
    requestService.mutate(
      { ...selections, ...contact },
      {
        onSuccess: (res) => setLocation(`/request-service/${res.requestId}/brief`),
        onError: (err) =>
          toast({
            title: "Request failed",
            description: err instanceof Error ? err.message : "Something went wrong.",
            variant: "destructive",
          }),
      },
    );
  };

  // ── Scroll-tracking nav ──────────────────────────────────────────────────────
  const sectionIds = ["overview", "deliverables", "packages", "preview", "reviews", "workflow", "live-preview", "faq", "related"];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to top of viewport among intersecting ones
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) setActiveSection(topEntry.target.id);
      },
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
    );

    const timerId = setTimeout(() => {
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }, 300);

    return () => {
      clearTimeout(timerId);
      observer.disconnect();
    };
  }, [service?.id]); // re-bind once service loads

  if (isLoading || !service) return <DetailSkeleton />;

  const currency = service.currency;
  const hasStats = showcase && showcase.stats.reviewCount > 0;
  const hasPortfolio = showcase && showcase.portfolios.length > 0;
  const hasReviews = showcase && showcase.reviews && showcase.reviews.length > 0;
  const hasFaq = showcase?.faqs && showcase.faqs.length > 0;
  const hasRelated = showcase?.relatedServices && showcase.relatedServices.length > 0;
  const hasPackages = service.packages.length > 0;
  const hasDeliverables = service.deliverables && service.deliverables.length > 0;

  // ── Scroll helpers ───────────────────────────────────────────────────────────
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const navHeight = 56;
    const y = el.getBoundingClientRect().top + window.scrollY - navHeight - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
    setActiveSection(id);
  };

  // ── Trust pills (data-driven) ────────────────────────────────────────────────
  const trustPills = [
    service.humanReview && { icon: Shield, label: "Human Reviewed", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
    service.serviceFlow !== "enterprise" && { icon: CreditCard, label: "Transparent Pricing", color: "text-violet", bg: "bg-violet/10 border-violet/25" },
    { icon: Lock, label: "Secure Project", color: "text-cyan", bg: "bg-cyan/10 border-cyan/25" },
    service.serviceFlow === "fixed_price" && { icon: Globe, label: "Commercial Ready", color: "text-gold", bg: "bg-gold/10 border-gold/25" },
  ].filter(Boolean) as { icon: React.ElementType; label: string; color: string; bg: string }[];

  // ── In-page nav sections ─────────────────────────────────────────────────────
  const NAV_SECTIONS = [
    { id: "overview",     label: "Overview"    },
    { id: "deliverables", label: "Deliverables" },
    ...(hasPackages  ? [{ id: "packages",    label: "Packages"    }] : []),
    ...(hasPortfolio ? [{ id: "preview",     label: "Portfolio"   }] : []),
    ...(hasReviews   ? [{ id: "reviews",     label: "Reviews"     }] : []),
    { id: "workflow",     label: "How It Works" },
    { id: "live-preview", label: "AI Preview"   },
    ...(hasFaq       ? [{ id: "faq",         label: "FAQ"         }] : []),
  ];

  // ── Package recommended logic ────────────────────────────────────────────────
  const recommendedPackageId = (() => {
    if (service.packages.length === 3) return service.packages[1].id;
    const std = service.packages.find((p) => /standard|pro|business/i.test(p.packageType));
    return std?.id;
  })();

  return (
    <Layout>
      {/* Flow stepper */}
      <div className="border-b border-border/40 bg-surface-1/60">
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <FlowStepper currentStep="harga" />
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/40" style={{ background: "linear-gradient(180deg, rgba(8,13,30,1) 0%, rgba(6,11,24,1) 100%)" }}>
        {/* Ambient orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 right-1/4 w-[500px] h-[250px] rounded-full" style={{ background: "radial-gradient(ellipse, rgba(124,110,250,0.07) 0%, transparent 70%)", filter: "blur(40px)" }} />
          <div className="absolute bottom-0 left-1/3 w-[300px] h-[150px] rounded-full" style={{ background: "radial-gradient(ellipse, rgba(34,211,238,0.05) 0%, transparent 70%)", filter: "blur(30px)" }} />
        </div>

        <div className="relative container mx-auto px-4 md:px-8 max-w-7xl py-10 md:py-14">
          {/* Back link */}
          <Link
            href="/services"
            className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            All Services
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-10 items-start">
            {/* Left: title + meta */}
            <div className="lg:col-span-2 space-y-5">
              {/* Badges row */}
              <div className="flex flex-wrap gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${flowColor(service.serviceFlow)}`}>
                  {flowLabel(service.serviceFlow)}
                </span>
                {service.humanReview && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Human Review
                  </span>
                )}
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-border text-[#8B9BC4] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {service.estimatedDelivery}
                </span>
              </div>

              {/* Title */}
              <h1
                className="font-bold text-3xl md:text-4xl lg:text-5xl leading-tight text-[#F0F4FF]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {service.serviceName}
              </h1>

              {/* Value proposition */}
              <p className="text-base text-[#8B9BC4] leading-relaxed max-w-xl">
                {service.shortDescription || service.fullDescription.slice(0, 120) + "…"}
              </p>

              {/* Stats row */}
              {hasStats && (
                <div className="flex items-center gap-5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${i < Math.round(showcase.stats.avgRating ?? 0) ? "fill-gold text-gold" : "text-border"}`}
                      />
                    ))}
                    {showcase.stats.avgRating != null && (
                      <span className="text-sm font-bold ml-1 text-[#F0F4FF]">{showcase.stats.avgRating.toFixed(1)}</span>
                    )}
                    <span className="text-sm text-[#8B9BC4]">({showcase.stats.reviewCount} reviews)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-[#8B9BC4]">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    {showcase.stats.totalProjects}+ projects delivered
                  </div>
                </div>
              )}

              {/* Trust pills */}
              <div className="flex flex-wrap gap-2">
                {trustPills.map(({ icon: Icon, label, color, bg }) => (
                  <span key={label} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${bg} ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </span>
                ))}
              </div>

              {/* Dual CTA */}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  onClick={() => scrollTo(hasPackages ? "packages" : "customize")}
                  className="btn-primary gap-2"
                  aria-label="Choose a package"
                >
                  <Package className="w-4 h-4" />
                  Choose Package
                </button>
                <button
                  onClick={() => scrollTo(hasPortfolio ? "preview" : "live-preview")}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full border font-semibold text-sm transition-all duration-200 hover:bg-white/5"
                  style={{ borderColor: "rgba(46,66,112,0.8)", color: "#8B9BC4" }}
                  aria-label="Preview sample work"
                >
                  <Sparkles className="w-4 h-4 text-violet" />
                  Preview Sample
                </button>
              </div>

              {/* Seeded concept notice */}
              {seededConcept && (
                <div className="rounded-2xl border border-violet/30 bg-violet/5 p-4 flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-violet shrink-0 mt-0.5 animate-pulse-ring" />
                  <div className="text-sm">
                    <p className="font-semibold mb-0.5 text-[#F0F4FF]">
                      Continuing with Concept {seededConcept.selectedConcept}: {seededConcept.conceptData.name}
                    </p>
                    <p className="text-[#8B9BC4] text-xs leading-relaxed">
                      Your AI preview concept is carried into this brief — no need to regenerate. Pick a package and submit below.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Right: price teaser card */}
            <div className="lg:col-span-1">
              <div
                className="rounded-2xl p-5 border"
                style={{ background: "rgba(13,21,38,0.8)", borderColor: "rgba(46,66,112,0.7)", backdropFilter: "blur(12px)" }}
              >
                <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-1">Starting from</p>
                <p className="font-bold text-3xl text-[#F0F4FF] mb-3" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {formatMoney(Number(service.startingPrice), currency)}
                </p>
                <div className="space-y-1.5 mb-4">
                  {[
                    service.humanReview && "Human expert review included",
                    `${service.estimatedDelivery} standard delivery`,
                    service.serviceFlow === "fixed_price" && "Instant checkout — no back-and-forth",
                    service.serviceFlow !== "fixed_price" && "Custom quotation available",
                  ].filter(Boolean).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-[#8B9BC4]">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {item as string}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => scrollTo(hasPackages ? "packages" : "customize")}
                  className="btn-primary w-full justify-center"
                >
                  Choose Package
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── AI Workforce (lazy) ────────────────────────────────────────── */}
      <Suspense fallback={
        <div className="border-b" style={{ borderColor: "rgba(46,66,112,0.3)", height: 8 }} />
      }>
        <AiWorkforceSection />
      </Suspense>

      {/* ── In-page nav ───────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-20 border-b"
        style={{ background: "rgba(6,11,24,0.95)", borderColor: "rgba(46,66,112,0.5)", backdropFilter: "blur(12px)" }}
        role="navigation"
        aria-label="Page sections"
      >
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <div className="flex items-center gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
            {NAV_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                aria-pressed={activeSection === s.id}
                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50 ${
                  activeSection === s.id
                    ? "bg-gradient-primary text-white"
                    : "text-[#8B9BC4] hover:text-[#F0F4FF]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 md:px-8 max-w-7xl py-12 pb-28 lg:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start">

          {/* ── Main content ─────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-14">

            {/* Overview */}
            <section id="overview">
              <SectionHead icon={LayoutGrid} title="Overview" />
              <p className="text-base text-[#8B9BC4] leading-relaxed mb-6">{service.fullDescription}</p>
            </section>

            {/* What You'll Receive */}
            <section id="deliverables">
              <SectionHead icon={FileText} title="What You'll Receive" />
              {hasDeliverables ? (
                <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(46,66,112,0.5)", background: "rgba(13,21,38,0.6)" }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x" style={{ "--tw-divide-color": "rgba(46,66,112,0.4)" } as React.CSSProperties}>
                    {/* Included */}
                    <div className="p-5 sm:p-6">
                      <p className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider mb-4">
                        <CheckCircle2 className="w-4 h-4" />
                        Included
                      </p>
                      <ul className="space-y-3">
                        {service.deliverables!.map((d, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)" }}>
                              <Check className="w-3 h-3 text-emerald-400" />
                            </div>
                            <span className="text-[#C8D5F0]">{d}</span>
                          </li>
                        ))}
                        {service.humanReview && (
                          <li className="flex items-start gap-3 text-sm">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)" }}>
                              <Check className="w-3 h-3 text-emerald-400" />
                            </div>
                            <span className="text-[#C8D5F0]">Human quality review before delivery</span>
                          </li>
                        )}
                      </ul>
                    </div>
                    {/* Meta */}
                    <div className="p-5 sm:p-6 space-y-4">
                      <p className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider mb-4">Project Details</p>
                      {[
                        { icon: Clock, label: "Delivery Time", value: service.estimatedDelivery },
                        { icon: Globe, label: "Flow Type", value: flowLabel(service.serviceFlow) },
                        { icon: Shield, label: "Human Review", value: service.humanReview ? "Included" : "Not included" },
                        { icon: RefreshCw, label: "Revisions", value: "Per package" },
                      ].map(({ icon: Icon, label, value }) => (
                        <div key={label} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Icon className="w-3.5 h-3.5 text-[#8B9BC4]" />
                            <span className="text-xs text-[#8B9BC4]">{label}</span>
                          </div>
                          <span className="text-xs font-semibold text-[#F0F4FF]">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl p-6 flex items-center gap-3" style={{ border: "1px solid rgba(46,66,112,0.4)", background: "rgba(13,21,38,0.5)" }}>
                  <FileText className="w-5 h-5 text-[#8B9BC4] shrink-0" />
                  <p className="text-sm text-[#8B9BC4]">
                    Deliverables are customised per brief. You'll confirm the full scope with our team after submission.
                  </p>
                </div>
              )}
            </section>

            {/* Packages */}
            {hasPackages && (
              <section id="packages">
                <SectionHead icon={Package} title="Choose a Package" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" role="radiogroup" aria-label="Service packages">
                  {service.packages.map((p, idx) => {
                    const price = p.oneTimePrice ?? p.monthlyPrice ?? p.yearlyPrice;
                    const selected = selections.packageId === p.id;
                    const recommended = p.id === recommendedPackageId;
                    return (
                      <div key={p.id} className="relative">
                        {recommended && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                            <span className="flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-bold bg-gradient-primary text-white shadow-lg whitespace-nowrap">
                              <Star className="w-3 h-3 fill-white" />
                              Most Popular
                            </span>
                          </div>
                        )}
                        <button
                          role="radio"
                          aria-checked={selected}
                          tabIndex={0}
                          onClick={() => runQuote({ ...selections, packageId: selected ? undefined : p.id })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              runQuote({ ...selections, packageId: selected ? undefined : p.id });
                            }
                          }}
                          className={`relative w-full text-left p-5 rounded-2xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 ${
                            selected
                              ? "border-violet/70 shadow-[0_0_0_3px_rgba(124,110,250,0.15),0_4px_24px_rgba(124,110,250,0.1)]"
                              : recommended
                              ? "border-violet/30 hover:border-violet/50"
                              : "border-border/60 hover:border-violet/30"
                          }`}
                          style={{
                            background: selected
                              ? "rgba(124,110,250,0.06)"
                              : recommended
                              ? "rgba(124,110,250,0.03)"
                              : "rgba(13,21,38,0.6)",
                          }}
                        >
                          {selected && (
                            <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-gradient-primary flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                          <p
                            className={`font-bold text-sm mb-1 pr-7 transition-colors ${selected ? "text-violet" : "text-[#F0F4FF]"}`}
                            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                          >
                            {p.packageName}
                          </p>
                          {price && (
                            <p className="text-xl font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: selected ? "#7C6EFA" : "#F0F4FF" }}>
                              {formatMoney(Number(price), currency)}
                            </p>
                          )}
                          {p.paymentPolicy && (
                            <p className="text-[11px] text-[#8B9BC4] capitalize mb-3">
                              {p.paymentPolicy.replace(/_/g, " ")}
                            </p>
                          )}
                          {p.featuresJson && p.featuresJson.length > 0 && (
                            <ul className="space-y-1.5">
                              {p.featuresJson.slice(0, 4).map((f, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-[#8B9BC4]">
                                  <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                                  {f}
                                </li>
                              ))}
                              {p.featuresJson.length > 4 && (
                                <li className="text-[11px] text-violet ml-5">+{p.featuresJson.length - 4} more</li>
                              )}
                            </ul>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Portfolio */}
            {hasPortfolio && (
              <section id="preview">
                <SectionHead icon={Award} title="Portfolio & Sample Output" />
                <PortfolioGallery portfolios={showcase.portfolios} />
              </section>
            )}

            {/* Reviews */}
            {hasReviews && (
              <section id="reviews">
                <SectionHead icon={Star} title="Client Reviews" />
                <PortfolioReviews reviews={showcase!.reviews!} avgRating={showcase!.stats.avgRating} />
              </section>
            )}

            {/* Customize */}
            <section id="customize">
              <SectionHead icon={Settings2} title="Customize Your Order" />
              <div className="rounded-2xl p-6 space-y-6" style={{ border: "1px solid rgba(46,66,112,0.5)", background: "rgba(13,21,38,0.6)" }}>

                {/* Delivery speed — segmented control */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan" />
                    Delivery Speed
                  </label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Delivery speed options">
                    {[
                      { value: "", label: `Standard (${service.estimatedDelivery})`, addl: "" },
                      { value: "48h",      label: "Rush 48h",   addl: "+fee" },
                      { value: "24h",      label: "Rush 24h",   addl: "+fee" },
                      { value: "same_day", label: "Same Day",   addl: "+fee" },
                    ].map((opt) => {
                      const active = (selections.rushSpeed ?? "") === opt.value;
                      return (
                        <button
                          key={opt.value}
                          role="radio"
                          aria-checked={active}
                          onClick={() => runQuote({ ...selections, rushSpeed: (opt.value || undefined) as QuoteSelections["rushSpeed"] })}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50 ${
                            active
                              ? "bg-cyan/15 border-cyan/40 text-cyan"
                              : "border-border/60 text-[#8B9BC4] hover:border-cyan/30 hover:text-[#F0F4FF]"
                          }`}
                        >
                          {opt.label}
                          {opt.addl && <span className="ml-1 opacity-60">{opt.addl}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Quantity */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-violet" />
                      Quantity
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Decrease quantity"
                        onClick={() => runQuote({ ...selections, quantity: Math.max(1, (selections.quantity ?? 1) - 1) })}
                        className="w-9 h-9 rounded-lg border border-border/60 flex items-center justify-center text-[#8B9BC4] hover:border-violet/40 hover:text-[#F0F4FF] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
                      >−</button>
                      <input
                        type="number"
                        min={1}
                        className="input-field flex-1 text-center"
                        value={selections.quantity ?? 1}
                        onChange={(e) => runQuote({ ...selections, quantity: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="Quantity"
                      />
                      <button
                        aria-label="Increase quantity"
                        onClick={() => runQuote({ ...selections, quantity: (selections.quantity ?? 1) + 1 })}
                        className="w-9 h-9 rounded-lg border border-border/60 flex items-center justify-center text-[#8B9BC4] hover:border-violet/40 hover:text-[#F0F4FF] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
                      >+</button>
                    </div>
                  </div>

                  {/* Extra revisions */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-gold" />
                      Extra Revisions
                      <span className="text-[10px] text-[#8B9BC4] normal-case font-normal">(+fee each)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Decrease revisions"
                        onClick={() => runQuote({ ...selections, extraRevisions: Math.max(0, (selections.extraRevisions ?? 0) - 1) })}
                        className="w-9 h-9 rounded-lg border border-border/60 flex items-center justify-center text-[#8B9BC4] hover:border-violet/40 hover:text-[#F0F4FF] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
                      >−</button>
                      <input
                        type="number"
                        min={0}
                        className="input-field flex-1 text-center"
                        value={selections.extraRevisions ?? 0}
                        onChange={(e) => runQuote({ ...selections, extraRevisions: Math.max(0, Number(e.target.value) || 0) })}
                        aria-label="Extra revisions"
                      />
                      <button
                        aria-label="Increase revisions"
                        onClick={() => runQuote({ ...selections, extraRevisions: (selections.extraRevisions ?? 0) + 1 })}
                        className="w-9 h-9 rounded-lg border border-border/60 flex items-center justify-center text-[#8B9BC4] hover:border-violet/40 hover:text-[#F0F4FF] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
                      >+</button>
                    </div>
                  </div>
                </div>

                {/* Add-ons */}
                <div className="border-t pt-5" style={{ borderColor: "rgba(46,66,112,0.4)" }}>
                  <p className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider mb-4">Add-ons</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        ["humanReviewRequested", "Human review add-on",   Shield,    "text-violet",   "Expert human reviews your final output for quality and brand fit."],
                        ["bilingual",            "Bilingual delivery",    LayoutGrid,"text-cyan",      "Receive all copy and materials in two languages."],
                        ["editableSourceFile",   "Editable source files", Settings2, "text-gold",      "Get the original editable files (AI, PSD, Figma, etc.)."],
                        ["extendedUsageRights",  "Extended usage rights", Award,     "text-emerald-400","Full commercial license for unlimited media channels."],
                      ] as const
                    ).map(([key, label, Icon, iconCls, tooltip]) => {
                      const checked = !!(selections as Record<string, unknown>)[key];
                      return (
                        <label
                          key={key}
                          title={tooltip}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all focus-within:ring-2 focus-within:ring-violet/50 ${
                            checked
                              ? "border-violet/40 bg-violet/5"
                              : "border-border/60 hover:border-violet/25 hover:bg-white/[0.01]"
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${checked ? "bg-gradient-primary" : "bg-surface-2 border border-border"}`}>
                            <Icon className={`w-4 h-4 ${checked ? "text-white" : iconCls}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-[#F0F4FF]">{label}</span>
                            <p className="text-[11px] text-[#8B9BC4] mt-0.5 leading-snug">{tooltip}</p>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${checked ? "border-violet bg-violet" : "border-border"}`}>
                            {checked && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={(e) => runQuote({ ...selections, [key]: e.target.checked })}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* How It Works */}
            <section id="workflow">
              <SectionHead icon={ChevronRight} title="How It Works" />
              <ServiceWorkflow />
            </section>

            {/* Live AI Preview */}
            <section id="live-preview">
              <SectionHead icon={Sparkles} title="Try a Free AI Preview" />
              <LiveAiPreview
                serviceId={serviceId}
                onConceptContinued={(res) => {
                  setSeededConcept(res);
                  setContact((c) => ({ ...c, notes: res.seed.notes }));
                  // Scroll to the request / customize section so user sees the banner
                  setTimeout(() => scrollTo("customize"), 100);
                }}
              />
            </section>

            {/* FAQ */}
            {hasFaq && (
              <section id="faq">
                <SectionHead icon={HelpCircle} title="Frequently Asked Questions" />
                <ServiceFaqSection faqs={showcase!.faqs!} />
              </section>
            )}

            {/* Related services */}
            {hasRelated && (
              <section id="related">
                <SectionHead icon={LayoutGrid} title="You Might Also Like" />
                <RelatedServices services={showcase!.relatedServices!} />
              </section>
            )}
          </div>

          {/* ── Sticky sidebar ───────────────────────────────────────── */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-16 space-y-4">

              {/* Quote card */}
              <div className="rounded-2xl p-6 space-y-5" style={{ border: "1px solid rgba(46,66,112,0.6)", background: "rgba(13,21,38,0.8)", backdropFilter: "blur(12px)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-violet" />
                    <h3 className="font-bold text-base text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Your Quote</h3>
                  </div>
                  {!displayBreakdown && (
                    <button
                      onClick={() => runQuote(selections)}
                      disabled={quote.isPending}
                      className="text-xs text-violet hover:text-violet-hover font-medium transition-colors disabled:opacity-50"
                    >
                      Calculate
                    </button>
                  )}
                </div>

                {/* Quote body — no layout shift: keep prev data visible with spinner overlay */}
                <div className="relative">
                  {displayBreakdown ? (
                    <div className="space-y-2">
                      {displayBreakdown.lineItems.map((li) => (
                        <div key={li.code} className="flex justify-between text-sm">
                          <span className="text-[#8B9BC4]">{li.label}</span>
                          <span className="font-medium text-[#F0F4FF]">{formatMoney(li.amount, displayBreakdown.currency)}</span>
                        </div>
                      ))}
                      {displayBreakdown.discount > 0 && (
                        <div className="flex justify-between text-sm text-emerald-400">
                          <span>Discount</span>
                          <span>−{formatMoney(displayBreakdown.discount, displayBreakdown.currency)}</span>
                        </div>
                      )}
                      {displayBreakdown.tax > 0 && (
                        <div className="flex justify-between text-sm text-[#8B9BC4]">
                          <span>Tax ({displayBreakdown.taxPercent}%)</span>
                          <span>{formatMoney(displayBreakdown.tax, displayBreakdown.currency)}</span>
                        </div>
                      )}
                      <div className="border-t pt-3 flex justify-between items-baseline" style={{ borderColor: "rgba(46,66,112,0.5)" }}>
                        <span className="font-bold text-[#F0F4FF]">Total</span>
                        <span className="font-bold text-xl text-gradient-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                          {formatMoney(displayBreakdown.total, displayBreakdown.currency)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-surface-1/50 p-4 text-center">
                      <p className="text-xs text-[#8B9BC4] mb-2">Select options above to see live pricing</p>
                      <button
                        onClick={() => runQuote(selections)}
                        className="text-xs font-medium text-violet hover:text-violet-hover transition-colors"
                      >
                        Update Quote →
                      </button>
                    </div>
                  )}
                  {/* Recalculating spinner overlay */}
                  <AnimatePresence>
                    {quote.isPending && displayBreakdown && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center rounded-xl"
                        style={{ background: "rgba(6,11,24,0.5)", backdropFilter: "blur(2px)" }}
                      >
                        <Loader2 className="w-5 h-5 animate-spin text-violet" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Microcopy */}
                <div className="space-y-1.5 border-t pt-4" style={{ borderColor: "rgba(46,66,112,0.4)" }}>
                  {[
                    { icon: Lock,       text: "No hidden fees" },
                    { icon: BadgeCheck, text: service.serviceFlow === "fixed_price"
                        ? "Instant checkout after brief"
                        : "Commercial verification before production" },
                    { icon: FileText,   text: "Price may adjust based on submitted brief" },
                  ].map(({ icon: Icon, text }) => (
                    <p key={text} className="text-[11px] text-[#8B9BC4] flex items-start gap-1.5">
                      <Icon className="w-3 h-3 text-violet shrink-0 mt-0.5" />
                      {text}
                    </p>
                  ))}
                </div>
              </div>

              {/* Request form */}
              <div className="rounded-2xl p-6 space-y-4" style={{ border: "1px solid rgba(46,66,112,0.6)", background: "rgba(13,21,38,0.7)", backdropFilter: "blur(12px)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-violet" />
                  <h3 className="font-bold text-base text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Request This Service</h3>
                </div>
                <fieldset className="space-y-3" aria-label="Contact information">
                  <input
                    className="input-field"
                    placeholder="Your name *"
                    autoComplete="name"
                    value={contact.customerName}
                    onChange={(e) => setContact({ ...contact, customerName: e.target.value })}
                    aria-label="Your name"
                    aria-required="true"
                  />
                  <input
                    className="input-field"
                    placeholder="Email address *"
                    type="email"
                    autoComplete="email"
                    value={contact.customerEmail}
                    onChange={(e) => setContact({ ...contact, customerEmail: e.target.value })}
                    aria-label="Email address"
                    aria-required="true"
                  />
                  <input
                    className="input-field"
                    placeholder="Phone (optional)"
                    autoComplete="tel"
                    value={contact.customerPhone}
                    onChange={(e) => setContact({ ...contact, customerPhone: e.target.value })}
                    aria-label="Phone number"
                  />
                  <input
                    className="input-field"
                    placeholder="Company (optional)"
                    autoComplete="organization"
                    value={contact.companyName}
                    onChange={(e) => setContact({ ...contact, companyName: e.target.value })}
                    aria-label="Company name"
                  />
                  <textarea
                    className="input-field resize-none"
                    rows={3}
                    placeholder="Anything we should know? (optional)"
                    value={contact.notes}
                    onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                    aria-label="Additional notes"
                  />
                </fieldset>
                <button
                  onClick={onSubmitRequest}
                  disabled={requestService.isPending || !contact.customerName || !contact.customerEmail}
                  className="btn-primary w-full justify-center disabled:opacity-60"
                  aria-label="Submit service request"
                >
                  {requestService.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                  )}
                  {requestService.isPending ? "Submitting…" : "Request This Service"}
                </button>
                <p className="text-[11px] text-center text-[#8B9BC4] leading-relaxed">
                  By submitting you agree to our Terms of Service.{" "}
                  No payment required at this step.
                </p>
              </div>

              {/* Trust badges */}
              <div className="rounded-2xl p-4" style={{ border: "1px solid rgba(46,66,112,0.5)", background: "rgba(13,21,38,0.5)" }}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { icon: Shield, label: "Secure" },
                    { icon: Award,  label: "Quality" },
                    { icon: Zap,    label: "Fast"    },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center">
                        <Icon className="w-4 h-4 text-violet" aria-hidden="true" />
                      </div>
                      <span className="text-[11px] text-[#8B9BC4] font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile sticky bar ─────────────────────────────────────────── */}
      <MobileStickyBar
        service={service}
        breakdown={displayBreakdown}
        selections={selections}
        isPending={quote.isPending}
        onSubmit={onSubmitRequest}
        submitting={requestService.isPending}
      />
    </Layout>
  );
}
