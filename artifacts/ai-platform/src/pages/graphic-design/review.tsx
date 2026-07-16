/**
 * Graphic Design — Admin QC Review Panel
 * Route: /admin/graphic-design/review
 *
 * Lets admin staff score a generation report and view the deliverable manifest.
 */

import { useState } from "react";

type ServiceCode =
  | "logo" | "business-card" | "letterhead" | "flyer" | "poster"
  | "banner" | "brochure" | "social-media" | "certificate" | "stationery";

type PackageTier = "starter" | "professional" | "business" | "enterprise";

interface QcDimensions {
  briefCompleteness: number;
  printSpecValid: number;
  textFitting: number;
  bleedSafeArea: number;
  deliverableCount: number;
}

interface QcResult {
  qcScore: number;
  passed: boolean;
  threshold: number;
  dimensions: QcDimensions;
  warnings: string[];
  serviceCode: ServiceCode;
  packageTier: PackageTier;
}

const DIMENSION_LABELS: Record<keyof QcDimensions, string> = {
  briefCompleteness: "Brief Completeness (25%)",
  printSpecValid:    "Print Spec Valid (30%)",
  textFitting:       "Text Fitting (25%)",
  bleedSafeArea:     "Bleed & Safe Area (10%)",
  deliverableCount:  "Deliverable Count (10%)",
};

const SERVICE_CODES: ServiceCode[] = [
  "logo", "business-card", "letterhead", "flyer", "poster",
  "banner", "brochure", "social-media", "certificate", "stationery",
];

const TIERS: PackageTier[] = ["starter", "professional", "business", "enterprise"];

// ── Placeholder generation report for demo ────────────────────────────────────

function makeSampleReport(serviceCode: ServiceCode) {
  const isDigital = ["logo", "social-media"].includes(serviceCode);
  return {
    actualWidthMm:             isDigital ? null : 95.25,
    actualHeightMm:            isDigital ? null : 57.15,
    actualBleedMm:             isDigital ? null : 3.175,
    actualSafeAreaMm:          isDigital ? null : 3.175,
    actualDpi:                 isDigital ? null : 300,
    actualColorMode:           isDigital ? null : "cmyk",
    textOverflowRatio:         0,
    overflowingTextElements:   [],
    producedFiles:             ["primary.pdf", "preview.png", "manifest.json", "qc-report.json"],
    satisfiedBriefFields:      ["gdCompanyName","gdIndustry","gdStyle","gdPrimaryColor"],
    totalRequiredBriefFields:  6,
  };
}

export default function GraphicDesignReview() {
  const [serviceCode, setServiceCode] = useState<ServiceCode>("business-card");
  const [packageTier, setPackageTier] = useState<PackageTier>("professional");
  const [reportJson, setReportJson] = useState<string>(
    () => JSON.stringify(makeSampleReport("business-card"), null, 2),
  );
  const [result, setResult] = useState<QcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const BASE_URL = (import.meta as Record<string, unknown>)["env"]
    ? (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL
    : "/admin/";

  function updateService(code: ServiceCode) {
    setServiceCode(code);
    setReportJson(JSON.stringify(makeSampleReport(code), null, 2));
    setResult(null);
  }

  async function runQc() {
    setLoading(true);
    setError(null);
    try {
      let report: unknown;
      try { report = JSON.parse(reportJson); }
      catch { setError("Invalid JSON in generation report"); setLoading(false); return; }

      const apiBase = BASE_URL.replace(/\/$/, "").replace("/admin", "");
      const res = await fetch(`${apiBase}/api/ai/graphic-design/qc/score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-api-key": (import.meta as unknown as { env: Record<string, string> }).env
            ?.VITE_ADMIN_API_KEY ?? "",
        },
        body: JSON.stringify({ generationReport: report, serviceCode, packageTier }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        setError(e.error ?? "Request failed");
      } else {
        setResult(await res.json());
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/60">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <p className="text-xs uppercase tracking-widest text-indigo-400 mb-1">Admin · Graphic Design</p>
          <h1 className="text-xl font-bold text-white">QC Review Panel</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Score a generation report. Pass threshold: 65/100.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 grid grid-cols-2 gap-6">
        {/* Left: Inputs */}
        <div className="space-y-5">
          {/* Service + tier selectors */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Job parameters</h3>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Service</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                value={serviceCode}
                onChange={(e) => updateService(e.target.value as ServiceCode)}
              >
                {SERVICE_CODES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">Package tier</label>
              <div className="flex gap-2">
                {TIERS.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setPackageTier(t); setResult(null); }}
                    className={[
                      "flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      packageTier === t
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700",
                    ].join(" ")}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generation report editor */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Generation Report (JSON)</h3>
              <button
                onClick={() => setReportJson(JSON.stringify(makeSampleReport(serviceCode), null, 2))}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Reset to sample
              </button>
            </div>
            <textarea
              className="w-full bg-gray-950 text-green-300 font-mono text-xs p-4 resize-none focus:outline-none"
              rows={20}
              value={reportJson}
              onChange={(e) => setReportJson(e.target.value)}
              spellCheck={false}
            />
          </div>

          <button
            onClick={runQc}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
          >
            {loading ? "Scoring…" : "Run QC Score"}
          </button>

          {error && (
            <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div>
          {!result ? (
            <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
              Run QC to see results
            </div>
          ) : (
            <div className="space-y-4">
              {/* Score banner */}
              <div className={[
                "rounded-xl border p-6 text-center",
                result.passed
                  ? "border-green-700/40 bg-green-900/10"
                  : "border-red-700/40 bg-red-900/10",
              ].join(" ")}>
                <p className={`text-5xl font-bold ${result.passed ? "text-green-400" : "text-red-400"}`}>
                  {result.qcScore}
                  <span className="text-xl text-gray-500">/100</span>
                </p>
                <p className={`mt-2 text-sm font-semibold ${result.passed ? "text-green-400" : "text-red-400"}`}>
                  {result.passed ? "✓ PASSED" : "✗ FAILED"}
                </p>
                <p className="text-xs text-gray-500 mt-1">threshold: {result.threshold}</p>
              </div>

              {/* Dimension breakdown */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-800">
                  <h3 className="text-sm font-semibold text-white">Dimension Breakdown</h3>
                </div>
                <div className="p-5 space-y-3">
                  {(Object.entries(result.dimensions) as [keyof QcDimensions, number][]).map(([dim, score]) => (
                    <div key={dim}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{DIMENSION_LABELS[dim]}</span>
                        <span className={`font-semibold ${score >= 65 ? "text-green-400" : score >= 40 ? "text-amber-400" : "text-red-400"}`}>
                          {typeof score === "boolean" ? (score ? "✓" : "✗") : score}
                        </span>
                      </div>
                      {typeof score === "number" && (
                        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${score >= 65 ? "bg-green-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-800/40 bg-amber-900/10 p-4">
                  <p className="text-xs font-semibold text-amber-400 mb-2">Warnings ({result.warnings.length})</p>
                  <ul className="space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-300/80">• {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
