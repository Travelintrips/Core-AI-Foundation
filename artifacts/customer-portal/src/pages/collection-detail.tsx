/**
 * Collection Detail Page — /collections/:slug — Team 03
 *
 * Shows a single public solution collection and its eligible services.
 *
 * ── Navigation contract ──────────────────────────────────────────────────────
 *   Service cards link to /services/${service.id} (numeric PK from ai_services.id).
 *   serviceName and serviceCode are NOT used for routing.
 *
 * ── Commercial policy ────────────────────────────────────────────────────────
 *   Backend (Team 01 + Team 04) filters services to:
 *     status=active, visibility=public, commercial_status=commercial_ready.
 *   Frontend trusts this; no client-side commercial guards needed.
 *
 * API: GET /api/ai/solution-collections/:slug → { collection, services[] }
 */

import { Link, useParams } from "wouter";
import { Layout } from "@/components/layout";
import { useCollectionDetail } from "@/hooks/use-discovery";
import { useTrackCollectionOpened } from "@/hooks/use-discovery-analytics";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Clock, LayoutGrid, Layers, RefreshCw, AlertTriangle,
} from "lucide-react";
import type { CollectionService } from "@/lib/discoveryApi";
import { SEOMeta } from "@/components/SEOMeta";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string | null, currency: string): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!n) return "Hubungi kami";
  if (currency === "IDR") return `Rp ${n.toLocaleString("id-ID")}`;
  return `$${n.toLocaleString()}`;
}

// ── Service card ──────────────────────────────────────────────────────────────

function CollectionServiceCard({ service, index }: { service: CollectionService; index: number }) {
  const accentColor = index % 2 === 0 ? "#7C6EFA" : "#22D3EE";
  const borderColor = index % 2 === 0 ? "rgba(124,110,250,0.35)" : "rgba(34,211,238,0.25)";
  const bgGlow      = index % 2 === 0 ? "rgba(124,110,250,0.08)" : "rgba(34,211,238,0.06)";

  const priceDisplay = formatPrice(service.startingPrice, service.currency);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:-translate-y-0.5"
      style={{ background: "#0D1526", border: "1px solid #2E4270" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = borderColor;
        (e.currentTarget as HTMLElement).style.boxShadow  = `0 8px 28px ${bgGlow}`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#2E4270";
        (e.currentTarget as HTMLElement).style.boxShadow  = "none";
      }}
    >
      <h3
        className="font-bold text-sm text-[#F0F4FF] leading-snug"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {service.serviceName}
      </h3>

      {service.shortDescription && (
        <p className="text-sm text-[#8B9BC4] leading-relaxed flex-1">
          {service.shortDescription}
        </p>
      )}

      {service.estimatedDelivery && (
        <div className="flex items-center gap-1.5 text-xs text-[#8B9BC4]">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{service.estimatedDelivery}</span>
        </div>
      )}

      {priceDisplay && (
        <p className="text-xs font-semibold" style={{ color: accentColor }}>
          Mulai dari {priceDisplay}
        </p>
      )}

      {/* CTA — uses service.id (numeric PK) for /services/:id routing */}
      {service.id > 0 && (
        <Link
          href={`/services/${service.id}`}
          className="mt-auto flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150"
          style={{
            background: `rgba(${index % 2 === 0 ? "124,110,250" : "34,211,238"},0.12)`,
            color: accentColor,
            border: `1px solid ${borderColor}`,
          }}
          aria-label={`Lihat detail layanan: ${service.serviceName}`}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = `rgba(${index % 2 === 0 ? "124,110,250" : "34,211,238"},0.22)`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = `rgba(${index % 2 === 0 ? "124,110,250" : "34,211,238"},0.12)`;
          }}
        >
          Lihat detail
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </motion.div>
  );
}

function ServiceCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4 animate-pulse"
      style={{ background: "#0D1526", border: "1px solid #243352" }}
      aria-hidden="true"
    >
      <div className="h-5 w-3/4 rounded bg-[#1E2D4A]" />
      <div className="h-4 w-full rounded bg-[#1E2D4A]" />
      <div className="h-4 w-2/3 rounded bg-[#1E2D4A]" />
      <div className="h-8 w-full rounded-xl bg-[#1E2D4A] mt-auto" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CollectionDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { data, isLoading, isError, error, refetch } = useCollectionDetail(slug);
  // ── Analytics ─────────────────────────────────────────────────────────────
  useTrackCollectionOpened(slug);

  // 404
  if (!isLoading && !isError && data === null) {
    return (
      <Layout>
        <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen flex items-center justify-center">
          <div className="text-center flex flex-col items-center gap-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #22D3EE 0%, #7C6EFA 100%)" }}
            >
              404
            </div>
            <h1
              className="text-xl font-bold"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Paket tidak ditemukan
            </h1>
            <p className="text-sm text-[#8B9BC4]">
              Paket solusi ini tidak tersedia atau sudah tidak aktif.
            </p>
            <Link
              href="/collections"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Kembali ke paket solusi
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  const collection = data?.collection;
  const services   = data?.services ?? [];

  return (
    <Layout>
      <SEOMeta
        title={collection?.name ?? "Koleksi Layanan"}
        description={collection?.shortDescription ?? "Koleksi layanan creative AI yang dikurasi untuk kebutuhan bisnis Anda."}
        canonical={`/collections/${slug}`}
      />
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Back ─────────────────────────────────────────────────────── */}
        <div className="border-b border-[#243352]">
          <div className="container mx-auto px-4 md:px-8 max-w-5xl py-4">
            <Link
              href="/collections"
              className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
              Semua paket solusi
            </Link>
          </div>
        </div>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <section className="container mx-auto px-4 md:px-8 max-w-5xl py-10">

          {/* Error */}
          {isError && (
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
              <p className="font-semibold text-[#F0F4FF] mb-1">Tidak dapat memuat paket</p>
              <p className="text-sm text-[#8B9BC4]">
                {error?.message ?? "Terjadi kesalahan. Coba lagi."}
              </p>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Coba lagi
              </button>
            </div>
          )}

          {/* Loading header */}
          {isLoading && (
            <div className="animate-pulse space-y-4 mb-10">
              <div className="h-10 w-64 rounded-lg bg-[#1E2D4A]" />
              <div className="h-5 w-96 rounded bg-[#1E2D4A]" />
            </div>
          )}

          {/* Collection header */}
          {collection && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="mb-10"
            >
              <div className="flex items-start gap-4 mb-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}
                  aria-hidden="true"
                >
                  <Layers className="w-7 h-7 text-[#22D3EE]" />
                </div>
                <div>
                  <h1
                    className="font-bold text-2xl md:text-3xl leading-tight"
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    {collection.name}
                  </h1>
                  {collection.shortDescription && (
                    <p className="text-sm text-[#8B9BC4] mt-2 max-w-2xl">
                      {collection.shortDescription}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Services heading */}
          {(collection || isLoading) && (
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#243352]">
              <h2
                className="font-semibold text-base"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {isLoading ? (
                  <span className="inline-block w-48 h-5 rounded bg-[#1E2D4A] animate-pulse" />
                ) : `Layanan dalam paket ini`}
              </h2>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-xs text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                Semua layanan
              </Link>
            </div>
          )}

          {/* Loading services */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <ServiceCardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Empty services */}
          {!isLoading && !isError && data && services.length === 0 && (
            <div className="flex flex-col items-center gap-5 py-12 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)" }}
              >
                <Layers className="w-6 h-6 text-[#22D3EE]" aria-hidden="true" />
              </div>
              <p className="font-semibold text-[#F0F4FF] mb-1">Belum ada layanan</p>
              <p className="text-sm text-[#8B9BC4]">Paket ini belum memiliki layanan aktif.</p>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                Telusuri semua layanan
              </Link>
            </div>
          )}

          {/* Service grid */}
          {!isLoading && !isError && data && services.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              role="list"
              aria-label={`Layanan dalam ${collection?.name ?? "paket"}`}
            >
              {services.map((svc, i) => (
                <div key={svc.id || svc.serviceCode || i} role="listitem">
                  <CollectionServiceCard service={svc} index={i} />
                </div>
              ))}
            </div>
          )}

          {/* Bottom navigation */}
          {!isLoading && !isError && data !== null && (
            <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 justify-between pt-8 border-t border-[#243352]">
              <Link
                href="/collections"
                className="flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors group"
              >
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
                Semua paket solusi
              </Link>
              <Link
                href="/services"
                className="flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
              >
                <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                Telusuri semua layanan
              </Link>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
