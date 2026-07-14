import { memo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColorPreset {
  value: string;
  label: string;
  hex: string;
  /** If true, renders as the exclusive "No Preference" pill */
  none?: boolean;
}

/** Phase 2 presets — Indonesian labels, 13 colors + none */
export const DEFAULT_COLOR_PRESETS: ColorPreset[] = [
  { value: "blue",   label: "Biru",      hex: "#3B82F6" },
  { value: "black",  label: "Hitam",     hex: "#1F2937" },
  { value: "white",  label: "Putih",     hex: "#F8FAFC" },
  { value: "red",    label: "Merah",     hex: "#EF4444" },
  { value: "green",  label: "Hijau",     hex: "#10B981" },
  { value: "purple", label: "Ungu",      hex: "#8B5CF6" },
  { value: "orange", label: "Oranye",    hex: "#F97316" },
  { value: "brown",  label: "Cokelat",   hex: "#92400E" },
  { value: "gold",   label: "Emas",      hex: "#F59E0B" },
  { value: "gray",   label: "Abu-abu",   hex: "#6B7280" },
  { value: "silver", label: "Silver",    hex: "#C0C0C0" },
  { value: "pastel", label: "Pastel",    hex: "#F9A8D4" },
  { value: "earth",  label: "Earth tone",hex: "#A67B5B" },
  { value: "none",   label: "Tidak ada preferensi", hex: "transparent", none: true },
];

/** Light-background colors that need a dark check icon */
const NEEDS_DARK_CHECK = new Set(["white", "pastel", "silver", "gold"]);

interface ColorPickerProps {
  presets?: ColorPreset[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Max non-none selections allowed */
  max?: number;
  disabled?: boolean;
  className?: string;
}

export const ColorPicker = memo(function ColorPicker({
  presets = DEFAULT_COLOR_PRESETS,
  value,
  onChange,
  max,
  disabled,
  className,
}: ColorPickerProps) {
  const toggle = useCallback(
    (val: string, isNone: boolean) => {
      if (disabled) return;
      if (isNone) {
        onChange(value.includes(val) ? [] : [val]);
        return;
      }
      const withoutNone = value.filter((v) => v !== "none");
      if (withoutNone.includes(val)) {
        onChange(withoutNone.filter((v) => v !== val));
      } else {
        if (max && withoutNone.length >= max) return;
        onChange([...withoutNone, val]);
      }
    },
    [value, onChange, disabled, max],
  );

  const nonNonePresets = presets.filter((p) => !p.none);
  const nonePreset = presets.find((p) => p.none);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Color swatches grid */}
      <div
        className="flex flex-wrap gap-2.5"
        role="group"
        aria-label="Pilih warna brand"
      >
        {nonNonePresets.map((preset) => {
          const isSelected = value.includes(preset.value);
          const atMax = !isSelected && !!max && value.filter((v) => v !== "none").length >= max;
          return (
            <motion.button
              key={preset.value}
              type="button"
              aria-label={preset.label}
              aria-pressed={isSelected}
              aria-disabled={atMax}
              disabled={disabled || atMax}
              onClick={() => toggle(preset.value, false)}
              whileHover={!disabled && !atMax ? { scale: 1.12 } : undefined}
              whileTap={!disabled && !atMax ? { scale: 0.92 } : undefined}
              transition={{ duration: 0.15 }}
              className={cn(
                "relative w-10 h-10 rounded-xl border-2 transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isSelected
                  ? "border-primary shadow-[0_0_12px_-2px_rgba(124,110,250,0.6)]"
                  : "border-border/40 hover:border-primary/40",
                (disabled || atMax) && "opacity-40 cursor-not-allowed",
              )}
              style={{ backgroundColor: preset.hex }}
              title={preset.label}
            >
              <AnimatePresence>
                {isSelected && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <Check
                      className="w-4 h-4 drop-shadow"
                      style={{
                        color: NEEDS_DARK_CHECK.has(preset.value) ? "#1F2937" : "#ffffff",
                      }}
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {/* Max indicator */}
      {max && (
        <p className="text-[11px] text-muted-foreground">
          {value.filter((v) => v !== "none").length} dari maks. {max} dipilih
        </p>
      )}

      {/* "No Preference" pill */}
      {nonePreset && (
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
          {nonePreset.label}
        </button>
      )}

      {/* Selected labels summary */}
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
