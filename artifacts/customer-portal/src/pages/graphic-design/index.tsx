/**
 * artifacts/customer-portal/src/pages/graphic-design/index.tsx — Team 15
 *
 * Customer-facing Graphic Design service request page.
 * Allows customers to browse the 10 services, select a package tier,
 * fill in a brief, and submit for production.
 *
 * Route: /graphic-design (public, no auth required for browsing;
 *        brief submission uses the public catalog request flow).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceSummary {
  serviceCode: string;
  serviceName: string;
  basePriceIdr: number;
  packages: {
    basic:    PackageSummary;
    standard: PackageSummary;
    premium:  PackageSummary;
  };
}

interface PackageSummary {
  tier:              string;
  label:             string;
  conceptVariants:   number;
  revisionRounds:    number;
  deliveryDays:      number;
  includesSourceFiles: boolean;
  rushEligible:      boolean;
  description:       string;
  price:             number;
}

type PackageTier = "basic" | "standard" | "premium";

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_ICONS: Record<string, string> = {
  "GD-LOGO":       "✦",
  "GD-BCARD":      "🪪",
  "GD-LTRHEAD":    "📄",
  "GD-FLYER":      "📰",
  "GD-POSTER":     "🖼️",
  "GD-BANNER":     "🎌",
  "GD-BROCHURE":   "📋",
  "GD-SOCIAL":     "📱",
  "GD-CERT":       "🏆",
  "GD-STATIONERY": "🗂️",
};

const TIER_COLORS: Record<PackageTier, string> = {
  basic:    "border-gray-300 bg-gray-50",
  standard: "border-blue-400 bg-blue-50 ring-2 ring-blue-400",
  premium:  "border-purple-400 bg-purple-50",
};

const TIER_BADGE: Record<PackageTier, string> = {
  basic:    "bg-gray-200 text-gray-700",
  standard: "bg-blue-100 text-blue-800",
  premium:  "bg-purple-100 text-purple-800",
};

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL ?? "/";

function apiUrl(path: string): string {
  return `${BASE}api${path}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function formatIdr(amount: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}

// ── Components ────────────────────────────────────────────────────────────────

function PackageCard({ pkg, selected, onSelect }: {
  pkg: PackageSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${TIER_COLORS[pkg.tier as PackageTier]} ${selected ? "shadow-lg scale-[1.02]" : "hover:shadow-md"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TIER_BADGE[pkg.tier as PackageTier]}`}>
          {pkg.label}
        </span>
        {pkg.tier === "standard" && (
          <span className="text-xs text-blue-600 font-semibold">Most Popular</span>
        )}
      </div>
      <div className="text-xl font-bold text-gray-900 mb-1">{formatIdr(pkg.price)}</div>
      <p className="text-xs text-gray-600 mb-3 leading-snug">{pkg.description}</p>
      <ul className="space-y-1 text-xs text-gray-700">
        <li>✓ {pkg.conceptVariants} concept{pkg.conceptVariants > 1 ? "s" : ""}</li>
        <li>✓ {pkg.revisionRounds === -1 ? "Unlimited" : pkg.revisionRounds} revision rounds</li>
        <li>✓ {pkg.deliveryDays}-day delivery</li>
        {pkg.includesSourceFiles && <li>✓ Source files (AI/PSD)</li>}
        {pkg.rushEligible && <li>✓ Rush delivery available</li>}
      </ul>
    </button>
  );
}

function ServiceCard({ service, onSelect }: {
  service: ServiceSummary;
  onSelect: (s: ServiceSummary) => void;
}) {
  return (
    <button
      onClick={() => onSelect(service)}
      className="text-left p-5 rounded-2xl border border-gray-200 bg-white hover:border-blue-300 hover:shadow-md transition-all group"
    >
      <div className="text-3xl mb-3">{SERVICE_ICONS[service.serviceCode] ?? "🎨"}</div>
      <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 mb-1">{service.serviceName}</h3>
      <p className="text-xs text-gray-500">
        from {formatIdr(service.packages.basic.price)}
      </p>
    </button>
  );
}

// ── Brief form ────────────────────────────────────────────────────────────────

function BriefForm({ service, tier, onBack, onSubmit }: {
  service: ServiceSummary;
  tier: PackageTier;
  onBack: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    clientName:     "",
    brandName:      "",
    industry:       "",
    targetAudience: "",
    stylePreference: "modern",
    primaryColor:   "#003DA5",
    notes:          "",
    urgencyLevel:   "standard",
    language:       "id",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      serviceCode:     service.serviceCode,
      clientName:      form.clientName,
      brandName:       form.brandName,
      industry:        form.industry,
      targetAudience:  form.targetAudience,
      stylePreference: form.stylePreference,
      colorPalette:    [form.primaryColor],
      notes:           form.notes || undefined,
      urgencyLevel:    form.urgencyLevel,
      language:        form.language,
      packageTier:     tier,
      outputFormat:    "both",
      printQuantity:   0,
      referenceUrls:   [],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your Name / Company *</label>
          <input name="clientName" value={form.clientName} onChange={handleChange} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="PT Maju Bersama" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name *</label>
          <input name="brandName" value={form.brandName} onChange={handleChange} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="MajuBrand" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Industry *</label>
          <input name="industry" value={form.industry} onChange={handleChange} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Manufacturing, F&B, Retail…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience *</label>
          <input name="targetAudience" value={form.targetAudience} onChange={handleChange} required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="B2B managers, retail consumers 25–45…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Style *</label>
          <select name="stylePreference" value={form.stylePreference} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
            {["modern","classic","minimalist","bold","elegant","playful","corporate","vintage","futuristic"].map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Primary Brand Color</label>
          <div className="flex items-center gap-2">
            <input type="color" name="primaryColor" value={form.primaryColor} onChange={handleChange}
              className="w-10 h-10 border border-gray-300 rounded cursor-pointer" />
            <span className="text-sm text-gray-500 font-mono">{form.primaryColor}</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Urgency</label>
          <select name="urgencyLevel" value={form.urgencyLevel} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
            <option value="standard">Standard ({service.packages[tier].deliveryDays} days)</option>
            <option value="rush">Rush (faster, +50% fee)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <select name="language" value={form.language} onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
            <option value="both">Bilingual (ID + EN)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes / Reference Links</label>
        <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Describe your vision, competitor references, must-avoid elements…" />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
          className="px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
          ← Back
        </button>
        <button type="submit"
          className="flex-1 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors">
          Submit Brief — {formatIdr(service.packages[tier].price)}
        </button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Step = "browse" | "select-tier" | "fill-brief" | "submitted";

export default function GraphicDesignPage() {
  const [step, setStep] = useState<Step>("browse");
  const [selectedService, setSelectedService] = useState<ServiceSummary | null>(null);
  const [selectedTier, setSelectedTier] = useState<PackageTier>("standard");
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ services: ServiceSummary[]; total: number }>({
    queryKey: ["gd-services"],
    queryFn: () => fetchJson(apiUrl("/ai/graphic-design/services")),
  });

  const submitMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(apiUrl("/ai/graphic-design/briefs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: (result) => {
      setSubmittedId(result.briefId);
      setStep("submitted");
    },
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-6 mb-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl">🎨</span>
            <h1 className="text-2xl font-bold text-gray-900">Graphic Design AI</h1>
          </div>
          <p className="text-gray-500 text-sm">
            Professional print and digital design — AI-generated, brand-consistent, print-ready.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pb-16">

        {/* Step: Browse services */}
        {step === "browse" && (
          <>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Choose a Service</h2>
            {isLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl bg-gray-200 animate-pulse" />
                ))}
              </div>
            )}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                Could not load services. Please try again.
              </div>
            )}
            {data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.services.map((svc) => (
                  <ServiceCard key={svc.serviceCode} service={svc} onSelect={(s) => {
                    setSelectedService(s);
                    setStep("select-tier");
                  }} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Step: Select package tier */}
        {step === "select-tier" && selectedService && (
          <>
            <button onClick={() => setStep("browse")}
              className="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1">
              ← All Services
            </button>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl">{SERVICE_ICONS[selectedService.serviceCode]}</span>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedService.serviceName}</h2>
                <p className="text-sm text-gray-500">Choose your package</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {(["basic", "standard", "premium"] as PackageTier[]).map((tier) => (
                <PackageCard
                  key={tier}
                  pkg={selectedService.packages[tier]}
                  selected={selectedTier === tier}
                  onSelect={() => setSelectedTier(tier)}
                />
              ))}
            </div>
            <button
              onClick={() => setStep("fill-brief")}
              className="w-full sm:w-auto px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
              Continue with {selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)} →
            </button>
          </>
        )}

        {/* Step: Fill brief */}
        {step === "fill-brief" && selectedService && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl">{SERVICE_ICONS[selectedService.serviceCode]}</span>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedService.serviceName}</h2>
                <p className="text-sm text-gray-500">
                  {selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)} package — {formatIdr(selectedService.packages[selectedTier].price)}
                </p>
              </div>
            </div>

            {submitMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {submitMutation.error.message}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <BriefForm
                service={selectedService}
                tier={selectedTier}
                onBack={() => setStep("select-tier")}
                onSubmit={(data) => submitMutation.mutate(data)}
              />
            </div>
          </>
        )}

        {/* Step: Submitted */}
        {step === "submitted" && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Brief Submitted!</h2>
            <p className="text-gray-500 mb-2">Your reference number:</p>
            <code className="text-sm bg-gray-100 px-3 py-1 rounded font-mono text-gray-800">{submittedId}</code>
            <p className="text-sm text-gray-500 mt-4 max-w-sm mx-auto">
              Our team will review your brief and start production once approved.
              You'll receive updates via email.
            </p>
            <button
              onClick={() => { setStep("browse"); setSelectedService(null); setSubmittedId(null); }}
              className="mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">
              Order Another Service
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
