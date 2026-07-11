import { useState } from "react";
import { Star, Images, Clock, Wrench } from "lucide-react";
import type { Portfolio } from "@/hooks/use-portfolio";
import { useRecordPortfolioView } from "@/hooks/use-portfolio";

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: "Coffee Shop", restaurant: "Restaurant", hotel: "Hotel & Hospitality",
  manufacturing: "Manufacturing", mining: "Mining", trading: "Trading",
  logistics: "Logistics", construction: "Construction", medical: "Medical & Healthcare",
  education: "Education", retail: "Retail", fashion: "Fashion", technology: "Technology",
  government: "Government", other: "Other",
};

export function PortfolioGallery({ portfolios }: { portfolios: Portfolio[] }) {
  const [active, setActive] = useState<Portfolio | null>(null);
  const recordView = useRecordPortfolioView();

  if (portfolios.length === 0) return null;

  const openItem = (p: Portfolio) => {
    setActive(p);
    recordView.mutate(p.id);
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Images className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">Creative Showcase</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {portfolios.map((p) => (
          <button
            key={p.id}
            onClick={() => openItem(p)}
            className="text-left group rounded-2xl overflow-hidden border border-card-border bg-card hover:shadow-md transition-shadow"
          >
            <div className="aspect-[4/3] bg-muted overflow-hidden relative">
              {p.coverImage ? (
                <img src={p.coverImage} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No cover image</div>
              )}
              {p.featured && (
                <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">Featured</span>
              )}
            </div>
            <div className="p-4 space-y-1.5">
              <p className="font-medium">{p.title}</p>
              <p className="text-xs text-muted-foreground">{INDUSTRY_LABELS[p.industry] ?? p.industry} · {p.style}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                {p.rating && (
                  <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{p.rating}</span>
                )}
                {p.deliveryTime && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{p.deliveryTime}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {active && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setActive(null)}>
          <div className="bg-background rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-serif font-medium">{active.title}</h3>
                <p className="text-sm text-muted-foreground">{INDUSTRY_LABELS[active.industry] ?? active.industry} · {active.style}</p>
              </div>
              <button onClick={() => setActive(null)} className="text-muted-foreground hover:text-foreground text-sm">Close</button>
            </div>

            {active.beforeImage && active.afterImage ? (
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Before</p>
                  <img src={active.beforeImage} alt="Before" className="w-full rounded-xl" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">After</p>
                  <img src={active.afterImage} alt="After" className="w-full rounded-xl" />
                </div>
              </div>
            ) : active.coverImage ? (
              <img src={active.coverImage} alt={active.title} className="w-full rounded-xl mb-5" />
            ) : null}

            {active.galleryJson && active.galleryJson.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-5">
                {active.galleryJson.map((g, i) => (
                  g.type === "image" ? (
                    <img key={i} src={g.url} alt={g.caption ?? ""} className="w-full aspect-square object-cover rounded-lg" />
                  ) : (
                    <a key={i} href={g.url} target="_blank" rel="noreferrer" className="w-full aspect-square rounded-lg border border-border flex items-center justify-center text-xs text-muted-foreground text-center p-2">
                      {g.caption ?? g.type}
                    </a>
                  )
                ))}
              </div>
            )}

            {active.description && <p className="text-sm text-muted-foreground leading-relaxed mb-5">{active.description}</p>}

            {active.workflowJson && active.workflowJson.length > 0 && (
              <div className="mb-5">
                <p className="text-sm font-medium mb-2">How it was made</p>
                <div className="flex flex-wrap gap-2">
                  {active.workflowJson.map((w, i) => (
                    <span key={i} className="px-3 py-1.5 rounded-full bg-muted text-xs">{i + 1}. {w.label}</span>
                  ))}
                </div>
              </div>
            )}

            {active.deliverablesJson && active.deliverablesJson.length > 0 && (
              <div className="mb-2">
                <p className="text-sm font-medium mb-2">Deliverable formats</p>
                <div className="flex flex-wrap gap-2">
                  {active.deliverablesJson.map((d, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-md border border-border text-xs uppercase tracking-wide">{d}</span>
                  ))}
                </div>
              </div>
            )}

            {active.toolsUsedJson && active.toolsUsedJson.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
                <Wrench className="w-3.5 h-3.5" /> Built with {active.toolsUsedJson.join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
