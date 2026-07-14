import { memo } from "react";
import { cn } from "@/lib/utils";

interface FieldTitleProps {
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  className?: string;
  as?: "label" | "h2" | "h3" | "h4" | "p";
  htmlFor?: string;
}

/**
 * Consistent field label / section heading for Creative AI forms.
 * Shows an optional "Wajib" badge or "(opsional)" suffix.
 */
export const FieldTitle = memo(function FieldTitle({
  children,
  required,
  optional,
  className,
  as: Tag = "label",
  htmlFor,
}: FieldTitleProps) {
  return (
    <Tag
      htmlFor={htmlFor}
      className={cn(
        "flex items-center gap-2 text-sm font-semibold text-foreground leading-tight",
        className,
      )}
    >
      <span>{children}</span>
      {required && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-wide bg-primary/15 text-primary border border-primary/20 select-none">
          Wajib
        </span>
      )}
      {optional && !required && (
        <span className="text-[11px] font-normal text-muted-foreground/70 select-none">
          (opsional)
        </span>
      )}
    </Tag>
  );
});

FieldTitle.displayName = "FieldTitle";
