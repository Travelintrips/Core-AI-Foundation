/**
 * CommercialAutomationPage.tsx — Team 03
 *
 * Admin dashboard for the Creative AI Commercial Automation domain.
 * Tabs: Recommendations | Abandoned Checkouts | Repeat Orders | Funnel | Attribution | Approvals
 *
 * NOTE: Not registered in App.tsx or sidebar yet — Team 24 will do that.
 * This page is self-contained and works standalone for testing.
 */

import { useState } from "react";
import FunnelProjectionPanel from "../../components/creative-commercial/FunnelProjectionPanel";
import AttributionReportPanel from "../../components/creative-commercial/AttributionReportPanel";
import AbandonedCheckoutPanel from "../../components/creative-commercial/AbandonedCheckoutPanel";
import RepeatOrderPanel from "../../components/creative-commercial/RepeatOrderPanel";
import PendingApprovalsPanel from "../../components/creative-commercial/PendingApprovalsPanel";
import BundleCatalogPanel from "../../components/creative-commercial/BundleCatalogPanel";

type Tab =
  | "funnel"
  | "attribution"
  | "abandoned"
  | "repeat"
  | "bundles"
  | "approvals";

const TABS: { id: Tab; label: string }[] = [
  { id: "funnel", label: "Funnel Projection" },
  { id: "attribution", label: "Attribution" },
  { id: "abandoned", label: "Abandoned Checkouts" },
  { id: "repeat", label: "Repeat Orders" },
  { id: "bundles", label: "Bundle Catalog" },
  { id: "approvals", label: "Pending Approvals" },
];

export default function CommercialAutomationPage() {
  const [activeTab, setActiveTab] = useState<Tab>("funnel");

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
            <span className="text-sm font-bold">CA</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">
              Commercial Automation
            </h1>
            <p className="text-xs text-gray-400">
              Package recommendations · Upsell · Cross-sell · Funnel · Attribution
            </p>
          </div>
          <span className="ml-auto rounded-full bg-violet-900/40 px-2.5 py-0.5 text-xs font-medium text-violet-300 ring-1 ring-violet-700/40">
            Team 03
          </span>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-violet-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === "funnel" && <FunnelProjectionPanel />}
        {activeTab === "attribution" && <AttributionReportPanel />}
        {activeTab === "abandoned" && <AbandonedCheckoutPanel />}
        {activeTab === "repeat" && <RepeatOrderPanel />}
        {activeTab === "bundles" && <BundleCatalogPanel />}
        {activeTab === "approvals" && <PendingApprovalsPanel />}
      </div>
    </div>
  );
}
