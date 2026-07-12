import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  FolderOpen, 
  Plus, 
  FileText, 
  Briefcase, 
  Receipt, 
  Bell, 
  User, 
  Settings,
  Sparkles,
  ChevronRight,
  Share2,
  Download,
  MessageSquare,
  Clock,
  CheckCircle2,
  Lock,
  History,
  Send,
  MoreVertical,
  AlertCircle,
  File
} from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/', active: false },
    { icon: FolderOpen, label: 'My Projects', href: '/projects', active: false },
    { icon: Plus, label: 'New Request', href: '/new', active: false, special: true },
    { icon: FileText, label: 'Quotations', href: '/quotes', active: false },
    { icon: Briefcase, label: 'Workspace', href: '/workspace', active: true },
    { icon: Receipt, label: 'Billing', href: '/billing', active: false },
    { icon: Bell, label: 'Notifications', href: '/notifications', active: false, badge: '5' },
    { icon: User, label: 'Profile', href: '/profile', active: false },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-[#0A1628] leading-tight">Creative AI</div>
            <div className="text-xs text-neutral-400">Studio</div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2">
        {navItems.map((item, i) => (
          <a
            key={i}
            href={item.href}
            onClick={(e) => e.preventDefault()}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-2 my-0.5 transition-all ${
              item.special
                ? 'bg-orange-500 text-white font-medium hover:bg-orange-600 shadow-[0_4px_16px_rgba(249,115,22,0.35)] mt-4 mb-2'
                : item.active
                ? 'bg-orange-50 text-orange-600 font-medium'
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
            }`}
          >
            <item.icon className={`w-4 h-4 ${item.active || item.special ? 'opacity-100' : 'opacity-70'}`} />
            <span className="flex-1">{item.label}</span>
            {item.badge && (
              <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {item.badge}
              </span>
            )}
          </a>
        ))}
      </div>

      <div className="p-4 border-t border-neutral-100 mt-auto">
        <div className="flex items-center gap-3 p-2 hover:bg-neutral-50 rounded-xl cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white font-medium text-sm">
            SR
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[#0A1628] truncate">Siti Rahayu</div>
            <div className="text-xs text-neutral-400 truncate">Batik Nusantara Co.</div>
          </div>
          <Settings className="w-4 h-4 text-neutral-400" />
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: 'In Progress' | 'Review' | 'Completed' | 'Pending' | 'Overdue' }) => {
  const styles = {
    'In Progress': 'bg-blue-50 text-blue-700 border-blue-100',
    'Review': 'bg-amber-50 text-amber-700 border-amber-100',
    'Completed': 'bg-green-50 text-green-700 border-green-100',
    'Pending': 'bg-orange-50 text-orange-700 border-orange-100',
    'Overdue': 'bg-red-50 text-red-700 border-red-100',
  };

  return (
    <span className={`border text-xs font-semibold px-3 py-1 rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
};

export function Workspace() {
  const [activeTab, setActiveTab] = useState('Deliverables');
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <div className="flex-1 p-8">
          <div className="animate-pulse bg-neutral-100 rounded-lg h-8 w-64 mb-6"></div>
          <div className="animate-pulse bg-neutral-100 rounded-lg h-12 w-full mb-8"></div>
          <div className="grid grid-cols-5 gap-6">
            <div className="col-span-2 space-y-4">
              <div className="animate-pulse bg-neutral-100 rounded-lg h-24 w-full"></div>
              <div className="animate-pulse bg-neutral-100 rounded-lg h-24 w-full"></div>
            </div>
            <div className="col-span-3">
              <div className="animate-pulse bg-neutral-100 rounded-lg h-96 w-full"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md w-full text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to load workspace</h3>
            <p className="text-sm text-red-600 mb-6">There was an error retrieving the project details. Please try again.</p>
            <button 
              onClick={() => setHasError(false)}
              className="bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-xl px-5 py-2.5 text-sm font-medium transition-all"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-neutral-400" />
            </div>
            <h3 className="text-xl font-semibold text-[#0A1628] mb-2">No deliverables yet</h3>
            <p className="text-sm text-neutral-500 mb-6">This project doesn't have any files or deliverables uploaded.</p>
            <button 
              onClick={() => setIsEmpty(false)}
              className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95"
            >
              Upload First File
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
      <Sidebar />
      
      <main className="flex-1 flex flex-col min-w-0">
        {/* Project Header */}
        <header className="px-8 pt-6 pb-0 bg-white border-b border-neutral-100">
          <div className="flex items-center text-sm text-neutral-500 mb-4">
            <span className="hover:text-neutral-800 cursor-pointer transition-colors">My Projects</span>
            <ChevronRight className="w-4 h-4 mx-2 text-neutral-300" />
            <span className="text-[#0A1628] font-medium">Brand Identity Redesign</span>
          </div>

          {isSuccess && (
             <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 mb-6 relative">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-green-800">Successfully downloaded!</h4>
                <p className="text-xs text-green-600 mt-0.5">Your files have been successfully saved to your computer.</p>
              </div>
              <button onClick={() => setIsSuccess(false)} className="absolute top-4 right-4 text-green-600 hover:text-green-800">
                  <span className="sr-only">Dismiss</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          )}
          
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight">
                Brand Identity Redesign
              </h1>
              <StatusBadge status="In Progress" />
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 transform -rotate-90">
                    <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-neutral-100" />
                    <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray="150" strokeDashoffset="48" className="text-orange-500" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-[#0A1628]">68%</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center">
                <div className="flex -space-x-2 mr-4">
                  <div className="w-8 h-8 rounded-full border-2 border-white bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white text-xs font-medium z-30">SR</div>
                  <div className="w-8 h-8 rounded-full border-2 border-white bg-gradient-to-br from-blue-400 to-indigo-300 flex items-center justify-center text-white text-xs font-medium z-20">AJ</div>
                  <div className="w-8 h-8 rounded-full border-2 border-white bg-gradient-to-br from-emerald-400 to-teal-300 flex items-center justify-center text-white text-xs font-medium z-10">MK</div>
                </div>
                <button className="text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-3 py-1.5 text-sm transition-all flex items-center gap-2 font-medium">
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex gap-8 border-t border-transparent">
            {['Deliverables', 'Brief', 'Activity', 'Files', 'Settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-4 text-sm font-medium transition-colors relative ${
                  activeTab === tab 
                    ? 'text-orange-600' 
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {tab}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-full"></div>
                )}
              </button>
            ))}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-[#FAFAF8]">
          <div className="grid grid-cols-5 gap-6 px-8 py-6">
            
            {/* Left Panel: Deliverable List */}
            <div className="col-span-2 space-y-6">
              
              {/* Ready for Review Section */}
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] overflow-hidden">
                <div className="p-4 border-b border-neutral-100 flex items-center gap-2 bg-gradient-to-br from-white to-neutral-50/50">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <h3 className="font-semibold text-sm text-[#0A1628]">Ready for Review (3)</h3>
                </div>
                
                <div className="p-2 flex flex-col gap-1">
                  {/* Item 1 */}
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-orange-50/50 cursor-pointer transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-yellow-100 text-yellow-600 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#0A1628] truncate group-hover:text-orange-700 transition-colors">Logo Package.zip</span>
                        <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">ZIP</span>
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5 flex items-center gap-2">
                        <span>45.2MB</span>
                        <span className="w-1 h-1 rounded-full bg-neutral-300"></span>
                        <span>Final</span>
                      </div>
                    </div>
                    <div className="flex items-center text-green-600 gap-1 text-xs font-medium pr-1">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Item 2 (Active) */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50/80 cursor-pointer border border-orange-100/50 shadow-sm relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500"></div>
                    <div className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#0A1628] truncate">Brand Guidelines.pdf</span>
                        <span className="bg-red-50 text-red-600 border border-red-100 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">PDF</span>
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2">
                        <span>12.8MB</span>
                        <span className="w-1 h-1 rounded-full bg-neutral-300"></span>
                        <span className="font-medium text-orange-600">v2</span>
                      </div>
                    </div>
                    <div className="flex items-center text-amber-500 gap-1 text-xs font-medium pr-1">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Item 3 */}
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-orange-50/50 cursor-pointer transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#0A1628] truncate group-hover:text-orange-700 transition-colors">Color Palette.png</span>
                        <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">PNG</span>
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5 flex items-center gap-2">
                        <span>2.1MB</span>
                      </div>
                    </div>
                    <div className="flex items-center text-green-600 gap-1 text-xs font-medium pr-1">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>

              {/* In Progress Section */}
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] overflow-hidden">
                <div className="p-4 border-b border-neutral-100 flex items-center gap-2 bg-gradient-to-br from-white to-neutral-50/50">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <h3 className="font-semibold text-sm text-[#0A1628]">In Progress (2)</h3>
                </div>
                
                <div className="p-2 flex flex-col gap-1">
                  <div className="flex items-center gap-3 p-3 rounded-xl opacity-60">
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 text-neutral-400 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-600 truncate">Website Mockup.fig</span>
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        Expected Jul 15
                      </div>
                    </div>
                    <div className="pr-2">
                      <Lock className="w-4 h-4 text-neutral-300" />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-xl opacity-60">
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 text-neutral-400 flex items-center justify-center shrink-0">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-600 truncate">Social Templates</span>
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        Expected Jul 18
                      </div>
                    </div>
                    <div className="pr-2">
                      <Lock className="w-4 h-4 text-neutral-300" />
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Panel: Preview Area */}
            <div className="col-span-3 flex flex-col gap-6">
              
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-6">
                
                {/* Tabs / File Name */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-2">
                    <div className="bg-orange-50 text-orange-700 px-4 py-1.5 rounded-full text-sm font-medium border border-orange-100 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Brand Guidelines.pdf
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 bg-neutral-50 px-3 py-1.5 rounded-full border border-neutral-100">
                    <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs text-neutral-500 font-medium">Generated by Claude Sonnet · Jul 5</span>
                  </div>
                </div>

                {/* Preview Frame */}
                <div className="rounded-xl border border-neutral-200 bg-neutral-100 h-72 overflow-hidden relative flex items-center justify-center mb-6 shadow-inner">
                  {/* Decorative Background Pattern */}
                  <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
                  
                  {/* Abstract Document Visual */}
                  <div className="relative w-64 h-80 bg-white shadow-xl transform rotate-2 rounded-sm border border-neutral-200 overflow-hidden mt-12 flex flex-col">
                    <div className="h-24 bg-gradient-to-br from-[#0A1628] to-[#1A2C4D] p-6 text-white flex flex-col justify-end">
                      <div className="w-12 h-12 bg-white/10 rounded-lg mb-2"></div>
                      <div className="h-4 w-3/4 bg-white/20 rounded"></div>
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="h-2 w-full bg-neutral-100 rounded"></div>
                      <div className="h-2 w-5/6 bg-neutral-100 rounded"></div>
                      <div className="h-2 w-4/6 bg-neutral-100 rounded"></div>
                      
                      <div className="grid grid-cols-3 gap-2 mt-6">
                        <div className="h-12 bg-orange-100 rounded"></div>
                        <div className="h-12 bg-blue-100 rounded"></div>
                        <div className="h-12 bg-emerald-100 rounded"></div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Page 2 Behind */}
                  <div className="absolute w-64 h-80 bg-white shadow-md transform -rotate-3 rounded-sm border border-neutral-200 -z-10 mt-12 opacity-80"></div>

                  {/* Watermark */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-6xl font-black text-neutral-900/5 transform -rotate-12 select-none tracking-widest">PREVIEW</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mb-8 pb-8 border-b border-neutral-100">
                  <div className="flex items-center gap-3">
                    <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2">
                      <Download className="w-4 h-4" />
                      Download PDF
                    </button>
                    <button className="bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-5 py-2.5 text-sm font-medium transition-all flex items-center gap-2">
                      <Share2 className="w-4 h-4" />
                      Share
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button className="text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-3 py-2 text-sm transition-all flex items-center gap-2 font-medium">
                      <History className="w-4 h-4" />
                      Version History
                    </button>
                  </div>
                </div>

                {/* Version History Collapsible (Open) */}
                <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-100 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-[#0A1628]">Version History</h4>
                  </div>
                  <div className="space-y-4">
                    <div className="flex gap-4 relative">
                      <div className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 z-10 shrink-0"></div>
                      <div className="absolute left-[3px] top-3 bottom-[-24px] w-0.5 bg-neutral-200"></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-orange-600">v2 (current)</span>
                          <span className="text-xs text-neutral-400">— Jul 5, 2:30 PM</span>
                        </div>
                        <p className="text-sm text-neutral-600 mt-1">Refined logo mark, updated color palette per feedback from yesterday's meeting.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="w-2 h-2 rounded-full bg-neutral-300 mt-1.5 z-10 shrink-0"></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-neutral-500">v1</span>
                          <span className="text-xs text-neutral-400">— Jun 28, 10:15 AM</span>
                        </div>
                        <p className="text-sm text-neutral-500 mt-1">Initial concept delivery including 3 directions.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Comments Section */}
                <div>
                  <h4 className="text-sm font-semibold text-[#0A1628] flex items-center gap-2 mb-4">
                    <MessageSquare className="w-4 h-4 text-neutral-400" />
                    Comments (1)
                  </h4>
                  
                  <div className="space-y-4 mb-6">
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full border border-neutral-200 bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white text-xs font-medium shrink-0">SR</div>
                      <div className="flex-1">
                        <div className="bg-neutral-50 border border-neutral-100 rounded-2xl rounded-tl-none p-3 text-sm text-neutral-700">
                          <span className="font-semibold text-[#0A1628] mr-2">Siti Rahayu</span>
                          Looks great! Can we adjust the orange to be slightly warmer in the secondary palette?
                        </div>
                        <div className="flex gap-3 mt-1.5 px-1">
                          <button className="text-xs font-medium text-neutral-400 hover:text-orange-500 transition-colors">Like</button>
                          <button className="text-xs font-medium text-neutral-400 hover:text-orange-500 transition-colors">Reply</button>
                          <span className="text-xs text-neutral-400">2h ago</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-3 items-center">
                    <div className="w-8 h-8 rounded-full border border-neutral-200 bg-gradient-to-br from-blue-400 to-indigo-300 flex items-center justify-center text-white text-xs font-medium shrink-0">AJ</div>
                    <div className="flex-1 relative">
                      <input 
                        type="text" 
                        placeholder="Add a comment..." 
                        className="w-full bg-white border border-neutral-200 rounded-full pl-4 pr-12 py-2 text-sm focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 transition-all placeholder:text-neutral-400"
                      />
                      <button className="absolute right-1.5 top-1.5 w-7 h-7 bg-orange-500 hover:bg-orange-600 text-white rounded-full flex items-center justify-center transition-colors">
                        <Send className="w-3.5 h-3.5 ml-0.5" />
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
            
          </div>
        </div>
      </main>
    </div>
  );
}

export default Workspace;
