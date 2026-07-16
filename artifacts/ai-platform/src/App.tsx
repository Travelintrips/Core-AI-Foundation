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
        <Route path="/design-studio" component={DesignStudio} />
        <Route path="/design-studio/:id" component={DesignStudioEditor} />
        <Route path="/creative-marketplace" component={CreativeMarketplace} />
        <Route path="/design-render-batches/new" component={DesignRenderBatchesNew} />
        <Route path="/design-render-batches/:id" component={DesignRenderBatchDetail} />
        <Route path="/design-render-batches" component={DesignRenderBatches} />
        <Route path="/design-templates/ai-create" component={DesignTemplateAiCreate} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
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
  );
}

export default App;