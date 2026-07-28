/**
 * WP-02 — Furniture Catalog — Customer-facing item detail page
 */

import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Package, Ruler, Tag } from "lucide-react";

interface FurnitureAsset { id: string; assetType: string; url: string; sortOrder: number; }
interface FurnitureTag   { id: string; name: string; slug: string; }

interface FurnitureItemDetail {
  id: string;
  code: string;
  name: string;
  nameId: string;
  slug: string;
  description?: string | null;
  furnitureType?: string | null;
  style?: string | null;
  priceTier: string;
  thumbnailUrl?: string | null;
  previewImages: string[];
  primaryMaterials: string[];
  finishes: string[];
  colors: string[];
  dimensions: { widthCm: number; depthCm: number; heightCm: number; weightKg?: number | null; seatHeightCm?: number | null };
  sku?: string | null;
  assets?: FurnitureAsset[];
  tags?: FurnitureTag[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRICE_TIER_LABELS: Record<string, string> = {
  budget: "Budget", mid: "Mid-Range", premium: "Premium", luxury: "Luxury",
};
const PRICE_TIER_COLORS: Record<string, string> = {
  budget:  "bg-green-100 text-green-800",
  mid:     "bg-sky-100 text-sky-800",
  premium: "bg-purple-100 text-purple-800",
  luxury:  "bg-amber-100 text-amber-800",
};

export default function FurnitureCatalogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [item, setItem]         = useState<FurnitureItemDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    if (!id) return;
    fetch(`${BASE}api/ai/furniture-catalog/items/${id}`)
      .then(async res => {
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json() as FurnitureItemDetail;
        setItem(data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#060B18" }}>
        <div className="w-8 h-8 rounded-lg animate-pulse" style={{ background: "rgba(124,110,250,0.3)" }} />
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#060B18", color: "#F0F4FF" }}>
        <div className="text-center">
          <Package className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <h2 className="text-xl font-bold">Item not found</h2>
          <button onClick={() => navigate("/furniture-catalog")} className="mt-4 px-4 py-2 rounded-xl text-sm"
            style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA" }}>
            Back to catalog
          </button>
        </div>
      </div>
    );
  }

  const allImages = [
    ...(item.thumbnailUrl ? [item.thumbnailUrl] : []),
    ...item.previewImages,
    ...(item.assets?.filter(a => a.assetType === "preview" || a.assetType === "render").map(a => a.url) ?? []),
  ];

  return (
    <div className="min-h-screen" style={{ background: "#060B18", color: "#F0F4FF" }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back */}
        <button onClick={() => navigate("/furniture-catalog")}
          className="flex items-center gap-2 text-sm mb-6 hover:opacity-80"
          style={{ color: "#8B9BC4" }}>
          <ArrowLeft className="w-4 h-4" /> Furniture Catalog
        </button>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-3">
            <div className="aspect-square rounded-2xl overflow-hidden" style={{ background: "rgba(124,110,250,0.08)" }}>
              {allImages[activeImg] ? (
                <img src={allImages[activeImg]} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="w-20 h-20 opacity-15" style={{ color: "#7C6EFA" }} />
                </div>
              )}
            </div>
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allImages.map((src, i) => (
                  <button key={i} onClick={() => setActiveImg(i)}
                    className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 border-2 transition-colors ${i === activeImg ? "border-purple-500" : "border-transparent"}`}
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRICE_TIER_COLORS[item.priceTier] ?? ""}`}>
                  {PRICE_TIER_LABELS[item.priceTier] ?? item.priceTier}
                </span>
                {item.style && (
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA" }}>
                    {item.style}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold leading-snug" style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                {item.name}
              </h1>
              {item.nameId && item.nameId !== item.name && (
                <p className="text-sm mt-1" style={{ color: "#8B9BC4" }}>{item.nameId}</p>
              )}
              {item.furnitureType && (
                <p className="text-sm mt-1 capitalize" style={{ color: "#8B9BC4" }}>
                  {item.furnitureType.replace(/_/g, " ")}
                </p>
              )}
            </div>

            {item.description && (
              <p className="text-sm leading-relaxed" style={{ color: "#C4CEDE" }}>{item.description}</p>
            )}

            {/* Dimensions */}
            <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Ruler className="w-4 h-4" style={{ color: "#7C6EFA" }} />
                <span className="font-medium text-sm">Dimensions</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {([["Width", item.dimensions.widthCm, "cm"], ["Depth", item.dimensions.depthCm, "cm"], ["Height", item.dimensions.heightCm, "cm"]] as [string, number, string][]).map(([label, val, unit]) => (
                  <div key={label}>
                    <div className="text-lg font-bold">{val}<span className="text-xs ml-0.5" style={{ color: "#8B9BC4" }}>{unit}</span></div>
                    <div className="text-xs" style={{ color: "#8B9BC4" }}>{label}</div>
                  </div>
                ))}
              </div>
              {item.dimensions.weightKg && (
                <div className="text-sm text-center mt-1" style={{ color: "#8B9BC4" }}>
                  Weight: {item.dimensions.weightKg} kg
                </div>
              )}
            </div>

            {/* Materials */}
            {item.primaryMaterials.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Materials</p>
                <div className="flex flex-wrap gap-2">
                  {item.primaryMaterials.map(m => (
                    <span key={m} className="text-xs px-2 py-1 rounded-lg capitalize"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#C4CEDE" }}>
                      {m.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Colors */}
            {item.colors.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Available Colors</p>
                <div className="flex flex-wrap gap-2">
                  {item.colors.map(c => (
                    <span key={c} className="text-xs px-2 py-1 rounded-lg capitalize"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#C4CEDE" }}>
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag className="w-4 h-4" style={{ color: "#8B9BC4" }} />
                {item.tags.map(t => (
                  <span key={t.id} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(124,110,250,0.12)", color: "#7C6EFA", border: "1px solid rgba(124,110,250,0.2)" }}>
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="pt-2">
              <a href="/services" className="block w-full py-3 rounded-xl text-center text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#7C6EFA,#5F52D0)", color: "#fff" }}>
                Request a Custom Interior Design
              </a>
              <p className="text-xs text-center mt-2" style={{ color: "#8B9BC4" }}>
                Catalog code: <span className="font-mono">{item.code}</span>
                {item.sku && <> · SKU: <span className="font-mono">{item.sku}</span></>}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
