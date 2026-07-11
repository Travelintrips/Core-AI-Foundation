import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import type { CatalogService } from "@/hooks/use-catalog";

export function RelatedServices({ services }: { services: CatalogService[] }) {
  if (services.length === 0) return null;

  return (
    <section>
      <h2 className="font-serif text-lg font-medium mb-4">You might also like</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {services.map((s) => (
          <Link
            key={s.id}
            href={`/services/${s.id}`}
            className="group p-5 rounded-2xl border border-card-border bg-card hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm">{s.serviceName}</p>
              <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{s.shortDescription}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
