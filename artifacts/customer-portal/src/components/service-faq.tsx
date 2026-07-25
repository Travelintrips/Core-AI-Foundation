import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ServiceFaq } from "@/hooks/use-portfolio";
import { useTranslation } from "@/lib/i18n";
import { localizeFaq } from "@/lib/catalog-i18n";

export function ServiceFaqSection({ faqs }: { faqs: ServiceFaq[] }) {
  const { lang } = useTranslation();
  const [openId, setOpenId] = useState<number | null>(faqs[0]?.id ?? null);
  if (faqs.length === 0) return null;

  return (
    <div
      className="divide-y rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(46,66,112,0.5)", background: "rgba(13,21,38,0.6)" }}
    >
      {faqs.map((rawFaq) => {
        const f = localizeFaq(rawFaq, lang);
        const open = openId === f.id;
        return (
          <div key={f.id}>
            <button
              onClick={() => setOpenId(open ? null : f.id)}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/50 rounded-none"
            >
              <span className="font-semibold text-sm text-[#F0F4FF]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {f.question}
              </span>
              <motion.div
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0"
              >
                <ChevronDown className="w-4 h-4 text-[#8B9BC4]" />
              </motion.div>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="answer"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                >
                  <p className="px-5 pb-5 text-sm text-[#8B9BC4] leading-relaxed">{f.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
