import { Link } from "wouter";
import { ArrowUpRight, Clock, Shield } from "lucide-react";
import type { CatalogService } from "@/hooks/use-catalog";

function formatMoney(value: number, currency: string) {
  if (currency === "IDR") return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
  return `$${value.toLocaleString()}`;
}

export function RelatedServices({ services }: { services: CatalogService[] }) {
  if (services.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {services.map((s) => (
        <Link
          key={s.id}
          href={`/services/${s.id}`}
          className="group relative flex flex-col p-5 rounded-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
          style={{
            background: "rgba(13,21,38,0.7)",
            border: "1px solid rgba(46,66,112,0.5)",
          }}
          aria-label={`View ${s.serviceName}`}
        >
          {/* Hover glow */}
          <div
            className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
            style={{ boxShadow: "0 0 0 1px rgba(124,110,250,0.4), 0 4px 24px rgba(124,110,250,0.08)" }}
          />

          <div className="flex items-start justify-between gap-2 mb-2">
            <p
              className="font-semibold text-sm text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors leading-snug"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {s.serviceName}
            </p>
            <ArrowUpRight className="w-4 h-4 text-[#8B9BC4] group-hover:text-[#7C6EFA] shrink-0 transition-colors" />
          </div>

          <p className="text-xs text-[#8B9BC4] leading-relaxed line-clamp-2 mb-3 flex-1">
            {s.shortDescription}
          </p>

          <div className="flex items-center justify-between gap-2 mt-auto">
            <span className="text-sm font-bold text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {formatMoney(Number(s.startingPrice), s.currency)}
            </span>
            <div className="flex items-center gap-2">
              {s.humanReview && (
                <Shield className="w-3.5 h-3.5 text-emerald-400" aria-label="Human reviewed" />
              )}
              <span className="flex items-center gap-1 text-[11px] text-[#8B9BC4]">
                <Clock className="w-3 h-3" />
                {s.estimatedDelivery}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
