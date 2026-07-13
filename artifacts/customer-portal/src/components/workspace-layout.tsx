import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FolderKanban, Download, Receipt, Palette,
  Bell, UserCircle, LifeBuoy, Sparkles, Menu, X, Award, Gift,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { useWorkspaceNotifications } from "@/hooks/use-workspace";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/lib/i18n";

export function WorkspaceLayout({ token, children }: { token: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: notif } = useWorkspaceNotifications(token, { read: "unread" });
  const unread = notif?.unreadCount ?? 0;

  const NAV_ITEMS = [
    { href: "",               label: t('workspace.nav.dashboard'),      icon: LayoutDashboard },
    { href: "/projects",      label: t('workspace.nav.projects'),       icon: FolderKanban },
    { href: "/downloads",     label: t('workspace.nav.downloads'),      icon: Download },
    { href: "/invoices",      label: t('workspace.nav.invoices'),       icon: Receipt },
    { href: "/brand-kit",     label: t('workspace.nav.brandKit'),       icon: Palette },
    { href: "/notifications", label: t('workspace.nav.notifications'),  icon: Bell },
    { href: "/affiliate",     label: t('workspace.nav.affiliate'),      icon: Award },
    { href: "/referral",      label: t('workspace.nav.referral'),       icon: Gift },
    { href: "/profile",       label: t('workspace.nav.profile'),        icon: UserCircle },
    { href: "/support",       label: t('workspace.nav.support'),        icon: LifeBuoy },
    { href: "/settings",      label: t('workspace.nav.settings'),       icon: Settings },
  ];

  const currentPath = location.replace(`/workspace/${token}`, "") || "";

  const SidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <Link href={`/workspace/${token}`} className="flex items-center gap-2.5 px-3 py-2 mb-8 group">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg,#F97316,#EA580C)" }}>
          <Sparkles className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <div className="font-display font-bold text-base text-white tracking-tight leading-none">
            Workspace
          </div>
          <div className="text-xs mt-0.5" style={{ color: "#64748B" }}>Creative Studio</div>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 flex-1" aria-label="Workspace navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = currentPath === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={`/workspace/${token}${item.href}`}
              onClick={() => setMobileOpen(false)}
              data-testid={`nav-workspace-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive ? "text-white" : "text-slate-400 hover:text-white hover:bg-white/6"
              }`}
              style={isActive ? { background: "rgba(249,115,22,0.15)", boxShadow: "inset 0 0 0 1px rgba(249,115,22,0.25)" } : {}}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: "#F97316" }} />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-orange-400" : ""}`} />
              <span className="flex-1">{item.label}</span>
              {item.href === "/notifications" && unread > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: "#F97316", color: "#fff" }}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer help */}
      <div className="mt-4 p-3 rounded-xl"
        style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.15)" }}>
        <div className="text-xs font-semibold text-orange-400 mb-1">{t('workspace.help.title')}</div>
        <div className="text-xs" style={{ color: "#64748B" }}>{t('workspace.help.desc')}</div>
        <Link href={`/workspace/${token}/support`}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors">
          <LifeBuoy className="w-3.5 h-3.5" />
          {t('workspace.help.cta')}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex" style={{ background: "#FAFAF7" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col p-4 sticky top-0 h-[100dvh] overflow-y-auto"
        style={{ background: "#0F172A", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        {SidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4"
        style={{ background: "#0F172A", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href={`/workspace/${token}`} className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#F97316,#EA580C)" }}>
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-sm text-white">Workspace</span>
        </Link>
        <button onClick={() => setMobileOpen((v) => !v)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          aria-label="Toggle menu">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="md:hidden fixed inset-0 z-30 bg-black/50"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="md:hidden fixed top-14 left-0 bottom-0 z-40 w-72 p-4 overflow-y-auto"
              style={{ background: "#0F172A", borderRight: "1px solid rgba(255,255,255,0.06)" }}
              initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }}
              transition={{ duration: 0.25, ease: "easeOut" }}>
              {SidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 min-w-0 md:ml-0 pt-14 md:pt-0">
        <div className="container mx-auto px-4 md:px-8 py-8 max-w-5xl">
          {children}
        </div>
      </main>
    </div>
  );
}
