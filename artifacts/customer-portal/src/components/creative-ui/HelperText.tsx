import { memo } from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface HelperTextProps {
  hint?: string;
  error?: string;
  id?: string;
  className?: string;
}

/**
 * Displays inline hint and/or validation error beneath a form field.
 * Errors animate in so the user notices them clearly.
 */
export const HelperText = memo(function HelperText({
  hint,
  error,
  id,
  className,
}: HelperTextProps) {
  if (!hint && !error) return null;

  return (
    <div className={cn("space-y-1", className)}>
      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={id}
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1.5 text-xs font-medium text-destructive"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60" />
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

HelperText.displayName = "HelperText";
