import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import { InternalAuthProvider } from "@/hooks/use-internal-auth";
import { RequireAuth } from "@/components/require-auth";
import { LangProvider } from "@/lib/i18n";

import Dashboard from "@/pages/dashboard";
import Analytics from "@/pages/analytics";
import Registry from "@/pages/registry";
import Agents from "@/pages/agents";
import Orchestrator from "@/pages/orchestrator";
import CreativeAI from "@/pages/creative-ai";
import Workflows from "@/pages/workflows";
import WorkflowExecutions from "@/pages/workflow-executions";
import Prompts from "@/pages/prompts";
import Knowledge from "@/pages/knowledge";
import Memory from "@/pages/memory";
import Audit from "@/pages/audit";
import Settings from "@/pages/settings";
import ClientReviewPage from "@/pages/client-review";
import Workforce from "@/pages/workforce";
import Operations from "@/pages/operations";
import Queue from "@/pages/queue";
import Events from "@/pages/events";
import Scheduler from "@/pages/scheduler";
import Marketplace from "@/pages/marketplace";
import HumanTasks from "@/pages/human-tasks";
import Services from "@/pages/services";
import ServiceDetail from "@/pages/service-detail";
import CatalogAdmin from "@/pages/catalog-admin";
import ServiceRequests from "@/pages/service-requests";
import AutomationPage from "@/pages/automation";
import AIInsightsPage from "@/pages/ai-insights";
import Payments from "@/pages/payments";
import PortfolioAdmin from "@/pages/portfolio-admin";
import CreativeIntelligence from "@/pages/creative-intelligence";
import TemplateMarketplace from "@/pages/template-marketplace";
import TemplateEngine from "@/pages/template-engine";
import TemplateKnowledgeLibrary from "@/pages/template-knowledge-library";
import CommercialPage from "@/pages/commercial";
import PromotionsPage from "@/pages/promotions";
import CouponsPage from "@/pages/coupons";
import AffiliatesPage from "@/pages/affiliates";
import HealthScoresPage from "@/pages/health-scores";
import ReferralsPage from "@/pages/referrals";
import ObservabilityPage from "@/pages/observability";
import ProductionPipelinePage from "@/pages/production-pipeline";
import DesignStudio from "@/pages/design-studio";
import DesignStudioEditor from "@/pages/design-studio-editor";
import CreativeMarketplace from "@/pages/creative-marketplace";
import DesignRenderBatches from "@/pages/design-render-batches";
import DesignRenderBatchesNew from "@/pages/design-render-batches-new";
import DesignRenderBatchDetail from "@/pages/design-render-batch-detail";
import DesignTemplateAiCreate from "@/pages/design-template-ai-create";
import DesignTemplateEditor from "@/pages/design-template-editor";
import DesignTemplates from "@/pages/design-templates";
import DesignTemplateDetail from "@/pages/design-template-detail";

