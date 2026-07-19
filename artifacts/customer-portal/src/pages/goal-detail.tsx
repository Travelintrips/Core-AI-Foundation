/**
 * Goal Detail Page — /goals/:slug — Team 03
 *
 * Shows a single business goal and the services available for it.
 * Uses existing service catalog links — no new order/checkout flow.
 *
 * SERVICE NAVIGATION CONTRACT GAP:
 *   GET /api/ai/goals/:slug/services returns GoalServiceStub which has
 *   serviceCode but NOT a numeric serviceId. The customer portal service
 *   detail route /services/:id requires a numeric ID. Until Team 02/Team 04
 *   extends GoalServiceStub with serviceId, the CTA links to
 *   /services?q=<serviceCode> (catalog search) and is labelled
 *   "Lihat layanan terkait" to accurately describe the behaviour.
 */

import { Link, useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useGoalDetail } from "@/hooks/use-goals";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, RefreshCw, Clock, LayoutGrid, Star,
} from "lucide-react";
import type { GoalService } from "@/lib/goalDiscoveryApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string | null, currency: string): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!n) return "Hubungi kami";
  if (currency === "IDR") return `Rp ${n.toLocaleString("id-ID")}`;
  return `$${n.toLocaleString()}`;
}

// ── Service card (goal context) ───────────────────────────────────────────────
// Simplified: no serviceFlow badge (not in GoalServiceStub contract).
// isPrimary is surfaced as a "Utama" badge.

