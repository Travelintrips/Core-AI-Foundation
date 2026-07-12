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
  Camera,
  Edit2,
  CheckCircle,
  Shield,
  CreditCard,
  Users,
  Link2,
  Trash2,
  AlertCircle,
  Check,
  ChevronDown,
  Star
} from 'lucide-react';

// --- Shared Helper Components ---

function StatusBadge({ status }: { status: 'In Progress' | 'Review' | 'Completed' | 'Pending' | 'Overdue' }) {
  const styles = {
    'In Progress': 'bg-blue-50 text-blue-700 border border-blue-100',
    'Review': 'bg-amber-50 text-amber-700 border border-amber-100',
    'Completed': 'bg-green-50 text-green-700 border border-green-100',
    'Pending': 'bg-orange-50 text-orange-700 border border-orange-100',
    'Overdue': 'bg-red-50 text-red-700 border border-red-100',
  };

  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 w-full">
      <div className="animate-pulse bg-neutral-100 rounded-lg h-32 w-full"></div>
      <div className="animate-pulse bg-neutral-100 rounded-lg h-8 w-2/3"></div>
      <div className="animate-pulse bg-neutral-100 rounded-lg h-8 w-1/2"></div>
    </div>
  );
}

function EmptyState({ item, onAction }: { item: string, onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-neutral-100 border-dashed text-center">
      <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-4 text-neutral-400">
        <FolderOpen size={32} strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold text-[#0A1628] mb-2">No {item} yet</h3>
      <p className="text-sm text-neutral-500 mb-6 max-w-md">
        There are currently no {item.toLowerCase()} to display in this section.
      </p>
      {onAction && (
        <button onClick={onAction} className="bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-5 py-2.5 text-sm font-medium transition-all">
          Create {item}
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string, onRetry?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-4">
      <div className="text-red-500 mt-0.5">
        <AlertCircle size={20} />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-semibold text-red-800 mb-1">Something went wrong</h4>
        <p className="text-sm text-red-700 mb-3">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="text-xs font-medium bg-white text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function SuccessState({ message }: { message: string }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-4">
      <div className="text-green-500 mt-0.5">
        <CheckCircle size={20} />
      </div>
      <div>
        <h4 className="text-sm font-semibold text-green-800 mb-1">Success</h4>
        <p className="text-sm text-green-700">{message}</p>
      </div>
    </div>
  );
}

// --- Main Components ---

function Sidebar() {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
    { icon: FolderOpen, label: 'My Projects', href: '/projects' },
    { icon: Plus, label: 'New Request', href: '/new', special: true },
    { icon: FileText, label: 'Quotations', href: '/quotes' },
    { icon: Briefcase, label: 'Workspace', href: '/workspace' },
    { icon: Receipt, label: 'Billing', href: '/billing' },
    { icon: Bell, label: 'Notifications', href: '/notifications', badge: 5 },
    { icon: User, label: 'Profile', href: '/profile', active: true },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold">
            <span className="sr-only">Logo</span>
            <div className="w-3.5 h-3.5 border-2 border-white rounded-sm"></div>
          </div>
          <div>
            <div className="font-semibold text-[#0A1628] leading-tight">Creative AI</div>
            <div className="text-xs text-neutral-400 font-medium">Studio</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          
          if (item.special) {
            return (
              <a key={idx} href={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-4 my-2 bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors shadow-sm hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)]">
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            );
          }
          
          return (
            <a 
              key={idx} 
              href={item.href} 
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm mx-2 my-0.5 transition-colors ${
                item.active 
                  ? 'bg-orange-50 text-orange-600 font-medium' 
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className={item.active ? 'text-orange-500' : 'text-neutral-400'} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="p-4 border-t border-neutral-100">
        <div className="flex items-center justify-between hover:bg-neutral-50 p-2 rounded-xl cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white text-xs font-bold border border-white shadow-sm">
              SR
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[#0A1628] leading-tight">Siti Rahayu</span>
            </div>
          </div>
          <Settings size={16} className="text-neutral-400" />
        </div>
      </div>
    </div>
  );
}

function SettingsNav() {
  const settingsNavItems = [
    { icon: User, label: 'Personal Info', active: true },
    { icon: Shield, label: 'Security & Password' },
    { icon: Bell, label: 'Notifications' },
    { icon: CreditCard, label: 'Billing Info' },
    { icon: Users, label: 'Team Members' },
    { icon: Link2, label: 'Connected Accounts' },
  ];

  return (
    <div className="w-[220px] shrink-0 bg-white border-r border-neutral-100 h-screen sticky top-0 pt-6 flex flex-col">
      <div className="text-xs font-semibold tracking-widest uppercase text-neutral-400 px-6 mb-4">
        Settings
      </div>
      
      <div className="flex-1 flex flex-col">
        {settingsNavItems.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button 
              key={idx} 
              className={`flex items-center gap-3 px-6 py-2.5 text-sm text-left transition-colors ${
                item.active 
                  ? 'bg-orange-50 border-r-2 border-orange-500 text-orange-600 font-medium' 
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 border-r-2 border-transparent'
              }`}
            >
              <Icon size={16} className={item.active ? 'text-orange-500' : 'text-neutral-400'} />
              <span>{item.label}</span>
            </button>
          );
        })}
        
        <div className="mt-auto mb-6">
          <div className="h-px bg-neutral-100 mx-6 mb-2"></div>
          <button className="w-full flex items-center gap-3 px-6 py-2.5 text-sm text-left text-red-500 hover:bg-red-50 transition-colors border-r-2 border-transparent">
            <Trash2 size={16} />
            <span>Danger Zone</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function Profile() {
  const [toggles, setToggles] = useState({
    email: true,
    whatsapp: true,
    inapp: true,
    marketing: false
  });

  const handleToggle = (key: keyof typeof toggles) => {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
      <Sidebar />
      <SettingsNav />
      
      <main className="flex-1 overflow-y-auto px-10 py-8 relative">
        <div className="max-w-4xl mx-auto">
          
          {/* Header Card */}
          <div className="bg-gradient-to-r from-[#0A1628] to-[#1a3060] rounded-2xl p-8 text-white mb-8 shadow-[0_8px_32px_rgba(10,22,40,0.15)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl"></div>
            
            <div className="relative z-10 flex items-start justify-between">
              <div className="flex items-center gap-6">
                <div className="group relative cursor-pointer">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-3xl font-bold text-white shadow-xl ring-4 ring-white/10 transition-all duration-300 group-hover:ring-orange-500/30">
                    SR
                  </div>
                  <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-300">
                    <Camera size={24} className="text-white" />
                  </div>
                </div>
                
                <div>
                  <h1 className="font-['Playfair_Display'] text-3xl font-semibold mb-1 tracking-tight">Siti Rahayu</h1>
                  <p className="text-white/70 text-sm mb-1.5 flex items-center gap-2">
                    <Briefcase size={14} className="text-orange-400" />
                    Brand Manager · Batik Nusantara Co.
                  </p>
                  <p className="text-xs text-white/50 font-medium tracking-wide">
                    MEMBER SINCE JANUARY 2024
                  </p>
                </div>
              </div>
              
              <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-medium transition-all text-white backdrop-blur-sm">
                <Edit2 size={14} />
                <span>Edit Photo</span>
              </button>
            </div>
            
            <div className="mt-8 pt-6 border-t border-white/10 flex gap-12 relative z-10">
              <div>
                <div className="text-xs text-white/50 font-semibold tracking-wider uppercase mb-1">Projects</div>
                <div className="text-xl font-semibold">12 Active</div>
              </div>
              <div>
                <div className="text-xs text-white/50 font-semibold tracking-wider uppercase mb-1">Investment</div>
                <div className="text-xl font-semibold">Rp 52.8M</div>
              </div>
              <div>
                <div className="text-xs text-white/50 font-semibold tracking-wider uppercase mb-1">Client Rating</div>
                <div className="text-xl font-semibold flex items-center gap-1.5">
                  <span>4.9</span>
                  <Star size={16} className="fill-orange-400 text-orange-400" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Personal Information Form */}
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.02)] p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-['Playfair_Display'] text-xl font-semibold text-[#0A1628]">Personal Information</h2>
              <button className="text-neutral-400 hover:text-orange-500 hover:bg-orange-50 p-2 rounded-lg transition-colors">
                <Edit2 size={18} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Full Name</label>
                <input 
                  type="text" 
                  defaultValue="Siti Rahayu" 
                  className="w-full bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <input 
                    type="email" 
                    defaultValue="siti@batiknusantara.co.id" 
                    className="w-full bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 pr-10 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 bg-green-50 rounded-full p-0.5" title="Verified Email">
                    <CheckCircle size={14} className="fill-green-100" />
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Phone Number</label>
                <input 
                  type="tel" 
                  defaultValue="+62 812 3456 7890" 
                  className="w-full bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Company Name</label>
                <input 
                  type="text" 
                  defaultValue="Batik Nusantara Co." 
                  className="w-full bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Industry</label>
                <div className="relative">
                  <select className="w-full appearance-none bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all cursor-pointer">
                    <option>Fashion & Apparel</option>
                    <option>Technology</option>
                    <option>Retail</option>
                    <option>Creative Agency</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Timezone</label>
                <div className="relative">
                  <select className="w-full appearance-none bg-neutral-50/50 border border-neutral-200 rounded-xl px-4 py-3 text-sm text-[#0A1628] font-medium focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10 focus:outline-none transition-all cursor-pointer">
                    <option>WIB (UTC+7)</option>
                    <option>WITA (UTC+8)</option>
                    <option>WIT (UTC+9)</option>
                    <option>SGT (UTC+8)</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                </div>
              </div>
            </div>
            
            <div className="mt-8 pt-6 border-t border-neutral-100 flex items-center justify-end gap-3">
              <button className="text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl px-5 py-2.5 text-sm font-medium transition-all">
                Cancel
              </button>
              <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:cursor-not-allowed">
                Save Changes
              </button>
            </div>
          </div>
          
          {/* Notification Preferences */}
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.02)] p-8">
            <h2 className="font-['Playfair_Display'] text-xl font-semibold text-[#0A1628] mb-6">Notification Preferences</h2>
            
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-4 border-b border-neutral-100">
                <div>
                  <h3 className="text-sm font-semibold text-[#0A1628] mb-1">Email Notifications</h3>
                  <p className="text-sm text-neutral-500">Receive crucial updates and invoices via email.</p>
                </div>
                <button 
                  onClick={() => handleToggle('email')}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${toggles.email ? 'bg-orange-500' : 'bg-neutral-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform absolute left-1 ${toggles.email ? 'translate-x-5' : 'translate-x-0'}`}></div>
                </button>
              </div>
              
              <div className="flex items-center justify-between py-4 border-b border-neutral-100">
                <div>
                  <h3 className="text-sm font-semibold text-[#0A1628] mb-1">WhatsApp Updates</h3>
                  <p className="text-sm text-neutral-500">Project milestones, fast approvals & file delivery.</p>
                </div>
                <button 
                  onClick={() => handleToggle('whatsapp')}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${toggles.whatsapp ? 'bg-orange-500' : 'bg-neutral-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform absolute left-1 ${toggles.whatsapp ? 'translate-x-5' : 'translate-x-0'}`}></div>
                </button>
              </div>
              
              <div className="flex items-center justify-between py-4 border-b border-neutral-100">
                <div>
                  <h3 className="text-sm font-semibold text-[#0A1628] mb-1">In-App Alerts</h3>
                  <p className="text-sm text-neutral-500">Real-time notifications within the portal dashboard.</p>
                </div>
                <button 
                  onClick={() => handleToggle('inapp')}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${toggles.inapp ? 'bg-orange-500' : 'bg-neutral-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform absolute left-1 ${toggles.inapp ? 'translate-x-5' : 'translate-x-0'}`}></div>
                </button>
              </div>
              
              <div className="flex items-center justify-between py-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#0A1628] mb-1">Marketing Emails</h3>
                  <p className="text-sm text-neutral-500">Tips, case studies, and occasional special offers.</p>
                </div>
                <button 
                  onClick={() => handleToggle('marketing')}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${toggles.marketing ? 'bg-orange-500' : 'bg-neutral-200'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform absolute left-1 ${toggles.marketing ? 'translate-x-5' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
