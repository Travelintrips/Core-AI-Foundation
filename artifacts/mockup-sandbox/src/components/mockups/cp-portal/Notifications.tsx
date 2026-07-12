import React, { useState } from 'react';
import { 
  LayoutDashboard, FolderOpen, Plus, FileText, Briefcase, 
  Receipt, Bell, User, Settings, CheckCircle, MessageSquare, 
  TrendingUp, DollarSign, X, CheckCircle2, Info, AlertCircle
} from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
    { icon: FolderOpen, label: 'My Projects', href: '/projects' },
    { icon: Plus, label: 'New Request', href: '/new', special: true },
    { icon: FileText, label: 'Quotations', href: '/quotes' },
    { icon: Briefcase, label: 'Workspace', href: '/workspace' },
    { icon: Receipt, label: 'Billing', href: '/billing' },
    { icon: Bell, label: 'Notifications', href: '/notifications', active: true, badge: 5 },
    { icon: User, label: 'Profile', href: '/profile' },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center shadow-sm">
          <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-[#0A1628] leading-tight">Creative AI</span>
          <span className="text-[10px] uppercase tracking-widest text-neutral-400 font-semibold">Studio</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          if (item.special) {
            return (
              <a key={index} href={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-4 my-3 bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors shadow-[0_4px_12px_rgba(249,115,22,0.25)]">
                <Icon size={18} />
                {item.label}
              </a>
            );
          }
          return (
            <a 
              key={index} 
              href={item.href} 
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm mx-2 my-0.5 transition-colors ${
                item.active 
                  ? 'bg-orange-50 text-orange-600 font-medium' 
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className={item.active ? 'text-orange-500' : ''} />
                {item.label}
              </div>
              {item.badge && (
                <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <div className="p-4 border-t border-neutral-100">
        <div className="flex items-center gap-3 hover:bg-neutral-50 p-2 rounded-xl cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white font-medium shadow-sm">
            SR
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium text-[#0A1628] truncate">Siti Rahayu</span>
            <span className="text-xs text-neutral-500 truncate">Batik Nusantara Co.</span>
          </div>
          <Settings size={16} className="text-neutral-400 shrink-0" />
        </div>
      </div>
    </div>
  );
};

export function Notifications() {
  const [activeTab, setActiveTab] = useState('All');
  // State mock to simulate UI
  const [viewState, setViewState] = useState<'normal' | 'loading' | 'empty' | 'error' | 'success'>('normal');

  const tabs = [
    { label: 'All', count: 12 },
    { label: 'Unread', count: 5, hasUnreadBadge: true },
    { label: 'Projects', count: 4 },
    { label: 'Payments', count: 3 },
    { label: 'System', count: 1 },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
      <Sidebar />
      
      <main className="flex-1 flex flex-col max-w-4xl">
        <div className="px-8 pt-10 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight">
              Notifications
            </h1>
            <span className="bg-orange-100 text-orange-600 text-xs font-semibold px-2.5 py-1 rounded-full border border-orange-200">
              5 unread
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button className="text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-3 py-1.5 text-sm font-medium transition-all">
              Mark all as read
            </button>
            <button className="bg-white border border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 rounded-xl p-2 transition-all shadow-sm">
              <Settings size={18} />
            </button>
          </div>
        </div>

        <div className="px-8 pb-4">
          <div className="flex items-center gap-6 border-b border-neutral-200">
            {tabs.map((tab) => (
              <button
                key={tab.label}
                onClick={() => setActiveTab(tab.label)}
                className={`pb-3 relative flex items-center gap-2 text-sm transition-colors ${
                  activeTab === tab.label
                    ? 'text-orange-600 font-medium'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {tab.label}
                <span className={`text-xs ${activeTab === tab.label ? 'text-orange-400' : 'text-neutral-400'}`}>
                  {tab.count}
                </span>
                {tab.hasUnreadBadge && (
                  <span className="-ml-1 -mt-2 bg-orange-500 text-white text-[9px] font-bold px-1 rounded-full">
                    5
                  </span>
                )}
                {activeTab === tab.label && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="px-8 flex-1 overflow-y-auto pb-12">
          {viewState === 'loading' && (
            <div className="space-y-4">
              <div className="animate-pulse bg-neutral-200 rounded-lg h-4 w-24 mb-4"></div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-neutral-100 p-4 flex gap-4 h-24">
                  <div className="animate-pulse bg-neutral-100 rounded-xl w-10 h-10 shrink-0"></div>
                  <div className="flex-1 space-y-2 py-1">
                    <div className="animate-pulse bg-neutral-100 rounded h-4 w-1/3"></div>
                    <div className="animate-pulse bg-neutral-100 rounded h-3 w-3/4"></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewState === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-800">Failed to load notifications</h3>
                <p className="text-sm text-red-600 mt-1">There was a problem connecting to the server. Please try again.</p>
                <button 
                  onClick={() => setViewState('normal')}
                  className="mt-3 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-lg px-4 py-1.5 text-sm font-medium transition-all"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {viewState === 'empty' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4">
                <Bell size={28} className="text-neutral-300" />
              </div>
              <h3 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">
                You're all caught up! 🎉
              </h3>
              <p className="text-neutral-500 text-sm max-w-sm mb-6">
                When there are updates on your projects, quotations, or payments, they will appear here.
              </p>
              <button 
                onClick={() => setViewState('normal')}
                className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95"
              >
                Browse Projects
              </button>
            </div>
          )}

          {viewState === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 mb-6">
              <CheckCircle size={20} className="text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-green-800">All notifications marked as read</h3>
                <p className="text-sm text-green-600 mt-1">Your inbox is clear. Have a productive day!</p>
              </div>
              <button className="text-green-600 hover:bg-green-100 p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>
          )}

          {viewState === 'normal' && (
            <>
              {/* Dev tool for switching states */}
              <div className="hidden">
                <button onClick={() => setViewState('loading')}>Load</button>
                <button onClick={() => setViewState('empty')}>Empty</button>
                <button onClick={() => setViewState('error')}>Error</button>
                <button onClick={() => setViewState('success')}>Success</button>
              </div>

              <div className="mb-8">
                <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-400 mb-3 ml-1">Today</h2>
                <div className="space-y-2">
                  
                  {/* Card 1 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:shadow-[0_4px_16px_rgba(249,115,22,0.08)] transition-all relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500 rounded-l-2xl"></div>
                    <div className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full"></div>
                    <button className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md">
                      <X size={14} />
                    </button>
                    
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                      <FileText size={20} className="text-blue-600" />
                    </div>
                    <div className="flex-1 pr-12">
                      <h3 className="font-semibold text-sm text-[#0A1628]">Deliverable Ready</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5 line-clamp-2">
                        Brand Guidelines PDF v2 is ready for your review
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">2m ago</span>
                        <a href="#" className="text-orange-500 text-xs font-medium hover:underline">View File &rarr;</a>
                      </div>
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:shadow-[0_4px_16px_rgba(249,115,22,0.08)] transition-all relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500 rounded-l-2xl"></div>
                    <div className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full"></div>
                    <button className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md">
                      <X size={14} />
                    </button>
                    
                    <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={20} className="text-green-600" />
                    </div>
                    <div className="flex-1 pr-12">
                      <h3 className="font-semibold text-sm text-[#0A1628]">Quote Approved</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5 line-clamp-2">
                        Quote #QT-2024-0089 approved, payment link sent
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">15m ago</span>
                        <a href="#" className="text-orange-500 text-xs font-medium hover:underline">View Invoice &rarr;</a>
                      </div>
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:shadow-[0_4px_16px_rgba(249,115,22,0.08)] transition-all relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500 rounded-l-2xl"></div>
                    <div className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full"></div>
                    <button className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md">
                      <X size={14} />
                    </button>
                    
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                      <MessageSquare size={20} className="text-purple-600" />
                    </div>
                    <div className="flex-1 pr-12">
                      <h3 className="font-semibold text-sm text-[#0A1628]">New Comment</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5 line-clamp-2">
                        Maya left a comment on Brand Identity project
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">1h ago</span>
                        <a href="#" className="text-orange-500 text-xs font-medium hover:underline">View Comment &rarr;</a>
                      </div>
                    </div>
                  </div>

                  {/* Card 4 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:shadow-[0_4px_16px_rgba(249,115,22,0.08)] transition-all relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500 rounded-l-2xl"></div>
                    <div className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full"></div>
                    <button className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md">
                      <X size={14} />
                    </button>
                    
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <TrendingUp size={20} className="text-amber-600" />
                    </div>
                    <div className="flex-1 pr-12">
                      <h3 className="font-semibold text-sm text-[#0A1628]">Milestone Reached</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-2 line-clamp-2">
                        Social Media Pack is 75% complete — on track for Jul 18
                      </p>
                      
                      <div className="w-full bg-neutral-100 rounded-full h-1.5 mb-2.5 overflow-hidden">
                        <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '75%' }}></div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">3h ago</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 5 */}
                  <div className="group bg-green-50/40 rounded-2xl border border-green-100 p-4 flex items-start gap-4 hover:shadow-[0_4px_16px_rgba(249,115,22,0.08)] transition-all relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500 rounded-l-2xl"></div>
                    <div className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full"></div>
                    <button className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md">
                      <X size={14} />
                    </button>
                    
                    <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                      <DollarSign size={20} className="text-green-600" />
                    </div>
                    <div className="flex-1 pr-12">
                      <h3 className="font-semibold text-sm text-[#0A1628]">Payment Confirmed</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5 line-clamp-2">
                        Rp 13,320,000 received for INV-2024-089
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">5h ago</span>
                        <a href="#" className="text-orange-500 text-xs font-medium hover:underline">View Receipt &rarr;</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-400 mb-3 ml-1">Yesterday</h2>
                <div className="space-y-2 opacity-80">
                  
                  {/* Card 6 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:opacity-100 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0">
                      <Info size={20} className="text-neutral-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-neutral-700">Scheduled Maintenance</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5">
                        System maintenance planned for Jul 13, 2am WIB. Brief downtime expected.
                      </p>
                      <span className="text-xs text-neutral-400">Yesterday</span>
                    </div>
                  </div>

                  {/* Card 7 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:opacity-100 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0">
                      <Briefcase size={20} className="text-neutral-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-neutral-700">Project Started</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5">
                        Website Copywriting initiated by account manager.
                      </p>
                      <span className="text-xs text-neutral-400">Yesterday</span>
                    </div>
                  </div>

                  {/* Card 8 */}
                  <div className="group bg-white rounded-2xl border border-neutral-100 p-4 flex items-start gap-4 hover:opacity-100 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm text-neutral-700">Rate Your Experience</h3>
                      <p className="text-xs text-neutral-500 mt-0.5 mb-1.5">
                        Social Media Pack completed. How did we do?
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-400">Yesterday</span>
                        <a href="#" className="text-orange-500 text-xs font-medium hover:underline">Rate Now &rarr;</a>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </>
          )}

          <div className="mt-8 pt-4 border-t border-neutral-100 flex items-center">
            <a href="#" className="text-sm text-orange-500 font-medium hover:underline">
              Manage notification settings &rarr;
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