function GoalServiceCard({ service, index }: { service: GoalService; index: number }) {
  // Accent based on isPrimary and position
  const isHighlighted = service.isPrimary;
  const accentColor   = isHighlighted ? "#7C6EFA" : "#22D3EE";
  const borderColor   = isHighlighted ? "rgba(124,110,250,0.35)" : "rgba(34,211,238,0.25)";
  const bgGlow        = isHighlighted ? "rgba(124,110,250,0.08)" : "rgba(34,211,238,0.06)";

  const priceDisplay = formatPrice(service.startingPrice, service.currency);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="group rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "#0D1526",
        border: "1px solid #2E4270",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = borderColor;
        (e.currentTarget as HTMLElement).style.boxShadow  = `0 8px 28px ${bgGlow}`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#2E4270";
        (e.currentTarget as HTMLElement).style.boxShadow  = "none";
      }}
    >
      {/* Top */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {service.isPrimary && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2"
              style={{
                color: "#F59E0B",
                border: "1px solid rgba(245,158,11,0.3)",
                background: "rgba(245,158,11,0.08)",
              }}
            >
              <Star className="w-2.5 h-2.5" aria-hidden="true" />
              Utama
            </span>
          )}
          <h3
            className="font-bold text-[#F0F4FF] text-sm leading-snug"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {service.serviceName}
          </h3>
        </div>
      </div>

      {/* Description */}
      {service.shortDescription && (
        <p className="text-sm text-[#8B9BC4] leading-relaxed flex-1">
          {service.shortDescription}
        </p>
      )}

      {/* Meta */}
      {service.estimatedDelivery && (
        <div className="flex items-center gap-4 text-xs text-[#8B9BC4]">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-[#22D3EE]" aria-hidden="true" />
            {service.estimatedDelivery}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#243352]">
        <div>
          {priceDisplay ? (
            <>
              <p className="text-[11px] text-[#8B9BC4] mb-0.5">Mulai dari</p>
              <p
                className="font-bold text-sm text-[#F0F4FF]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {priceDisplay}
              </p>
            </>
          ) : (
            <span className="text-xs text-[#8B9BC4]">Hubungi kami</span>
          )}
        </div>

        {/*
          CTA: links to catalog search by serviceCode.
          Label is "Lihat layanan terkait" (not "Lihat detail") because this
          opens a search result page, not a specific detail page.
          CONTRACT GAP: when Team 02/Team 04 adds serviceId to GoalServiceStub,
          update this href to /services/${service.serviceId} and change label to
          "Lihat detail".
        */}
        <Link
          href={`/services?q=${encodeURIComponent(service.serviceCode)}`}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C6EFA]"
          style={{
            background: bgGlow,
            color: accentColor,
            border: `1px solid ${borderColor}`,
          }}
          aria-label={`Lihat layanan terkait untuk ${service.serviceName}`}
        >
          Lihat layanan terkait
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <Layout>
      <div className="bg-[#060B18] min-h-screen">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl py-10">
          <div className="skeleton h-4 w-28 rounded mb-8" aria-hidden="true" />
          <div className="skeleton h-12 w-12 rounded-2xl mb-5" aria-hidden="true" />
          <div className="skeleton h-9 w-2/3 rounded mb-3" aria-hidden="true" />
          <div className="skeleton h-4 w-full rounded mb-2" aria-hidden="true" />
          <div className="skeleton h-4 w-4/5 rounded mb-10" aria-hidden="true" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-52 rounded-2xl" aria-hidden="true" />
            ))}
          </div>
        </div>
        <p className="sr-only" role="status">Memuat detail tujuan bisnis…</p>
      </div>
    </Layout>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GoalDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();

  const { data: goal, isLoading, isError, refetch } = useGoalDetail(slug);

  if (isLoading) return <DetailSkeleton />;

  // Unknown goal (404 from API → fetchGoalDetail returns null)
  if (!isLoading && !isError && goal === null) {
    return (
      <Layout>
        <div className="bg-[#060B18] min-h-screen flex items-center justify-center px-4">
          <div className="text-center max-w-md" role="main">
            <p className="text-5xl mb-5" aria-hidden="true">🔍</p>
            <h1
              className="font-bold text-2xl text-[#F0F4FF] mb-2"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Tujuan tidak ditemukan
            </h1>
            <p className="text-sm text-[#8B9BC4] mb-6">
              Tujuan bisnis yang Anda cari tidak tersedia. Coba telusuri semua layanan kami.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                onClick={() => navigate("/goals")}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Kembali ke tujuan
              </button>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-[#060B18] hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #22D3EE 100%)" }}
              >
                Semua layanan
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Error state
  if (isError) {
    return (
      <Layout>
        <div className="bg-[#060B18] min-h-screen flex items-center justify-center px-4">
          <div className="text-center max-w-md" role="alert">
            <p className="text-5xl mb-5" aria-hidden="true">⚠️</p>
            <h1
              className="font-bold text-2xl text-[#F0F4FF] mb-2"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Gagal memuat halaman
            </h1>
            <p className="text-sm text-[#8B9BC4] mb-6">
              Terjadi kesalahan saat memuat tujuan ini. Anda tetap bisa menelusuri semua layanan kami.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Coba lagi
              </button>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-[#060B18] hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #22D3EE 100%)" }}
              >
                Semua layanan
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!goal) return null;

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Breadcrumb ────────────────────────────────────────────────── */}
        <div className="border-b border-[#243352] bg-[#060B18]">
          <div className="container mx-auto px-4 md:px-8 max-w-5xl py-3">
            <nav aria-label="Navigasi halaman" className="flex items-center gap-2 text-xs text-[#8B9BC4]">
              <Link href="/services" className="hover:text-[#F0F4FF] transition-colors">
                Layanan
              </Link>
              <span aria-hidden="true">/</span>
              <Link href="/goals" className="hover:text-[#F0F4FF] transition-colors">
                Tujuan bisnis
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-[#F0F4FF] truncate max-w-[180px]" aria-current="page">
                {goal.name}
              </span>
            </nav>
          </div>
        </div>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-[#243352]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div
              className="absolute top-0 left-1/4 w-[500px] h-[300px] rounded-full opacity-[0.07]"
              style={{ background: "radial-gradient(ellipse, #7C6EFA 0%, transparent 70%)", filter: "blur(50px)" }}
            />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-12 md:py-16">
            {/* Back */}
            <Link
              href="/goals"
              className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors mb-6 group"
              aria-label="Kembali ke semua tujuan bisnis"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
              Semua tujuan
            </Link>

            {/* Icon + title */}
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                style={{
                  background: "linear-gradient(135deg, rgba(124,110,250,0.15) 0%, rgba(34,211,238,0.08) 100%)",
                  border: "1px solid rgba(124,110,250,0.4)",
                }}
                aria-hidden="true"
              >
                {goal.icon ?? "🎯"}
              </div>
              <h1
                className="font-bold text-2xl md:text-4xl leading-tight"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {goal.name}
              </h1>
            </div>

            {goal.description && (
              <p className="text-[#8B9BC4] text-sm md:text-base max-w-2xl leading-relaxed">
                {goal.description}
              </p>
            )}
          </div>
        </section>

        {/* ── Services ─────────────────────────────────────────────────── */}
        <section
          className="container mx-auto px-4 md:px-8 max-w-5xl py-12 md:py-16"
          aria-labelledby="goal-services-heading"
        >
          <h2
            id="goal-services-heading"
            className="font-bold text-lg text-[#F0F4FF] mb-2"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Layanan yang tersedia
          </h2>
          {/* Service count — derived from actual services array length, not fabricated */}
          {goal.services.length > 0 && (
            <p className="text-sm text-[#8B9BC4] mb-6">
              {goal.services.length} layanan tersedia untuk tujuan ini
            </p>
          )}

          {/* No services for this goal */}
          {goal.services.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.3)" }}
                aria-hidden="true"
              >
                🔧
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Belum ada layanan tersedia</p>
                <p className="text-sm text-[#8B9BC4]">
                  Layanan untuk tujuan ini sedang disiapkan. Sementara itu, telusuri semua layanan kami.
                </p>
              </div>
              <Link
                href="/services"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
              >
                <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                Semua layanan
              </Link>
            </div>
          )}

          {/* Service grid */}
          {goal.services.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              role="list"
              aria-label={`Layanan untuk ${goal.name}`}
            >
              {goal.services.map((svc, i) => (
                /* Use serviceCode as key — stable identifier from the API */
                <div key={svc.serviceCode || i} role="listitem">
                  <GoalServiceCard service={svc} index={i} />
                </div>
              ))}
            </div>
          )}

          {/* Bottom navigation */}
          <div className="mt-12 flex flex-col sm:flex-row items-center gap-4 justify-between pt-8 border-t border-[#243352]">
            <Link
              href="/goals"
              className="flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
              Semua tujuan bisnis
            </Link>
            <Link
              href="/services"
              className="flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              Telusuri semua layanan
            </Link>
          </div>
        </section>
      </div>
    </Layout>
  );
}
