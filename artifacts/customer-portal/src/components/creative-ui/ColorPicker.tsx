import { memo, useCallback } from "react";
import { motion } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColorPreset {
  value: string;
  label: string;
  hex: string;
  /** If true, renders as a "No Preference" / empty option */
  none?: boolean;
}

export const DEFAULT_COLOR_PRESETS: ColorPreset[] = [
  { value: "blue",   label: "Blue",   hex: "#3B82F6" },
  { value: "black",  label: "Black",  hex: "#1F2937" },
  { value: "white",  label: "White",  hex: "#F9FAFB" },
  { value: "gold",   label: "Gold",   hex: "#F59E0B" },
  { value: "red",    label: "Red",    hex: "#EF4444" },
  { value: "purple", label: "Purple", hex: "#8B5CF6" },
  { value: "green",  label: "Green",  hex: "#10B981" },
  { value: "orange", label: "Orange", hex: "#F97316" },
  { value: "gray",   label: "Gray",   hex: "#6B7280" },
  { value: "brown",  label: "Brown",  hex: "#92400E" },
  { value: "none",   label: "Tidak Ada Preferensi", hex: "transparent", none: true },
];

interface ColorPickerProps {
  presets?: ColorPreset[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export const ColorPicker = memo(function ColorPicker({
  presets = DEFAULT_COLOR_PRESETS,
  value,
  onChange,
  disabled,
  className,
}: ColorPickerProps) {
  const toggle = useCallback(
    (val: string, isNone: boolean) => {
      if (disabled) return;
      if (isNone) {
        // "No preference" clears all others, or deselects itself
        onChange(value.includes(val) ? [] : [val]);
        return;
      }
      // Selecting a real color deselects "none"
      const withoutNone = value.filter((v) => v !== "none");
      if (withoutNone.includes(val)) {
        onChange(withoutNone.filter((v) => v !== val));
      } else {
        onChange([...withoutNone, val]);
      }
    },
    [value, onChange, disabled],
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Color swatches grid */}
      <div className="flex flex-wrap gap-2.5" role="group" aria-label="Pilih warna brand">
        {presets
          .filter((p) => !p.none)
          .map((preset) => {
            const isSelected = value.includes(preset.value);
            return (
              <motion.button
                key={preset.value}
                type="button"
                aria-label={preset.label}
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => toggle(preset.value, false)}
                whileHover={!disabled ? { scale: 1.12 } : undefined}
                whileTap={!disabled ? { scale: 0.92 } : undefined}
                transition={{ duration: 0.15 }}
                className={cn(
                  "relative w-10 h-10 rounded-xl border-2 transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "border-primary shadow-[0_0_12px_-2px_rgba(124,110,250,0.6)]"
                    : "border-border/40 hover:border-primary/40",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
                style={{ backgroundColor: preset.hex }}
                title={preset.label}
              >
                {isSelected && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <Check
                      className="w-4 h-4 drop-shadow"
                      style={{
                        color:
                          preset.hex === "#F9FAFB" || preset.hex === "#F59E0B" || preset.hex === "#F97316"
                            ? "#1F2937"
                            : "#ffffff",
                      }}
                    />
                  </motion.span>
                )}
              </motion.button>
            );
          })}
      </div>

      {/* "No Preference" pill */}
      {presets.find((p) => p.none) && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => toggle("none", true)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            value.includes("none")
              ? "bg-primary/10 border-primary text-primary"
              : "border-border/50 text-muted-foreground bg-card hover:border-primary/30 hover:text-foreground",
            disabled && "opacity-40 cursor-not-allowed",
          )}
        >
          <Minus className="w-3.5 h-3.5" />
          Tidak Ada Preferensi
        </button>
      )}

      {/* Selected labels */}
      {value.length > 0 && !value.includes("none") && (
        <p className="text-xs text-muted-foreground">
          Dipilih:{" "}
          <span className="text-foreground font-medium">
            {value
              .map((v) => presets.find((p) => p.value === v)?.label ?? v)
              .join(", ")}
          </span>
        </p>
      )}
    </div>
  );
});

ColorPicker.displayName = "ColorPicker";
