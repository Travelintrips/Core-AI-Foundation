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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";
import { useInternalAuth } from "@/hooks/use-internal-auth";
import { LogOut } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart2 },
    ],
  },
  {
    label: "AI Workforce",
    items: [
      { href: "/workforce", label: "AI Workforce", icon: Building2 },
      { href: "/operations", label: "Operations Center", icon: Crown },
      { href: "/agents", label: "Agents", icon: Users },
      { href: "/orchestrator", label: "Orchestrator", icon: Play },
      { href: "/creative-ai", label: "Creative AI", icon: Sparkles },
      { href: "/production-pipeline", label: "Production Pipeline", icon: GitMerge },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/workflows", label: "Workflows", icon: GitMerge },
      { href: "/workflow-executions", label: "Executions", icon: Activity },
      { href: "/scheduler", label: "Scheduler", icon: CalendarClock },
      { href: "/automation", label: "Automation Center", icon: Zap },
      { href: "/events", label: "AI Events", icon: Zap },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { href: "/prompts", label: "Prompts", icon: FileText },
      { href: "/knowledge", label: "Knowledge", icon: Database },
      { href: "/memory", label: "Memory", icon: Cpu },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/queue", label: "Queue Center", icon: ListOrdered },
      { href: "/human-tasks", label: "Human Tasks", icon: ClipboardCheck },
      { href: "/registry", label: "Registry", icon: Box },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/marketplace", label: "Marketplace", icon: Store },
      { href: "/services", label: "Service Catalog", icon: Tags },
      { href: "/service-requests", label: "Service Requests", icon: ClipboardList },
      { href: "/payments", label: "Payments", icon: Wallet },
      { href: "/commercial", label: "Commercial", icon: TrendingUp },
      { href: "/pricing-calculator", label: "Kalkulator Harga AI", icon: Calculator },
      { href: "/promotions", label: "Promotions", icon: Tags },
      { href: "/coupons", label: "Coupons", icon: Ticket },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/referrals", label: "Referrals", icon: Share2 },
      { href: "/affiliates", label: "Affiliates", icon: Users2 },
      { href: "/health-scores", label: "Health Scores", icon: Heart },
      { href: "/ai-insights", label: "AI Insights", icon: Lightbulb },
      { href: "/creative-intelligence", label: "Creative Intelligence", icon: Brain },
      { href: "/template-marketplace", label: "Template Marketplace", icon: LayoutTemplate },
      { href: "/template-engine", label: "Template Engine", icon: Layers },
      { href: "/design-templates", label: "Design Templates", icon: LayoutTemplate },
    ],
  },
  {
    label: "Creative",
    items: [
      { href: "/design-studio", label: "Design Studio", icon: LayoutTemplate },
      { href: "/design-templates", label: "Template Library", icon: FileStack },
      { href: "/creative-marketplace", label: "Creative Marketplace", icon: Store },
      { href: "/design-render-batches", label: "Bulk Render", icon: Layers },
      { href: "/design-templates/ai-create", label: "AI Template Assistant", icon: Sparkles },
    ],
  },
  {
    label: "Trade Tools",
    items: [
      { href: "/customs-tariff", label: "Tarif BTKI & HS Code", icon: PackageSearch },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/catalog-admin", label: "Catalog Admin", icon: LayoutGrid },
      { href: "/portfolio", label: "Portfolio", icon: Store },
      { href: "/observability", label: "Observability", icon: Activity },
      { href: "/audit", label: "Audit Log", icon: ShieldAlert },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health, isLoading } = useHealthCheck();
  const { user, logout } = useInternalAuth();

  const isOnline = !isLoading && health?.status === 'ok';

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: '#060B18' }}>
      {/* ── SIDEBAR ── */}
      <aside
        className="w-60 flex flex-col flex-shrink-0 z-10"
        style={{
          background: '#0A1020',
          borderRight: '1px solid #1E3057',
        }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 flex-shrink-0" style={{ borderBottom: '1px solid #1E3057' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 2px 10px rgba(124,110,250,0.40)' }}
            >
              <Cpu className="size-3.5 text-white" />
            </div>
            <span
              className="font-semibold tracking-tight text-sm"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
            >
              AI Platform
            </span>
            <span
              className="text-[9px] font-mono tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(124,110,250,0.15)', color: '#9D91FB', border: '1px solid rgba(124,110,250,0.20)' }}
            >
              ENT
            </span>
          </div>
        </div>

        {/* Nav sections */}
        <div className="flex-1 overflow-y-auto py-3 scrollbar-none">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-1">
              <div
                className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: '#4F6494' }}
              >
                {section.label}
              </div>
              <div className="px-2 space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer group relative",
                        )}
                        style={
                          isActive
                            ? {
                                background: 'rgba(124,110,250,0.12)',
                                color: '#9D91FB',
                                borderLeft: '2px solid #7C6EFA',
                                paddingLeft: '8px',
                              }
                            : {
                                color: '#6B82B0',
                                borderLeft: '2px solid transparent',
                              }
                        }
                        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <item.icon
                          className="size-3.5 flex-shrink-0"
                          style={{ color: isActive ? '#7C6EFA' : '#4F6494' }}
                        />
                        <span className="truncate">{item.label}</span>
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
            <span
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: '#4F6494' }}
            >
              {isLoading ? 'Pinging…' : isOnline ? 'System Online' : 'Degraded'}
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
