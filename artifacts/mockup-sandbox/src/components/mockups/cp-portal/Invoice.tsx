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
  Download,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  Clock,
  Landmark,
  CreditCard,
  ChevronDown,
  Eye,
  AlertCircle
} from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/', active: false },
    { icon: FolderOpen, label: 'My Projects', href: '/projects', active: false },
    { icon: Plus, label: 'New Request', href: '/new', active: false, special: true },
    { icon: FileText, label: 'Quotations', href: '/quotes', active: false },
    { icon: Briefcase, label: 'Workspace', href: '/workspace', active: false },
    { icon: Receipt, label: 'Billing', href: '/billing', active: true },
    { icon: Bell, label: 'Notifications', href: '/notifications', active: false, badge: '5' },
    { icon: User, label: 'Profile', href: '/profile', active: false },
  ];

  return (
    <div className="w-[240px] shrink-0 bg-white border-r border-neutral-100 flex flex-col h-screen sticky top-0">
      <div className="p-6 pb-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-sm">
          <div className="w-3 h-3 bg-white rounded-sm"></div>
        </div>
        <div>
          <div className="font-semibold text-[#0A1628] leading-tight">Creative AI</div>
          <div className="text-xs text-neutral-400 font-medium">Studio</div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          if (item.special) {
            return (
              <a key={idx} href={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mx-4 my-4 bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors shadow-[0_4px_12px_rgba(249,115,22,0.25)]">
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
                <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="p-4 border-t border-neutral-100">
        <a href="/settings" className="flex items-center justify-between p-2 hover:bg-neutral-50 rounded-xl transition-colors cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-300 border border-white shadow-sm flex items-center justify-center text-white font-medium text-xs">
              SR
            </div>
            <div>
              <div className="text-sm font-medium text-[#0A1628]">Siti Rahayu</div>
              <div className="text-xs text-neutral-500">Batik Nusantara</div>
            </div>
          </div>
          <Settings size={16} className="text-neutral-400" />
        </a>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  switch (status.toLowerCase()) {
    case 'paid':
    case 'completed':
      return <span className="bg-green-50 text-green-700 border border-green-100 text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>{status}</span>;
    case 'processing':
    case 'review':
      return <span className="bg-amber-50 text-amber-700 border border-amber-100 text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>{status}</span>;
    case 'overdue':
      return <span className="bg-red-50 text-red-700 border border-red-100 text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>{status}</span>;
    case 'pending':
    case 'in progress':
      return <span className="bg-orange-50 text-orange-700 border border-orange-100 text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>{status}</span>;
    default:
      return <span className="bg-neutral-50 text-neutral-700 border border-neutral-200 text-xs font-semibold px-2.5 py-1 rounded-full">{status}</span>;
  }
};

export function Invoice() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [viewState, setViewState] = useState<'loading' | 'success' | 'error' | 'empty' | 'normal'>('normal');

  const filters = ['All', 'Paid', 'Pending', 'Overdue'];

  const invoices = [
    { id: 'INV-2024-089', project: 'Brand Identity', date: 'Jul 10', amount: 'Rp 13,320,000', status: 'Paid' },
    { id: 'INV-2024-088', project: 'Social Media Pack', date: 'Jul 3', amount: 'Rp 4,250,000', status: 'Paid' },
    { id: 'INV-2024-087', project: 'Strategy Workshop', date: 'Jun 28', amount: 'Rp 3,500,000', status: 'Processing' },
    { id: 'INV-2024-086', project: 'Website Copywriting', date: 'Jun 15', amount: 'Rp 3,200,000', status: 'Overdue' },
    { id: 'INV-2024-085', project: 'Ad Campaign', date: 'Jun 1', amount: 'Rp 2,780,000', status: 'Paid' },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex font-sans">
      <Sidebar />
      
      <div className="flex-1 overflow-y-auto pb-12 relative bg-gradient-to-br from-orange-50/30 via-[#FAFAF8] to-blue-50/20">
        {/* Debug UI to switch states */}
        <div className="absolute top-4 right-8 flex gap-2 z-50 opacity-20 hover:opacity-100 transition-opacity">
          {['normal', 'loading', 'empty', 'error', 'success'].map((state) => (
             <button 
               key={state}
               onClick={() => setViewState(state as any)}
               className={`text-[10px] px-2 py-1 rounded uppercase tracking-wider font-bold ${viewState === state ? 'bg-orange-500 text-white' : 'bg-white text-neutral-500 border border-neutral-200'}`}
             >
               {state}
             </button>
          ))}
        </div>

        {viewState === 'loading' && (
          <div className="p-8 max-w-6xl mx-auto space-y-6">
            <div className="animate-pulse bg-neutral-200/60 rounded-xl h-12 w-1/3 mb-8"></div>
            <div className="animate-pulse bg-neutral-200/60 rounded-xl h-16 w-full mb-6"></div>
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="animate-pulse bg-neutral-200/60 rounded-2xl h-32 w-full"></div>
              <div className="animate-pulse bg-neutral-200/60 rounded-2xl h-32 w-full"></div>
              <div className="animate-pulse bg-neutral-200/60 rounded-2xl h-32 w-full"></div>
            </div>
            <div className="animate-pulse bg-neutral-200/60 rounded-2xl h-64 w-full"></div>
          </div>
        )}

        {viewState === 'empty' && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-6">
              <Receipt size={32} className="text-orange-500" />
            </div>
            <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#0A1628] mb-2">No invoices yet</h2>
            <p className="text-neutral-500 mb-6 max-w-md">You don't have any billing history at the moment. When your projects generate invoices, they'll appear here.</p>
            <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold transition-all hover:shadow-[0_4px_16px_rgba(249,115,22,0.35)] active:scale-95">
              View Workspace
            </button>
          </div>
        )}

        {viewState === 'error' && (
          <div className="p-8 max-w-6xl mx-auto pt-24">
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex flex-col items-center text-center">
              <AlertCircle size={32} className="text-red-500 mb-3" />
              <h3 className="text-red-800 font-semibold mb-1">Failed to load billing details</h3>
              <p className="text-red-600 text-sm mb-4">We encountered an issue connecting to the payment server.</p>
              <button 
                onClick={() => setViewState('normal')}
                className="bg-white border border-red-200 text-red-700 hover:bg-red-100 rounded-xl px-5 py-2 text-sm font-medium transition-all"
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {viewState === 'success' && (
          <div className="p-8 max-w-6xl mx-auto pt-24">
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex flex-col items-center text-center">
              <CheckCircle size={32} className="text-green-600 mb-3" />
              <h3 className="text-green-800 font-semibold mb-1">Payment Successful</h3>
              <p className="text-green-700 text-sm mb-4">Your payment of Rp 3,200,000 for INV-2024-086 has been received.</p>
              <button 
                onClick={() => setViewState('normal')}
                className="bg-white border border-green-200 text-green-700 hover:bg-green-100 rounded-xl px-5 py-2 text-sm font-medium transition-all"
              >
                View Updated Invoice
              </button>
            </div>
          </div>
        )}

        {viewState === 'normal' && (
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="px-8 pt-10 pb-6 flex items-center justify-between">
              <h1 className="font-['Playfair_Display'] text-4xl font-semibold text-[#0A1628] tracking-tight">Billing & Payments</h1>
              <div className="flex items-center gap-3">
                <button className="bg-white border border-neutral-200 text-neutral-700 hover:border-orange-300 hover:text-orange-600 rounded-xl px-5 py-2.5 text-sm font-medium transition-all flex items-center gap-2 shadow-sm">
                  <Download size={16} />
                  Export CSV
                </button>
                <button className="text-neutral-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-all">
                  Download All
                </button>
              </div>
            </div>

            {/* Alert Banner */}
            <div className="px-8 mb-6">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 flex items-center gap-3 shadow-sm">
                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-orange-600" />
                </div>
                <span className="text-sm font-medium text-orange-900">Invoice <span className="font-bold">INV-2024-086</span> is 5 days overdue.</span>
                <a href="#" className="ml-auto text-orange-600 font-semibold text-sm hover:text-orange-700 flex items-center gap-1 group">
                  Pay Now <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </a>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="px-8 mb-8 grid grid-cols-3 gap-5">
              <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.06)] hover:-translate-y-0.5 transition-all duration-300 group">
                <div className="flex justify-between items-start mb-4">
                  <div className="text-xs font-semibold tracking-widest uppercase text-neutral-500">Total Billed</div>
                  <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors">
                    <TrendingUp size={18} />
                  </div>
                </div>
                <div className="text-3xl font-bold text-[#0A1628] tracking-tight">Rp 52.8M</div>
                <div className="text-xs text-neutral-500 mt-2 font-medium">Lifetime value</div>
              </div>

              <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/60 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(34,197,94,0.1)] hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex justify-between items-start mb-4">
                  <div className="text-xs font-semibold tracking-widest uppercase text-neutral-500">Paid</div>
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                    <CheckCircle size={18} />
                  </div>
                </div>
                <div className="text-3xl font-bold text-green-600 tracking-tight">Rp 49.6M</div>
                <div className="text-xs text-neutral-500 mt-2 font-medium">Completed payments</div>
              </div>

              <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-orange-200/60 p-6 shadow-[0_4px_24px_rgba(249,115,22,0.08)] hover:shadow-[0_8px_32px_rgba(249,115,22,0.15)] hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-bl-full -mr-8 -mt-8"></div>
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-orange-600">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                    Outstanding
                  </div>
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                    <Clock size={18} />
                  </div>
                </div>
                <div className="text-3xl font-bold text-orange-600 tracking-tight relative z-10">Rp 3.2M</div>
                <div className="text-xs text-orange-600/70 mt-2 font-medium relative z-10">Requires attention</div>
              </div>
            </div>

            {/* Payment Method Strip */}
            <div className="px-8 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[#0A1628] text-base">Payment Methods</h3>
                <button className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg px-3 py-1.5 text-sm font-medium transition-all">
                  Add Method
                </button>
              </div>
              <div className="flex gap-4">
                <div className="bg-white rounded-xl border-2 border-orange-500 p-4 flex items-center gap-4 w-72 shadow-sm relative overflow-hidden cursor-pointer group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                  <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center shrink-0 border border-orange-100">
                    <Landmark size={20} className="text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#0A1628] truncate text-sm">BCA Bank Transfer</div>
                    <div className="text-xs text-neutral-400 font-mono mt-0.5">••••1234</div>
                  </div>
                  <span className="bg-orange-50 text-orange-600 border border-orange-100 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Primary</span>
                </div>

                <div className="bg-white rounded-xl border border-neutral-200 p-4 flex items-center gap-4 w-64 hover:border-orange-300 transition-colors cursor-pointer shadow-sm">
                  <div className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center shrink-0 border border-neutral-100">
                    <Landmark size={20} className="text-neutral-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#0A1628] truncate text-sm">BRI Bank Transfer</div>
                    <div className="text-xs text-neutral-400 font-mono mt-0.5">••••5678</div>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-neutral-300 p-4 flex items-center justify-center gap-2 w-48 text-neutral-500 hover:text-orange-600 hover:border-orange-300 hover:bg-orange-50/50 transition-all cursor-pointer font-medium text-sm">
                  <Plus size={16} />
                  <span>Add Card</span>
                </div>
              </div>
            </div>

            {/* Invoice Table */}
            <div className="mx-8 bg-white rounded-2xl border border-neutral-200/80 shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden mb-12">
              <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-white">
                <h3 className="font-semibold text-[#0A1628] text-lg font-['Playfair_Display']">Recent Invoices</h3>
                <div className="flex gap-1 bg-neutral-50 p-1 rounded-lg border border-neutral-100">
                  {filters.map(filter => (
                    <button 
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                        activeFilter === filter 
                          ? 'bg-white text-orange-600 shadow-sm border border-neutral-200/50' 
                          : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#FAFAF8] text-neutral-500 text-xs uppercase tracking-wider font-semibold border-b border-neutral-100">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Invoice #</th>
                      <th className="px-6 py-4 font-semibold">Project</th>
                      <th className="px-6 py-4 font-semibold">Date</th>
                      <th className="px-6 py-4 font-semibold">Amount</th>
                      <th className="px-6 py-4 font-semibold">Status</th>
                      <th className="px-6 py-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {invoices.map((inv, i) => (
                      <tr 
                        key={inv.id} 
                        className={`group transition-colors ${
                          inv.status === 'Overdue' 
                            ? 'bg-red-50/20 hover:bg-red-50/40' 
                            : 'hover:bg-orange-50/20 bg-white'
                        }`}
                      >
                        <td className="px-6 py-4 font-mono text-xs font-medium text-neutral-600">
                          {inv.id}
                        </td>
                        <td className="px-6 py-4 font-medium text-[#0A1628]">
                          {inv.project}
                        </td>
                        <td className="px-6 py-4 text-neutral-500">
                          {inv.date}
                        </td>
                        <td className="px-6 py-4 font-medium text-[#0A1628]">
                          {inv.amount}
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-6 py-4 text-right">
                          {inv.status === 'Overdue' ? (
                            <button className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-all shadow-[0_2px_8px_rgba(249,115,22,0.25)] hover:shadow-[0_4px_12px_rgba(249,115,22,0.35)] active:scale-95 inline-flex items-center gap-1.5">
                              Pay Now
                            </button>
                          ) : inv.status === 'Processing' ? (
                            <button className="text-neutral-500 hover:text-orange-600 font-medium px-3 py-1.5 rounded-lg hover:bg-orange-50 transition-colors inline-flex items-center gap-1.5 text-xs">
                              <Eye size={14} /> View
                            </button>
                          ) : (
                            <button className="text-neutral-500 hover:text-neutral-700 font-medium px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-colors inline-flex items-center gap-1.5 text-xs">
                              <Download size={14} /> Download
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
