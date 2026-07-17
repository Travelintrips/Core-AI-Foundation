/**
 * cw-layout.tsx — Creative Workspace layout shell (Team 2).
 * Standalone layout — NOT registered in App.tsx/sidebar.
 * Team 24 mounts this via the integration manifest.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FolderKanban, Bell, LifeBuoy,
  Sparkles, Menu, X, ChevronLeft,
} from "lucide-react";
import { useCWNotifications } from "@/hooks/creative-workspace";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

function getNavItems(token: string): NavItem[] {
  return [
    { href: `/creative-workspace/${token}`,               label: "Beranda",          icon: LayoutDashboard },
    { href: `/creative-workspace/${token}/projects`,      label: "Semua Proyek",     icon: FolderKanban },
    { href: `/creative-workspace/${token}/notifications`, label: "Notifikasi",       icon: Bell },
    { href: `/creative-workspace/${token}/support`,       label: "Bantuan",          icon: LifeBuoy },
  ];
}

export function CWLayout({
  token,
  children,
  title,
  backHref,
}: {
  token: string;
  children: React.ReactNode;
  title?: string;
  backHref?: string;
}) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: notifData } = useCWNotifications(token);
  const unread = notifData?.unreadCount ?? 0;
  const navItems = getNavItems(token);

  const Sidebar = (
    <div className="flex flex-col h-full py-6 px-3">
      {/* Logo */}
      <Link
        href={`/creative-workspace/${token}`}
        className="flex items-center gap-2.5 px-3 mb-8"
        onClick={() => setMobileOpen(false)}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shrink-0"
          style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
        >
          <Sparkles className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <div className="font-bold text-sm text-white leading-none">Creative Workspace</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Studio AI</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5 flex-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? "text-white bg-white/10"
                  : "text-slate-400 hover:text-white hover:bg-white/6"
              }`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: "#6366F1" }}
                />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-indigo-400" : ""}`} />
              <span className="flex-1">{item.label}</span>
              {item.label === "Notifikasi" && unread > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-indigo-500 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs">
        <div className="font-semibold text-indigo-300 mb-1">Perlu Bantuan?</div>
        <div className="text-slate-400">Tim kami siap membantu Anda 24/7.</div>
        <Link
          href={`/creative-workspace/${token}/support`}
          className="mt-2 flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
        >
          <LifeBuoy className="w-3.5 h-3.5" /> Hubungi Support
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "#0D0F14" }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-60 shrink-0 border-r border-white/6"
        style={{ background: "#111318" }}
      >
        {Sidebar}
      </aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-64 z-50 lg:hidden border-r border-white/6"
              style={{ background: "#111318" }}
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/8 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              {Sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-white/6 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/8 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          {backHref && (
            <Link href={backHref} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" /> Kembali
            </Link>
          )}
          {title && <h1 className="text-sm font-semibold text-white truncate">{title}</h1>}
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
            {/* Desktop back link */}
            {backHref && (
              <Link
                href={backHref}
                className="hidden lg:inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6 group"
              >
                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                Kembali
              </Link>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
