import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart2,
  Brain,
  Box, 
  CalendarClock,
  ClipboardCheck,
  Cpu, 
  Database, 
  FileText, 
  GitMerge, 
  LayoutDashboard, 
  ListOrdered,
  Play, 
  Settings, 
  ShieldAlert,
  Sparkles,
  Users,
  Building2,
  Crown,
  Zap,
  Store,
  Tags,
  LayoutGrid,
  ClipboardList,
  Wallet,
  TrendingUp,
  Ticket,
  Share2,
  Users2,
  Heart,
  Lightbulb,
  LayoutTemplate,
  Layers,
  FileStack,
  PackageSearch,
  Calculator,
  History,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";
import { useInternalAuth } from "@/hooks/use-internal-auth";
import { useLang } from "@/lib/i18n";

interface LayoutProps {
  children: React.ReactNode;
}

// Nav is defined as a function so it picks up translations dynamically.
// Each item carries a `tKey` pointing into the locale files.
const NAV_SECTIONS_DEF = [
  {
    sectionKey: "overview",
    items: [
      { href: "/",          tKey: "nav.items.dashboard",          icon: LayoutDashboard },
      { href: "/analytics", tKey: "nav.items.analytics",          icon: BarChart2 },
    ],
  },
  {
    sectionKey: "workforce",
    items: [
      { href: "/workforce",           tKey: "nav.items.aiWorkforce",        icon: Building2 },
      { href: "/operations",          tKey: "nav.items.operationsCenter",   icon: Crown },
      { href: "/agents",              tKey: "nav.items.agents",             icon: Users },
      { href: "/orchestrator",        tKey: "nav.items.orchestrator",       icon: Play },
      { href: "/creative-ai",         tKey: "nav.items.creativeAI",         icon: Sparkles },
      { href: "/production-pipeline", tKey: "nav.items.productionPipeline", icon: GitMerge },
    ],
  },
  {
    sectionKey: "automation",
    items: [
      { href: "/workflows",           tKey: "nav.items.workflows",       icon: GitMerge },
      { href: "/workflow-executions", tKey: "nav.items.executions",      icon: Activity },
      { href: "/scheduler",           tKey: "nav.items.scheduler",       icon: CalendarClock },
      { href: "/automation",          tKey: "nav.items.automationCenter",icon: Zap },
      { href: "/events",              tKey: "nav.items.aiEvents",        icon: Zap },
    ],
  },
  {
    sectionKey: "knowledge",
    items: [
      { href: "/prompts",   tKey: "nav.items.prompts",   icon: FileText },
      { href: "/knowledge", tKey: "nav.items.knowledge", icon: Database },
      { href: "/memory",    tKey: "nav.items.memory",    icon: Cpu },
    ],
  },
  {
    sectionKey: "operations",
    items: [
      { href: "/queue",        tKey: "nav.items.queueCenter", icon: ListOrdered },
      { href: "/human-tasks",  tKey: "nav.items.humanTasks",  icon: ClipboardCheck },
      { href: "/registry",     tKey: "nav.items.registry",    icon: Box },
    ],
  },
  {
    sectionKey: "commerce",
    items: [
      { href: "/marketplace",        tKey: "nav.items.marketplace",      icon: Store },
      { href: "/services",           tKey: "nav.items.serviceCatalog",   icon: Tags },
      { href: "/service-requests",   tKey: "nav.items.serviceRequests",  icon: ClipboardList },
      { href: "/payments",           tKey: "nav.items.payments",         icon: Wallet },
      { href: "/commercial",         tKey: "nav.items.commercial",       icon: TrendingUp },
      { href: "/pricing-calculator", tKey: "nav.items.pricingCalculator",icon: Calculator },
      { href: "/promotions",         tKey: "nav.items.promotions",       icon: Tags },
      { href: "/coupons",            tKey: "nav.items.coupons",          icon: Ticket },
    ],
  },
  {
    sectionKey: "growth",
    items: [
      { href: "/referrals",             tKey: "nav.items.referrals",            icon: Share2 },
      { href: "/affiliates",            tKey: "nav.items.affiliates",           icon: Users2 },
      { href: "/health-scores",         tKey: "nav.items.healthScores",         icon: Heart },
      { href: "/ai-insights",           tKey: "nav.items.aiInsights",           icon: Lightbulb },
      { href: "/creative-intelligence", tKey: "nav.items.creativeIntelligence", icon: Brain },
      { href: "/template-marketplace",  tKey: "nav.items.templateMarketplace",  icon: LayoutTemplate },
      { href: "/template-engine",       tKey: "nav.items.templateEngine",       icon: Layers },
      { href: "/design-templates",      tKey: "nav.items.designTemplates",      icon: LayoutTemplate },
    ],
  },
  {
    sectionKey: "creative",
    items: [
      { href: "/room-templates",    tKey: "nav.items.roomTemplates",   icon: LayoutGrid },
      { href: "/interior-design",  tKey: "nav.items.interiorDesign",  icon: LayoutGrid },
      { href: "/design-studio",    tKey: "nav.items.designStudio",    icon: LayoutTemplate },
      { href: "/export-workspace",        tKey: "nav.items.exportWorkspace",      icon: FileStack },
      { href: "/design-templates",        tKey: "nav.items.templateLibrary",      icon: FileStack },
      { href: "/creative-marketplace",    tKey: "nav.items.creativeMarketplace",  icon: Store },
      { href: "/design-render-batches",   tKey: "nav.items.bulkRender",           icon: Layers },
      { href: "/design-templates/ai-create", tKey: "nav.items.aiTemplateAssistant", icon: Sparkles },
      { href: "/version-timeline",        tKey: "nav.items.versionTimeline",      icon: History },
    ],
  },
  {
    sectionKey: "tradeTools",
    items: [
      { href: "/customs-tariff", tKey: "nav.items.tarifsHsCode", icon: PackageSearch },
    ],
  },
  {
    sectionKey: "platform",
    items: [
      { href: "/catalog-admin",   tKey: "nav.items.catalogAdmin",   icon: LayoutGrid },
      { href: "/portfolio",       tKey: "nav.items.portfolio",       icon: Store },
      { href: "/observability",   tKey: "nav.items.observability",   icon: Activity },
      { href: "/audit",           tKey: "nav.items.auditLog",        icon: ShieldAlert },
      { href: "/settings",        tKey: "nav.items.settings",        icon: Settings },
    ],
  },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health, isLoading } = useHealthCheck();
  const { user, logout } = useInternalAuth();
  const { lang, setLang, t } = useLang();

  const isOnline = !isLoading && health?.status === 'ok';

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: '#060B18' }}>
      {/* ── SIDEBAR ── */}
      <aside
        className="w-60 flex flex-col flex-shrink-0 z-10"
        style={{ background: '#0A1020', borderRight: '1px solid #1E3057' }}
      >
        {/* Logo + Language Toggle */}
        <div className="h-14 flex items-center px-4 flex-shrink-0 gap-2" style={{ borderBottom: '1px solid #1E3057' }}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div
              className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 2px 10px rgba(124,110,250,0.40)' }}
            >
              <Cpu className="size-3.5 text-white" />
            </div>
            <span
              className="font-semibold tracking-tight text-sm truncate"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
            >
              AI Platform
            </span>
            <span
              className="text-[9px] font-mono tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: 'rgba(124,110,250,0.15)', color: '#9D91FB', border: '1px solid rgba(124,110,250,0.20)' }}
            >
              ENT
            </span>
          </div>

          {/* Language toggle pill */}
          <div
            className="flex items-center flex-shrink-0 rounded-md overflow-hidden"
            style={{ border: '1px solid #1E3057', background: '#060B18' }}
          >
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors"
                style={
                  lang === l
                    ? { background: '#7C6EFA', color: '#fff' }
                    : { color: '#4F6494' }
                }
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Nav sections */}
        <div className="flex-1 overflow-y-auto py-3 scrollbar-none">
          {NAV_SECTIONS_DEF.map((section) => (
            <div key={section.sectionKey} className="mb-1">
              <div
                className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: '#4F6494' }}
              >
                {t(`nav.sections.${section.sectionKey}`)}
              </div>
              <div className="px-2 space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href;
                  const label = t(item.tKey);
                  return (
                    <Link key={`${item.href}-${item.tKey}`} href={item.href}>
                      <div
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer group relative",
                        )}
                        style={
                          isActive
                            ? { background: 'rgba(124,110,250,0.12)', color: '#9D91FB', borderLeft: '2px solid #7C6EFA', paddingLeft: '8px' }
                            : { color: '#6B82B0', borderLeft: '2px solid transparent' }
                        }
                        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <item.icon
                          className="size-3.5 flex-shrink-0"
                          style={{ color: isActive ? '#7C6EFA' : '#4F6494' }}
                        />
                        <span className="truncate">{label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Signed-in staff account */}
        {user && (
          <div className="px-4 py-3 flex-shrink-0 flex items-center justify-between gap-2" style={{ borderTop: '1px solid #1E3057' }}>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: '#F0F4FF' }} data-testid="text-current-user-email">
                {user.email}
              </div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: '#4F6494' }} data-testid="text-current-user-role">
                {user.role.replace('_', ' ')}
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-white/5"
              style={{ color: '#6B82B0' }}
              title="Log out"
              data-testid="button-logout"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        )}

        {/* System status */}
        <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid #1E3057' }}>
          <div className="flex items-center gap-2">
            <div
              className={cn("size-1.5 rounded-full flex-shrink-0", isLoading ? "animate-pulse" : "")}
              style={{
                background: isLoading ? '#4F6494' : isOnline ? '#10B981' : '#F43F5E',
                boxShadow: isLoading ? 'none' : isOnline ? '0 0 6px rgba(16,185,129,0.6)' : '0 0 6px rgba(244,63,94,0.6)',
              }}
            />
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#4F6494' }}>
              {isLoading ? t('status.pinging') : isOnline ? t('status.online') : t('status.degraded')}
            </span>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main
        className="flex-1 flex flex-col min-w-0 relative z-0 overflow-auto"
        style={{ background: '#060B18' }}
      >
        {children}
      </main>
    </div>
  );
}
