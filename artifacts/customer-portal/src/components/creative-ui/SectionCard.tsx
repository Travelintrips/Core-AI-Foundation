import { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface SectionCardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  /** Disable entrance animation (e.g. when section is always visible) */
  animate?: boolean;
  footer?: React.ReactNode;
}

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
};

/**
 * Wrapper card for each section of a Creative AI form.
 * Provides consistent padding, border, and optional header.
 */
export const SectionCard = memo(function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  className,
  animate = true,
  footer,
}: SectionCardProps) {
  const Wrapper = animate ? motion.div : "div";
  const motionProps = animate
    ? { variants: cardVariants, initial: "hidden", animate: "visible" }
    : {};

  return (
    <Wrapper
      {...(motionProps as any)}
      className={cn(
        "rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden",
        "shadow-[0_4px_24px_-4px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      {(title || Icon) && (
        <div className="flex items-start gap-3 px-6 pt-6 pb-5 border-b border-border/40">
          {Icon && (
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
              <Icon className="w-4.5 h-4.5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
      )}
      <div className="p-6 space-y-5">{children}</div>
      {footer && (
        <div className="px-6 pb-6 pt-2 border-t border-border/30">{footer}</div>
      )}
    </Wrapper>
  );
});

SectionCard.displayName = "SectionCard";
