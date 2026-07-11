import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useCategories, useServices } from "@/hooks/use-catalog";
import { Loader2, ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";

function formatPrice(value: string, currency: string) {
  const n = Number(value);
  if (currency === "IDR") return `Rp${n.toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

export default function ServicesPage() {
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: services, isLoading: loadingServices } = useServices(categoryId);

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl">
          <FlowStepper currentStep="paket" />
        </div>
      </div>
      <div className="container mx-auto px-4 md:px-8 py-16">
        <div className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            <span>AI Service Catalog</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium">Browse our AI services</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Pick a service, see transparent pricing, and request work — no back-and-forth needed.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-12">
          <button
            onClick={() => setCategoryId(undefined)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              categoryId === undefined ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
            }`}
          >
            All
          </button>
          {loadingCategories ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            categories?.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                  categoryId === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))
          )}
        </div>

        {loadingServices ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services?.map((s) => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="group bg-card border border-card-border rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
              >
                <h3 className="text-lg font-serif font-medium mb-2">{s.serviceName}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">{s.shortDescription}</p>
                <div className="mt-6 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    From {formatPrice(s.startingPrice, s.currency)}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))}
            {services?.length === 0 && (
              <p className="col-span-full text-center text-muted-foreground py-12">No services found in this category.</p>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
