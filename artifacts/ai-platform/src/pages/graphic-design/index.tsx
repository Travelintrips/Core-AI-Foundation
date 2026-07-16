/**
 * Graphic Design — Admin Overview
 * Route: /admin/graphic-design
 *
 * Admin dashboard: service catalogue metadata, QC thresholds,
 * package policies, and print spec reference.
 */

import { useState, useEffect } from "react";

type ServiceCode =
  | "logo" | "business-card" | "letterhead" | "flyer" | "poster"
  | "banner" | "brochure" | "social-media" | "certificate" | "stationery";

interface ServiceInfo {
  code: ServiceCode;
  blueprint: { engineTeam: number; jobType: string; promptTemplate: string };
  printSpec: {
    widthMm: number; heightMm: number; bleedMm: number; safeAreaMm: number;
    resolutionDpi: number; colorMode: string; digitalOnly: boolean;
  };
}

const ENGINE_LABELS: Record<number, string> = {
  9: "Image Gen (T9)", 10: "Template Engine (T10)", 11: "PDF Export (T11)",
};

const SERVICE_ICONS: Record<ServiceCode, string> = {
  logo: "✦", "business-card": "▭", letterhead: "☰", flyer: "⬡", poster: "◻",
  banner: "▬", brochure: "⊞", "social-media": "◉", certificate: "⊛", stationery: "⊟",
};

export default function GraphicDesignAdmin() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ServiceCode | null>(null);

  const BASE_URL = (import.meta as Record<string, unknown>)["env"]
    ? (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL
    : "/admin/";

  useEffect(() => {
    const apiBase = BASE_URL.replace(/\/$/, "").replace("/admin", "");
    fetch(`${apiBase}/api/ai/graphic-design/services`, {
      headers: {
        "x-admin-api-key": (import.meta as unknown as { env: Record<string, string> }).env
          ?.VITE_ADMIN_API_KEY ?? "",
      },
    })
      .then((r) => r.json())
      .then((d) => { setServices(d.services ?? []); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  const selectedService = services.find((s) => s.code === selected);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/60">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-indigo-400 mb-1">Admin · Graphic Design</p>
            <h1 className="text-xl font-bold text-white">Service Catalogue & Blueprint Registry</h1>
            <p className="text-xs text-gray-500 mt-0.5">Team 15 domain — port interfaces to Teams 7–14</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
              QC threshold: 65/100
            </span>
            <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
              10 services registered
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 flex gap-6">
        {/* Left: Service list */}
        <div className="w-72 shrink-0">
          <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-3">Services</h2>

          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-gray-800 animate-pulse" />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4 text-xs text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-1.5">
              {services.map((svc) => (
                <button
                  key={svc.code}
                  onClick={() => setSelected(svc.code)}
                  className={[
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
                    selected === svc.code
                      ? "bg-indigo-600/20 border border-indigo-600/50 text-white"
                      : "bg-gray-800/50 border border-gray-800 text-gray-300 hover:bg-gray-800",
                  ].join(" ")}
                >
                  <span className="text-indigo-400 text-base">{SERVICE_ICONS[svc.code]}</span>
                  <div>
                    <p className="font-medium capitalize">{svc.code.replace(/-/g, " ")}</p>
                    <p className="text-[10px] text-gray-500">
                      {svc.printSpec.digitalOnly ? "Digital" : `${svc.printSpec.colorMode.toUpperCase()} · ${svc.printSpec.resolutionDpi}dpi`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Detail panel */}
        <div className="flex-1 min-w-0">
          {!selectedService ? (
            <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
              Select a service to view its blueprint and print specification
            </div>
          ) : (
            <ServiceDetailPanel service={selectedService} />
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceDetailPanel({ service }: { service: ServiceInfo }) {
  const spec = service.printSpec;

  return (
    <div className="space-y-5">
      {/* Blueprint */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Blueprint</h3>
          <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2.5 py-1 rounded-full">
            {ENGINE_LABELS[service.blueprint.engineTeam] ?? `Team ${service.blueprint.engineTeam}`}
          </span>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-1">Job type</p>
            <code className="text-indigo-300 text-xs bg-gray-800 px-2 py-1 rounded">
              {service.blueprint.jobType}
            </code>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Prompt template</p>
            <code className="text-green-300 text-xs bg-gray-800 px-2 py-1 rounded">
              {service.blueprint.promptTemplate}
            </code>
          </div>
        </div>
      </div>

      {/* Print specification */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Print Specification</h3>
          <span className={[
            "text-xs px-2.5 py-1 rounded-full",
            spec.digitalOnly ? "text-sky-400 bg-sky-900/30" : "text-orange-400 bg-orange-900/30",
          ].join(" ")}>
            {spec.digitalOnly ? "Digital only" : "Print + Digital"}
          </span>
        </div>
        <div className="p-5">
          {spec.digitalOnly ? (
            <p className="text-sm text-gray-400">No print dimensions — digital file output only.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {[
                ["Width", `${spec.widthMm} mm`],
                ["Height", `${spec.heightMm} mm`],
                ["Bleed", `${spec.bleedMm} mm`],
                ["Safe area", `${spec.safeAreaMm} mm`],
                ["Resolution", `${spec.resolutionDpi} DPI`],
                ["Colour mode", spec.colorMode.toUpperCase()],
              ].map(([label, val]) => (
                <div key={label} className="bg-gray-800 rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</p>
                  <p className="text-sm font-semibold text-white">{val}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Port interface legend */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Port Interfaces (Teams 7–14)</h3>
        </div>
        <div className="p-5 grid grid-cols-2 gap-2 text-xs">
          {[
            [7,  "Brand DNA",          "BrandDnaContext"],
            [8,  "Asset Intelligence", "AssetIntelligenceResult"],
            [9,  "Image Generation",   "ImageGenerationJob"],
            [10, "Template Engine",    "TemplateRenderRequest"],
            [11, "PDF Export",         "PdfExportJob"],
            [12, "ZIP Delivery",       "ZipManifest"],
            [13, "QC Orchestration",   "QcRunResult"],
            [14, "Job Dispatch",       "JobDispatchRequest"],
          ].map(([team, role, contract]) => (
            <div key={String(team)} className={[
              "flex items-start gap-2 p-2.5 rounded-lg bg-gray-800/50",
              service.blueprint.engineTeam === Number(team) ? "ring-1 ring-indigo-500/40" : "",
            ].join(" ")}>
              <span className="text-indigo-400 font-bold shrink-0">T{team}</span>
              <div>
                <p className="text-gray-300">{role}</p>
                <code className="text-[10px] text-gray-500">{contract}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
