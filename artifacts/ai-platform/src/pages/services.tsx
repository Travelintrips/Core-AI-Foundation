import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListServiceCategories,
  useListServices,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LayoutGrid, ShieldCheck, Sparkles, RefreshCw, Building2 } from "lucide-react";

export default function Services() {
  const { data: categories = [], isLoading: categoriesLoading } = useListServiceCategories();
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);

  const { data: services = [], isLoading: servicesLoading } = useListServices(
    activeCategoryId != null ? { categoryId: activeCategoryId } : undefined,
  );

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeCategoryId) ?? null,
    [categories, activeCategoryId],
  );

  return (
    <div className="p-6 h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
          <LayoutGrid className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">AI Service Catalog</h1>
          <p className="text-sm text-muted-foreground">
            Browse every AI department's services and pricing — request work directly from here.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
        {/* Categories */}
        <div className="border border-border rounded-lg bg-card overflow-y-auto">
          <button
            onClick={() => setActiveCategoryId(null)}
            className={cn(
              "w-full text-left px-3 py-2.5 text-sm border-b border-border/60 transition-colors",
              activeCategoryId === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40",
            )}
            data-testid="button-category-all"
          >
            All categories
          </button>
          {categoriesLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (
            categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategoryId(c.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 text-sm border-b border-border/60 last:border-b-0 transition-colors flex items-center justify-between gap-2",
                  activeCategoryId === c.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40",
                )}
                data-testid={`button-category-${c.code}`}
              >
                <span>{c.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Services */}
        <div className="overflow-y-auto pr-1">
          {activeCategory && (
            <p className="text-sm text-muted-foreground mb-3">{activeCategory.description}</p>
          )}
          {servicesLoading ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Loading services…</div>
          ) : services.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center flex flex-col items-center gap-2">
              <Building2 className="size-6 opacity-40" />
              No services published in this category yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {services.map((s) => {
                const category = categories.find((c) => c.id === s.categoryId);
                return (
                  <Link key={s.id} href={`/services/${s.id}`}>
                    <div
                      className="border border-border rounded-lg bg-card p-4 flex flex-col gap-3 h-full cursor-pointer hover:border-primary/40 transition-colors"
                      data-testid={`card-service-${s.serviceCode}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.serviceName}</div>
                          {category && <div className="text-xs text-muted-foreground mt-0.5">{category.name}</div>}
                        </div>
                        {s.startingPrice && (
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold">
                              ${Number(s.startingPrice).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-muted-foreground uppercase">
                              {s.pricingModel === "one_time" ? "starting" : "/mo"}
                            </div>
                          </div>
                        )}
                      </div>

                      {s.shortDescription && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{s.shortDescription}</p>
                      )}

                      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
                        {s.humanReview ? (
                          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1">
                            <ShieldCheck className="size-3" /> Human Review
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/20 gap-1">
                            <Sparkles className="size-3" /> AI Only
                          </Badge>
                        )}
                        {s.subscriptionSupported && (
                          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/20 gap-1">
                            <RefreshCw className="size-3" /> Subscription
                          </Badge>
                        )}
                        {s.enterpriseSupported && (
                          <Badge variant="outline" className="text-xs">Enterprise</Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
