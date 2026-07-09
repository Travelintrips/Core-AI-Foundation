import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart2,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/workforce", label: "AI Workforce", icon: Building2 },
  { href: "/operations", label: "Operations Center", icon: Crown },
  { href: "/queue", label: "Queue Center", icon: ListOrdered },
  { href: "/registry", label: "Registry", icon: Box },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/orchestrator", label: "Orchestrator", icon: Play },
  { href: "/creative-ai", label: "Creative AI", icon: Sparkles },
  { href: "/workflows", label: "Workflows", icon: GitMerge },
  { href: "/workflow-executions", label: "Executions", icon: Activity },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/knowledge", label: "Knowledge", icon: Database },
  { href: "/memory", label: "Memory", icon: Cpu },
  { href: "/human-tasks", label: "Human Tasks", icon: ClipboardCheck },
  { href: "/events", label: "AI Events", icon: Zap },
  { href: "/scheduler", label: "Scheduler", icon: CalendarClock },
  { href: "/audit", label: "Audit Log", icon: ShieldAlert },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health, isLoading } = useHealthCheck();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/20">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col flex-shrink-0 z-10">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-6 bg-primary/10 rounded border border-primary/30 flex items-center justify-center">
              <Cpu className="size-4 text-primary" />
            </div>
            <span className="font-bold tracking-tight text-sidebar-foreground">AI Platform</span>
            <span className="text-[10px] uppercase tracking-widest font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded ml-2">ENT</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          <div className="px-2 mb-2">
            <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Modules</span>
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-2 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer group",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <item.icon className={cn("size-4", isActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("size-2 rounded-full", isLoading ? "bg-muted-foreground animate-pulse" : (health?.status === 'ok' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]"))} />
              <span className="text-xs font-mono text-muted-foreground uppercase">System {isLoading ? 'Pinging...' : (health?.status === 'ok' ? 'Online' : 'Degraded')}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative z-0">
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}