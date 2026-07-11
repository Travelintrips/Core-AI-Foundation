import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import LandingPage from '@/pages/landing';
import SubmitPage from '@/pages/submit';
import SuccessPage from '@/pages/success';
import ReviewPage from '@/pages/review';
import DashboardPage from '@/pages/dashboard';
import AccessPage from '@/pages/access';
import QuotationPage from '@/pages/quotation';
import ServicesPage from '@/pages/services';
import ServiceDetailPage from '@/pages/service-detail';
import CommercialGatePage from '@/pages/commercial-gate';
import ProjectPage from '@/pages/project';
import BriefPage from '@/pages/brief';
import RequestPricingPage from '@/pages/request-pricing';
import RequestQuotationPage from '@/pages/request-quotation';
import RequestApprovalPage from '@/pages/request-approval';
import AffiliateWorkspacePage from '@/pages/workspace/affiliate';
import ReferralWorkspacePage from '@/pages/workspace/referral';
import RequestResultsPage from '@/pages/request-results';
import WorkspaceDashboardPage from '@/pages/workspace/dashboard';
import WorkspaceProjectsPage from '@/pages/workspace/projects';
import WorkspaceProjectDetailPage from '@/pages/workspace/project-detail';
import WorkspaceDownloadsPage from '@/pages/workspace/downloads';
import WorkspaceInvoicesPage from '@/pages/workspace/invoices';
import WorkspaceBrandKitPage from '@/pages/workspace/brand-kit';
import WorkspaceNotificationsPage from '@/pages/workspace/notifications';
import WorkspaceProfilePage from '@/pages/workspace/profile';
import WorkspaceSupportPage from '@/pages/workspace/support';
import PortfolioPage from '@/pages/portfolio';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-serif font-bold text-foreground">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route path="/services" component={ServicesPage} />
      <Route path="/services/:id" component={ServiceDetailPage} />
      <Route path="/submit" component={SubmitPage} />
      <Route path="/success" component={SuccessPage} />
      <Route path="/review/:token" component={ReviewPage} />
      <Route path="/dashboard/:dashboardToken" component={DashboardPage} />
      <Route path="/access" component={AccessPage} />
      <Route path="/quotation/:token" component={QuotationPage} />
      <Route path="/gate/:token" component={CommercialGatePage} />
      <Route path="/project/:token" component={ProjectPage} />
      <Route path="/request-service/:requestId/brief" component={BriefPage} />
      <Route path="/request-service/:requestId/pricing" component={RequestPricingPage} />
      <Route path="/request-service/:requestId/quotation" component={RequestQuotationPage} />
      <Route path="/request-service/:requestId/approval" component={RequestApprovalPage} />
      <Route path="/workspace/:token/affiliate" component={AffiliateWorkspacePage} />
      <Route path="/workspace/:token/referral" component={ReferralWorkspacePage} />
      <Route path="/request-service/:requestId/results" component={RequestResultsPage} />
      <Route path="/workspace/:token" component={WorkspaceDashboardPage} />
      <Route path="/workspace/:token/projects" component={WorkspaceProjectsPage} />
      <Route path="/workspace/:token/projects/:projectNumber" component={WorkspaceProjectDetailPage} />
      <Route path="/workspace/:token/downloads" component={WorkspaceDownloadsPage} />
      <Route path="/workspace/:token/invoices" component={WorkspaceInvoicesPage} />
      <Route path="/workspace/:token/brand-kit" component={WorkspaceBrandKitPage} />
      <Route path="/workspace/:token/notifications" component={WorkspaceNotificationsPage} />
      <Route path="/workspace/:token/profile" component={WorkspaceProfilePage} />
      <Route path="/workspace/:token/support" component={WorkspaceSupportPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
