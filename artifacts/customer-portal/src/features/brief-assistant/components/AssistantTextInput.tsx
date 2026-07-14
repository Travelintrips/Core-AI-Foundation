/**
 * Phase 4A — Brief Assistant: Text Input
 *
 * Rendered only for "text" type questions.
 * Input is trimmed, length-capped, and XSS-safe (React renders as text, never HTML).
 */

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { SendHorizonal } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 1000;

interface AssistantTextInputProps {
  placeholder?: string;
  helperText?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  className?: string;
}

export const AssistantTextInput = memo(function AssistantTextInput({
  placeholder = "Tuliskan jawaban Anda...",
  helperText,
  initialValue = "",
  onSubmit,
  className,
}: AssistantTextInputProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when shown
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className={cn("space-y-2", className)}>
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          aria-label="Jawaban teks"
          className={cn(
            "w-full resize-none rounded-xl px-4 py-3 pr-12 text-sm",
            "bg-card/60 border border-border/60 text-foreground",
            "placeholder:text-muted-foreground/60",
            "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
            "transition-colors leading-relaxed",
          )}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!value.trim()}
          aria-label="Kirim jawaban"
          className={cn(
            "absolute right-2 bottom-2 p-2 rounded-lg",
            "text-primary hover:bg-primary/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "disabled:opacity-30 disabled:pointer-events-none",
            "min-h-[36px] min-w-[36px] flex items-center justify-center",
          )}
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground/60">
          Enter untuk kirim, Shift+Enter untuk baris baru
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          {value.length}/{MAX_LENGTH}
        </p>
      </div>
    </div>
  );
});

AssistantTextInput.displayName = "AssistantTextInput";
