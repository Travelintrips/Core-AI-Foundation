/**
 * Graphic Design — Brief Wizard
 * Route: /graphic-design/brief/:serviceCode
 *
 * Multi-step brief collection for all 10 services.
 * Submits to POST /api/ai/graphic-design/brief/score for live scoring.
 */

import { useState, useEffect } from "react";
import { useParams, useSearch, Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceCode =
  | "logo" | "business-card" | "letterhead" | "flyer" | "poster"
  | "banner" | "brochure" | "social-media" | "certificate" | "stationery";

interface BriefField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "multiselect" | "number" | "toggle";
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

interface BriefStep {
  title: string;
  description?: string;
  fields: BriefField[];
}

// ── Common steps shared by all services ───────────────────────────────────────

const COMMON_STEPS: BriefStep[] = [
  {
    title: "Brand Identity",
    description: "Tell us about your company and the audience you're designing for.",
    fields: [
      { key: "gdCompanyName",   label: "Company name",      type: "text",     required: true,  placeholder: "e.g. Acme Logistics" },
      { key: "gdIndustry",      label: "Industry",          type: "text",     required: true,  placeholder: "e.g. Logistics & Supply Chain" },
      { key: "gdTargetAudience",label: "Target audience",   type: "textarea", required: true,  placeholder: "Who will see this design?" },
      { key: "gdTagline",       label: "Tagline (optional)",type: "text",     placeholder: "e.g. Moving the World Forward" },
    ],
  },
  {
    title: "Visual Direction",
    description: "Help us nail the look and feel before we start generating.",
    fields: [
      {
        key: "gdStyle", label: "Design style", type: "select", required: true,
        options: ["modern", "classic", "minimalist", "bold", "playful", "corporate"],
      },
      { key: "gdPrimaryColor",   label: "Primary colour (hex)", type: "text", required: true, placeholder: "#1A73E8" },
      { key: "gdSecondaryColor", label: "Secondary colour",     type: "text", placeholder: "#FF5722" },
      { key: "gdAccentColor",    label: "Accent colour",        type: "text", placeholder: "#FFC107" },
      { key: "gdFontPreference", label: "Font preference",      type: "text", placeholder: "e.g. Inter, Playfair Display" },
    ],
  },
];

// ── Per-service extra steps ───────────────────────────────────────────────────

const SERVICE_STEPS: Record<ServiceCode, BriefStep[]> = {
  logo: [
    {
      title: "Logo Concept",
      fields: [
        { key: "gdLogoSymbolIdea", label: "Symbol / icon idea",  type: "textarea", required: true, placeholder: "Describe the concept or metaphor for your logo mark" },
        { key: "gdLogoUsageContext",label: "Where will it appear?",type: "textarea", placeholder: "e.g. website header, vehicle wraps, product packaging" },
        { key: "gdLogoColorCount",  label: "Colour count",        type: "number",   placeholder: "1, 2 or 3" },
        {
          key: "gdLogoVariants", label: "Required variants", type: "multiselect",
          options: ["horizontal", "stacked", "icon"],
        },
        {
          key: "gdLogoFileFormats", label: "Output file formats", type: "multiselect",
          options: ["svg", "png", "eps", "pdf"],
        },
      ],
    },
  ],
  "business-card": [
    {
      title: "Card Details",
      description: "Enter the information that will appear on the front of your card.",
      fields: [
        { key: "gdBcFrontName",    label: "Full name",   type: "text", required: true },
        { key: "gdBcFrontTitle",   label: "Job title",   type: "text", required: true },
        { key: "gdBcFrontEmail",   label: "Email",       type: "text", required: true },
        { key: "gdBcFrontPhone",   label: "Phone",       type: "text", required: true },
        { key: "gdBcFrontWebsite", label: "Website",     type: "text" },
        { key: "gdBcFrontAddress", label: "Address",     type: "textarea" },
        { key: "gdBcBackContent",  label: "Back content (optional)", type: "textarea", placeholder: "Leave blank for solid colour back" },
        { key: "gdBcFinish",       label: "Print finish", type: "select", options: ["matte", "glossy", "silk", "soft-touch"] },
        { key: "gdBcCorners",      label: "Corners",      type: "select", options: ["square", "rounded"] },
      ],
    },
  ],
  letterhead: [
    {
      title: "Letterhead Details",
      fields: [
        { key: "gdLhAddress",      label: "Full address",    type: "textarea", required: true },
        { key: "gdLhPhone",        label: "Phone",           type: "text",     required: true },
        { key: "gdLhEmail",        label: "Email",           type: "text",     required: true },
        { key: "gdLhWebsite",      label: "Website",         type: "text" },
        { key: "gdLhFooterText",   label: "Footer text",     type: "text", placeholder: "Optional footer tagline or registration number" },
        { key: "gdLhHeaderLayout", label: "Header alignment",type: "select", options: ["left", "center", "right"] },
        { key: "gdLhIncludeWatermark", label: "Include watermark", type: "toggle" },
      ],
    },
  ],
  flyer: [
    {
      title: "Flyer Content",
      fields: [
        { key: "gdFlyerHeadline",    label: "Main headline",    type: "text",     required: true },
        { key: "gdFlyerSubheadline", label: "Subheadline",      type: "text" },
        { key: "gdFlyerBodyText",    label: "Body copy",        type: "textarea" },
        { key: "gdFlyerCallToAction",label: "Call to action",   type: "text",     required: true, placeholder: "e.g. Call 0800-1234 · visit acme.com" },
        { key: "gdFlyerEventDate",   label: "Event date",       type: "text",     placeholder: "e.g. 1 August 2026" },
        { key: "gdFlyerEventVenue",  label: "Venue",            type: "text" },
        { key: "gdFlyerSize",        label: "Flyer size",       type: "select",   options: ["a4", "a5", "dl"] },
        { key: "gdFlyerSides",       label: "Sides",            type: "select",   options: ["single", "double"] },
      ],
    },
  ],
  poster: [
    {
      title: "Poster Content",
      fields: [
        { key: "gdPosterHeadline",    label: "Main headline",    type: "text",     required: true },
        { key: "gdPosterSubheadline", label: "Subheadline",      type: "text" },
        { key: "gdPosterBodyText",    label: "Body copy",        type: "textarea" },
        { key: "gdPosterCallToAction",label: "Call to action",   type: "text" },
        { key: "gdPosterSize",        label: "Poster size",      type: "select",   required: true, options: ["a3", "a2", "a1", "b2", "custom"] },
        { key: "gdPosterOrientation", label: "Orientation",      type: "select",   options: ["portrait", "landscape"] },
        { key: "gdPosterImageStyle",  label: "Image style",      type: "select",   options: ["photography", "illustration", "abstract"] },
      ],
    },
  ],
  banner: [
    {
      title: "Banner Specification",
      fields: [
        { key: "gdBannerHeadline",    label: "Headline",         type: "text",     required: true },
        { key: "gdBannerSubheadline", label: "Subheadline",      type: "text" },
        { key: "gdBannerType",        label: "Banner type",      type: "select",   required: true, options: ["rollup", "horizontal", "backdrop", "xbanner"] },
        { key: "gdBannerWidthMm",     label: "Custom width (mm)",type: "number",   placeholder: "850 for standard roll-up" },
        { key: "gdBannerHeightMm",    label: "Custom height (mm)",type: "number",  placeholder: "2000 for standard roll-up" },
        { key: "gdBannerCallToAction",label: "Call to action",   type: "text" },
        { key: "gdBannerVenueContext", label: "Venue / context", type: "text",     placeholder: "e.g. trade show booth, office lobby" },
      ],
    },
  ],
  brochure: [
    {
      title: "Brochure Content",
      fields: [
        { key: "gdBrochureFoldType",    label: "Fold type",       type: "select",   required: true, options: ["trifold", "bifold", "z-fold", "gatefold"] },
        { key: "gdBrochureHeadline",    label: "Cover headline",  type: "text",     required: true },
        { key: "gdBrochurePageCount",   label: "Page count",      type: "number",   placeholder: "6" },
        { key: "gdBrochureCallToAction",label: "Call to action",  type: "text" },
        { key: "gdBrochureContactInfo", label: "Contact details", type: "textarea" },
      ],
    },
  ],
  "social-media": [
    {
      title: "Social Media Kit",
      fields: [
        {
          key: "gdSmPlatforms", label: "Target platforms", type: "multiselect", required: true,
          options: ["instagram", "facebook", "linkedin", "twitter", "tiktok"],
        },
        { key: "gdSmContentTheme",  label: "Content theme",   type: "textarea", required: true, placeholder: "e.g. Product launch campaign with bold imagery" },
        { key: "gdSmPostCaption",   label: "Post caption",    type: "textarea", placeholder: "Example caption for the kit" },
        { key: "gdSmHashtags",      label: "Hashtags",        type: "text",     placeholder: "#YourBrand #Campaign" },
        { key: "gdSmPostCount",     label: "Post variants",   type: "number",   placeholder: "3" },
        { key: "gdSmIncludeStory",  label: "Include story format (1080×1920)", type: "toggle" },
        { key: "gdSmIncludeCover",  label: "Include cover / banner images",    type: "toggle" },
      ],
    },
  ],
  certificate: [
    {
      title: "Certificate Details",
      fields: [
        { key: "gdCertTitle",           label: "Certificate title",    type: "text",     required: true, placeholder: "Certificate of Achievement" },
        { key: "gdCertIssuingOrg",      label: "Issuing organisation", type: "text",     required: true },
        { key: "gdCertBodyText",        label: "Body text",            type: "textarea", required: true, placeholder: "This certifies that {name} has successfully…" },
        { key: "gdCertRecipientLabel",  label: "Recipient label",      type: "text",     placeholder: "This certifies that" },
        { key: "gdCertSignatoryName",   label: "Signatory name",       type: "text" },
        { key: "gdCertSignatoryTitle",  label: "Signatory title",      type: "text" },
        { key: "gdCertSignature2Name",  label: "2nd signatory name",   type: "text" },
        { key: "gdCertBorderStyle",     label: "Border style",         type: "select",   options: ["classic", "modern", "minimal", "ornate"] },
        { key: "gdCertOrientation",     label: "Orientation",          type: "select",   options: ["landscape", "portrait"] },
        { key: "gdCertSeal",            label: "Include official seal",type: "toggle" },
      ],
    },
  ],
  stationery: [
    {
      title: "Stationery Set",
      fields: [
        {
          key: "gdStItems", label: "Items to include", type: "multiselect", required: true,
          options: ["letterhead", "business-card", "envelope", "with-compliments", "notepad"],
        },
        { key: "gdStAddress",           label: "Full address",    type: "textarea", required: true },
        { key: "gdStPhone",             label: "Phone",           type: "text" },
        { key: "gdStEmail",             label: "Email",           type: "text",     required: true },
        { key: "gdStWebsite",           label: "Website",         type: "text" },
        { key: "gdStEnvelopeSize",      label: "Envelope size",   type: "select",   options: ["dl", "c4", "c5"] },
        { key: "gdStConsistencyLevel",  label: "Consistency",     type: "select",   options: ["exact", "coordinated"] },
      ],
    },
  ],
};

const SERVICE_LABELS: Record<ServiceCode, string> = {
  "logo": "Logo Concept", "business-card": "Business Card", "letterhead": "Letterhead",
  "flyer": "Flyer", "poster": "Poster", "banner": "Banner", "brochure": "Brochure",
  "social-media": "Social Media Kit", "certificate": "Certificate", "stationery": "Stationery Set",
};

// ── Brief wizard component ────────────────────────────────────────────────────

export default function GraphicDesignBrief() {
  const params = useParams<{ serviceCode: string }>();
  const search = useSearch();
  const serviceCode = (params.serviceCode ?? "logo") as ServiceCode;
  const tier = new URLSearchParams(search).get("tier") ?? "professional";

  const allSteps = [...COMMON_STEPS, ...(SERVICE_STEPS[serviceCode] ?? [])];
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [score, setScore] = useState<null | { overallScore: number; readinessStatus: string; warnings: string[] }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const BASE_URL = (import.meta as Record<string, unknown>)["env"] 
    ? (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL 
    : "/";

  const currentStep = allSteps[step];
  const isLastStep = step === allSteps.length - 1;

  function updateField(key: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function checkScore() {
    try {
      const res = await fetch(`${BASE_URL}api/ai/graphic-design/brief/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceCode, briefJson: { ...formData, gdServiceCode: serviceCode, gdPackageTier: tier } }),
      });
      if (res.ok) setScore(await res.json());
    } catch {}
  }

  async function handleSubmit() {
    setSubmitting(true);
    await checkScore();
    setSubmitting(false);
    setSubmitted(true);
  }

  useEffect(() => {
    if (step > 0) checkScore();
  }, [step]);

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="max-w-md w-full text-center p-8">
          <div className="text-5xl mb-4">✓</div>
          <h2 className="text-2xl font-bold text-white mb-2">Brief submitted</h2>
          {score && (
            <p className={`text-sm mb-4 ${score.readinessStatus === "ready" ? "text-green-400" : "text-amber-400"}`}>
              Readiness score: {score.overallScore}/100 — {score.readinessStatus.replace("_", " ")}
            </p>
          )}
          <p className="text-gray-400 text-sm mb-8">
            Our team will review your {SERVICE_LABELS[serviceCode]} brief and begin production shortly.
          </p>
          <Link href="/graphic-design">
            <button className="px-6 py-2.5 bg-indigo-600 rounded-lg text-white text-sm font-medium hover:bg-indigo-500 transition-colors">
              Order another service
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/60 backdrop-blur">
        <div className="mx-auto max-w-2xl px-6 py-5 flex items-center justify-between">
          <div>
            <Link href="/graphic-design" className="text-xs text-gray-500 hover:text-gray-300">
              ← Graphic Design
            </Link>
            <h1 className="mt-1 text-lg font-bold text-white">{SERVICE_LABELS[serviceCode]}</h1>
            <p className="text-xs text-indigo-400 capitalize">{tier} package</p>
          </div>
          {score && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Brief score</p>
              <p className={`text-lg font-bold ${score.overallScore >= 60 ? "text-green-400" : "text-amber-400"}`}>
                {score.overallScore}<span className="text-xs text-gray-500">/100</span>
              </p>
            </div>
          )}
        </div>

        {/* Step progress */}
        <div className="mx-auto max-w-2xl px-6 pb-4 flex gap-1.5">
          {allSteps.map((s, i) => (
            <div
              key={i}
              className={[
                "flex-1 h-1 rounded-full transition-all",
                i < step ? "bg-indigo-500" : i === step ? "bg-indigo-400" : "bg-gray-700",
              ].join(" ")}
            />
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white">{currentStep.title}</h2>
          {currentStep.description && (
            <p className="mt-1 text-sm text-gray-400">{currentStep.description}</p>
          )}
        </div>

        <div className="space-y-5">
          {currentStep.fields.map((field) => (
            <BriefFieldInput
              key={field.key}
              field={field}
              value={formData[field.key]}
              onChange={(v) => updateField(field.key, v)}
            />
          ))}
        </div>

        {/* Warnings */}
        {score?.warnings && score.warnings.length > 0 && (
          <div className="mt-6 rounded-lg border border-amber-800/40 bg-amber-900/10 p-4">
            <p className="text-xs font-semibold text-amber-400 mb-2">Suggestions</p>
            <ul className="space-y-1">
              {score.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-300/80">• {w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Nav buttons */}
        <div className="mt-8 flex justify-between">
          {step > 0 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="px-5 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {isLastStep ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2.5 bg-indigo-600 rounded-lg text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Scoring…" : "Submit brief"}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-6 py-2.5 bg-indigo-600 rounded-lg text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Field renderer ────────────────────────────────────────────────────────────

function BriefFieldInput({
  field,
  value,
  onChange,
}: {
  field: BriefField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const base =
    "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 transition-colors";

  return (
    <div>
      <label className="block text-xs font-medium text-gray-300 mb-1.5">
        {field.label}
        {field.required && <span className="ml-1 text-indigo-400">*</span>}
      </label>

      {field.type === "textarea" && (
        <textarea
          className={`${base} resize-none`}
          rows={3}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {(field.type === "text" || field.type === "number") && (
        <input
          type={field.type}
          className={base}
          placeholder={field.placeholder}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) =>
            onChange(field.type === "number" ? Number(e.target.value) : e.target.value)
          }
        />
      )}

      {field.type === "select" && (
        <select
          className={`${base} cursor-pointer`}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select —</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/-/g, " ")}
            </option>
          ))}
        </select>
      )}

      {field.type === "multiselect" && (
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const selected = Array.isArray(value) && (value as string[]).includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const current = Array.isArray(value) ? (value as string[]) : [];
                  onChange(selected ? current.filter((v) => v !== opt) : [...current, opt]);
                }}
                className={[
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  selected
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700",
                ].join(" ")}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/-/g, " ")}
              </button>
            );
          })}
        </div>
      )}

      {field.type === "toggle" && (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={[
            "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors",
            value
              ? "bg-indigo-600 border-indigo-500 text-white"
              : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700",
          ].join(" ")}
        >
          <span className={`w-4 h-4 rounded-full border-2 ${value ? "bg-white border-white" : "border-gray-500"}`} />
          {value ? "Yes" : "No"}
        </button>
      )}
    </div>
  );
}
