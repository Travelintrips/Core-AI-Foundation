/**
 * Graphic Design — Customer Service Catalogue
 * Route: /graphic-design
 *
 * Lists all 10 Graphic Design services with package tier selection.
 * Clicking a service opens the brief wizard.
 */

import { useState } from "react";
import { Link } from "wouter";

// ── Service metadata ──────────────────────────────────────────────────────────

interface GdService {
  code: string;
  label: string;
  description: string;
  digitalOnly: boolean;
  icon: string;
  popular?: boolean;
}

const SERVICES: GdService[] = [
  {
    code: "logo",
    label: "Logo Concept",
    description: "Distinctive brand mark in SVG, PNG, and all key variants — horizontal, icon, white, black.",
    digitalOnly: true,
    icon: "✦",
    popular: true,
  },
  {
    code: "business-card",
    label: "Business Card",
    description: "Print-ready CMYK PDF at 88.9 × 50.8 mm with full bleed. Front and back layouts.",
    digitalOnly: false,
    icon: "▭",
  },
  {
    code: "letterhead",
    label: "Letterhead",
    description: "A4 letterhead PDF + editable .docx. Professional header, footer, and contact block.",
    digitalOnly: false,
    icon: "☰",
  },
  {
    code: "flyer",
    label: "Flyer",
    description: "A4 / A5 single or double-sided flyer with headline, hero visual, and call-to-action.",
    digitalOnly: false,
    icon: "⬡",
  },
  {
    code: "poster",
    label: "Poster",
    description: "A2 / A3 print-ready poster plus high-res digital JPG for online distribution.",
    digitalOnly: false,
    icon: "◻",
    popular: true,
  },
  {
    code: "banner",
    label: "Banner",
    description: "Roll-up (850 × 2000 mm) and horizontal banner PDFs. Custom dimensions supported.",
    digitalOnly: false,
    icon: "▬",
  },
  {
    code: "brochure",
    label: "Brochure",
    description: "Trifold / bifold / z-fold brochure with print PDF and screen-optimised digital version.",
    digitalOnly: false,
    icon: "⊞",
  },
  {
    code: "social-media",
    label: "Social Media Kit",
    description: "Platform-sized assets for Instagram, Facebook, LinkedIn, Twitter — posts, stories, covers.",
    digitalOnly: true,
    icon: "◉",
    popular: true,
  },
  {
    code: "certificate",
    label: "Certificate",
    description: "Landscape A4 certificate with ornamental border, seal, and fillable blank version.",
    digitalOnly: false,
    icon: "⊛",
  },
  {
    code: "stationery",
    label: "Stationery Set",
    description: "Coordinated letterhead, business card, DL envelope, and with-compliments slip.",
    digitalOnly: false,
    icon: "⊟",
  },
];

const TIERS = [
  {
    id: "starter",
    label: "Starter",
    tagline: "1 revision · 5-day SLA",
    color: "from-slate-700 to-slate-600",
  },
  {
    id: "professional",
    label: "Professional",
    tagline: "3 revisions · 3-day SLA · Brand DNA",
    color: "from-indigo-700 to-indigo-600",
    highlighted: true,
  },
  {
    id: "business",
    label: "Business",
    tagline: "5 revisions · 2-day SLA · Source files",
    color: "from-purple-700 to-purple-600",
  },
  {
    id: "enterprise",
    label: "Enterprise",
    tagline: "Unlimited revisions · 1-day SLA",
    color: "from-amber-700 to-amber-600",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function GraphicDesignCatalogue() {
  const [selectedTier, setSelectedTier] = useState("professional");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/60 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-indigo-400 mb-2">Creative Studio</p>
              <h1 className="text-3xl font-bold text-white">Graphic Design</h1>
              <p className="mt-2 text-gray-400 text-sm max-w-xl">
                Professional print and digital design — delivered in your brand's DNA.
                Select a service and package, then complete the brief.
              </p>
            </div>
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              ← Back to home
            </Link>
          </div>

          {/* Package tier selector */}
          <div className="mt-6 flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setSelectedTier(tier.id)}
                className={[
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                  selectedTier === tier.id
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700",
                ].join(" ")}
              >
                <span>{tier.label}</span>
                <span className="ml-2 text-xs opacity-70 hidden sm:inline">{tier.tagline}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Service grid */}
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((svc) => (
            <Link
              key={svc.code}
              href={`/graphic-design/brief/${svc.code}?tier=${selectedTier}`}
            >
              <div
                className={[
                  "group relative rounded-xl border p-5 cursor-pointer transition-all duration-200",
                  "bg-gray-900 hover:bg-gray-800 border-gray-800 hover:border-indigo-600/50",
                  "hover:shadow-lg hover:shadow-indigo-900/20",
                ].join(" ")}
              >
                {svc.popular && (
                  <span className="absolute top-3 right-3 text-[10px] uppercase tracking-widest font-semibold text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded-full">
                    Popular
                  </span>
                )}

                <div className="text-2xl mb-3 text-indigo-400 group-hover:text-indigo-300 transition-colors">
                  {svc.icon}
                </div>

                <h3 className="font-semibold text-white text-sm mb-1">{svc.label}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{svc.description}</p>

                <div className="mt-4 flex items-center justify-between">
                  <span
                    className={[
                      "text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded",
                      svc.digitalOnly
                        ? "bg-sky-900/40 text-sky-400"
                        : "bg-orange-900/40 text-orange-400",
                    ].join(" ")}
                  >
                    {svc.digitalOnly ? "Digital" : "Print + Digital"}
                  </span>
                  <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    Start brief →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Tier feature comparison (compact) */}
        <div className="mt-12 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-white">Package Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-6 py-3 text-gray-500 font-medium">Feature</th>
                  {TIERS.map((t) => (
                    <th
                      key={t.id}
                      className={[
                        "px-4 py-3 text-center font-semibold",
                        selectedTier === t.id ? "text-indigo-300" : "text-gray-400",
                      ].join(" ")}
                    >
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Revisions", "1", "3", "5", "Unlimited"],
                  ["SLA", "5 days", "3 days", "2 days", "1 day"],
                  ["Brand DNA", "—", "✓", "✓", "✓"],
                  ["Source files (.ai / .eps)", "—", "—", "✓", "✓"],
                  ["Human QC sign-off", "—", "—", "✓", "✓"],
                  ["Priority dispatch", "Low", "Medium", "High", "Urgent"],
                ].map(([label, ...vals]) => (
                  <tr key={label} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-6 py-3 text-gray-400">{label}</td>
                    {vals.map((v, i) => (
                      <td
                        key={i}
                        className={[
                          "px-4 py-3 text-center",
                          selectedTier === TIERS[i].id ? "text-white font-medium" : "text-gray-500",
                        ].join(" ")}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
