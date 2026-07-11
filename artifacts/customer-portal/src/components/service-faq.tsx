import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { ServiceFaq } from "@/hooks/use-portfolio";

export function ServiceFaqSection({ faqs }: { faqs: ServiceFaq[] }) {
  const [openId, setOpenId] = useState<number | null>(faqs[0]?.id ?? null);
  if (faqs.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <HelpCircle className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">Frequently Asked Questions</h2>
      </div>
      <div className="divide-y divide-border border border-card-border rounded-2xl bg-card overflow-hidden">
        {faqs.map((f) => {
          const open = openId === f.id;
          return (
            <div key={f.id}>
              <button
                onClick={() => setOpenId(open ? null : f.id)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-medium text-sm">{f.question}</span>
                <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{f.answer}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
