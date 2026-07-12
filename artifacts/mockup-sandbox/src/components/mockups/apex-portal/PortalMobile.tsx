import React from 'react';
import { Menu, ChevronRight, Star, ArrowRight, Zap, BarChart, Scale, Cpu } from 'lucide-react';

export function PortalMobile() {
  return (
    <div style={{ width: 390, minHeight: 844, background: '#060B18', overflowY: 'auto', overflowX: 'hidden', position: 'relative', fontFamily: "'Inter', sans-serif" }}>
      {/* Background Gradients */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, #060B18 0%, #0D1526 50%, #12163A 100%)', zIndex: 0 }}></div>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '800px', pointerEvents: 'none', background: 'radial-gradient(ellipse at 60% 0%, rgba(124,110,250,0.15) 0%, transparent 60%)', zIndex: 0 }}></div>

      {/* Navigation */}
      <nav style={{ position: 'sticky', top: 0, height: 56, background: 'rgba(6,11,24,0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid #243352', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', zIndex: 50 }}>
        <div style={{ color: '#F0F4FF', fontSize: 16, fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, border: '2px solid #7C6EFA', transform: 'rotate(45deg)' }}></div>
          Creative Studio
        </div>
        <button style={{ background: 'transparent', border: 'none', color: '#F0F4FF', padding: 0 }}>
          <Menu size={24} />
        </button>
      </nav>

      <main style={{ position: 'relative', zIndex: 10, paddingBottom: 100 }}>
        {/* Hero Section */}
        <section style={{ padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Badge */}
          <div style={{ alignSelf: 'flex-start', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', color: '#22D3EE', padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>✦</span> 15 Layanan AI
          </div>

          {/* Headline */}
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 36, fontWeight: 700, color: '#F0F4FF', lineHeight: 1.2, margin: 0, letterSpacing: '-0.02em' }}>
            Transformasi Bisnis Anda dengan <br />
            <span style={{ background: 'linear-gradient(135deg, #7C6EFA 0%, #9D91FB 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'inline-block' }}>AI Enterprise</span>
          </h1>

          {/* Subheadline */}
          <p style={{ color: '#8B9BC4', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Tingkatkan efisiensi dan produktivitas korporat melalui solusi kecerdasan buatan terbaik yang dirancang khusus untuk enterprise di Indonesia.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <button className="active:scale-95 transition-transform" style={{ width: '100%', height: 48, borderRadius: 8, background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', color: '#FFF', fontSize: 15, fontWeight: 600, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
              Mulai Sekarang <ArrowRight size={18} />
            </button>
            <button style={{ width: '100%', height: 48, borderRadius: 8, background: 'transparent', color: '#F0F4FF', fontSize: 15, fontWeight: 600, border: '1px solid #2E4270', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              Lihat Demo
            </button>
          </div>

          {/* Trust Stats (Horizontal Scroll) */}
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, marginTop: 16, msOverflowStyle: 'none', scrollbarWidth: 'none' }} className="hide-scrollbar">
            {[
              { icon: <Star size={14} color="#F59E0B" fill="#F59E0B" />, text: '4.9/5 Rating' },
              { icon: <span style={{ color: '#22D3EE' }}>●</span>, text: '500+ Klien' },
              { icon: <Cpu size={14} color="#9D91FB" />, text: '15 AI Model' },
              { icon: <Zap size={14} color="#10B981" />, text: '99.9% Uptime' }
            ].map((stat, i) => (
              <div key={i} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, background: '#131E35', border: '1px solid #243352', padding: '8px 12px', borderRadius: 999, fontSize: 12, color: '#8B9BC4', fontWeight: 500 }}>
                {stat.icon} {stat.text}
              </div>
            ))}
          </div>
        </section>

        {/* Services List */}
        <section style={{ padding: '16px' }}>
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: '#F0F4FF', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 4, height: 20, background: '#7C6EFA', borderRadius: 4 }}></div>
            Layanan Kami
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { name: 'Creative AI', desc: 'Otomatisasi pembuatan aset visual dan copy', price: 'Mulai Rp 5JT/bln', icon: <Star size={20} color="#7C6EFA" /> },
              { name: 'Marketing AI', desc: 'Personalisasi kampanye marketing skala besar', price: 'Mulai Rp 7JT/bln', icon: <Zap size={20} color="#F59E0B" /> },
              { name: 'Finance AI', desc: 'Analisis prediktif & pelaporan keuangan otomatis', price: 'Mulai Rp 10JT/bln', icon: <BarChart size={20} color="#22D3EE" /> },
              { name: 'Legal AI', desc: 'Review kontrak & dokumen hukum cepat', price: 'Mulai Rp 12JT/bln', icon: <Scale size={20} color="#10B981" /> }
            ].map((service, i) => (
              <div key={i} style={{ background: '#0D1526', border: '1px solid #243352', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: '#131E35', border: '1px solid #2E4270', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {service.icon}
                  </div>
                  <button style={{ background: 'transparent', border: 'none', color: '#4F6494', cursor: 'pointer' }}>
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div>
                  <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 16, fontWeight: 600, color: '#F0F4FF', margin: '0 0 4px 0' }}>{service.name}</h3>
                  <p style={{ color: '#8B9BC4', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{service.desc}</p>
                </div>
                <div style={{ paddingTop: 12, borderTop: '1px solid #1C2A45', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#9D91FB' }}>{service.price}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Social Proof */}
        <section style={{ padding: '32px 0 16px 0' }}>
          <div style={{ padding: '0 16px', marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: '#F0F4FF', margin: 0 }}>Dipercaya Klien Top</h2>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 16px 16px 16px', msOverflowStyle: 'none', scrollbarWidth: 'none' }} className="hide-scrollbar">
            {[
              { company: 'TechCorp Indonesia', quote: 'Platform ini telah menghemat 40% waktu produksi materi marketing kami.', role: 'CMO' },
              { company: 'Global Logistics', quote: 'Prediksi supply chain menggunakan AI Enterprise sangat akurat. Return on investment luar biasa.', role: 'VP Operations' }
            ].map((testi, i) => (
              <div key={i} style={{ flexShrink: 0, width: 280, background: '#0D1526', border: '1px solid #243352', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
                  {[...Array(5)].map((_, j) => <Star key={j} size={14} color="#F59E0B" fill="#F59E0B" />)}
                </div>
                <p style={{ color: '#F0F4FF', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px 0', fontStyle: 'italic' }}>"{testi.quote}"</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1C2A45', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B9BC4', fontSize: 12, fontWeight: 700 }}>
                    {testi.company[0]}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F4FF' }}>{testi.company}</div>
                    <div style={{ fontSize: 11, color: '#8B9BC4' }}>{testi.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Banner */}
        <section style={{ padding: '16px' }}>
          <div style={{ background: 'linear-gradient(135deg, #131E35 0%, #1C2A45 100%)', border: '1px solid #2E4270', borderRadius: 16, padding: 24, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, background: 'radial-gradient(circle, rgba(124,110,250,0.4) 0%, transparent 70%)', filter: 'blur(20px)' }}></div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, color: '#F0F4FF', marginBottom: 8, position: 'relative', zIndex: 1 }}>Siap Bertransformasi?</h2>
            <p style={{ color: '#8B9BC4', fontSize: 14, marginBottom: 20, position: 'relative', zIndex: 1 }}>Diskusikan kebutuhan bisnis Anda dengan tim ahli kami hari ini.</p>
            <button style={{ width: '100%', height: 44, borderRadius: 8, background: '#F0F4FF', color: '#060B18', fontSize: 14, fontWeight: 600, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', position: 'relative', zIndex: 1 }}>
              Mulai Konsultasi Gratis <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      {/* Bottom Sticky CTA */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, #060B18 60%, transparent 100%)', padding: '32px 16px 16px 16px', zIndex: 50 }}>
        <button style={{ width: '100%', height: 52, borderRadius: 12, background: 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)', color: '#FFF', fontSize: 16, fontWeight: 600, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(124,110,250,0.3)', cursor: 'pointer' }}>
          Mulai Sekarang
        </button>
      </div>
      
      {/* Global styles for hide-scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-up {
          animation: fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}} />
    </div>
  );
}
