/**
 * Goal Detail Page — /goals/:slug — Team 03
 *
 * Shows a single business goal and its commercially eligible services.
 *
 * ── Navigation contract ──────────────────────────────────────────────────────
 *   CTA navigates to /services/${service.serviceId} (numeric PK from Team 04 fix).
 *   serviceCode is NOT used for routing — it is metadata only.
 *   serviceName is NOT used as an identifier.
 *
 * ── Commercial policy ────────────────────────────────────────────────────────
 *   Backend (Team 01) filters out inactive, internal-only, and commercially
 *   blocked services before returning them. Frontend trusts this filtering and
 *   does NOT add client-side guards.
 *
 * API: GET /api/ai/goals/:slug/services → GoalWithServices
 */

import { Link, useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useGoalDetail } from "@/hooks/use-discovery";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, RefreshCw, Clock, LayoutGrid, Star, AlertTriangle,
} from "lucide-react";
import type { GoalService } from "@/lib/discoveryApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string | null, currency: string): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!n) return "Hubungi kami";
  if (currency === "IDR") return `Rp ${n.toLocaleString("id-ID")}`;
  return `$${n.toLocaleString()}`;
}

// ── Service card ──────────────────────────────────────────────────────────────

function GoalServiceCard({ service, index }: { service: GoalService; index: number }) {
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
        <div className="flex items-center gap-1.5 text-xs text-[#8B9BC4]">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{service.estimatedDelivery}</span>
        </div>
      )}

      {/* Price */}
      {priceDisplay && (
        <p className="text-xs font-semibold" style={{ color: accentColor }}>
          Mulai dari {priceDisplay}
        </p>
      )}

      {/* CTA ── Phase 6 fix: uses serviceId (numeric PK) for /services/:id routing ── */}
      {service.serviceId > 0 && (
        <Link
          href={`/services/${service.serviceId}`}
          className="mt-auto flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150"
          style={{
            background: `rgba(${isHighlighted ? "124,110,250" : "34,211,238"},0.12)`,
            color: accentColor,
            border: `1px solid ${borderColor}`,
          }}
          aria-label={`Lihat detail layanan: ${service.serviceName}`}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = `rgba(${isHighlighted ? "124,110,250" : "34,211,238"},0.22)`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = `rgba(${isHighlighted ? "124,110,250" : "34,211,238"},0.12)`;
          }}
        >
          Lihat detail layanan
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </motion.div>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

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

export default function GoalDetailPage() {
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const slug = params.slug;

  const { data: goal, isLoading, isError, error, refetch } = useGoalDetail(slug);

  // 404 redirect
  if (!isLoading && !isError && goal === null) {
    return (
      <Layout>
        <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen flex items-center justify-center">
          <div className="text-center flex flex-col items-center gap-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
            >
              404
            </div>
            <h1
              className="text-xl font-bold"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Tujuan tidak ditemukan
            </h1>
            <p className="text-sm text-[#8B9BC4]">
              Tujuan bisnis ini tidak tersedia atau sudah tidak aktif.
            </p>
            <Link
              href="/goals"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Kembali ke tujuan bisnis
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Back navigation ──────────────────────────────────────────── */}
        <div className="border-b border-[#243352]">
          <div className="container mx-auto px-4 md:px-8 max-w-5xl py-4">
            <Link
              href="/goals"
              className="inline-flex items-center gap-1.5 text-sm text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
              Semua tujuan bisnis
            </Link>
          </div>
        </div>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <section className="container mx-auto px-4 md:px-8 max-w-5xl py-10">

          {/* Error state */}
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
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Tidak dapat memuat tujuan</p>
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

          {/* Loading — goal header */}
          {isLoading && (
            <div className="animate-pulse space-y-4 mb-10">
              <div className="h-10 w-64 rounded-lg bg-[#1E2D4A]" />
              <div className="h-5 w-96 rounded bg-[#1E2D4A]" />
            </div>
          )}

          {/* Goal header */}
          {goal && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="mb-10"
            >
              <div className="flex items-start gap-4 mb-4">
                {goal.icon && (
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                    style={{ background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.2)" }}
                    aria-hidden="true"
                  >
                    {goal.icon}
                  </div>
                )}
                <div>
                  <h1
                    className="font-bold text-2xl md:text-3xl leading-tight"
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    {goal.name}
                  </h1>
                  {goal.description && (
                    <p className="text-sm text-[#8B9BC4] mt-2 max-w-2xl">
                      {goal.description}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Services section heading */}
          {(goal || isLoading) && (
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#243352]">
              <h2
                className="font-semibold text-base"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {isLoading ? (
                  <span className="inline-block w-40 h-5 rounded bg-[#1E2D4A] animate-pulse" />
                ) : `Layanan untuk ${goal!.name}`}
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

          {/* Loading — service cards */}
          {isLoading && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              aria-busy="true"
              aria-label="Memuat layanan…"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <ServiceCardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Empty services */}
          {goal && goal.services.length === 0 && (
            <div className="flex flex-col items-center gap-5 py-12 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.2)" }}
              >
                <LayoutGrid className="w-6 h-6 text-[#7C6EFA]" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#F0F4FF] mb-1">Belum ada layanan</p>
                <p className="text-sm text-[#8B9BC4]">Layanan untuk tujuan ini belum tersedia.</p>
              </div>
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
          {goal && goal.services.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              role="list"
              aria-label={`Layanan untuk ${goal.name}`}
            >
              {goal.services.map((svc, i) => (
                <div key={svc.serviceCode || svc.serviceId || i} role="listitem">
                  <GoalServiceCard service={svc} index={i} />
                </div>
              ))}
            </div>
          )}

          {/* Bottom navigation */}
          {!isLoading && !isError && goal !== null && (
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
          )}
        </section>
      </div>
    </Layout>
  );
}
