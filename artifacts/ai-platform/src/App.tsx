import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";

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
import CommercialPage from "@/pages/commercial";
import PromotionsPage from "@/pages/promotions";
import CouponsPage from "@/pages/coupons";
import AffiliatesPage from "@/pages/affiliates";
import HealthScoresPage from "@/pages/health-scores";
import ReferralsPage from "@/pages/referrals";

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
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="ai-platform-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Switch>
              {/* Public client review page — no admin Layout */}
              <Route path="/review/creative/:token" component={ClientReviewPage} />
              {/* Admin platform */}
              <Route component={AdminRouter} />
            </Switch>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;