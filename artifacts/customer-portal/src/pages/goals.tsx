/**
 * Goals Browse Page — /goals — Team 03
 *
 * Shows all active business goals. Customer picks a goal to see
 * relevant services, instead of browsing a long service list.
 */

import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useGoals } from "@/hooks/use-goals";
import { GoalCard, GoalCardSkeleton } from "@/components/goal-card";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, LayoutGrid, RefreshCw } from "lucide-react";

// ── Animation variants ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const { data: goals, isLoading, isError, refetch } = useGoals();

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-[#243352]">
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <motion.div
              animate={{ scale: [1, 1.08, 1], opacity: [0.07, 0.13, 0.07] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[380px] rounded-full"
              style={{ background: "radial-gradient(ellipse, #7C6EFA 0%, transparent 70%)", filter: "blur(60px)" }}
            />
            <div
              className="absolute inset-0 opacity-[0.02]"
              style={{
                backgroundImage:
                  "linear-gradient(#7C6EFA 1px, transparent 1px), linear-gradient(90deg, #7C6EFA 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-14 md:py-20 text-center">
            {/* Badge */}
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center justify-center gap-2 mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2E4270] bg-[#0D1526]/70 text-xs font-semibold text-[#7C6EFA]">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Apa yang ingin Anda capai?
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-bold text-3xl md:text-5xl mb-4 leading-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Pilih tujuan bisnis Anda
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="text-sm md:text-base text-[#8B9BC4] max-w-xl mx-auto mb-8"
            >
              Ceritakan apa yang ingin Anda wujudkan. Kami akan menampilkan layanan yang paling sesuai untuk Anda.
            </motion.p>

            {/* Link to full catalog */}
            <motion.div variants={fadeUp} initial="hidden" animate="show">
              <Link
                href="/services"
                className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                Atau telusuri semua layanan
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ── Goal grid ────────────────────────────────────────────────── */}
        <section className="container mx-auto px-4 md:px-8 max-w-6xl py-12 md:py-16">

          {/* Loading */}
          {isLoading && (
            <>
              <p className="sr-only" role="status">Memuat tujuan bisnis…</p>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                aria-label="Memuat tujuan bisnis"
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <GoalCardSkeleton key={i} />
                ))}
              </div>
            </>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <div className="flex flex-col items-center gap-5 py-20 text-center" role="alert">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
                aria-hidden="true"
              >
                ⚠️
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Gagal memuat tujuan bisnis</p>
                <p className="text-sm text-[#8B9BC4]">Anda masih bisa menelusuri semua layanan secara langsung.</p>
              </div>
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={() => refetch()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Coba lagi
                </button>
                <Link
                  href="/services"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-[#060B18] hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #22D3EE 100%)" }}
                >
                  Lihat semua layanan
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && goals?.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.3)" }}
                aria-hidden="true"
              >
                🎯
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Belum ada tujuan tersedia</p>
                <p className="text-sm text-[#8B9BC4]">Anda masih bisa menelusuri semua layanan secara langsung.</p>
              </div>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-[#060B18] hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #22D3EE 100%)" }}
              >
                Lihat semua layanan
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          )}

          {/* Goal cards */}
          {!isLoading && !isError && goals && goals.length > 0 && (
            <>
              <h2 className="sr-only">Daftar tujuan bisnis</h2>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                role="list"
                aria-label="Tujuan bisnis"
              >
                {goals.map((goal, i) => (
                  <div key={goal.slug} role="listitem">
                    <GoalCard goal={goal} index={i} />
                  </div>
                ))}
              </div>

              {/* Bottom CTA */}
              <div className="mt-14 flex flex-col items-center gap-3">
                <p className="text-sm text-[#8B9BC4] text-center">
                  Tidak menemukan yang Anda cari?
                </p>
                <Link
                  href="/services"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:bg-[#131E35] hover:border-[#7C6EFA]/40 transition-all duration-150"
                >
                  <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                  Telusuri semua {' '}
                  layanan
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
