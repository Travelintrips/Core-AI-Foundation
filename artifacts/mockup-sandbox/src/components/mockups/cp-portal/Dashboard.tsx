import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, FolderOpen, Plus, FileText, Briefcase, 
  Receipt, Bell, User, Settings, ArrowRight, Download, 
  MessageSquare, ChevronRight, CheckCircle, AlertCircle, 
  Clock, TrendingUp, Palette, CheckCircle2, Copy, Send, PlayCircle, Loader2, Sparkles, FolderKanban
} from 'lucide-react';

// StatusBadge Component
const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'In Progress':
      return <span className="bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">In Progress</span>;
    case 'Review Needed':
    case 'Review':
      return <span className="bg-amber-50 text-amber-700 border border-amber-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Review Needed</span>;
    case 'Completed':
      return <span className="bg-green-50 text-green-700 border border-green-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Completed</span>;
    case 'Pending':
      return <span className="bg-orange-50 text-orange-700 border border-orange-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Pending</span>;
    case 'Overdue':
      return <span className="bg-red-50 text-red-700 border border-red-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Overdue</span>;
    default:
      return <span className="bg-neutral-100 text-neutral-600 border border-neutral-200 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">{status}</span>;
  }
};

// Sidebar Component
const Sidebar = ({ activePath }: { activePath: string }) => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
    { icon: FolderOpen, label: 'My Projects', href: '/projects' },
    { icon: Plus, label: 'New Request', href: '/new', isSpecial: true },
    { icon: FileText, label: 'Quotations', href: '/quotes' },
    { icon: Briefcase, label: 'Workspace', href: '/workspace' },
    { icon: Receipt, label: 'Billing', href: '/billing' },
    { icon: Bell, label: 'Notifications', href: '/notifications', badge: 5 },
    { icon: User, label: 'Profile', href: '/profile' },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0 z-20">
      <div className="p-6 pb-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-[#0A1628] leading-none">Creative AI</span>
          <span className="text-[10px] text-neutral-400 font-semibold uppercase tracking-widest mt-1">Studio</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          const isActive = activePath === item.href;

          if (item.isSpecial) {
            return (
              <a key={idx} href={item.href} onClick={(e) => e.preventDefault()} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-4 my-4 bg-orange-500 text-white font-medium hover:bg-orange-600 transition-all shadow-[0_4px_16px_rgba(249,115,22,0.3)] active:scale-95 group">
                <Icon className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                <span>{item.label}</span>
              </a>
            );
          }

          return (
            <a key={idx} href={item.href} onClick={(e) => e.preventDefault()} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-4 my-1 transition-all ${
              isActive 
                ? 'bg-orange-50 text-orange-600 font-medium' 
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 font-medium'
            }`}>
              <Icon className="w-4 h-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="bg-orange-100 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="p-4 border-t border-neutral-100">
        <div className="flex items-center gap-3 px-2 py-2 hover:bg-neutral-50 rounded-xl transition-all cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white font-semibold text-xs shadow-inner">
            SR
          </div>
          <div className="flex flex-col flex-1">
            <span className="text-sm font-semibold text-[#0A1628] leading-tight">Siti Rahayu</span>
            <span className="text-[11px] text-neutral-500 truncate w-[110px]">Batik Nusantara Co.</span>
          </div>
          <Settings className="w-4 h-4 text-neutral-400 group-hover:text-[#0A1628] transition-colors" />
        </div>
      </div>
    </div>
  );
};

export function Dashboard() {
  const [appState, setAppState] = useState<'loading' | 'error' | 'empty' | 'success' | 'normal'>('loading');

  // Simulate initial loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppState('normal');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const triggerState = (state: 'loading' | 'error' | 'empty' | 'success' | 'normal') => {
    setAppState(state);
    if (state !== 'normal' && state !== 'empty') {
      setTimeout(() => setAppState('normal'), 3000);
    }
  };

  const recentProjects = [
    { name: "Brand Identity Redesign", type: "Brand Identity", icon: Palette, progress: 65, status: "In Progress", color: "blue", updated: "2h ago" },
    { name: "Social Media Pack Q3", type: "Social Media", icon: Send, progress: 90, status: "Review Needed", color: "amber", updated: "5h ago" },
    { name: "Website Copywriting", type: "Copywriting", icon: Copy, progress: 100, status: "Completed", color: "green", updated: "1d ago" },
  ];

  const recentActivity = [
    { text: "Brand Guidelines PDF ready", time: "2m ago", color: "bg-green-500" },
    { text: "Quote approved by team", time: "15m ago", color: "bg-blue-500" },
    { text: "Milestone reached: 75%", time: "3h ago", color: "bg-orange-500" },
    { text: "Payment confirmed Rp 13.3M", time: "5h ago", color: "bg-purple-500" },
    { text: "Project kickoff: Website Copy", time: "Yesterday", color: "bg-neutral-400" },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans text-neutral-600">
      <Sidebar activePath="/" />

      <div className="flex-1 flex flex-col overflow-x-hidden">
        
        {/* Helper to switch states - invisible in actual use, just for demo purposes */}
        <div className="fixed bottom-4 right-4 z-50 flex gap-2 bg-white/80 backdrop-blur-md p-2 rounded-xl shadow-lg border border-neutral-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 self-center px-2">States</span>
          <button onClick={() => triggerState('loading')} className="px-3 py-1 bg-neutral-100 hover:bg-neutral-200 text-xs rounded-md">Loading</button>
          <button onClick={() => triggerState('error')} className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs rounded-md">Error</button>
          <button onClick={() => triggerState('success')} className="px-3 py-1 bg-green-50 hover:bg-green-100 text-green-600 text-xs rounded-md">Success</button>
          <button onClick={() => triggerState('empty')} className="px-3 py-1 bg-neutral-100 hover:bg-neutral-200 text-xs rounded-md">Empty</button>
          <button onClick={() => setAppState('normal')} className="px-3 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 font-medium text-xs rounded-md">Normal</button>
        </div>

        {appState === 'loading' ? (
          <div className="p-8 w-full max-w-6xl mx-auto space-y-8 animate-pulse">
            <div className="h-40 bg-white rounded-2xl border border-neutral-100" />
            <div className="grid grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-neutral-100" />)}
            </div>
            <div className="grid grid-cols-5 gap-6">
              <div className="col-span-3 space-y-4">
                <div className="h-8 w-48 bg-neutral-200 rounded-lg" />
                {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-neutral-100" />)}
              </div>
              <div className="col-span-2 space-y-4">
                <div className="h-8 w-32 bg-neutral-200 rounded-lg" />
                <div className="h-64 bg-white rounded-xl border border-neutral-100" />
              </div>
            </div>
          </div>
        ) : appState === 'empty' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mb-6">
              <FolderKanban className="w-10 h-10 text-orange-400" />
            </div>
            <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">No projects yet</h2>
            <p className="text-neutral-500 mb-8 max-w-sm text-center">You haven't started any projects with us yet. Create a new request to get started.</p>
            <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Start New Request
            </button>
          </div>
        ) : (
          <>
            {/* Global Messages */}
            {appState === 'error' && (
              <div className="m-8 mb-0 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <span className="text-sm text-red-700 flex-1 font-medium">Failed to synchronize latest project data. Please check your connection.</span>
                <button onClick={() => setAppState('normal')} className="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 transition-colors">
                  Retry
                </button>
              </div>
            )}
            
            {appState === 'success' && (
              <div className="m-8 mb-0 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <span className="text-sm text-green-700 flex-1 font-medium">Your request for "Website Copywriting" was approved successfully.</span>
              </div>
            )}

            {/* Hero Bar */}
            <div className="bg-gradient-to-r from-orange-50/80 via-orange-50/30 to-amber-50/20 px-10 py-10 pb-8 border-b border-orange-100/50">
              <div className="max-w-6xl mx-auto flex items-end justify-between">
                <div>
                  <div className="text-xs font-semibold tracking-widest uppercase text-orange-500 mb-3 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" /> {new Date().toLocaleDateString('en-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                  <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight mb-2">
                    Good morning, Siti <span className="text-orange-400">✦</span>
                  </h1>
                  <p className="text-neutral-500 text-[15px]">You have 3 active projects and 2 quotes awaiting review.</p>
                </div>
                
                <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-3 text-sm font-semibold transition-all shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> New Request
                </button>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 max-w-6xl w-full mx-auto pb-12 w-full">
              
              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-5 px-10 py-8">
                {/* Card 1 */}
                <div className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.08)] hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-md">+1 this month</span>
                  </div>
                  <div className="text-3xl font-bold text-[#0A1628] mb-1 font-['Playfair_Display']">4</div>
                  <div className="text-sm font-medium text-neutral-500">Active Projects</div>
                </div>

                {/* Card 2 */}
                <div className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.08)] hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                      <FileText className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-neutral-400 bg-neutral-50 px-2 py-1 rounded-md">respond by Jul 15</span>
                  </div>
                  <div className="text-3xl font-bold text-[#0A1628] mb-1 font-['Playfair_Display']">2</div>
                  <div className="text-sm font-medium text-neutral-500">Pending Quotes</div>
                </div>

                {/* Card 3 */}
                <div className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.08)] hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
                      <Download className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-md">3 new</span>
                  </div>
                  <div className="text-3xl font-bold text-[#0A1628] mb-1 font-['Playfair_Display']">7</div>
                  <div className="text-sm font-medium text-neutral-500">Ready to Download</div>
                </div>

                {/* Card 4 */}
                <div className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.08)] hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-1 rounded-md flex items-center gap-1">
                      ↑ 23% growth
                    </span>
                  </div>
                  <div className="text-3xl font-bold text-[#0A1628] mb-1 font-['Playfair_Display']">Rp 52.8M</div>
                  <div className="text-sm font-medium text-neutral-500">Total Investment</div>
                </div>
              </div>

              {/* Two-Column Layout */}
              <div className="grid grid-cols-5 gap-8 px-10">
                
                {/* Left Column - Recent Projects */}
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628]">Recent Projects</h2>
                    <a href="/projects" className="text-sm font-semibold text-orange-500 hover:text-orange-600 flex items-center gap-1 group">
                      View All <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </a>
                  </div>

                  <div className="space-y-3">
                    {recentProjects.map((project, i) => {
                      const PIcon = project.icon;
                      const getBgColor = (color: string) => {
                        if (color === 'blue') return 'bg-blue-50 text-blue-600';
                        if (color === 'amber') return 'bg-amber-50 text-amber-600';
                        if (color === 'green') return 'bg-green-50 text-green-600';
                        return 'bg-neutral-50 text-neutral-600';
                      };
                      const getAccentColor = (color: string) => {
                        if (color === 'blue') return 'bg-blue-500';
                        if (color === 'amber') return 'bg-amber-500';
                        if (color === 'green') return 'bg-green-500';
                        return 'bg-neutral-500';
                      };

                      return (
                        <div key={i} className="flex items-center p-5 bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_20px_rgba(249,115,22,0.08)] transition-all cursor-pointer group relative overflow-hidden">
                          {/* Accent line */}
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${getAccentColor(project.color)}`} />
                          
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-2 ${getBgColor(project.color)}`}>
                            <PIcon className="w-5 h-5" />
                          </div>
                          
                          <div className="ml-4 flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="font-semibold text-[#0A1628] text-base group-hover:text-orange-600 transition-colors">{project.name}</h3>
                              <StatusBadge status={project.status} />
                            </div>
                            
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-neutral-500">{project.type}</span>
                              <span className="text-neutral-400 text-xs">Updated {project.updated}</span>
                            </div>
                            
                            <div className="mt-3 flex items-center gap-3">
                              <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${project.progress === 100 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${project.progress}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-neutral-700 w-8">{project.progress}%</span>
                            </div>
                          </div>

                          <div className="ml-4 shrink-0 text-neutral-300 group-hover:text-orange-400 transition-colors">
                            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column - Quick Actions & Activity */}
                <div className="col-span-2">
                  <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.02)] p-6 mb-6">
                    <h3 className="font-['Playfair_Display'] text-xl font-semibold text-[#0A1628] mb-4">Quick Actions</h3>
                    
                    <div className="space-y-3">
                      <button className="w-full flex items-center justify-between p-4 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors shadow-sm group">
                        <div className="flex items-center gap-3">
                          <Plus className="w-5 h-5" />
                          <span className="font-semibold text-sm">Start New Request</span>
                        </div>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>

                      <button className="w-full flex items-center justify-between p-4 bg-white border border-neutral-200 text-neutral-700 rounded-xl hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50 transition-all group">
                        <div className="flex items-center gap-3">
                          <Download className="w-5 h-5 text-neutral-400 group-hover:text-orange-500 transition-colors" />
                          <span className="font-medium text-sm">Download Files</span>
                        </div>
                      </button>

                      <button className="w-full flex items-center justify-between p-4 bg-white border border-neutral-200 text-neutral-700 rounded-xl hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50 transition-all group">
                        <div className="flex items-center gap-3">
                          <MessageSquare className="w-5 h-5 text-neutral-400 group-hover:text-orange-500 transition-colors" />
                          <span className="font-medium text-sm">Contact Support</span>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.02)] p-6">
                    <h3 className="font-['Playfair_Display'] text-lg font-semibold text-[#0A1628] mb-5">Recent Activity</h3>
                    
                    <div className="space-y-5">
                      {recentActivity.map((activity, i) => (
                        <div key={i} className="flex gap-4 relative">
                          {/* Vertical line connecting dots */}
                          {i !== recentActivity.length - 1 && (
                            <div className="absolute left-1.5 top-5 bottom-[-20px] w-px bg-neutral-100" />
                          )}
                          
                          <div className={`w-3 h-3 rounded-full mt-1.5 shrink-0 z-10 shadow-sm outline outline-2 outline-white ${activity.color}`} />
                          
                          <div>
                            <p className="text-sm font-medium text-[#0A1628]">{activity.text}</p>
                            <span className="text-xs text-neutral-400 mt-0.5 block">{activity.time}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
