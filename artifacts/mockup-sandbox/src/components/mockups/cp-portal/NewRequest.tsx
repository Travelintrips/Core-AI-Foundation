import React, { useState } from 'react';
import {
  LayoutDashboard, FolderOpen, Plus, FileText, Briefcase, Receipt, Bell, User,
  ChevronRight, Palette, Share2, PenLine, Megaphone, Video, Target, Mail, LayoutTemplate, Camera, CheckCircle, Clock, AlertCircle, Settings,
  Check
} from 'lucide-react';

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

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '#', active: false },
    { icon: FolderOpen, label: 'My Projects', href: '#', active: false },
    { icon: Plus, label: 'New Request', href: '#', active: false },
    { icon: FileText, label: 'Quotations', href: '#', active: false },
    { icon: Briefcase, label: 'Workspace', href: '#', active: false },
    { icon: Receipt, label: 'Billing', href: '#', active: false },
    { icon: Bell, label: 'Notifications', href: '#', active: false, badge: '5' },
    { icon: User, label: 'Profile', href: '#', active: false },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <span className="text-white font-bold text-lg">C</span>
          </div>
          <div>
            <h1 className="font-semibold text-[#0A1628] leading-tight">Creative AI</h1>
            <p className="text-xs text-neutral-400">Studio</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {navItems.map((item, idx) => {
          const isNewRequest = item.label === 'New Request';
          return (
            <a key={idx} href={item.href} className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm mx-2 my-0.5 transition-colors ${
              isNewRequest
                ? 'bg-orange-500 text-white shadow-[0_4px_16px_rgba(249,115,22,0.35)]' 
                : item.active
                ? 'bg-orange-50 text-orange-600 font-medium'
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
            }`}>
              <div className="flex items-center gap-3">
                <item.icon className={`w-4 h-4 ${isNewRequest ? 'text-white' : item.active ? 'text-orange-500' : 'text-neutral-400'}`} />
                <span className={isNewRequest || item.active ? 'font-medium' : ''}>{item.label}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  item.active ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-600'
                }`}>
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>
      <div className="p-4 border-t border-neutral-100">
        <div className="flex items-center gap-3 px-2 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 flex items-center justify-center text-white font-bold text-xs shadow-inner">
            SR
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0A1628] truncate group-hover:text-orange-600 transition-colors">Siti Rahayu</p>
            <p className="text-xs text-neutral-500 truncate">Batik Nusantara Co.</p>
          </div>
          <button className="text-neutral-400 hover:text-orange-500 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export function NewRequest() {
  const [selectedService, setSelectedService] = useState('Brand Identity');
  const [viewState, setViewState] = useState<'normal'|'loading'|'empty'|'error'|'success'>('normal');

  const services = [
    { id: 1, name: 'Brand Identity', desc: 'Complete visual identity system including logo, typography, and guidelines.', price: 'From Rp 2.5M', time: '3–5 days', icon: Palette, gradient: 'from-orange-400 to-amber-500' },
    { id: 2, name: 'Social Media Pack', desc: 'Cohesive templates and custom posts for Instagram, LinkedIn, and TikTok.', price: 'From Rp 1.5M', time: '2–4 days', icon: Share2, gradient: 'from-blue-500 to-indigo-500' },
    { id: 3, name: 'Website Copy', desc: 'Persuasive, SEO-optimized copy for your landing pages and about sections.', price: 'From Rp 3.0M', time: '4–7 days', icon: PenLine, gradient: 'from-emerald-500 to-teal-500' },
    { id: 4, name: 'Ad Campaign', desc: 'High-converting creative assets for Facebook, Instagram, and Google Ads.', price: 'From Rp 2.0M', time: '3–5 days', icon: Megaphone, gradient: 'from-rose-500 to-pink-500' },
    { id: 5, name: 'Video Script', desc: 'Engaging scripts for promotional videos, explainers, or YouTube content.', price: 'From Rp 1.8M', time: '2–4 days', icon: Video, gradient: 'from-violet-500 to-purple-500' },
    { id: 6, name: 'Brand Strategy', desc: 'In-depth market research, positioning, and messaging framework.', price: 'From Rp 5.0M', time: '7–14 days', icon: Target, gradient: 'from-cyan-500 to-teal-500' },
    { id: 7, name: 'Email Campaign', desc: 'Sequence of engaging emails designed to convert leads to customers.', price: 'From Rp 1.2M', time: '2–3 days', icon: Mail, gradient: 'from-amber-500 to-orange-400' },
    { id: 8, name: 'Pitch Deck', desc: 'Stunning investor or sales presentations that communicate value clearly.', price: 'From Rp 4.5M', time: '5–7 days', icon: LayoutTemplate, gradient: 'from-slate-500 to-blue-600' },
    { id: 9, name: 'Photography', desc: 'Art direction and styling guidelines for product or team photoshoots.', price: 'From Rp 2.5M', time: '3–5 days', icon: Camera, gradient: 'from-pink-500 to-rose-400' },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans text-neutral-800">
      <Sidebar />
      <main className="flex-1 flex flex-col relative overflow-y-auto">
        
        {/* Development State Controls */}
        <div className="absolute top-6 right-8 flex gap-2 z-50">
          {(['normal', 'loading', 'empty', 'error', 'success'] as const).map(state => (
            <button
              key={state}
              onClick={() => setViewState(state)}
              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${
                viewState === state 
                  ? 'bg-neutral-800 text-white' 
                  : 'bg-white text-neutral-400 border border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {state}
            </button>
          ))}
        </div>

        <div className="px-8 pt-6 max-w-6xl mx-auto w-full">
          <div className="flex items-center text-xs text-neutral-400 gap-1">
            <span className="hover:text-neutral-600 cursor-pointer transition-colors">Dashboard</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[#0A1628] font-medium">New Request</span>
          </div>
        </div>

        {/* Step Progress */}
        <div className="px-8 py-8 max-w-4xl mx-auto w-full">
           <div className="flex items-center">
             {/* Step 1 */}
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-semibold shadow-[0_2px_8px_rgba(249,115,22,0.4)]">1</div>
               <span className="text-orange-500 font-semibold text-sm">Choose Service</span>
             </div>
             {/* Line */}
             <div className="flex-1 h-[2px] bg-neutral-200 mx-4 relative overflow-hidden rounded-full">
                <div className="absolute top-0 left-0 h-full w-0 bg-orange-500 transition-all duration-500"></div>
             </div>
             {/* Step 2 */}
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full border-2 border-neutral-200 flex items-center justify-center text-neutral-400 text-sm font-semibold bg-white">2</div>
               <span className="text-neutral-400 font-medium text-sm">Project Details</span>
             </div>
             {/* Line */}
             <div className="flex-1 h-[2px] bg-neutral-200 mx-4 rounded-full"></div>
             {/* Step 3 */}
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full border-2 border-neutral-200 flex items-center justify-center text-neutral-400 text-sm font-semibold bg-white">3</div>
               <span className="text-neutral-400 font-medium text-sm">Review & Confirm</span>
             </div>
           </div>
        </div>

        {viewState === 'loading' && (
          <div className="px-8 max-w-5xl mx-auto w-full mt-10 space-y-8 pb-32">
            <div className="animate-pulse bg-neutral-200 rounded-xl h-12 w-1/3 mx-auto"></div>
            <div className="animate-pulse bg-neutral-200/60 rounded-lg h-5 w-1/2 mx-auto mt-2"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="animate-pulse bg-white rounded-2xl border border-neutral-100 p-5 h-44 shadow-[0_2px_20px_rgba(0,0,0,0.02)]">
                  <div className="w-12 h-12 rounded-xl bg-neutral-100 mb-4"></div>
                  <div className="h-5 bg-neutral-100 rounded w-2/3 mb-2"></div>
                  <div className="h-3 bg-neutral-50 rounded w-full mb-1"></div>
                  <div className="h-3 bg-neutral-50 rounded w-4/5 mb-6"></div>
                  <div className="flex gap-3 pt-4 border-t border-neutral-50">
                    <div className="h-4 bg-neutral-100 rounded w-1/3"></div>
                    <div className="h-4 bg-neutral-100 rounded w-1/4"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {viewState === 'empty' && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-20 text-center">
            <div className="w-20 h-20 bg-white border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] rounded-2xl flex items-center justify-center mb-6">
              <FolderOpen className="w-8 h-8 text-neutral-300" />
            </div>
            <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">No services available</h2>
            <p className="text-neutral-500 text-sm max-w-sm mb-8">We are currently updating our service catalog. Please check back later or contact your account manager.</p>
            <button className="bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-6 py-3 text-sm font-medium transition-all shadow-sm">
              Contact Support
            </button>
          </div>
        )}

        {viewState === 'error' && (
          <div className="px-8 max-w-3xl mx-auto w-full mt-20">
            <div className="bg-white border border-red-100 shadow-[0_8px_32px_rgba(239,68,68,0.1)] rounded-2xl p-8 flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-red-500"></div>
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-5">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="font-['Playfair_Display'] text-2xl text-[#0A1628] font-semibold mb-2">Connection Error</h3>
              <p className="text-neutral-500 text-sm mb-6 max-w-md">We encountered an issue while loading the service catalog. Check your connection or try again.</p>
              <button 
                onClick={() => setViewState('normal')}
                className="bg-red-500 hover:bg-red-600 text-white shadow-[0_4px_16px_rgba(239,68,68,0.25)] rounded-xl px-6 py-2.5 text-sm font-semibold transition-all active:scale-95"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {viewState === 'success' && (
          <div className="px-8 max-w-3xl mx-auto w-full mt-20">
            <div className="bg-white border border-green-100 shadow-[0_8px_32px_rgba(34,197,94,0.1)] rounded-2xl p-8 flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-5">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="font-['Playfair_Display'] text-2xl text-[#0A1628] font-semibold mb-2">Request Submitted</h3>
              <p className="text-neutral-500 text-sm mb-6 max-w-md">Your new project request has been successfully created. Our AI specialists will begin preparing the assets.</p>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setViewState('normal')}
                  className="bg-white border border-neutral-200 text-neutral-700 hover:border-green-300 hover:text-green-700 rounded-xl px-5 py-2.5 text-sm font-medium transition-all"
                >
                  Create Another
                </button>
                <button className="bg-green-600 hover:bg-green-700 text-white shadow-[0_4px_16px_rgba(34,197,94,0.25)] rounded-xl px-6 py-2.5 text-sm font-semibold transition-all active:scale-95">
                  View Project
                </button>
              </div>
            </div>
          </div>
        )}

        {viewState === 'normal' && (
          <>
            <div className="text-center py-6 px-4">
              <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight">What can we create for you?</h1>
              <p className="text-neutral-500 text-sm mt-3 max-w-lg mx-auto">Choose a service to get started. Our AI team handles the rest, delivering premium assets directly to your workspace.</p>
            </div>

            <div className="px-8 pt-4 pb-32 max-w-6xl mx-auto w-full">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {services.map(service => {
                   const isSelected = selectedService === service.name;
                   return (
                     <div 
                       key={service.id}
                       onClick={() => setSelectedService(service.name)}
                       className={`relative bg-white rounded-2xl border p-5 transition-all duration-300 cursor-pointer group flex flex-col ${
                         isSelected 
                           ? 'border-orange-500 ring-2 ring-orange-500 ring-offset-2 bg-orange-50/20 shadow-[0_8px_24px_rgba(249,115,22,0.12)] -translate-y-0.5' 
                           : 'border-neutral-100 hover:border-orange-300 hover:shadow-[0_8px_32px_rgba(249,115,22,0.10)] hover:-translate-y-1'
                       }`}
                     >
                       {isSelected && (
                         <div className="absolute top-4 right-4 z-10 bg-white rounded-full shadow-sm animate-in zoom-in duration-200">
                           <CheckCircle className="w-6 h-6 text-orange-500" fill="currentColor" stroke="white" strokeWidth={2} />
                         </div>
                       )}
                       <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${service.gradient} flex items-center justify-center shadow-inner mb-5 relative overflow-hidden`}>
                         <div className="absolute inset-0 bg-black/10 mix-blend-overlay"></div>
                         <service.icon className="w-7 h-7 text-white relative z-10 drop-shadow-sm" strokeWidth={2} />
                       </div>
                       
                       <div className="flex-1">
                         <h3 className="font-semibold text-base text-[#0A1628] mb-1.5">{service.name}</h3>
                         <p className="text-xs text-neutral-500 leading-relaxed pr-2">{service.desc}</p>
                       </div>
                       
                       <div className="flex items-center gap-3 mt-5 pt-4 border-t border-neutral-50">
                         <span className="text-xs text-orange-600 font-bold bg-orange-50 px-2.5 py-1 rounded-md">{service.price}</span>
                         <div className="flex items-center gap-1.5 text-xs text-neutral-500 bg-neutral-50 border border-neutral-100 px-2.5 py-1 rounded-md">
                           <Clock className="w-3 h-3 text-neutral-400" />
                           <span className="font-medium">{service.time}</span>
                         </div>
                       </div>
                     </div>
                   )
                })}
              </div>
            </div>

            {/* Bottom sticky bar */}
            <div className="fixed bottom-0 left-[240px] right-0 bg-white/80 backdrop-blur-xl border-t border-neutral-100 px-8 py-5 z-40 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
               <div className="max-w-6xl mx-auto flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse"></div>
                   <div className="flex flex-col">
                     <span className="text-xs text-neutral-400 font-medium uppercase tracking-wider mb-0.5">Selected Service</span>
                     <span className="text-sm font-semibold text-[#0A1628] flex items-center gap-2">
                       {selectedService}
                       <Check className="w-4 h-4 text-green-500" strokeWidth={3} />
                     </span>
                   </div>
                 </div>
                 <div className="flex items-center gap-4">
                   <button className="text-sm text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-4 py-2 font-medium transition-all">
                     View Packages
                   </button>
                   <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-8 py-3 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center gap-2">
                     Continue to Details
                     <ChevronRight className="w-4 h-4" />
                   </button>
                 </div>
               </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
