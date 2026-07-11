import { Star, Quote } from "lucide-react";
import type { PortfolioReview } from "@/hooks/use-portfolio";

export function PortfolioReviews({ reviews, avgRating }: { reviews: PortfolioReview[]; avgRating: number | null }) {
  if (reviews.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg font-medium">Client Reviews</h2>
        {avgRating != null && (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="font-medium">{avgRating.toFixed(1)}</span>
            <span className="text-muted-foreground">({reviews.length} reviews)</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {reviews.map((r) => (
          <div key={r.id} className="bg-card border border-card-border rounded-2xl p-5 relative">
            <Quote className="w-5 h-5 text-primary/30 absolute top-4 right-4" />
            <div className="flex items-center gap-1 mb-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`w-3.5 h-3.5 ${i < r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">"{r.review}"</p>
            <p className="text-sm font-medium">{r.clientName ?? r.company}</p>
            <p className="text-xs text-muted-foreground">{r.company}{r.industry ? ` · ${r.industry}` : ""}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
