import { useEffect, useState } from "react";
import { Link, useParams, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useServiceDetail, useQuoteCalculator, useRequestService, type QuoteSelections } from "@/hooks/use-catalog";
import { useServiceShowcase, type ContinueConceptResult } from "@/hooks/use-portfolio";
import { PortfolioGallery } from "@/components/portfolio-gallery";
import { PortfolioReviews } from "@/components/portfolio-reviews";
import { ServiceFaqSection } from "@/components/service-faq";
import { RelatedServices } from "@/components/related-services";
import { LiveAiPreview } from "@/components/live-ai-preview";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";

function formatMoney(value: number, currency: string) {
  if (currency === "IDR") return `Rp${Math.round(value).toLocaleString("id-ID")}`;
  return `${currency} ${value.toLocaleString()}`;
}

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const serviceId = Number(params.id);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { data: service, isLoading } = useServiceDetail(Number.isFinite(serviceId) ? serviceId : undefined);
  const { data: showcase } = useServiceShowcase(Number.isFinite(serviceId) ? serviceId : undefined);
  const quote = useQuoteCalculator(Number.isFinite(serviceId) ? serviceId : undefined);
  const requestService = useRequestService(Number.isFinite(serviceId) ? serviceId : undefined);

  const [selections, setSelections] = useState<QuoteSelections>({ quantity: 1 });
  const [contact, setContact] = useState({ customerName: "", customerEmail: "", customerPhone: "", companyName: "", notes: "" });
  const [seededConcept, setSeededConcept] = useState<ContinueConceptResult | null>(null);

  // Arriving from "Continue With This Concept" — seed the brief notes with
  // the exact already-generated concept, never re-run generation here.
  useEffect(() => {
    const params2 = new URLSearchParams(search);
    if (params2.get("seedPreview")) {
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
      toast({ title: "Missing details", description: "Please provide your name and email.", variant: "destructive" });
      return;
    }
    requestService.mutate(
      { ...selections, ...contact },
      {
        onSuccess: (res) => {
          setLocation(`/request-service/${res.requestId}/brief`);
        },
        onError: (err) => {
          toast({ title: "Request failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
        },
      },
    );
  };

  if (isLoading || !service) {
    return (
      <Layout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  const breakdown = quote.data;
  const currency = service.currency;

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl">
          <FlowStepper currentStep="harga" />
        </div>
      </div>
      <div className="container mx-auto px-4 md:px-8 py-12 max-w-5xl">
        <Link href="/services" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" /> All services
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-8">
            <div>
              <h1 className="text-3xl md:text-4xl font-serif font-medium mb-3">{service.serviceName}</h1>
              <p className="text-lg text-muted-foreground leading-relaxed">{service.fullDescription}</p>
              {showcase && showcase.stats.reviewCount > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {showcase.stats.totalProjects}+ projects delivered
                  {showcase.stats.avgRating != null ? ` · ${showcase.stats.avgRating.toFixed(1)}★ average rating` : ""}
                </p>
              )}
            </div>

            {seededConcept && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Continuing with Concept {seededConcept.selectedConcept}: {seededConcept.conceptData.name}</p>
                  <p className="text-muted-foreground mt-0.5">We've carried your AI preview concept into this brief — no need to regenerate. Pick a package and submit your details below.</p>
                </div>
              </div>
            )}

            {showcase && showcase.portfolios.length > 0 && <PortfolioGallery portfolios={showcase.portfolios} />}

            {service.deliverables && service.deliverables.length > 0 && (
              <div className="bg-card border border-card-border rounded-2xl p-6">
                <h2 className="font-serif text-lg font-medium mb-4">What's included</h2>
                <ul className="space-y-2">
                  {service.deliverables.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {service.packages.length > 0 && (
              <div>
                <h2 className="font-serif text-lg font-medium mb-4">Packages</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {service.packages.map((p) => {
                    const price = p.oneTimePrice ?? p.monthlyPrice ?? p.yearlyPrice;
                    const selected = selections.packageId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => runQuote({ ...selections, packageId: selected ? undefined : p.id })}
                        className={`text-left p-5 rounded-2xl border transition-colors ${
                          selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                        }`}
                      >
                        <p className="font-medium mb-1">{p.packageName}</p>
                        {price && <p className="text-sm text-muted-foreground">{formatMoney(Number(price), currency)}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-card border border-card-border rounded-2xl p-6 space-y-6">
              <h2 className="font-serif text-lg font-medium">Customize your order</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Delivery speed</label>
                  <select
                    className="w-full px-4 py-3 rounded-xl border border-input bg-background"
                    value={selections.rushSpeed ?? ""}
                    onChange={(e) => runQuote({ ...selections, rushSpeed: (e.target.value || undefined) as QuoteSelections["rushSpeed"] })}
                  >
                    <option value="">Standard ({service.estimatedDelivery})</option>
                    <option value="48h">Rush — 48 hours</option>
                    <option value="24h">Rush — 24 hours</option>
                    <option value="same_day">Rush — same day</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-4 py-3 rounded-xl border border-input bg-background"
                    value={selections.quantity ?? 1}
                    onChange={(e) => runQuote({ ...selections, quantity: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Extra revisions</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full px-4 py-3 rounded-xl border border-input bg-background"
                    value={selections.extraRevisions ?? 0}
                    onChange={(e) => runQuote({ ...selections, extraRevisions: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>

                <div className="flex flex-col justify-end gap-3 pt-1">
                  {[
                    ["humanReviewRequested", "Human review add-on"],
                    ["bilingual", "Bilingual delivery"],
                    ["editableSourceFile", "Editable source file"],
                    ["extendedUsageRights", "Extended usage rights"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!(selections as Record<string, unknown>)[key]}
                        onChange={(e) => runQuote({ ...selections, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-24 bg-card border border-card-border rounded-2xl p-6 space-y-6 shadow-sm">
              <h2 className="font-serif text-lg font-medium">Your quote</h2>

              {quote.isPending ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : breakdown ? (
                <div className="space-y-2 text-sm">
                  {breakdown.lineItems.map((li) => (
                    <div key={li.code} className="flex justify-between text-muted-foreground">
                      <span>{li.label}</span>
                      <span>{formatMoney(li.amount, breakdown.currency)}</span>
                    </div>
                  ))}
                  {breakdown.discount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>-{formatMoney(breakdown.discount, breakdown.currency)}</span>
                    </div>
                  )}
                  {breakdown.tax > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax</span>
                      <span>{formatMoney(breakdown.tax, breakdown.currency)}</span>
                    </div>
                  )}
                  <div className="border-t border-border pt-3 flex justify-between font-medium text-base">
                    <span>Total</span>
                    <span>{formatMoney(breakdown.total, breakdown.currency)}</span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => runQuote(selections)}
                  className="w-full px-4 py-3 rounded-xl border border-border hover:bg-muted text-sm font-medium"
                >
                  Calculate price
                </button>
              )}

              <div className="border-t border-border pt-6 space-y-3">
                <input
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
                  placeholder="Your name *"
                  value={contact.customerName}
                  onChange={(e) => setContact({ ...contact, customerName: e.target.value })}
                />
                <input
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
                  placeholder="Email address *"
                  type="email"
                  value={contact.customerEmail}
                  onChange={(e) => setContact({ ...contact, customerEmail: e.target.value })}
                />
                <input
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
                  placeholder="Company (optional)"
                  value={contact.companyName}
                  onChange={(e) => setContact({ ...contact, companyName: e.target.value })}
                />
                <textarea
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm resize-none"
                  rows={3}
                  placeholder="Anything we should know? (optional)"
                  value={contact.notes}
                  onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                />
                <button
                  onClick={onSubmitRequest}
                  disabled={requestService.isPending}
                  className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {requestService.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Request this service
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 space-y-14">
          <LiveAiPreview serviceId={serviceId} />
          {showcase && <PortfolioReviews reviews={showcase.reviews} avgRating={showcase.stats.avgRating} />}
          {showcase && <ServiceFaqSection faqs={showcase.faqs} />}
          {showcase && <RelatedServices services={showcase.relatedServices} />}
        </div>
      </div>
    </Layout>
  );
}
