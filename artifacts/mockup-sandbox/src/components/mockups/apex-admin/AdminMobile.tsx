import React, { useState } from 'react';
import { 
  Bell, 
  Search, 
  BarChart2, 
  Bot, 
  GitMerge, 
  Settings,
  Server,
  Cpu,
  Activity,
  CheckCircle2,
  AlertCircle,
  Home,
  Menu,
  LineChart
} from 'lucide-react';

export function AdminMobile() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div 
      className="relative flex flex-col font-sans"
      style={{
        width: 390, 
        minHeight: 844, 
        background: '#060B18', 
        overflowY: 'auto',
        overflowX: 'hidden',
        color: '#F0F4FF',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up {
          opacity: 0;
          animation: fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .stagger-1 { animation-delay: 0.1s; }
        .stagger-2 { animation-delay: 0.2s; }
        .stagger-3 { animation-delay: 0.3s; }
        .stagger-4 { animation-delay: 0.4s; }
        
        .hover-card {
          transition: transform 150ms ease-out, box-shadow 150ms ease-out, border-color 150ms ease-out;
        }
        .hover-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(6,11,24,0.7);
          border-color: #2E4270 !important;
        }
        
        .btn-press {
          transition: transform 100ms ease-out, opacity 100ms;
        }
        .btn-press:active {
          transform: scale(0.97);
          opacity: 0.8;
        }

        /* Hide scrollbar for a native feel */
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Top Header */}
      <div 
        className="fixed top-0 z-20 w-[390px] backdrop-blur-md"
        style={{
          background: 'rgba(6, 11, 24, 0.75)',
          borderBottom: '1px solid #243352',
        }}
      >
        <div className="flex items-center justify-between px-5 h-16">
          <div className="flex items-center gap-2.5">
            <div 
              className="flex items-center justify-center w-8 h-8 rounded-lg shadow-lg"
              style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)' }}
            >
              <Bot size={18} color="#FFF" />
            </div>
            <span 
              className="font-bold text-[15px] tracking-wide"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              AI Platform
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="relative btn-press">
              <Bell size={20} color="#8B9BC4" />
              <div 
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-[1.5px] border-[#060B18]"
                style={{ background: '#F43F5E' }}
              />
            </button>
            <button 
              className="w-8 h-8 rounded-full bg-cover bg-center border-[1.5px] btn-press"
              style={{ 
                borderColor: '#2E4270',
                backgroundImage: 'url(https://i.pravatar.cc/100?img=33)' 
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 pt-24 pb-24 space-y-7 hide-scrollbar" style={{ overflowY: 'auto' }}>
        
        {/* Welcome Section */}
        <div className="space-y-1 animate-fade-up">
          <h1 
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Overview
          </h1>
          <p style={{ color: '#8B9BC4', fontSize: '14px' }}>
            System performance and usage
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3.5 animate-fade-up stagger-1">
          {[
            { icon: <Server size={18} color="#7C6EFA" />, label: "Providers", val: "5" },
            { icon: <Cpu size={18} color="#22D3EE" />, label: "Models", val: "14" },
            { icon: <GitMerge size={18} color="#F59E0B" />, label: "Workflows", val: "3" },
            { icon: <Activity size={18} color="#10B981" />, label: "Executions", val: "0" },
          ].map((stat, i) => (
            <div 
              key={i}
              className="rounded-[14px] p-4 flex flex-col gap-3 hover-card cursor-pointer"
              style={{
                background: '#0D1526',
                border: '1px solid #243352',
              }}
            >
              <div className="flex items-center justify-between">
                <div 
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: '#131E35' }}
                >
                  {stat.icon}
                </div>
              </div>
              <div className="mt-1">
                <div 
                  className="text-2xl font-bold tracking-tight"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: '#F0F4FF' }}
                >
                  {stat.val}
                </div>
                <div className="mt-0.5 font-medium" style={{ color: '#8B9BC4', fontSize: '13px' }}>
                  {stat.label}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="animate-fade-up stagger-2">
          <h2 
            className="text-[15px] font-semibold mb-4"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
          >
            Quick Actions
          </h2>
          <div className="flex justify-between items-center px-1">
            {[
              { icon: <BarChart2 size={22} />, label: "Analytics", color: '#7C6EFA' },
              { icon: <Bot size={22} />, label: "Agents", color: '#22D3EE' },
              { icon: <GitMerge size={22} />, label: "Workflows", color: '#F59E0B' },
              { icon: <Settings size={22} />, label: "Settings", color: '#8B9BC4' },
            ].map((action, i) => (
              <button key={i} className="flex flex-col items-center gap-2.5 btn-press">
                <div 
                  className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center"
                  style={{ 
                    background: '#0D1526', 
                    border: '1px solid #243352', 
                    color: action.color,
                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05)'
                  }}
                >
                  {action.icon}
                </div>
                <span className="font-medium" style={{ fontSize: '12px', color: '#8B9BC4' }}>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chart Card */}
        <div 
          className="rounded-[16px] p-5 flex flex-col hover-card cursor-pointer animate-fade-up stagger-3 relative overflow-hidden"
          style={{
            background: '#0D1526',
            border: '1px solid #243352',
            minHeight: '220px'
          }}
        >
          {/* Subtle AI Aura glow */}
          <div 
            className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 80% 0%, rgba(124,110,250,0.12) 0%, transparent 70%)'
            }}
          />
          
          <div className="flex justify-between items-center mb-6 relative z-10">
            <h3 
              className="text-[15px] font-semibold"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Token Usage
            </h3>
            <span className="px-2.5 py-1 rounded-md font-medium" style={{ fontSize: '12px', color: '#8B9BC4', background: '#131E35' }}>
              Last 7 days
            </span>
          </div>
          
          <div className="flex-1 flex flex-col items-center justify-center opacity-60 relative z-10 mt-4 pb-4">
            <div className="relative mb-3">
              <LineChart size={40} color="#4F6494" strokeWidth={1.5} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border border-dashed border-[#4F6494] rounded-full opacity-30 animate-[spin_10s_linear_infinite]" />
            </div>
            <span className="font-medium" style={{ fontSize: '14px', color: '#8B9BC4' }}>No data available</span>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="animate-fade-up stagger-4">
          <div className="flex justify-between items-center mb-4">
            <h2 
              className="text-[15px] font-semibold"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#F0F4FF' }}
            >
              Recent Activity
            </h2>
            <button className="text-[13px] font-medium btn-press" style={{ color: '#7C6EFA' }}>
              View All
            </button>
          </div>
          
          <div 
            className="rounded-[16px] overflow-hidden hover-card"
            style={{
              background: '#0D1526',
              border: '1px solid #243352',
            }}
          >
            {[
              { status: 'success', text: "Marketing Agent updated", time: "2m ago", detail: "v2.4 deployed" },
              { status: 'error', text: "Failed to connect OpenAI", time: "1h ago", detail: "API key invalid" },
              { status: 'success', text: "Finance AI model synced", time: "3h ago", detail: "Data ingestion complete" },
            ].map((item, i) => (
              <div 
                key={i}
                className="flex items-start gap-3.5 p-4 border-b last:border-0 btn-press cursor-pointer"
                style={{ borderColor: '#1C2A45', background: 'rgba(13, 21, 38, 0.5)' }}
              >
                <div className="mt-0.5">
                  {item.status === 'success' ? (
                    <div className="flex items-center justify-center w-6 h-6 rounded-full" style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
                      <CheckCircle2 size={14} color="#10B981" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-6 h-6 rounded-full" style={{ background: 'rgba(244, 63, 94, 0.15)' }}>
                      <AlertCircle size={14} color="#F43F5E" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium" style={{ fontSize: '14px', color: '#F0F4FF' }}>{item.text}</div>
                  <div className="mt-1" style={{ fontSize: '13px', color: '#8B9BC4' }}>{item.detail}</div>
                </div>
                <div className="font-medium" style={{ fontSize: '12px', color: '#4F6494' }}>{item.time}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Bottom Nav */}
      <div 
        className="fixed bottom-0 w-[390px] h-[84px] flex items-start justify-around px-2 pt-3 z-20 pb-safe"
        style={{
          background: 'rgba(13, 21, 38, 0.9)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid #243352',
        }}
      >
        {[
          { id: 'dashboard', icon: <Home size={24} />, label: "Dashboard" },
          { id: 'analytics', icon: <BarChart2 size={24} />, label: "Analytics" },
          { id: 'agents', icon: <Bot size={24} />, label: "Agents" },
          { id: 'tasks', icon: <Activity size={24} />, label: "Tasks" },
          { id: 'settings', icon: <Settings size={24} />, label: "Settings" },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center justify-center gap-1.5 w-16 btn-press"
              style={{
                color: isActive ? '#7C6EFA' : '#4F6494',
                transition: 'color 0.2s ease-out'
              }}
            >
              <div 
                className={`relative flex items-center justify-center ${isActive ? 'scale-110' : 'scale-100'}`}
                style={{ transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              >
                {tab.icon}
                {isActive && (
                  <div 
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: '#7C6EFA' }}
                  />
                )}
              </div>
              <span style={{ fontSize: '11px', fontWeight: isActive ? 600 : 500 }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
