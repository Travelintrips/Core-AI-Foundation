import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Loader2 } from 'lucide-react';

/* ─── Lazy page imports (code splitting) ─── */
const LandingPage                = lazy(() => import('@/pages/landing'));
const SubmitPage                 = lazy(() => import('@/pages/submit'));
const SuccessPage                = lazy(() => import('@/pages/success'));
const ReviewPage                 = lazy(() => import('@/pages/review'));
const DashboardPage              = lazy(() => import('@/pages/dashboard'));
const AccessPage                 = lazy(() => import('@/pages/access'));
const QuotationPage              = lazy(() => import('@/pages/quotation'));
const ServicesPage               = lazy(() => import('@/pages/services'));
const GoalsPage                  = lazy(() => import('@/pages/goals'));
const GoalDetailPage             = lazy(() => import('@/pages/goal-detail'));
const ServiceDetailPage          = lazy(() => import('@/pages/service-detail'));
const CommercialGatePage         = lazy(() => import('@/pages/commercial-gate'));
const ProjectPage                = lazy(() => import('@/pages/project'));
const BriefPage                  = lazy(() => import('@/pages/brief'));
const RequestPricingPage         = lazy(() => import('@/pages/request-pricing'));
const RequestQuotationPage       = lazy(() => import('@/pages/request-quotation'));
const RequestApprovalPage        = lazy(() => import('@/pages/request-approval'));
const RequestResultsPage         = lazy(() => import('@/pages/request-results'));
const AffiliateWorkspacePage     = lazy(() => import('@/pages/workspace/affiliate'));
const ReferralWorkspacePage      = lazy(() => import('@/pages/workspace/referral'));
const WorkspaceDashboardPage     = lazy(() => import('@/pages/workspace/dashboard'));
const WorkspaceProjectsPage      = lazy(() => import('@/pages/workspace/projects'));
const WorkspaceProjectDetailPage = lazy(() => import('@/pages/workspace/project-detail'));
const WorkspaceDownloadsPage     = lazy(() => import('@/pages/workspace/downloads'));
const WorkspaceInvoicesPage      = lazy(() => import('@/pages/workspace/invoices'));
const WorkspaceBrandKitPage         = lazy(() => import('@/pages/workspace/brand-kit'));
const WorkspaceAssetLibraryPage     = lazy(() => import('@/pages/workspace/asset-library'));
const WorkspaceBrandIntelligencePage = lazy(() => import('@/pages/workspace/brand-intelligence'));
const TemplateGalleryPage            = lazy(() => import('@/pages/template-gallery'));
const PortfolioGalleryPage           = lazy(() => import('@/pages/portfolio-gallery'));
const AssetMarketplacePage           = lazy(() => import('@/pages/asset-marketplace'));
const GalleryPage                    = lazy(() => import('@/pages/gallery'));
const WorkspaceFavoritesPage         = lazy(() => import('@/pages/workspace/favorites'));
const CreativePreviewPage            = lazy(() => import('@/pages/workspace/creative-preview'));
const WorkspaceNotificationsPage = lazy(() => import('@/pages/workspace/notifications'));
const WorkspaceProfilePage       = lazy(() => import('@/pages/workspace/profile'));
const WorkspaceSupportPage       = lazy(() => import('@/pages/workspace/support'));
const WorkspaceSettingsPage      = lazy(() => import('@/pages/workspace/settings'));
const PortfolioPage              = lazy(() => import('@/pages/portfolio'));
const CpReviewPage               = lazy(() => import('@/pages/cp-review'));
// ── Team 04: Portfolio V2 ────────────────────────────────────────────────
const GalleryV2Page              = lazy(() => import('@/pages/creative-portfolio/GalleryV2Page'));
const InspirationPage            = lazy(() => import('@/pages/creative-portfolio/InspirationPage'));
const ComparePage                = lazy(() => import('@/pages/creative-portfolio/ComparePage'));
// ── Team 17: Interior Design ─────────────────────────────────────────────
const InteriorDesignBriefPage   = lazy(() => import('@/pages/interior-design/index'));
const InteriorDesignProjectPage = lazy(() => import('@/pages/interior-design/project'));
// ── Team 18: Fashion & Apparel Design ─────────────────────────────────────
const FashionDesignPage          = lazy(() => import('@/pages/fashion-design/index'));
// ── Team 22: Vendor Directory ────────────────────────────────────────────
const VendorDirectoryPage        = lazy(() => import('@/pages/creative-vendors/VendorDirectoryPage'));
const VendorProfilePage          = lazy(() => import('@/pages/creative-vendors/VendorProfilePage'));
const StartPage                  = lazy(() => import('@/pages/start'));
// ── Customs Tariff ────────────────────────────────────────────────────────
const CustomsTariffPage          = lazy(() => import('@/pages/customs-tariff'));
const TarifKalkulatorPage        = lazy(() => import('@/pages/tarif-kalkulator'));
const DevTestPage                = lazy(() => import('@/pages/dev-test'));

