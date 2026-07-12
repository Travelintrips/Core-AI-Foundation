import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, FolderOpen, Plus, FileText, 
  Briefcase, Receipt, Bell, User, Settings, 
  ChevronRight, AlertCircle, CheckCircle, Clock, 
  ShieldCheck, Lock, MessageCircle, FileDown,
  RotateCw
} from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/", active: false },
    { icon: FolderOpen, label: "My Projects", href: "/projects", active: false },
    { icon: Plus, label: "New Request", href: "/new", active: false, special: true },
    { icon: FileText, label: "Quotations", href: "/quotes", active: true },
    { icon: Briefcase, label: "Workspace", href: "/workspace", active: false },
    { icon: Receipt, label: "Billing", href: "/billing", active: false },
    { icon: Bell, label: "Notifications", href: "/notifications", active: false, badge: 5 },
    { icon: User, label: "Profile", href: "/profile", active: false },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(249,115,22,0.3)]">
          <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
        </div>
        <div>
          <div className="font-semibold text-[#0A1628] leading-tight">Creative AI</div>
          <div className="text-xs text-neutral-400 font-medium tracking-wide">STUDIO</div>
        </div>
      </div>
      
      <div className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map((item, idx) => {
            const Icon = item.icon;
            if (item.special) {
              return (
                <div key={idx} className="mx-4 my-4">
                  <a href={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-orange-500 text-white transition-all hover:bg-orange-600 hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 shadow-sm">
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                    {item.label}
                  </a>
                </div>
              );
            }
            
            return (
              <a 
                key={idx} 
                href={item.href}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm mx-2 transition-all ${
                  item.active 
                    ? 'bg-orange-50 text-orange-600 font-medium' 
                    : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 font-medium'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" strokeWidth={item.active ? 2.5 : 2} />
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
        </div>
      </div>

      <div className="p-4 border-t border-neutral-100">
        <a href="/settings" className="flex items-center gap-3 px-2 py-2 rounded-xl text-sm text-neutral-600 hover:bg-neutral-50 transition-all cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 border border-white shadow-sm shrink-0 flex items-center justify-center text-white font-semibold text-xs">
            SR
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#0A1628] truncate">Siti Rahayu</div>
            <div className="text-xs text-neutral-400 truncate">Batik Nusantara Co.</div>
          </div>
          <Settings className="w-4 h-4 text-neutral-400 shrink-0" />
        </a>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  switch (status.toLowerCase()) {
    case 'in progress':
      return <span className="bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">In Progress</span>;
    case 'review':
    case 'awaiting approval':
      return <span className="bg-amber-50 text-amber-700 border border-amber-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Awaiting Approval</span>;
    case 'completed':
    case 'approved':
      return <span className="bg-green-50 text-green-700 border border-green-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Approved</span>;
    case 'pending':
      return <span className="bg-orange-50 text-orange-700 border border-orange-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Pending</span>;
    case 'overdue':
      return <span className="bg-red-50 text-red-700 border border-red-100 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Overdue</span>;
    default:
      return <span className="bg-neutral-50 text-neutral-700 border border-neutral-200 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">{status}</span>;
  }
};

export function Quotation() {
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [quoteState, setQuoteState] = useState<'awaiting' | 'approved'>('awaiting');

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setPageState('ready');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleApprove = () => {
    setQuoteState('approved');
  };

  // -------------------------------------------------------------
  // RENDER HELPERS FOR DIFFERENT STATES
  // -------------------------------------------------------------

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="px-8 pt-8 pb-4 flex items-center justify-between">
            <div className="animate-pulse bg-neutral-200 rounded-lg h-10 w-1/3"></div>
            <div className="animate-pulse bg-neutral-200 rounded-full h-6 w-32"></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 px-8 pb-12">
            <div className="lg:col-span-3">
              <div className="bg-white rounded-2xl border border-neutral-100 p-8 min-h-[600px] flex flex-col gap-6">
                <div className="animate-pulse bg-neutral-100 rounded-lg h-24 w-full"></div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="animate-pulse bg-neutral-100 rounded-lg h-32 w-full"></div>
                  <div className="animate-pulse bg-neutral-100 rounded-lg h-32 w-full"></div>
                </div>
                <div className="animate-pulse bg-neutral-100 rounded-lg h-48 w-full mt-4"></div>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-4">
               <div className="animate-pulse bg-white rounded-2xl border border-neutral-100 h-64 w-full"></div>
               <div className="animate-pulse bg-orange-50 rounded-2xl border border-orange-100 h-32 w-full"></div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-red-800 mb-2">Failed to load quotation</h3>
            <p className="text-red-600 text-sm mb-6">There was an error communicating with our servers. Please try again.</p>
            <button 
              onClick={() => setPageState('loading')}
              className="bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-xl px-5 py-2.5 text-sm font-medium transition-all shadow-sm"
            >
              Retry Connection
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (pageState === 'empty') {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-neutral-100 text-neutral-400 rounded-2xl flex items-center justify-center mx-auto mb-5 rotate-3">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">No Quotation Found</h3>
            <p className="text-neutral-500 text-sm mb-6">This quotation link may have expired or you don't have permission to view it.</p>
            <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95">
              Go to Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------
  // MAIN READY STATE
  // -------------------------------------------------------------

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full">
          {/* Header */}
          <div className="px-8 pt-10 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center text-sm text-neutral-500 mb-3 font-medium">
                <a href="/quotes" className="hover:text-orange-500 transition-colors">Quotations</a>
                <ChevronRight className="w-4 h-4 mx-1.5 opacity-50" />
                <span className="text-neutral-900">#QT-2024-0089</span>
              </div>
              <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight">
                Quotation #QT-2024-0089
              </h1>
            </div>
            <div className="flex flex-col md:items-end gap-2">
              <StatusBadge status={quoteState === 'approved' ? 'approved' : 'awaiting approval'} />
              {quoteState !== 'approved' && (
                <div className="flex items-center text-xs text-neutral-500 font-medium gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Expires Jul 20
                </div>
              )}
            </div>
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 px-8 pb-16">
            
            {/* LEFT COL: Document */}
            <div className="lg:col-span-3 flex flex-col">
              
              {/* Document Actions - Top Right (Desktop) */}
              <div className="flex justify-end gap-2 mb-4">
                <button className="text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-3 py-1.5 text-sm font-medium transition-all flex items-center gap-1.5">
                  <FileDown className="w-4 h-4" /> Download PDF
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-100 shadow-[0_2px_20px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col relative group">
                {/* Optional subtle hover effect */}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

                {/* Doc Header */}
                <div className="p-8 bg-gradient-to-r from-[#0A1628] to-[#1a2f52] text-white flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
                        <div className="w-5 h-5 border-2 border-white rounded-sm"></div>
                      </div>
                      <div>
                        <div className="font-semibold text-white leading-tight text-lg">Creative AI Studio</div>
                      </div>
                    </div>
                    <div className="text-sm text-white/70 space-y-1">
                      <p>Level 23, Pacific Century Place</p>
                      <p>SCBD, Jakarta 12190</p>
                      <p>hello@creativeai.studio</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold tracking-[0.2em] text-white/40 mb-1">QUOTATION</div>
                    <div className="text-2xl font-light tracking-wide text-white/90">#QT-2024-0089</div>
                  </div>
                </div>

                {/* Client Info */}
                <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-8 border-b border-neutral-100">
                  <div>
                    <div className="text-xs font-semibold tracking-widest uppercase text-neutral-400 mb-3">Bill To</div>
                    <div className="font-semibold text-[#0A1628] text-base mb-1">Siti Rahayu</div>
                    <div className="text-neutral-600 text-sm mb-1 font-medium">Batik Nusantara Co.</div>
                    <div className="text-neutral-500 text-sm">siti@batiknusantara.co.id</div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                    <div className="text-neutral-500 font-medium">Date Issued:</div>
                    <div className="text-[#0A1628] text-right font-medium">Jul 1, 2024</div>
                    <div className="text-neutral-500 font-medium">Valid Until:</div>
                    <div className="text-[#0A1628] text-right font-medium">Jul 20, 2024</div>
                    <div className="text-neutral-500 font-medium">Payment:</div>
                    <div className="text-[#0A1628] text-right font-medium">50/50 Split</div>
                  </div>
                </div>

                {/* Line Items */}
                <div className="px-8 py-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200">
                        <th className="text-left pb-4 text-xs font-semibold tracking-widest uppercase text-neutral-400 font-sans">Item & Description</th>
                        <th className="text-center pb-4 text-xs font-semibold tracking-widest uppercase text-neutral-400 font-sans w-24">Qty</th>
                        <th className="text-right pb-4 text-xs font-semibold tracking-widest uppercase text-neutral-400 font-sans w-32">Rate</th>
                        <th className="text-right pb-4 text-xs font-semibold tracking-widest uppercase text-neutral-400 font-sans w-32">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-neutral-50/50">
                        <td className="py-4 pr-4">
                          <div className="font-semibold text-[#0A1628] mb-1">Brand Identity Redesign Package</div>
                          <div className="text-neutral-500 text-xs leading-relaxed">Comprehensive logo redesign, color palette, typography guidelines, and brand book.</div>
                        </td>
                        <td className="py-4 text-center text-neutral-600 font-medium">1</td>
                        <td className="py-4 text-right text-neutral-600">Rp 12,000,000</td>
                        <td className="py-4 text-right font-semibold text-[#0A1628]">Rp 12,000,000</td>
                      </tr>
                      <tr className="bg-neutral-50/30 border-b border-neutral-50/50">
                        <td className="py-4 pr-4 px-2">
                          <div className="font-semibold text-[#0A1628] mb-1">Social Media Content (3 months)</div>
                          <div className="text-neutral-500 text-xs leading-relaxed">12 static posts and 4 short videos per month with copywriting included.</div>
                        </td>
                        <td className="py-4 text-center text-neutral-600 font-medium">1 pkg</td>
                        <td className="py-4 text-right text-neutral-600">Rp 8,500,000</td>
                        <td className="py-4 text-right font-semibold text-[#0A1628] px-2">Rp 8,500,000</td>
                      </tr>
                      <tr>
                        <td className="py-4 pr-4">
                          <div className="font-semibold text-[#0A1628] mb-1">Strategy Workshop</div>
                          <div className="text-neutral-500 text-xs leading-relaxed">Two 2-hour virtual sessions to define target audience and messaging strategy.</div>
                        </td>
                        <td className="py-4 text-center text-neutral-600 font-medium">2</td>
                        <td className="py-4 text-right text-neutral-600">Rp 1,750,000</td>
                        <td className="py-4 text-right font-semibold text-[#0A1628]">Rp 3,500,000</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="p-8 border-t border-neutral-100 bg-[#FAFAF8]/50 flex justify-end">
                  <div className="w-full max-w-[280px] space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500 font-medium">Subtotal</span>
                      <span className="font-medium text-[#0A1628]">Rp 24,000,000</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500 font-medium">Service Tax (11%)</span>
                      <span className="font-medium text-[#0A1628]">Rp 2,640,000</span>
                    </div>
                    <div className="flex justify-between pt-4 border-t border-neutral-200 mt-2">
                      <span className="font-bold text-[#0A1628] uppercase tracking-wider text-sm mt-1">Total</span>
                      <span className="text-2xl font-bold text-[#0A1628]">Rp 26,640,000</span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="px-8 pb-8">
                  <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100/50">
                    <div className="text-xs font-semibold tracking-widest uppercase text-orange-800/60 mb-2">Notes</div>
                    <p className="text-sm text-neutral-600 italic">
                      Includes unlimited revisions for the first 30 days post-delivery. Final source files will be handed over upon receipt of the final 50% payment.
                    </p>
                  </div>
                </div>

                {/* CTAs */}
                <div className="px-8 pb-8 pt-0">
                  {quoteState === 'approved' ? (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="bg-white rounded-full p-1 shrink-0 shadow-sm mt-0.5">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-green-900 text-sm">Quotation Approved!</h4>
                        <p className="text-green-800/80 text-sm mt-1">Thank you for your approval. We'll be in touch within 24 hours to initiate the kickoff process and send the first invoice.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button 
                        onClick={handleApprove}
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-4 text-base font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95 flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="w-5 h-5" /> Approve Quotation
                      </button>
                      <button className="flex-1 bg-white border-2 border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/30 rounded-xl px-6 py-4 text-base font-semibold transition-all flex items-center justify-center gap-2">
                        <RotateCw className="w-5 h-5" /> Request Revision
                      </button>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* RIGHT COL: Sidebar widgets */}
            <div className="lg:col-span-2 space-y-6 pt-10 lg:pt-0">
              
              {/* Timeline Widget */}
              <div className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-sm">
                <h3 className="font-['Playfair_Display'] text-xl font-semibold text-[#0A1628] mb-6">Quote Status</h3>
                
                <div className="relative pl-3 space-y-6">
                  {/* Vertical line connecting nodes */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-neutral-100"></div>
                  
                  {/* Completed step */}
                  <div className="relative z-10 flex items-start gap-4 group">
                    <div className="w-2 h-2 rounded-full bg-green-500 ring-4 ring-green-50 mt-1.5 shrink-0 transition-transform group-hover:scale-125"></div>
                    <div>
                      <div className="font-semibold text-sm text-[#0A1628]">Quote Created</div>
                      <div className="text-xs text-neutral-400 mt-0.5">Jul 1, 2024</div>
                    </div>
                  </div>
                  
                  {/* Completed step */}
                  <div className="relative z-10 flex items-start gap-4 group">
                    <div className="w-2 h-2 rounded-full bg-green-500 ring-4 ring-green-50 mt-1.5 shrink-0 transition-transform group-hover:scale-125"></div>
                    <div>
                      <div className="font-semibold text-sm text-[#0A1628]">Sent to Client</div>
                      <div className="text-xs text-neutral-400 mt-0.5">Jul 3, 2024</div>
                    </div>
                  </div>
                  
                  {/* Current step */}
                  {quoteState === 'approved' ? (
                    <>
                      <div className="relative z-10 flex items-start gap-4 group">
                        <div className="w-2 h-2 rounded-full bg-green-500 ring-4 ring-green-50 mt-1.5 shrink-0 transition-transform group-hover:scale-125"></div>
                        <div>
                          <div className="font-semibold text-sm text-[#0A1628]">Approved</div>
                          <div className="text-xs text-neutral-400 mt-0.5">Just now</div>
                        </div>
                      </div>
                      <div className="relative z-10 flex items-start gap-4">
                        <div className="w-2 h-2 rounded-full bg-orange-500 ring-4 ring-orange-100 mt-1.5 shrink-0 animate-pulse"></div>
                        <div>
                          <div className="font-semibold text-sm text-orange-600">Payment & Kickoff</div>
                          <div className="text-xs text-neutral-400 mt-0.5">Pending invoice</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative z-10 flex items-start gap-4">
                        <div className="w-2 h-2 rounded-full bg-orange-500 ring-4 ring-orange-100 mt-1.5 shrink-0 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.6)]"></div>
                        <div>
                          <div className="font-semibold text-sm text-orange-600">Under Review</div>
                          <div className="text-xs text-neutral-400 mt-0.5">Current Phase</div>
                        </div>
                      </div>
                      <div className="relative z-10 flex items-start gap-4 opacity-50">
                        <div className="w-2 h-2 rounded-full bg-neutral-300 ring-4 ring-white mt-1.5 shrink-0"></div>
                        <div>
                          <div className="font-semibold text-sm text-neutral-500">Payment & Kickoff</div>
                          <div className="text-xs text-neutral-400 mt-0.5">Pending approval</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Payment Terms Widget */}
              <div className="bg-gradient-to-br from-orange-50 to-[#FAFAF8] border border-orange-100 rounded-2xl p-6 shadow-sm relative overflow-hidden group">
                <div className="absolute -right-6 -top-6 text-orange-100/40 transform rotate-12 group-hover:rotate-6 transition-transform duration-500">
                  <ShieldCheck className="w-32 h-32" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 text-orange-600 mb-3">
                    <Lock className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Payment Terms</span>
                  </div>
                  <h4 className="font-semibold text-[#0A1628] text-base mb-1">50% upfront · 50% on delivery</h4>
                  <p className="text-sm text-neutral-600 leading-relaxed mb-4">Secure payment via bank transfer or credit card upon invoice generation.</p>
                  
                  <div className="flex items-center gap-3 pt-4 border-t border-orange-200/50">
                    <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full bg-white border border-neutral-100 flex items-center justify-center shadow-sm">
                        <span className="font-serif font-bold text-xs text-[#0A1628]">Rp</span>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-white border border-neutral-100 flex items-center justify-center shadow-sm">
                        <span className="font-serif font-bold text-xs text-[#0A1628]">$</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-neutral-500">Multiple currencies accepted</span>
                  </div>
                </div>
              </div>

              {/* Support Widget */}
              <div className="bg-white border border-neutral-100 rounded-2xl p-6 shadow-[0_2px_20px_rgba(0,0,0,0.02)]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <MessageCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#0A1628] text-sm">Questions about this quote?</h4>
                    <p className="text-xs text-neutral-500 mt-0.5">We typically reply within 1 hour</p>
                  </div>
                </div>
                <button className="w-full bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all shadow-sm">
                  Chat with our team
                </button>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Quotation;
