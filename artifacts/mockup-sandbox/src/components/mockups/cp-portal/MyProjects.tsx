import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, FolderOpen, Plus, FileText, Briefcase, 
  Receipt, Bell, User, Settings, Search, ChevronDown, 
  Palette, Share2, PenLine, Video, Megaphone, Target, 
  MoreHorizontal, Eye, Download, FolderOpen as FolderOpenIcon,
  AlertCircle, CheckCircle
} from 'lucide-react';

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    'In Progress': 'bg-blue-50 text-blue-700 border border-blue-100',
    'Review': 'bg-amber-50 text-amber-700 border border-amber-100',
    'Completed': 'bg-green-50 text-green-700 border border-green-100',
    'Pending': 'bg-orange-50 text-orange-700 border border-orange-100',
    'Overdue': 'bg-red-50 text-red-700 border border-red-100'
  };
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${styles[status] || styles['Pending']}`}>
      {status}
    </span>
  );
};

const Sidebar = ({ activePath = '/projects' }: { activePath?: string }) => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: FolderOpen, label: 'My Projects', path: '/projects' },
    { icon: Plus, label: 'New Request', path: '/new', special: true },
    { icon: FileText, label: 'Quotations', path: '/quotes' },
    { icon: Briefcase, label: 'Workspace', path: '/workspace' },
    { icon: Receipt, label: 'Billing', path: '/billing' },
    { icon: Bell, label: 'Notifications', path: '/notifications', badge: '5' },
    { icon: User, label: 'Profile', path: '/profile' }
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0 z-20">
      <div className="p-6 pb-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold text-xl shadow-sm">
          C
        </div>
        <div>
          <h1 className="font-semibold text-[#0A1628] leading-tight">Creative AI</h1>
          <p className="text-[10px] text-neutral-400 font-semibold uppercase tracking-widest">Studio</p>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
        {navItems.map((item, idx) => {
          const isActive = item.path === activePath;
          const Icon = item.icon;
          
          if (item.special) {
            return (
              <div key={idx} className="mx-4 my-4">
                <button className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              </div>
            );
          }
          
          return (
            <button key={idx} className={`w-[calc(100%-16px)] flex items-center justify-between mx-2 my-0.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
              isActive 
                ? 'bg-orange-50 text-orange-600 font-medium' 
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
            }`}>
              <div className="flex items-center gap-3">
                <Icon size={18} className={isActive ? "text-orange-500" : "text-neutral-400"} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="bg-orange-100 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      
      <div className="p-4 border-t border-neutral-100 bg-white">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-neutral-50 cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white font-medium shadow-sm shrink-0">
            SR
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0A1628] truncate">Siti Rahayu</p>
            <p className="text-[11px] text-neutral-500 truncate">Batik Nusantara Co.</p>
          </div>
          <Settings size={16} className="text-neutral-400 shrink-0 hover:text-orange-500 transition-colors" />
        </div>
      </div>
    </div>
  );
};

export function MyProjects() {
  const [activeTab, setActiveTab] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  useEffect(() => {
    // Simulate initial data loading
    const timer = setTimeout(() => setIsLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  const projects = [
    {
      id: 1,
      title: 'Rebranding Nusantara E-commerce',
      client: 'Batik Nusantara Co.',
      service: 'Brand Identity',
      serviceCategory: 'brand',
      progress: 65,
      milestonesCompleted: 3,
      milestonesTotal: 5,
      status: 'In Progress',
      updatedAt: '2h ago'
    },
    {
      id: 2,
      title: 'Ramadan 2024 Instagram Campaign',
      client: 'Batik Nusantara Co.',
      service: 'Social Media',
      serviceCategory: 'social',
      progress: 90,
      milestonesCompleted: 4,
      milestonesTotal: 5,
      status: 'Review',
      updatedAt: '5h ago'
    },
    {
      id: 3,
      title: 'Company Profile Web Copy',
      client: 'Batik Nusantara Co.',
      service: 'Copywriting',
      serviceCategory: 'copy',
      progress: 100,
      milestonesCompleted: 3,
      milestonesTotal: 3,
      status: 'Completed',
      updatedAt: '2d ago'
    },
    {
      id: 4,
      title: 'Product Launch Explainer Video',
      client: 'Batik Nusantara Co.',
      service: 'Video Script',
      serviceCategory: 'video',
      progress: 30,
      milestonesCompleted: 1,
      milestonesTotal: 4,
      status: 'In Progress',
      updatedAt: '1d ago'
    },
    {
      id: 5,
      title: 'Performance Marketing Ads Set',
      client: 'Batik Nusantara Co.',
      service: 'Ad Campaign',
      serviceCategory: 'ad',
      progress: 0,
      milestonesCompleted: 0,
      milestonesTotal: 2,
      status: 'Pending',
      updatedAt: '3d ago'
    },
    {
      id: 6,
      title: 'Q3 Content Strategy Framework',
      client: 'Batik Nusantara Co.',
      service: 'Strategy',
      serviceCategory: 'strategy',
      progress: 100,
      milestonesCompleted: 4,
      milestonesTotal: 4,
      status: 'Completed',
      updatedAt: '1w ago'
    }
  ];

  const getServiceStyles = (category: string) => {
    switch (category) {
      case 'brand': return { bg: 'from-orange-400 to-amber-500', icon: Palette, badge: 'bg-orange-50 text-orange-700' };
      case 'social': return { bg: 'from-blue-500 to-indigo-600', icon: Share2, badge: 'bg-blue-50 text-blue-700' };
      case 'copy': return { bg: 'from-emerald-500 to-teal-600', icon: PenLine, badge: 'bg-emerald-50 text-emerald-700' };
      case 'video': return { bg: 'from-violet-500 to-purple-600', icon: Video, badge: 'bg-violet-50 text-violet-700' };
      case 'ad': return { bg: 'from-rose-500 to-pink-600', icon: Megaphone, badge: 'bg-rose-50 text-rose-700' };
      case 'strategy': return { bg: 'from-cyan-500 to-teal-600', icon: Target, badge: 'bg-cyan-50 text-cyan-700' };
      default: return { bg: 'from-neutral-400 to-neutral-500', icon: FolderOpen, badge: 'bg-neutral-50 text-neutral-700' };
    }
  };

  const tabs = [
    { name: 'All', count: 8 },
    { name: 'In Progress', count: 3 },
    { name: 'Review', count: 2 },
    { name: 'Completed', count: 3 },
  ];

  const filteredProjects = projects.filter(p => {
    const matchesTab = activeTab === 'All' || p.status === activeTab || (activeTab === 'In Progress' && p.status === 'Pending');
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.service.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans text-neutral-800 selection:bg-orange-200 selection:text-orange-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Subtle decorative background gradients */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl pointer-events-none transform translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none transform -translate-x-1/2 translate-y-1/2"></div>

        {/* Header */}
        <div className="px-8 pt-8 pb-0 shrink-0 relative z-10">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight mb-2">
                My Projects
              </h1>
              <p className="text-sm text-neutral-500 font-medium">8 projects total</p>
            </div>
            <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all duration-300 hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2">
              <Plus size={18} />
              New Request
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="px-8 py-4 flex items-center justify-between shrink-0 relative z-10">
          <div className="flex gap-2">
            {tabs.map(tab => (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${
                  activeTab === tab.name
                    ? 'bg-orange-500 text-white shadow-[0_2px_10px_rgba(249,115,22,0.2)]'
                    : 'bg-white border border-neutral-200 text-neutral-600 hover:border-orange-300 hover:text-orange-600'
                }`}
              >
                {tab.name}
                <span className={`text-[10px] px-1.5 rounded-full transition-colors ${
                  activeTab === tab.name ? 'bg-orange-600/30 text-white' : 'bg-neutral-100 text-neutral-500'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          
          <div className="flex gap-3">
            <div className="relative group">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-orange-500 transition-colors" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 bg-white/80 backdrop-blur-sm border border-neutral-200 rounded-xl pl-9 pr-4 py-2 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all placeholder:text-neutral-400 shadow-sm"
              />
            </div>
            <button className="bg-white/80 backdrop-blur-sm border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-4 py-2 text-sm font-medium transition-all shadow-sm flex items-center gap-2 group">
              Latest
              <ChevronDown size={16} className="text-neutral-400 group-hover:text-orange-500 transition-colors" />
            </button>
          </div>
        </div>

        {/* Project Grid / Content Area */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 relative z-10 scrollbar-hide">
          {/* Error and Success states demo (normally rendered conditionally based on state) */}
          {/* <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-red-800">Sync Failed</h4>
                <p className="text-xs text-red-600 mt-1">Unable to load the latest status updates. Please try again.</p>
              </div>
              <button className="text-xs font-semibold text-red-700 hover:text-red-800 bg-red-100/50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">Retry</button>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle className="text-green-600 shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-green-800">Project Approved</h4>
                <p className="text-xs text-green-600 mt-1">"Company Profile Web Copy" has been successfully approved.</p>
              </div>
            </div>
          </div> */}

          {isLoading ? (
            <div className="grid grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] overflow-hidden">
                  <div className="h-36 bg-neutral-100 animate-pulse relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="h-4 w-24 bg-neutral-100 rounded animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-5 w-full bg-neutral-100 rounded animate-pulse" />
                      <div className="h-5 w-2/3 bg-neutral-100 rounded animate-pulse" />
                    </div>
                    <div className="h-3 w-32 bg-neutral-100 rounded animate-pulse" />
                    <div className="pt-2">
                      <div className="flex justify-between mb-1.5">
                        <div className="h-3 w-8 bg-neutral-100 rounded animate-pulse" />
                        <div className="h-3 w-20 bg-neutral-100 rounded animate-pulse" />
                      </div>
                      <div className="h-1.5 w-full bg-neutral-100 rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="px-4 pb-4 pt-2 flex justify-between items-center">
                    <div className="h-6 w-20 bg-neutral-100 rounded-full animate-pulse" />
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-10 bg-neutral-100 rounded animate-pulse" />
                      <div className="h-4 w-4 bg-neutral-100 rounded-sm animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="space-y-8">
              <div className="grid grid-cols-3 gap-5">
                {filteredProjects.map(project => {
                  const style = getServiceStyles(project.serviceCategory);
                  const Icon = style.icon;
                  const progressColor = project.status === 'Completed' ? 'bg-green-500' : project.status === 'Review' ? 'bg-amber-500' : 'bg-orange-500';
                  
                  return (
                    <div key={project.id} className="group bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.10)] hover:-translate-y-0.5 transition-all duration-300 flex flex-col relative overflow-hidden">
                      
                      {/* Top highlight bar */}
                      <div className={`h-1 w-full bg-gradient-to-r ${style.bg} absolute top-0 left-0 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>

                      {/* Thumbnail */}
                      <div className={`h-36 rounded-t-2xl overflow-hidden bg-gradient-to-br ${style.bg} relative flex items-center justify-center shrink-0`}>
                        {/* Subtle grid pattern */}
                        <div className="absolute inset-0 opacity-[0.15]" 
                             style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '16px 16px' }}></div>
                        
                        {/* Soft overlay gradient */}
                        <div className="absolute inset-0 bg-black/5 group-hover:bg-black/0 transition-colors duration-500"></div>
                        
                        <Icon size={48} className="text-white/90 z-10 drop-shadow-[0_4px_12px_rgba(0,0,0,0.15)] group-hover:scale-110 transition-transform duration-500 ease-out" strokeWidth={1.5} />
                        
                        {/* Quick action overlay on hover */}
                        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 z-20">
                          <button className="w-8 h-8 rounded-full bg-white/25 backdrop-blur-md flex items-center justify-center text-white hover:bg-white hover:text-[#0A1628] hover:shadow-lg transition-all duration-200">
                            <Eye size={14} />
                          </button>
                          <button className="w-8 h-8 rounded-full bg-white/25 backdrop-blur-md flex items-center justify-center text-white hover:bg-white hover:text-[#0A1628] hover:shadow-lg transition-all duration-200">
                            <Download size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="p-4 flex-1 flex flex-col relative bg-white">
                        <div className="mb-3 flex items-start justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${style.badge}`}>
                            {project.service}
                          </span>
                        </div>
                        
                        <h3 className="font-semibold text-[#0A1628] text-sm line-clamp-2 mb-1.5 leading-snug group-hover:text-orange-600 transition-colors">
                          {project.title}
                        </h3>
                        <p className="text-xs text-neutral-400 mb-5 font-medium">
                          {project.client}
                        </p>
                        
                        <div className="mt-auto">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[11px] font-bold text-neutral-700">{project.progress}%</span>
                            <span className="text-[10px] text-neutral-400 font-medium tracking-wide uppercase">{project.milestonesCompleted}/{project.milestonesTotal} milestones</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${progressColor} transition-all duration-1000 ease-out`} 
                              style={{ width: `${project.progress}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="px-4 pb-4 flex justify-between items-center border-t border-neutral-50/50 pt-3 bg-white">
                        <StatusBadge status={project.status} />
                        <div className="flex items-center gap-2 text-neutral-400">
                          <span className="text-[11px] font-medium">{project.updatedAt}</span>
                          <button className="hover:text-[#0A1628] hover:bg-neutral-100 p-1.5 rounded transition-colors group/btn">
                            <MoreHorizontal size={16} className="group-hover/btn:scale-110 transition-transform" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More */}
              {filteredProjects.length > 0 && (
                <div className="flex flex-col items-center gap-3 pt-4 pb-8">
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-widest">Showing {filteredProjects.length} of {projects.length} projects</p>
                  <button className="bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-6 py-2.5 text-sm font-medium transition-all shadow-sm hover:shadow-md">
                    Load More Projects
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center -mt-10">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-neutral-100 relative">
                <div className="absolute inset-0 rounded-full border border-orange-500/10 scale-[1.3]"></div>
                <div className="absolute inset-0 rounded-full border border-orange-500/5 scale-[1.6]"></div>
                <FolderOpenIcon size={40} className="text-neutral-300" strokeWidth={1.5} />
              </div>
              <h3 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">
                No projects found
              </h3>
              <p className="text-sm text-neutral-500 mb-6 max-w-sm text-center">
                {searchQuery ? `We couldn't find any projects matching "${searchQuery}". Try adjusting your filters or search terms.` : 'Start a new service request to see your projects here.'}
              </p>
              <button 
                onClick={() => setSearchQuery('')}
                className={searchQuery 
                  ? "bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-6 py-2.5 text-sm font-medium transition-all shadow-sm"
                  : "bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2"
                }
              >
                {searchQuery ? 'Clear Search' : <><Plus size={18} /> New Request</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
