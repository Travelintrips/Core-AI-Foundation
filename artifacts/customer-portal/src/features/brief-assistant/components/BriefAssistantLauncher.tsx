/**
 * Phase 4A — Brief Assistant: Launcher FAB
 *
 * Floating action button positioned bottom-right, above the sticky wizard footer.
 * Keyboard-accessible; does NOT auto-open; no fake unread badge.
 */

import { memo } from "react";
import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BriefAssistantLauncherProps {
  onOpen: () => void;
  disabled?: boolean;
  className?: string;
}

export const BriefAssistantLauncher = memo(function BriefAssistantLauncher({
  onOpen,
  disabled = false,
  className,
}: BriefAssistantLauncherProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.5 }}
      className={cn(
        // Position: above the sticky wizard footer (footer ~72px + 16px gap)
        "fixed bottom-[5.5rem] right-4 z-40",
        // Desktop: slightly more bottom gap
        "md:bottom-[5.5rem] md:right-6",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label="Buka Asisten Brief"
        className={cn(
          "group flex items-center gap-2 px-4 py-2.5 rounded-full",
          "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
          "hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "transition-all duration-200",
          "disabled:opacity-50 disabled:pointer-events-none",
          // Touch target ≥ 44px
          "min-h-[44px]",
        )}
      >
        <Sparkles className="w-4 h-4 shrink-0 group-hover:scale-110 transition-transform" />
        <span className="text-sm font-medium whitespace-nowrap leading-none">
          Asisten Brief
        </span>
      </button>
    </motion.div>
  );
});

BriefAssistantLauncher.displayName = "BriefAssistantLauncher";
