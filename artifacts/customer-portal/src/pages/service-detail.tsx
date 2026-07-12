import { useEffect, useState } from "react";
import { Link, useParams, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import {
  useServiceDetail,
  useQuoteCalculator,
  useRequestService,
  type QuoteSelections,
} from "@/hooks/use-catalog";
import { useServiceShowcase, type ContinueConceptResult } from "@/hooks/use-portfolio";
import { PortfolioGallery } from "@/components/portfolio-gallery";
import { PortfolioReviews } from "@/components/portfolio-reviews";
import { ServiceFaqSection } from "@/components/service-faq";
import { RelatedServices } from "@/components/related-services";
import { LiveAiPreview } from "@/components/live-ai-preview";
import { ServiceWorkflow } from "@/components/service-workflow";
import { AiWorkforceSection } from "@/components/ai-workforce";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ArrowLeft, CheckCircle2, Sparkles, Star, Clock, Shield,
  Zap, ChevronRight, Users, Award, Cpu, Package, Settings2,
  Receipt, HelpCircle, LayoutGrid, Check,
} from "lucide-react";

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

function SectionHead({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet/20 to-cyan/10 border border-violet/20 flex items-center justify-center">
        <Icon className="w-4 h-4 text-violet" />
      </div>
      <h2 className="font-display font-bold text-lg" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</h2>
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
  const [activeSection, setActiveSection] = useState<string | null>(null);

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

  if (isLoading || !service) return <DetailSkeleton />;

  const breakdown = quote.data;
  const currency = service.currency;
  const hasStats = showcase && showcase.stats.reviewCount > 0;

  // Scroll-to-section helper
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  };

  const NAV_SECTIONS = [
    { id: "description", label: "Overview" },
    ...(showcase?.portfolios.length ? [{ id: "preview", label: "Preview" }] : []),
    ...(service.packages.length ? [{ id: "packages", label: "Packages" }] : []),
    { id: "customize", label: "Customize" },
    ...(showcase?.faqs?.length ? [{ id: "faq", label: "FAQ" }] : []),
  ];

  return (
    <Layout>
      {/* Flow stepper */}
      <div className="border-b border-border/40 bg-surface-1/60">
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <FlowStepper currentStep="harga" />
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/40 bg-gradient-to-b from-surface-1 to-background">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 right-1/4 w-[400px] h-[200px] bg-violet/6 rounded-full blur-[60px]" />
        </div>

        <div className="relative container mx-auto px-4 md:px-8 max-w-7xl py-10 md:py-14">
          {/* Back link */}
          <Link
            href="/services"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            All Services
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-10 items-start">
            {/* Left: service title & meta */}
            <div className="lg:col-span-2">
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${flowColor(service.serviceFlow)}`}>
                  {flowLabel(service.serviceFlow)}
                </span>
                {service.humanReview && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Human Review
                  </span>
                )}
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-border text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {service.estimatedDelivery}
                </span>
              </div>

              <h1 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl leading-tight mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {service.serviceName}
              </h1>

              {/* Stats row */}
              {hasStats && (
                <div className="flex items-center gap-5 mb-5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < Math.round(showcase.stats.avgRating ?? 0)
                            ? "fill-gold text-gold"
                            : "text-border"
                        }`}
                      />
                    ))}
                    {showcase.stats.avgRating != null && (
                      <span className="text-sm font-semibold ml-1">
                        {showcase.stats.avgRating.toFixed(1)}
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      ({showcase.stats.reviewCount} reviews)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    {showcase.stats.totalProjects}+ projects delivered
                  </div>
                </div>
              )}

              {/* Seeded concept notice */}
              {seededConcept && (
                <div className="rounded-2xl border border-violet/30 bg-violet/5 p-4 flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-violet shrink-0 mt-0.5 animate-pulse-ring" />
                  <div className="text-sm">
                    <p className="font-semibold mb-0.5">
                      Continuing with Concept {seededConcept.selectedConcept}: {seededConcept.conceptData.name}
                    </p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Your AI preview concept is carried into this brief — no need to regenerate. Pick a package and submit below.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Right: price summary teaser */}
            <div className="lg:col-span-1">
              <div className="glass rounded-2xl p-5 border border-border/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Starting from</p>
                <p className="font-display font-bold text-3xl mb-3" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {formatMoney(Number(service.startingPrice), currency)}
                </p>
                <div className="space-y-1.5 mb-4">
                  {[
                    service.humanReview && "Human expert review included",
                    `${service.estimatedDelivery} standard delivery`,
                    service.serviceFlow === "fixed_price" && "Instant checkout — no back-and-forth",
                    service.serviceFlow !== "fixed_price" && "Custom quotation available",
                  ].filter(Boolean).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {item as string}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => scrollTo("customize")}
                  className="btn-primary w-full justify-center"
                >
                  Get a Quote
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── AI Workforce ──────────────────────────────────────────────── */}
      <AiWorkforceSection />

      {/* ── In-page nav ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 bg-background/90 backdrop-blur-md border-b border-border/40">
        <div className="container mx-auto px-4 md:px-8 max-w-7xl">
          <div className="flex items-center gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
            {NAV_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 ${
                  activeSection === s.id
                    ? "bg-gradient-primary text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 md:px-8 max-w-7xl py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start">

          {/* ── Main content column ──────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-14">

            {/* Description */}
            <section id="description">
              <SectionHead icon={LayoutGrid} title="Overview" />
              <p className="text-base text-muted-foreground leading-relaxed mb-6">
                {service.fullDescription}
              </p>

              {/* Deliverables */}
              {service.deliverables && service.deliverables.length > 0 && (
                <div className="card-base p-6">
                  <p className="font-display font-semibold text-sm mb-4 flex items-center gap-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    What's included
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {service.deliverables.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <div className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mt-0.5 shrink-0">
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                        </div>
                        {d}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Preview / Portfolio gallery */}
            {showcase && showcase.portfolios.length > 0 && (
              <section id="preview">
                <SectionHead icon={Award} title="Preview & Portfolio" />
                <PortfolioGallery portfolios={showcase.portfolios} />
              </section>
            )}

            {/* Rating / Reviews */}
            {showcase && showcase.reviews && showcase.reviews.length > 0 && (
              <section id="reviews">
                <SectionHead icon={Star} title="Client Reviews" />
                <PortfolioReviews reviews={showcase.reviews} avgRating={showcase.stats.avgRating} />
              </section>
            )}

            {/* Packages */}
            {service.packages.length > 0 && (
              <section id="packages">
                <SectionHead icon={Package} title="Packages" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {service.packages.map((p) => {
                    const price = p.oneTimePrice ?? p.monthlyPrice ?? p.yearlyPrice;
                    const selected = selections.packageId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() =>
                          runQuote({ ...selections, packageId: selected ? undefined : p.id })
                        }
                        className={`relative text-left p-5 rounded-2xl border transition-all duration-200 group ${
                          selected
                            ? "border-violet/60 bg-violet/5 shadow-[0_0_0_3px_rgba(124,110,250,0.12)]"
                            : "border-border hover:border-violet/30 hover:bg-surface-1 card-base"
                        }`}
                      >
                        {selected && (
                          <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-gradient-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        <p className="font-display font-semibold mb-2 pr-6 group-hover:text-violet transition-colors" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                          {p.packageName}
                        </p>
                        {price && (
                          <p className="text-lg font-bold mb-2">
                            {formatMoney(Number(price), currency)}
                          </p>
                        )}
                        {p.paymentPolicy && (
                          <p className="text-xs text-muted-foreground capitalize">
                            {p.paymentPolicy.replace(/_/g, " ")}
                          </p>
                        )}
                        {p.featuresJson && p.featuresJson.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {p.featuresJson.slice(0, 3).map((f, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Customize */}
            <section id="customize">
              <SectionHead icon={Settings2} title="Customize Your Order" />
              <div className="card-base p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Delivery speed */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan" />
                      Delivery Speed
                    </label>
                    <select
                      className="input-field"
                      value={selections.rushSpeed ?? ""}
                      onChange={(e) =>
                        runQuote({
                          ...selections,
                          rushSpeed: (e.target.value || undefined) as QuoteSelections["rushSpeed"],
                        })
                      }
                    >
                      <option value="">Standard — {service.estimatedDelivery}</option>
                      <option value="48h">Rush — 48 hours (+fee)</option>
                      <option value="24h">Rush — 24 hours (+fee)</option>
                      <option value="same_day">Same day (+fee)</option>
                    </select>
                  </div>

                  {/* Quantity */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-violet" />
                      Quantity
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="input-field"
                      value={selections.quantity ?? 1}
                      onChange={(e) =>
                        runQuote({ ...selections, quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </div>

                  {/* Extra revisions */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-gold" />
                      Extra Revisions
                    </label>
                    <input
                      type="number"
                      min={0}
                      className="input-field"
                      value={selections.extraRevisions ?? 0}
                      onChange={(e) =>
                        runQuote({
                          ...selections,
                          extraRevisions: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                </div>

                {/* Add-on checkboxes */}
                <div className="border-t border-border/50 pt-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                    Add-ons
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        ["humanReviewRequested", "Human review add-on", Shield, "text-violet"],
                        ["bilingual", "Bilingual delivery", LayoutGrid, "text-cyan"],
                        ["editableSourceFile", "Editable source file", Settings2, "text-gold"],
                        ["extendedUsageRights", "Extended usage rights", Award, "text-emerald-400"],
                      ] as const
                    ).map(([key, label, Icon, iconCls]) => {
                      const checked = !!(selections as Record<string, unknown>)[key];
                      return (
                        <label
                          key={key}
                          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            checked
                              ? "border-violet/40 bg-violet/5"
                              : "border-border hover:border-violet/20 hover:bg-surface-1"
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            checked ? "bg-gradient-primary" : "bg-surface-2 border border-border"
                          }`}>
                            <Icon className={`w-4 h-4 ${checked ? "text-white" : iconCls}`} />
                          </div>
                          <span className="text-sm font-medium flex-1">{label}</span>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            checked ? "border-violet bg-violet" : "border-border"
                          }`}>
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

            {/* Service workflow */}
            <section id="workflow">
              <SectionHead icon={ChevronRight} title="How It Works" />
              <ServiceWorkflow />
            </section>

            {/* Live AI Preview */}
            <section id="live-preview">
              <SectionHead icon={Sparkles} title="Live AI Preview" />
              <LiveAiPreview serviceId={serviceId} />
            </section>

            {/* FAQ */}
            {showcase?.faqs && showcase.faqs.length > 0 && (
              <section id="faq">
                <SectionHead icon={HelpCircle} title="Frequently Asked Questions" />
                <ServiceFaqSection faqs={showcase.faqs} />
              </section>
            )}

            {/* Related services */}
            {showcase?.relatedServices && showcase.relatedServices.length > 0 && (
              <section id="related">
                <SectionHead icon={LayoutGrid} title="Related Services" />
                <RelatedServices services={showcase.relatedServices} />
              </section>
            )}
          </div>

          {/* ── Sticky sidebar: quote + request ──────────────────────── */}
          <div className="lg:col-span-1">
            <div className="sticky top-16 space-y-4">

              {/* Quote card */}
              <div className="card-base p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-violet" />
                    <h3 className="font-display font-semibold text-base" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Your Quote</h3>
                  </div>
                  {!breakdown && (
                    <button
                      onClick={() => runQuote(selections)}
                      disabled={quote.isPending}
                      className="text-xs text-violet hover:text-violet-hover font-medium transition-colors"
                    >
                      Calculate
                    </button>
                  )}
                </div>

                {quote.isPending ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : breakdown ? (
                  <div className="space-y-2">
                    {breakdown.lineItems.map((li) => (
                      <div key={li.code} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{li.label}</span>
                        <span className="font-medium">{formatMoney(li.amount, breakdown.currency)}</span>
                      </div>
                    ))}
                    {breakdown.discount > 0 && (
                      <div className="flex justify-between text-sm text-emerald-400">
                        <span>Discount</span>
                        <span>−{formatMoney(breakdown.discount, breakdown.currency)}</span>
                      </div>
                    )}
                    {breakdown.tax > 0 && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Tax ({breakdown.taxPercent}%)</span>
                        <span>{formatMoney(breakdown.tax, breakdown.currency)}</span>
                      </div>
                    )}
                    <div className="border-t border-border pt-3 flex justify-between items-baseline">
                      <span className="font-semibold">Total</span>
                      <span className="font-display font-bold text-xl text-gradient-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                        {formatMoney(breakdown.total, breakdown.currency)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-surface-1/50 p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-2">
                      Adjust options above to see live pricing
                    </p>
                    <button
                      onClick={() => runQuote(selections)}
                      className="text-xs font-medium text-violet hover:text-violet-hover transition-colors"
                    >
                      Calculate now →
                    </button>
                  </div>
                )}
              </div>

              {/* Request form card */}
              <div className="card-base p-6 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-violet" />
                  <h3 className="font-display font-semibold text-base" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Request This Service</h3>
                </div>

                <div className="space-y-3">
                  <input
                    className="input-field"
                    placeholder="Your name *"
                    value={contact.customerName}
                    onChange={(e) => setContact({ ...contact, customerName: e.target.value })}
                  />
                  <input
                    className="input-field"
                    placeholder="Email address *"
                    type="email"
                    value={contact.customerEmail}
                    onChange={(e) => setContact({ ...contact, customerEmail: e.target.value })}
                  />
                  <input
                    className="input-field"
                    placeholder="Phone (optional)"
                    value={contact.customerPhone}
                    onChange={(e) => setContact({ ...contact, customerPhone: e.target.value })}
                  />
                  <input
                    className="input-field"
                    placeholder="Company (optional)"
                    value={contact.companyName}
                    onChange={(e) => setContact({ ...contact, companyName: e.target.value })}
                  />
                  <textarea
                    className="input-field resize-none"
                    rows={3}
                    placeholder="Anything we should know? (optional)"
                    value={contact.notes}
                    onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                  />
                </div>

                <button
                  onClick={onSubmitRequest}
                  disabled={requestService.isPending}
                  className="btn-primary w-full justify-center disabled:opacity-60"
                >
                  {requestService.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {requestService.isPending ? "Submitting…" : "Request This Service"}
                </button>

                <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                  By submitting you agree to our Terms of Service.
                  No payment required at this step.
                </p>
              </div>

              {/* Trust badges */}
              <div className="glass rounded-2xl p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { icon: Shield, label: "Secure" },
                    { icon: Award, label: "Quality" },
                    { icon: Zap, label: "Fast" },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center">
                        <Icon className="w-4 h-4 text-violet" />
                      </div>
                      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
