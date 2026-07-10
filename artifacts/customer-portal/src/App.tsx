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
      <Route path="/services" component={ServicesPage} />
      <Route path="/services/:id" component={ServiceDetailPage} />
      <Route path="/submit" component={SubmitPage} />
      <Route path="/success" component={SuccessPage} />
      <Route path="/review/:token" component={ReviewPage} />
      <Route path="/dashboard/:dashboardToken" component={DashboardPage} />
      <Route path="/access" component={AccessPage} />
      <Route path="/quotation/:token" component={QuotationPage} />
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
