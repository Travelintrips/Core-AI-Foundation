/**
 * Solution Collections Page — /collections — Team 03
 *
 * Displays all public active solution collections from Team 04.
 * API: GET /api/ai/solution-collections → { collections: SafeCollection[] }
 *
 * Server filters to status=active & visibility=public before responding.
 * Frontend trusts this filtering per Team 01 commercial policy.
 */

import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useCollections } from "@/hooks/use-discovery";
import { useTrackMarketplaceViewed } from "@/hooks/use-discovery-analytics";
import { CollectionCard, CollectionCardSkeleton } from "@/components/collection-card";
import { motion } from "framer-motion";
import { Layers, ArrowRight, LayoutGrid, RefreshCw, AlertTriangle } from "lucide-react";
import { SEOMeta } from "@/components/SEOMeta";

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function CollectionsPage() {
  const { data: collections, isLoading, isError, error, refetch } = useCollections();
  // ── Analytics — /collections is a marketplace discovery surface (no dedicated collections-list event)
  // Team-6 determination: marketplace_viewed is semantically correct here; there is no
  // collections_list_viewed event and solution_collection_viewed requires a collectionSlug.
  useTrackMarketplaceViewed();

  return (
    <Layout>
      <SEOMeta
        title="Koleksi Layanan Kreatif"
        description="Temukan koleksi layanan creative AI yang dikurasi untuk berbagai kebutuhan bisnis — dari branding lengkap hingga paket digital marketing terpadu."
        canonical="/collections"
      />
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-[#243352]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <motion.div
              animate={{ scale: [1, 1.08, 1], opacity: [0.07, 0.13, 0.07] }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[380px] rounded-full"
              style={{ background: "radial-gradient(ellipse, #22D3EE 0%, transparent 70%)", filter: "blur(60px)" }}
            />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-14 md:py-20 text-center">
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center justify-center gap-2 mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2E4270] bg-[#0D1526]/70 text-xs font-semibold text-[#22D3EE]">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                Paket solusi terintegrasi
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-bold text-3xl md:text-5xl mb-4 leading-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Paket Solusi
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="text-sm md:text-base text-[#8B9BC4] max-w-xl mx-auto mb-8"
            >
              Kombinasi layanan yang dirancang untuk hasil bisnis terbaik.
            </motion.p>

            <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/goals"
                className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
              >
                Jelajahi berdasarkan tujuan
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
              <span className="text-[#243352] text-xs" aria-hidden="true">·</span>
              <Link
                href="/services"
                className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                Semua layanan
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ── Grid ─────────────────────────────────────────────────────── */}
        <section className="container mx-auto px-4 md:px-8 max-w-5xl py-12">

          {/* Loading */}
          {isLoading && (
            <>
              <h2 className="sr-only">Memuat paket solusi…</h2>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
                aria-busy="true"
                aria-label="Memuat…"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <CollectionCardSkeleton key={i} />
                ))}
              </div>
            </>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <div
              role="alert"
              className="flex flex-col items-center gap-5 py-20 text-center"
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <AlertTriangle className="w-7 h-7 text-red-400" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Tidak dapat memuat paket solusi</p>
                <p className="text-sm text-[#8B9BC4]">
                  {error?.message ?? "Terjadi kesalahan. Coba lagi."}
                </p>
              </div>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Coba lagi
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && collections && collections.length === 0 && (
            <div className="flex flex-col items-center gap-5 py-20 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}
              >
                <Layers className="w-7 h-7 text-[#22D3EE]" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Belum ada paket tersedia</p>
                <p className="text-sm text-[#8B9BC4]">Paket solusi akan segera hadir.</p>
              </div>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-[#060B18] hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #22D3EE 0%, #7C6EFA 100%)" }}
              >
                Lihat semua layanan
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          )}

          {/* Collection cards */}
          {!isLoading && !isError && collections && collections.length > 0 && (
            <>
              <h2 className="sr-only">Daftar paket solusi</h2>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
                role="list"
                aria-label="Paket solusi"
              >
                {collections.map((col, i) => (
                  <div key={col.slug} role="listitem">
                    <CollectionCard collection={col} index={i} />
                  </div>
                ))}
              </div>

              <div className="mt-14 flex flex-col items-center gap-3">
                <p className="text-sm text-[#8B9BC4]">Cari layanan individual?</p>
                <Link
                  href="/services"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:bg-[#131E35] hover:border-[#22D3EE]/40 transition-all duration-150"
                >
                  <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                  Telusuri semua layanan
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