/* ─── Loading fallback ─── */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#060B18' }}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 4px 20px rgba(124,110,250,0.35)' }}
        >
          <Loader2 className="w-5 h-5 animate-spin text-white" />
        </div>
        <p className="text-sm animate-pulse" style={{ color: '#8B9BC4' }}>Loading…</p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: '#060B18' }}>
      <div className="text-center">
        <div
          className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 8px 32px rgba(124,110,250,0.35)' }}
        >
          <span className="text-4xl font-bold text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>4</span>
        </div>
        <h1 className="text-5xl font-bold mb-2" style={{ color: '#F0F4FF', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>404</h1>
        <p className="mt-2" style={{ color: '#8B9BC4' }}>Halaman tidak ditemukan.</p>
        <a href="/" className="mt-6 inline-flex btn-primary">Kembali ke Beranda</a>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/portfolio" component={PortfolioPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/services/:id" component={ServiceDetailPage} />
        {/* ── Team 03: Goal-Based Discovery ──────────────────────────── */}
        <Route path="/goals" component={GoalsPage} />
        <Route path="/goals/:slug" component={GoalDetailPage} />
        <Route path="/submit" component={SubmitPage} />
        <Route path="/success" component={SuccessPage} />
        <Route path="/review/:token" component={ReviewPage} />
        <Route path="/cp-review/:token" component={CpReviewPage} />
        <Route path="/dashboard/:dashboardToken" component={DashboardPage} />
        <Route path="/access" component={AccessPage} />
        <Route path="/quotation/:token" component={QuotationPage} />
        <Route path="/gate/:token" component={CommercialGatePage} />
        <Route path="/project/:token" component={ProjectPage} />
        <Route path="/request-service/:requestId/brief" component={BriefPage} />
        <Route path="/request-service/:requestId/pricing" component={RequestPricingPage} />
        <Route path="/request-service/:requestId/quotation" component={RequestQuotationPage} />
        <Route path="/request-service/:requestId/approval" component={RequestApprovalPage} />
        <Route path="/request-service/:requestId/results" component={RequestResultsPage} />
        <Route path="/workspace/:token/affiliate" component={AffiliateWorkspacePage} />
        <Route path="/workspace/:token/referral" component={ReferralWorkspacePage} />
        <Route path="/workspace/:token" component={WorkspaceDashboardPage} />
        <Route path="/workspace/:token/projects" component={WorkspaceProjectsPage} />
        <Route path="/workspace/:token/projects/:projectNumber" component={WorkspaceProjectDetailPage} />
        <Route path="/workspace/:token/downloads" component={WorkspaceDownloadsPage} />
        <Route path="/workspace/:token/invoices" component={WorkspaceInvoicesPage} />
        <Route path="/workspace/:token/brand-kit" component={WorkspaceBrandKitPage} />
        <Route path="/workspace/:token/assets" component={WorkspaceAssetLibraryPage} />
        <Route path="/workspace/:token/brand-intelligence" component={WorkspaceBrandIntelligencePage} />
        <Route path="/template-gallery" component={TemplateGalleryPage} />
        <Route path="/portfolio-gallery" component={PortfolioGalleryPage} />
        <Route path="/gallery" component={GalleryPage} />
        <Route path="/marketplace" component={AssetMarketplacePage} />
        <Route path="/workspace/:token/favorites" component={WorkspaceFavoritesPage} />
        <Route path="/workspace/:token/notifications" component={WorkspaceNotificationsPage} />
        <Route path="/workspace/:token/profile" component={WorkspaceProfilePage} />
        <Route path="/workspace/:token/support" component={WorkspaceSupportPage} />
        <Route path="/workspace/:token/settings" component={WorkspaceSettingsPage} />
        <Route path="/creative-preview/:sessionId" component={CreativePreviewPage} />
        {/* ── Team 18: Fashion & Apparel Design ──────────────────────── */}
        <Route path="/fashion-design" component={FashionDesignPage} />
        {/* ── Team 04: Portfolio V2 ───────────────────────────────────── */}
        <Route path="/interior-design" component={InteriorDesignBriefPage} />
        <Route path="/interior-design/:id" component={InteriorDesignProjectPage} />
        <Route path="/portfolio-v2" component={GalleryV2Page} />
        <Route path="/inspiration" component={InspirationPage} />
        <Route path="/portfolio-compare" component={ComparePage} />
        {/* ── Team 22: Vendor Directory ───────────────────────────────── */}
        <Route path="/vendors/:id" component={VendorProfilePage} />
        <Route path="/vendors" component={VendorDirectoryPage} />
        <Route path="/start" component={StartPage} />
        {/* ── Customs Tariff ─────────────────────────────────────────── */}
        <Route path="/customs-tariff" component={CustomsTariffPage} />
        <Route path="/tarif-kalkulator" component={TarifKalkulatorPage} />
        {/* ── Dev Testing (internal only) ─────────────────────────────── */}
        <Route path="/dev-test" component={DevTestPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
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
