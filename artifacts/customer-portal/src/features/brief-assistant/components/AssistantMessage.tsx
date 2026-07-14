/**
 * Phase 4A — Brief Assistant: Message Bubble
 */

import { memo } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssistantMessageProps {
  children: React.ReactNode;
  variant?: "assistant" | "system";
  className?: string;
}

export const AssistantMessage = memo(function AssistantMessage({
  children,
  variant = "assistant",
  className,
}: AssistantMessageProps) {
  if (variant === "system") {
    return (
      <div
        className={cn(
          "rounded-xl px-4 py-3 text-sm text-muted-foreground bg-muted/30 border border-border/30",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3", className)}>
      <div className="shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-card/80 border border-border/50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-foreground leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
});

AssistantMessage.displayName = "AssistantMessage";
