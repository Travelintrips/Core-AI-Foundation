import React, { useState, useEffect } from 'react';
import { 
  PenTool, 
  Megaphone, 
  PieChart, 
  Scale, 
  Truck, 
  BarChart2, 
  ChevronRight, 
  Play, 
  Star, 
  Sparkles, 
  ArrowRight,
  CheckCircle2,
  Box,
  Cpu,
  Shield,
  Zap
} from 'lucide-react';

export function PortalDesktop() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const services = [
    {
      icon: <PenTool className="w-5 h-5 text-[#7C6EFA]" />,
      title: "Creative AI",
      desc: "Hasilkan aset visual, copywriting, dan kampanye brand secara instan dengan panduan AI generatif.",
      price: "Mulai Rp 5.000.000 / bln"
    },
    {
      icon: <Megaphone className="w-5 h-5 text-[#22D3EE]" />,
      title: "Marketing AI",
      desc: "Optimasi kampanye digital, segmentasi audiens, dan prediktif ROI untuk semua platform media.",
      price: "Mulai Rp 7.500.000 / bln"
    },
    {
      icon: <PieChart className="w-5 h-5 text-[#F59E0B]" />,
      title: "Finance AI",
      desc: "Otomatisasi rekonsiliasi, invoice, dan prediksi arus kas enterprise dengan akurasi 99%.",
      price: "Mulai Rp 10.000.000 / bln"
    },
    {
      icon: <Scale className="w-5 h-5 text-[#10B981]" />,
      title: "Legal AI",
      desc: "Analisis kontrak massal, kepatuhan regulasi otomatis, dan ekstraksi klausa dalam hitungan detik.",
      price: "Mulai Rp 12.500.000 / bln"
    },
    {
      icon: <Truck className="w-5 h-5 text-[#F43F5E]" />,
      title: "Logistics AI",
      desc: "Optimalkan rute pengiriman, manajemen inventaris prediktif, dan efisiensi armada B2B.",
      price: "Mulai Rp 8.000.000 / bln"
    },
    {
      icon: <BarChart2 className="w-5 h-5 text-[#7C6EFA]" />,
      title: "Data Analytics AI",
      desc: "Transformasi jutaan baris data menjadi insight strategis dan dashboard real-time untuk C-Level.",
      price: "Mulai Rp 15.000.000 / bln"
    }
  ];

  const steps = [
    {
      num: "01",
      title: "Submit Brief",
      desc: "Berikan detail kebutuhan proyek dan target metrik bisnis Anda melalui portal kami."
    },
    {
      num: "02",
      title: "AI Analysis & Quotation",
      desc: "Sistem kami menganalisis scope dan memberikan estimasi harga serta timeline real-time."
    },
    {
      num: "03",
      title: "Production & Delivery",
      desc: "Agen AI spesialis mengeksekusi tugas dengan kualitas enterprise, siap Anda review."
    }
  ];

  return (
    <div className="min-h-screen bg-[#060B18] text-[#F0F4FF] selection:bg-[#7C6EFA]/30 overflow-x-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Background Effects */}
      <div 
        className="fixed top-0 left-0 w-full h-full pointer-events-none z-0"
        style={{
          background: 'radial-gradient(ellipse at 60% 0%, rgba(124,110,250,0.15) 0%, transparent 60%)'
        }}
      />
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }} />

      {/* 1. Navigation Bar */}
      <nav 
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          scrolled ? 'bg-[#060B18]/85 backdrop-blur-md border-b border-[#243352]/50 py-3' : 'bg-transparent py-5'
        }`}
      >
        <div className="max-w-[1280px] mx-auto px-8 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-pointer">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-[#0D1526] border border-[#2E4270] shadow-[0_0_15px_rgba(124,110,250,0.3)] group-hover:shadow-[0_0_20px_rgba(124,110,250,0.5)] transition-all duration-300">
              <Sparkles className="w-4 h-4 text-[#7C6EFA]" />
            </div>
            <span className="font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-lg tracking-tight text-[#F0F4FF]">
              Creative Studio
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#8B9BC4]">
            <a href="#" className="hover:text-[#F0F4FF] transition-colors">Layanan</a>
            <a href="#" className="hover:text-[#F0F4FF] transition-colors">Portfolio</a>
            <a href="#" className="hover:text-[#F0F4FF] transition-colors">Harga</a>
            <a href="#" className="hover:text-[#F0F4FF] transition-colors">Blog</a>
          </div>

          <div className="flex items-center gap-4">
            <button className="text-sm font-medium text-[#8B9BC4] hover:text-[#F0F4FF] px-4 py-2 transition-colors">
              Masuk
            </button>
            <button className="flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg text-white bg-gradient-to-br from-[#7C6EFA] to-[#5F52D0] hover:shadow-[0_0_20px_rgba(124,110,250,0.4)] hover:scale-[1.02] active:scale-95 transition-all duration-200">
              Mulai Sekarang <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative z-10">
        {/* 2. Hero Section */}
        <section className="relative min-h-[100dvh] flex items-center pt-20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#060B18] via-[#0D1526] to-[#12163A] -z-10" />
          
          <div className="max-w-[1280px] mx-auto px-8 w-full grid lg:grid-cols-2 gap-16 items-center">
            <div className={`transition-all duration-1000 ease-out ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131E35]/50 border border-[#2E4270] mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22D3EE] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22D3EE]"></span>
                </span>
                <span className="text-xs font-medium text-[#22D3EE] tracking-wide uppercase">15 Layanan AI Enterprise Tersedia</span>
              </div>
              
              <h1 className="font-['Plus_Jakarta_Sans',sans-serif] text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-6">
                Transformasi Bisnis Anda <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7C6EFA] via-[#9D91FB] to-[#22D3EE]">
                  dengan AI Enterprise
                </span>
              </h1>
              
              <p className="text-lg text-[#8B9BC4] max-w-lg mb-10 leading-relaxed">
                Dari kampanye kreatif hingga pengajuan pajak — tim AI Anda siap bekerja. Tingkatkan efisiensi operasional hingga 10x lipat dengan agen cerdas kami.
              </p>
              
              <div className="flex flex-wrap items-center gap-4 mb-14">
                <button className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-white bg-gradient-to-br from-[#7C6EFA] to-[#5F52D0] font-medium hover:shadow-[0_0_30px_rgba(124,110,250,0.5)] hover:scale-[1.02] active:scale-95 transition-all duration-200">
                  Mulai Sekarang <ArrowRight className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-2 px-7 py-3.5 rounded-xl text-[#F0F4FF] bg-[#131E35] border border-[#2E4270] font-medium hover:bg-[#1C2A45] hover:border-[#4F6494] active:scale-95 transition-all duration-200">
                  <Play className="w-4 h-4 text-[#7C6EFA] fill-[#7C6EFA]" /> Lihat Demo
                </button>
              </div>

              <div className="flex items-center gap-8 border-t border-[#243352]/50 pt-8">
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Star className="w-4 h-4 text-[#F59E0B] fill-[#F59E0B]" />
                    <span className="font-semibold text-lg">4.9</span>
                  </div>
                  <div className="text-xs text-[#8B9BC4] font-medium">Rating Enterprise</div>
                </div>
                <div className="w-px h-8 bg-[#243352]"></div>
                <div>
                  <div className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-lg mb-1">500+</div>
                  <div className="text-xs text-[#8B9BC4] font-medium">Klien Aktif</div>
                </div>
                <div className="w-px h-8 bg-[#243352] hidden sm:block"></div>
                <div className="hidden sm:block">
                  <div className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-lg mb-1">99.9%</div>
                  <div className="text-xs text-[#8B9BC4] font-medium">Uptime SLA</div>
                </div>
              </div>
            </div>

            <div className={`relative perspective-1000 transition-all duration-1000 delay-300 ease-out ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0'}`}>
              <div className="relative w-full aspect-[4/3] rounded-2xl bg-[#0D1526]/80 backdrop-blur-xl border border-[#2E4270] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8),0_0_40px_rgba(124,110,250,0.15)] transform rotate-y-[-5deg] rotate-x-[2deg] rotate-z-[1deg] p-6 overflow-hidden">
                {/* Mockup Top Bar */}
                <div className="flex items-center justify-between mb-8 border-b border-[#243352] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-[#F43F5E]"></div>
                    <div className="w-3 h-3 rounded-full bg-[#F59E0B]"></div>
                    <div className="w-3 h-3 rounded-full bg-[#10B981]"></div>
                  </div>
                  <div className="flex items-center gap-2 bg-[#060B18] px-3 py-1.5 rounded-md border border-[#243352]">
                    <Shield className="w-3 h-3 text-[#10B981]" />
                    <span className="text-[10px] font-['JetBrains_Mono',monospace] text-[#8B9BC4]">SYS_READY</span>
                  </div>
                </div>

                {/* Mockup Active Job */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-sm">Active Generations</h3>
                    <span className="text-[10px] font-['JetBrains_Mono',monospace] text-[#7C6EFA] bg-[#7C6EFA]/10 px-2 py-1 rounded">2 RUNNING</span>
                  </div>
                  
                  {/* Job Card */}
                  <div className="bg-[#131E35] border border-[#2E4270] rounded-xl p-4 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-[#7C6EFA] to-[#22D3EE] w-3/4 animate-pulse"></div>
                    <div className="flex justify-between items-start mb-3 mt-1">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-[#1C2A45] flex items-center justify-center">
                          <Cpu className="w-4 h-4 text-[#22D3EE]" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold">Q3 Marketing Campaign</div>
                          <div className="text-[10px] text-[#8B9BC4]">Marketing AI • Copy & Visuals</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-['JetBrains_Mono',monospace] text-[#22D3EE]">
                        <Zap className="w-3 h-3" /> 75%
                      </div>
                    </div>
                    <div className="space-y-2 mt-4">
                      <div className="flex justify-between text-[10px] text-[#4F6494] font-['JetBrains_Mono',monospace]">
                        <span>Generating copy variants...</span>
                        <span>0.4s elapsed</span>
                      </div>
                      <div className="w-full bg-[#060B18] rounded-full h-1.5">
                        <div className="bg-[#22D3EE] h-1.5 rounded-full w-[75%] shadow-[0_0_10px_rgba(34,211,238,0.5)]"></div>
                      </div>
                    </div>
                  </div>

                  {/* Completed Job */}
                  <div className="bg-[#131E35]/50 border border-[#243352] rounded-xl p-4 relative opacity-70">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-[#1C2A45] flex items-center justify-center">
                          <PieChart className="w-4 h-4 text-[#10B981]" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold">April Tax Reconciliation</div>
                          <div className="text-[10px] text-[#8B9BC4]">Finance AI • 2,400 rows</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-['JetBrains_Mono',monospace] text-[#10B981]">
                        <CheckCircle2 className="w-3 h-3" /> DONE
                      </div>
                    </div>
                  </div>
                </div>

                {/* Decorative glow */}
                <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-[#7C6EFA]/20 blur-[100px] rounded-full pointer-events-none"></div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Services Grid */}
        <section className="py-32 relative bg-[#060B18]">
          <div className="max-w-[1280px] mx-auto px-8">
            <div className="text-center mb-20">
              <h2 className="font-['Plus_Jakarta_Sans',sans-serif] text-3xl md:text-4xl font-bold mb-4">Layanan AI Kami</h2>
              <p className="text-[#8B9BC4] max-w-2xl mx-auto">Solusi kecerdasan buatan end-to-end yang dirancang khusus untuk memenuhi kompleksitas operasional enterprise di Indonesia.</p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, idx) => (
                <div 
                  key={idx} 
                  className="group bg-[#0D1526] border border-[#243352] rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#7C6EFA]/50 hover:shadow-[0_8px_32px_rgba(6,11,24,0.7),0_0_20px_rgba(124,110,250,0.1)] flex flex-col h-full cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#7C6EFA]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-bl-full pointer-events-none" />
                  
                  <div className="w-12 h-12 rounded-xl bg-[#131E35] border border-[#2E4270] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-[#7C6EFA]/30 transition-all duration-300">
                    {service.icon}
                  </div>
                  
                  <h3 className="font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-xl mb-3">{service.title}</h3>
                  <p className="text-[#8B9BC4] text-sm leading-relaxed mb-8 flex-grow">{service.desc}</p>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-[#243352] mt-auto">
                    <span className="font-['JetBrains_Mono',monospace] text-xs font-medium text-[#F0F4FF]">{service.price}</span>
                    <span className="text-[#7C6EFA] text-xs font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
                      Detail <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. How It Works */}
        <section className="py-24 bg-[#0D1526] border-y border-[#243352]">
          <div className="max-w-[1280px] mx-auto px-8">
            <div className="text-center mb-16">
              <h2 className="font-['Plus_Jakarta_Sans',sans-serif] text-3xl font-bold">Bagaimana Cara Kerjanya</h2>
              <p className="text-[#8B9BC4] mt-3">Tiga langkah sederhana menuju efisiensi maksimal.</p>
            </div>

            <div className="relative grid md:grid-cols-3 gap-12 lg:gap-8 max-w-5xl mx-auto">
              {/* Desktop Connector Line */}
              <div className="hidden md:block absolute top-8 left-[15%] right-[15%] h-[1px] bg-gradient-to-r from-[#243352] via-[#7C6EFA]/50 to-[#243352] -z-10" />

              {steps.map((step, idx) => (
                <div key={idx} className="relative flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-[#060B18] border border-[#2E4270] shadow-[0_0_20px_rgba(6,11,24,1)] flex items-center justify-center mb-6 relative group">
                    <div className="absolute inset-0 rounded-2xl bg-[#7C6EFA] opacity-0 group-hover:opacity-20 transition-opacity blur-md" />
                    <span className="font-['JetBrains_Mono',monospace] font-bold text-[#7C6EFA] text-xl relative z-10">{step.num}</span>
                  </div>
                  <h3 className="font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-lg mb-3">{step.title}</h3>
                  <p className="text-[#8B9BC4] text-sm leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. CTA Section */}
        <section className="py-32 relative">
          <div className="max-w-[1000px] mx-auto px-8 relative">
            <div className="absolute inset-0 bg-gradient-to-b from-[#7C6EFA]/10 to-transparent blur-3xl -z-10 rounded-full" />
            
            <div className="bg-[#0D1526] border border-[#2E4270] rounded-3xl p-12 md:p-16 text-center shadow-[0_0_50px_rgba(124,110,250,0.15)] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-[#22D3EE]/10 to-transparent blur-3xl -z-10 rounded-full translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-[#7C6EFA]/10 to-transparent blur-3xl -z-10 rounded-full -translate-x-1/2 translate-y-1/2" />

              <h2 className="font-['Plus_Jakarta_Sans',sans-serif] text-3xl md:text-5xl font-bold mb-6 max-w-2xl mx-auto tracking-tight">
                Siap memulai transformasi AI bisnis Anda?
              </h2>
              <p className="text-[#8B9BC4] text-lg mb-10 max-w-xl mx-auto">
                Bergabunglah dengan ratusan perusahaan enterprise yang telah meningkatkan efisiensi mereka bersama Creative Studio.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white bg-gradient-to-br from-[#7C6EFA] to-[#5F52D0] font-medium hover:shadow-[0_0_30px_rgba(124,110,250,0.5)] hover:scale-[1.02] active:scale-95 transition-all duration-200">
                  Konsultasi Gratis <ArrowRight className="w-4 h-4" />
                </button>
                <button className="w-full sm:w-auto px-8 py-4 rounded-xl text-[#F0F4FF] bg-[#1C2A45] border border-[#2E4270] font-medium hover:bg-[#243352] active:scale-95 transition-all duration-200">
                  Hubungi Sales
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 6. Footer */}
      <footer className="bg-[#060B18] border-t border-[#243352] py-16 relative z-10">
        <div className="max-w-[1280px] mx-auto px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-16">
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <Sparkles className="w-5 h-5 text-[#7C6EFA]" />
                <span className="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-xl tracking-tight text-[#F0F4FF]">
                  Creative Studio
                </span>
              </div>
              <p className="text-[#8B9BC4] text-sm max-w-xs leading-relaxed">
                Enterprise AI Marketplace pertama di Indonesia yang menghubungkan korporasi dengan agen cerdas spesialis industri.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold text-[#F0F4FF] mb-4">Layanan</h4>
              <ul className="space-y-3 text-sm text-[#4F6494]">
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Creative AI</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Marketing AI</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Finance AI</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Legal AI</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-[#F0F4FF] mb-4">Perusahaan</h4>
              <ul className="space-y-3 text-sm text-[#4F6494]">
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Tentang Kami</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Karier</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Press</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-[#F0F4FF] mb-4">Support</h4>
              <ul className="space-y-3 text-sm text-[#4F6494]">
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Pusat Bantuan</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Dokumentasi API</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Status Sistem</a></li>
                <li><a href="#" className="hover:text-[#7C6EFA] transition-colors">Hubungi Kami</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-[#243352] pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-[#4F6494] text-sm">
              © {new Date().getFullYear()} Creative Studio AI. Hak cipta dilindungi.
            </p>
            <div className="flex gap-6 text-sm text-[#4F6494]">
              <a href="#" className="hover:text-[#F0F4FF] transition-colors">Syarat & Ketentuan</a>
              <a href="#" className="hover:text-[#F0F4FF] transition-colors">Kebijakan Privasi</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