// ── Team 17: Universal Design Export Workspace ───────────────────────────
import ExportWorkspacePage from "@/pages/export-workspace";
// ── Team 03: Commercial Automation ───────────────────────────────────────
import CommercialAutomationPage from "@/pages/creative-commercial/CommercialAutomationPage";
// ── Team 05: Brand Intelligence V2 ───────────────────────────────────────
import BrandIntelligenceV2Page from "@/pages/brand-intelligence-v2/BrandIntelligenceV2Page";
// ── Team 06: Asset Intelligence V2 ───────────────────────────────────────
import AssetIntelligenceV2Page from "@/pages/asset-intelligence-v2";
// ── Team 07: Design Blueprints ────────────────────────────────────────────
import DesignBlueprintsPage from "@/pages/design-blueprints";
// ── Team 08: Design Components ───────────────────────────────────────────
import DesignComponentsPage from "@/pages/design-components";
// ── Team 09: Design Patterns ─────────────────────────────────────────────
import DesignPatternsPage from "@/pages/design-patterns";
// ── Team 10: Design Tokens ───────────────────────────────────────────────
import DesignTokensPage from "@/pages/design-tokens";
import FontPairsPage from "@/pages/design-tokens/font-pairs";
import ColorPalettesPage from "@/pages/design-tokens/color-palettes";
// ── Team 16: Design Review Workspace ─────────────────────────────────────
import ReviewWorkspacePage from "@/pages/review-workspace";
// ── Team 15: Graphic Design ───────────────────────────────────────────────
import GraphicDesignPage from "@/pages/graphic-design";
// ── Team 15: Version Timeline ─────────────────────────────────────────────
import VersionTimelinePage from "@/pages/version-timeline";
// ── Team 17: Interior Design ─────────────────────────────────────────────
import InteriorDesignPage from "@/pages/interior-design";
// ── Team 18: Fashion Design ──────────────────────────────────────────────
import FashionDesignPage from "@/pages/fashion-design";
// ── Team 19: Packaging Design ────────────────────────────────────────────
import PackagingDesignPage from "@/pages/packaging-design";
// ── Team 21: Universal Material Library ──────────────────────────────────
import MaterialLibraryPage from "@/pages/material-library";
import RoomTemplatesPage from "@/pages/room-templates/index";
import RoomTemplateDetailPage from "@/pages/room-templates/detail";
// ── Phase 5: Controlled Material Import & Human Review ───────────────────
import MaterialImportReviewPage from "@/pages/material-import-review";
// ── Team 22: Vendor Ecosystem ─────────────────────────────────────────────
import VendorAdminPage from "@/pages/creative-vendors/VendorAdminPage";
import VendorAdminDetailPage from "@/pages/creative-vendors/VendorAdminDetailPage";
// ── Team 35: Design Observability & Operations ───────────────────────────
import DesignObservabilityPage from "@/pages/design-observability";
// ── Customs Tariff (BTKI) ─────────────────────────────────────────────────
import CustomsTariff from "@/pages/customs-tariff";
import TarifKalkulator from "@/pages/tarif-kalkulator";
import PricingCalculator from "@/pages/pricing-calculator";

const queryClient = new QueryClient();

function AdminRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/registry" component={Registry} />
        <Route path="/agents" component={Agents} />
        <Route path="/orchestrator" component={Orchestrator} />
        <Route path="/creative-ai" component={CreativeAI} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/workflow-executions" component={WorkflowExecutions} />
        <Route path="/prompts" component={Prompts} />
        <Route path="/knowledge" component={Knowledge} />
        <Route path="/memory" component={Memory} />
        <Route path="/audit" component={Audit} />
        <Route path="/settings" component={Settings} />
        <Route path="/workforce" component={Workforce} />
        <Route path="/operations" component={Operations} />
        <Route path="/queue" component={Queue} />
        <Route path="/events" component={Events} />
        <Route path="/human-tasks" component={HumanTasks} />
        <Route path="/scheduler" component={Scheduler} />
        <Route path="/marketplace" component={Marketplace} />
        <Route path="/services" component={Services} />
        <Route path="/services/:id" component={ServiceDetail} />
        <Route path="/catalog-admin" component={CatalogAdmin} />
        <Route path="/service-requests" component={ServiceRequests} />
        <Route path="/automation" component={AutomationPage} />
        <Route path="/ai-insights" component={AIInsightsPage} />
        <Route path="/payments" component={Payments} />
        <Route path="/portfolio" component={PortfolioAdmin} />
        <Route path="/commercial" component={CommercialPage} />
        <Route path="/promotions" component={PromotionsPage} />
        <Route path="/coupons" component={CouponsPage} />
        <Route path="/affiliates" component={AffiliatesPage} />
        <Route path="/referrals" component={ReferralsPage} />
        <Route path="/health-scores" component={HealthScoresPage} />
        <Route path="/observability" component={ObservabilityPage} />
        <Route path="/production-pipeline" component={ProductionPipelinePage} />
        <Route path="/creative-intelligence" component={CreativeIntelligence} />
        <Route path="/template-marketplace" component={TemplateMarketplace} />
        <Route path="/template-engine" component={TemplateEngine} />
        <Route path="/template-knowledge-library" component={TemplateKnowledgeLibrary} />
        <Route path="/design-studio" component={DesignStudio} />
        <Route path="/design-studio/:id" component={DesignStudioEditor} />
        <Route path="/design-templates/ai-create" component={DesignTemplateAiCreate} />
        <Route path="/design-templates/:id/versions/:versionId/edit" component={DesignTemplateEditor} />
        <Route path="/design-templates/:id/edit" component={DesignTemplateEditor} />
        <Route path="/design-templates/:id/editor" component={DesignTemplateEditor} />
        <Route path="/design-templates/:id" component={DesignTemplateDetail} />
        <Route path="/design-templates" component={DesignTemplates} />
        <Route path="/creative-marketplace" component={CreativeMarketplace} />
        {/* ── Team 03: Commercial Automation ─────────────────────────── */}
        <Route path="/commercial-automation" component={CommercialAutomationPage} />
        {/* ── Team 05: Brand Intelligence V2 ─────────────────────────── */}
        <Route path="/brand-intelligence-v2" component={BrandIntelligenceV2Page} />
        {/* ── Team 06: Asset Intelligence V2 ─────────────────────────── */}
        <Route path="/asset-intelligence-v2" component={AssetIntelligenceV2Page} />
        {/* ── Team 07: Design Blueprints ──────────────────────────────── */}
        <Route path="/design-blueprints" component={DesignBlueprintsPage} />
        {/* ── Team 08: Design Components ──────────────────────────────── */}
        <Route path="/design-components" component={DesignComponentsPage} />
        {/* ── Team 09: Design Patterns ────────────────────────────────── */}
        <Route path="/design-patterns" component={DesignPatternsPage} />
        {/* ── Team 10: Design Tokens ──────────────────────────────────── */}
        <Route path="/design-tokens/font-pairs" component={FontPairsPage} />
        <Route path="/design-tokens/color-palettes" component={ColorPalettesPage} />
        <Route path="/design-tokens" component={DesignTokensPage} />
        {/* ── Team 16: Design Review Workspace ────────────────────────── */}
        <Route path="/review-workspace/:reviewId" component={ReviewWorkspacePage} />
        {/* ── Team 15: Graphic Design ─────────────────────────────────── */}
        <Route path="/graphic-design" component={GraphicDesignPage} />
        {/* ── Team 15: Version Timeline ───────────────────────────────── */}
        <Route path="/version-timeline" component={VersionTimelinePage} />
        {/* ── Team 17: Interior Design ────────────────────────────────── */}
        <Route path="/interior-design" component={InteriorDesignPage} />
        {/* ── Team 18: Fashion Design ─────────────────────────────────── */}
        <Route path="/fashion-design" component={FashionDesignPage} />
        {/* ── Team 19: Packaging Design ───────────────────────────────── */}
        <Route path="/packaging-design" component={PackagingDesignPage} />
        {/* ── Team 21: Universal Material Library ─────────────────────── */}
        <Route path="/room-templates/new" component={RoomTemplateDetailPage} />
        <Route path="/room-templates/:id" component={RoomTemplateDetailPage} />
        <Route path="/room-templates" component={RoomTemplatesPage} />
        <Route path="/material-library" component={MaterialLibraryPage} />
        {/* ── Phase 5: Controlled Material Import Review ───────────────── */}
        <Route path="/material-import-review" component={MaterialImportReviewPage} />
        {/* ── Team 22: Vendor Ecosystem ───────────────────────────────── */}
        <Route path="/creative-vendors/:id" component={VendorAdminDetailPage} />
        <Route path="/creative-vendors" component={VendorAdminPage} />
        {/* ── Team 35: Design Observability ──────────────────────────── */}
        <Route path="/design-observability" component={DesignObservabilityPage} />
        {/* ── Customs Tariff (BTKI) ───────────────────────────────────── */}
        <Route path="/customs-tariff" component={CustomsTariff} />
        <Route path="/tarif-kalkulator" component={TarifKalkulator} />
        <Route path="/pricing-calculator" component={PricingCalculator} />
        <Route path="/design-render-batches/new" component={DesignRenderBatchesNew} />
        <Route path="/design-render-batches/:id" component={DesignRenderBatchDetail} />
        <Route path="/design-render-batches" component={DesignRenderBatches} />
        {/* ── Team 17: Universal Design Export Workspace ────────────────── */}
        <Route path="/export-workspace" component={ExportWorkspacePage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <LangProvider>
    <ThemeProvider defaultTheme="dark" storageKey="ai-platform-theme">
      <QueryClientProvider client={queryClient}>
        <InternalAuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Switch>
                {/* Public client review page — no admin Layout, no internal login required */}
                <Route path="/review/creative/:token" component={ClientReviewPage} />
                {/* Internal staff auth — reachable without a session */}
                <Route path="/login" component={Login} />
                <Route path="/change-password" component={ChangePassword} />
                {/* Everything else is the internal portal — requires an active staff session */}
                <Route>
                  <RequireAuth>
                    <AdminRouter />
                  </RequireAuth>
                </Route>
              </Switch>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </InternalAuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
    </LangProvider>
  );
}

export default App;