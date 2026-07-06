import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Registry from "@/pages/registry";
import Agents from "@/pages/agents";
import Orchestrator from "@/pages/orchestrator";
import Workflows from "@/pages/workflows";
import WorkflowExecutions from "@/pages/workflow-executions";
import Prompts from "@/pages/prompts";
import Knowledge from "@/pages/knowledge";
import Memory from "@/pages/memory";
import Audit from "@/pages/audit";
import Settings from "@/pages/settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/registry" component={Registry} />
        <Route path="/agents" component={Agents} />
        <Route path="/orchestrator" component={Orchestrator} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/workflow-executions" component={WorkflowExecutions} />
        <Route path="/prompts" component={Prompts} />
        <Route path="/knowledge" component={Knowledge} />
        <Route path="/memory" component={Memory} />
        <Route path="/audit" component={Audit} />
        <Route path="/settings" component={Settings} />
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
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;