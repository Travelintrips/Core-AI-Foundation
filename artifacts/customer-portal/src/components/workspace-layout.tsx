import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  Download,
  Receipt,
  Palette,
  Bell,
  UserCircle,
  LifeBuoy,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { useWorkspaceNotifications } from "@/hooks/use-workspace";

const NAV_ITEMS = [
  { href: "", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "My Projects", icon: FolderKanban },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/brand-kit", label: "Brand Kit", icon: Palette },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/support", label: "Support", icon: LifeBuoy },
];

export function WorkspaceLayout({ token, children }: { token: string; children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: notif } = useWorkspaceNotifications(token, { read: "unread" });
  const unread = notif?.unreadCount ?? 0;

  const currentPath = location.replace(`/workspace/${token}`, "") || "";

  const SidebarContent = (
    <>
      <Link href={`/workspace/${token}`} className="flex items-center gap-2 px-2 py-1 mb-8">
        <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <span className="font-serif font-semibold text-lg tracking-tight">Workspace</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = currentPath === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={`/workspace/${token}${item.href}`}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors relative ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              data-testid={`nav-workspace-${item.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/notifications" && unread > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/50 p-4 sticky top-0 h-[100dvh] overflow-y-auto">
        {SidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4 bg-background/95 backdrop-blur border-b border-border/60">
        <Link href={`/workspace/${token}`} className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-serif font-semibold">Workspace</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-muted"
          data-testid="button-workspace-menu-toggle"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-background/98 backdrop-blur pt-14 p-4 overflow-y-auto">
          {SidebarContent}
        </div>
      )}

      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
