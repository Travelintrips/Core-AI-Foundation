import React, { useState } from 'react';
import {
  LayoutDashboard, BarChart3, Users, Settings, Cpu, GitBranch, Zap, Brain, Bot, 
  BookOpen, CheckSquare, CalendarDays, ShoppingBag, Circle, RefreshCw, TrendingUp, TrendingDown,
  Search as SearchIcon, Bell, Plus, Activity, Server, Clock
} from 'lucide-react';

export function AdminDesktop() {
  return (
    <div className="flex min-h-screen font-sans" style={{ backgroundColor: '#060B18', color: '#F0F4FF' }}>
      {/* Sidebar */}
      <aside className="w-[240px] flex-shrink-0 flex flex-col border-r border-[#243352]" style={{ backgroundColor: '#0D1526' }}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-[#243352]">
          <div className="flex items-center gap-2 text-[#F0F4FF] font-medium" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            <div className="w-6 h-6 rounded flex items-center justify-center bg-gradient-to-br from-[#7C6EFA] to-[#5F52D0]">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white"><path d="M12 2L2 12l10 10 10-10L12 2z"/></svg>
            </div>
            AI Platform
          </div>
        </div>
        
        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            <NavItem icon={<LayoutDashboard size={16} />} label="Dashboard" active />
            <NavItem icon={<BarChart3 size={16} />} label="Analytics" />
            
            <div className="pt-4 pb-1 px-3 text-xs font-semibold tracking-wider text-[#4F6494]">AI WORKFORCE</div>
            <NavItem icon={<Bot size={16} />} label="Agents" />
            <NavItem icon={<GitBranch size={16} />} label="Workflows" />
            <NavItem icon={<Zap size={16} />} label="Executions" />
            <NavItem icon={<BookOpen size={16} />} label="Prompts" />
            
            <div className="pt-4 pb-1 px-3 text-xs font-semibold tracking-wider text-[#4F6494]">KNOWLEDGE</div>
            <NavItem icon={<Brain size={16} />} label="Memory" />
            <NavItem icon={<Server size={16} />} label="Registry" />
            
            <div className="pt-4 pb-1 px-3 text-xs font-semibold tracking-wider text-[#4F6494]">OPERATIONS</div>
            <NavItem icon={<CheckSquare size={16} />} label="Human Tasks" />
            <NavItem icon={<Activity size={16} />} label="AI Events" />
            <NavItem icon={<CalendarDays size={16} />} label="Scheduler" />
            <NavItem icon={<ShoppingBag size={16} />} label="Marketplace" />
        </div>
        
        {/* User / Health */}
        <div className="p-4 border-t border-[#243352]">
           <div className="flex items-center gap-2 mb-4 px-2">
             <div className="relative flex h-2 w-2">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]"></span>
             </div>
             <span className="text-[11px] font-medium tracking-wide text-[#8B9BC4]">SYSTEM ONLINE</span>
           </div>
           
           <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#131E35] transition-colors cursor-pointer group">
              <div className="w-8 h-8 rounded-full bg-[#1C2A45] flex items-center justify-center border border-[#2E4270] text-xs font-medium group-hover:border-[#4F6494] transition-colors">AD</div>
              <div className="flex-1 overflow-hidden">
                <div className="text-sm font-medium truncate group-hover:text-white transition-colors">Admin User</div>
                <div className="text-xs text-[#8B9BC4] truncate">admin@aiplatform.id</div>
              </div>
              <Settings size={14} className="text-[#4F6494] group-hover:text-[#8B9BC4] transition-colors" />
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-[400px] pointer-events-none" style={{ background: 'radial-gradient(ellipse at 60% 0%, rgba(124,110,250,0.12) 0%, transparent 60%)' }}></div>
        
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-[#243352] bg-[#060B18]/60 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
             <div className="relative group">
               <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4F6494] group-focus-within:text-[#7C6EFA] transition-colors" />
               <input 
                 type="text" 
                 placeholder="Search anything... (Cmd+K)" 
                 className="w-72 bg-[#0D1526] border border-[#243352] rounded-md py-1.5 pl-9 pr-3 text-sm text-[#F0F4FF] placeholder-[#4F6494] focus:outline-none focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA] transition-all shadow-sm"
               />
             </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#243352] bg-[#0D1526] text-xs font-medium text-[#8B9BC4]">
              <Clock size={14} className="text-[#4F6494]" />
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <button className="relative p-2 rounded-md text-[#8B9BC4] hover:text-[#F0F4FF] hover:bg-[#131E35] transition-colors">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#7C6EFA] border border-[#060B18]"></span>
            </button>
            <div className="w-px h-4 bg-[#243352] mx-1"></div>
            <button className="flex items-center justify-center h-8 px-4 rounded-md text-sm font-medium text-white hover:opacity-90 transition-opacity hover:scale-[0.98] active:scale-[0.96]" style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', boxShadow: '0 4px 12px rgba(124, 110, 250, 0.25)' }}>
              <Plus size={16} className="mr-1.5" />
              New Workflow
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 z-10 space-y-8">
           {/* Page Title */}
           <div className="flex items-end justify-between animate-fade-in-up" style={{ animationDelay: '0ms' }}>
              <div>
                 <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Platform Overview</h1>
                 <p className="text-sm text-[#8B9BC4] mt-1">Control plane telemetry and real-time usage metrics</p>
              </div>
              <button className="flex items-center gap-2 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors border border-[#243352] rounded-md px-3 py-1.5 bg-[#0D1526] hover:border-[#2E4270] hover:bg-[#131E35]">
                 <RefreshCw size={14} />
                 Refresh
              </button>
           </div>

           {/* Stats Row */}
           <div className="grid grid-cols-6 gap-4">
              <StatCard title="Providers" value="5" icon={<Server size={16} className="text-[#7C6EFA]"/>} trend="+1" isUp={true} delay="50ms" />
              <StatCard title="Models" value="14" icon={<Cpu size={16} className="text-[#22D3EE]" />} trend="+2" isUp={true} delay="100ms" />
              <StatCard title="Workflows" value="3" icon={<GitBranch size={16} className="text-[#F59E0B]" />} trend="0" isUp={true} delay="150ms" />
              <StatCard title="Executions" value="0" icon={<Zap size={16} className="text-[#F0F4FF]" />} trend="0" isUp={true} delay="200ms" />
              <StatCard title="Tokens" value="0" icon={<Activity size={16} className="text-[#F43F5E]" />} trend="0%" isUp={true} delay="250ms" />
              <StatCard title="Cost" value="Rp 0" icon={<ShoppingBag size={16} className="text-[#10B981]" />} trend="0%" isUp={false} delay="300ms" />
           </div>

           {/* Charts Row */}
           <div className="grid grid-cols-3 gap-6">
             <div className="col-span-2 bg-[#0D1526] border border-[#243352] rounded-xl p-6 transition-all hover:border-[#2E4270] hover:shadow-[0_8px_32px_rgba(6,11,24,0.4)] group animate-fade-in-up" style={{ animationDelay: '350ms' }}>
               <div className="flex items-center justify-between mb-6">
                 <h3 className="text-sm font-medium tracking-wide text-[#8B9BC4]">TOKEN USAGE (7 DAYS)</h3>
                 <div className="flex gap-2">
                   {['24h', '7d', '30d'].map(t => (
                     <button key={t} className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${t === '7d' ? 'bg-[#1C2A45] text-[#F0F4FF]' : 'text-[#4F6494] hover:text-[#8B9BC4] hover:bg-[#131E35]'}`}>{t}</button>
                   ))}
                 </div>
               </div>
               <div className="h-64 flex flex-col items-center justify-center border border-dashed border-[#243352] rounded-lg bg-[#060B18]/50 group-hover:border-[#2E4270] transition-colors">
                 <Activity size={32} className="text-[#243352] mb-3 group-hover:text-[#4F6494] transition-colors" />
                 <p className="text-sm text-[#8B9BC4] font-medium">No telemetry data available</p>
                 <p className="text-xs text-[#4F6494] mt-1">Deploy workflows to generate traffic</p>
               </div>
             </div>
             
             <div className="col-span-1 bg-[#0D1526] border border-[#243352] rounded-xl p-6 transition-all hover:border-[#2E4270] hover:shadow-[0_8px_32px_rgba(6,11,24,0.4)] animate-fade-in-up" style={{ animationDelay: '400ms' }}>
               <h3 className="text-sm font-medium tracking-wide text-[#8B9BC4] mb-6">PROVIDER DISTRIBUTION</h3>
               <div className="space-y-5">
                  <BarItem name="Anthropic" value="38%" color="#7C6EFA" delay="450ms" />
                  <BarItem name="OpenAI" value="32%" color="#22D3EE" delay="500ms" />
                  <BarItem name="Google Gemini" value="18%" color="#F59E0B" delay="550ms" />
                  <BarItem name="Replicate" value="8%" color="#10B981" delay="600ms" />
                  <BarItem name="Mistral AI" value="4%" color="#F43F5E" delay="650ms" />
               </div>
             </div>
           </div>

           {/* Table */}
           <div className="bg-[#0D1526] border border-[#243352] rounded-xl overflow-hidden transition-all hover:border-[#2E4270] hover:shadow-[0_8px_32px_rgba(6,11,24,0.4)] animate-fade-in-up" style={{ animationDelay: '500ms' }}>
              <div className="px-6 py-4 border-b border-[#243352] flex items-center justify-between bg-[#0D1526]">
                <h3 className="text-sm font-medium tracking-wide text-[#8B9BC4]">RECENT ACTIVITY</h3>
                <button className="text-xs text-[#7C6EFA] hover:text-[#9D91FB] font-medium transition-colors">View All</button>
              </div>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[11px] uppercase tracking-wider text-[#4F6494] bg-[#060B18]/80 border-b border-[#243352]">
                    <tr>
                      <th className="px-6 py-3 font-semibold">Event</th>
                      <th className="px-6 py-3 font-semibold">Target</th>
                      <th className="px-6 py-3 font-semibold">User</th>
                      <th className="px-6 py-3 font-semibold text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243352] bg-[#0D1526]">
                    <TableRow 
                      event="Workflow Created" 
                      target="Customer Onboarding v1" 
                      user="admin@aiplatform.id" 
                      time="2 mins ago" 
                      icon={<GitBranch size={14} className="text-[#10B981]"/>} 
                    />
                    <TableRow 
                      event="Model Config Updated" 
                      target="gpt-4-turbo-preview" 
                      user="system" 
                      time="1 hour ago" 
                      icon={<Settings size={14} className="text-[#F59E0B]"/>} 
                    />
                    <TableRow 
                      event="Provider Added" 
                      target="Anthropic" 
                      user="admin@aiplatform.id" 
                      time="3 hours ago" 
                      icon={<Server size={14} className="text-[#7C6EFA]"/>} 
                    />
                  </tbody>
                </table>
              </div>
           </div>
        </div>
      </main>
      
      <style dangerouslySetInnerHTML={{__html:`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        @keyframes expandWidth {
          from { width: 0; }
        }
        .animate-expand-width {
          animation: expandWidth 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}} />
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <a href="#" className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group ${active ? 'bg-[#7C6EFA]/10 text-[#F0F4FF] border-l-2 border-[#7C6EFA]' : 'text-[#8B9BC4] hover:text-[#F0F4FF] hover:bg-[#131E35] border-l-2 border-transparent'}`}>
      <div className={`${active ? 'text-[#7C6EFA]' : 'text-[#4F6494] group-hover:text-[#8B9BC4]'} transition-colors`}>
        {icon}
      </div>
      {label}
    </a>
  );
}

function StatCard({ title, value, icon, trend, isUp, delay }: { title: string, value: string, icon: React.ReactNode, trend: string, isUp: boolean, delay: string }) {
  return (
    <div className="bg-[#0D1526] border border-[#243352] rounded-xl p-5 transition-all hover:border-[#2E4270] hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(6,11,24,0.4)] group animate-fade-in-up" style={{ animationDelay: delay }}>
       <div className="flex justify-between items-start mb-4">
         <div className="text-[11px] font-semibold text-[#4F6494] uppercase tracking-wider">{title}</div>
         <div className="p-1.5 rounded-md bg-[#131E35] group-hover:bg-[#1C2A45] transition-colors">{icon}</div>
       </div>
       <div className="flex items-end justify-between">
         <div className="text-2xl font-medium tracking-tight text-[#F0F4FF]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
         <div className={`flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded ${isUp ? 'text-[#10B981] bg-[#10B981]/10' : 'text-[#4F6494] bg-[#243352]/50'}`}>
           {isUp && trend !== "0" && trend !== "0%" ? <TrendingUp size={12} className="mr-1" /> : (trend === "0" || trend === "0%" ? <Circle size={8} className="mr-1 opacity-50" /> : <TrendingDown size={12} className="mr-1" />)}
           {trend}
         </div>
       </div>
    </div>
  );
}

function BarItem({ name, value, color, delay }: { name: string, value: string, color: string, delay: string }) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: delay }}>
      <div className="flex justify-between text-xs mb-2">
        <span className="text-[#8B9BC4] font-medium">{name}</span>
        <span className="text-[#F0F4FF]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
      </div>
      <div className="h-2 w-full bg-[#131E35] rounded-full overflow-hidden">
        <div className="h-full rounded-full animate-expand-width" style={{ width: value, backgroundColor: color, animationDelay: delay }}></div>
      </div>
    </div>
  );
}

function TableRow({ event, target, user, time, icon }: { event: string, target: string, user: string, time: string, icon: React.ReactNode }) {
  return (
    <tr className="hover:bg-[#131E35]/50 transition-colors group">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#1C2A45] flex items-center justify-center border border-[#243352] group-hover:border-[#4F6494] transition-colors">
            {icon}
          </div>
          <span className="font-medium text-[#F0F4FF]">{event}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-[#8B9BC4]">{target}</td>
      <td className="px-6 py-4">
        <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#131E35] text-[#8B9BC4] border border-[#243352] group-hover:border-[#4F6494] transition-colors">
          {user}
        </span>
      </td>
      <td className="px-6 py-4 text-right text-[#4F6494] text-xs font-medium">
        {time}
      </td>
    </tr>
  );
}
