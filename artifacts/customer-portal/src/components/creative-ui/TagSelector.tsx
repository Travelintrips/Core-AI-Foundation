import {
  memo,
  useState,
  useMemo,
  useCallback,
  useRef,
  KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TagOption {
  value: string;
  label: string;
  group?: string;
}

interface TagSelectorProps {
  options: TagOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  groupable?: boolean;
  max?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Tag picker with optional search, filter, grouping, and keyboard navigation.
 * Selected tags shown as dismissible chips above the input.
 */
export const TagSelector = memo(function TagSelector({
  options,
  value,
  onChange,
  placeholder = "Cari atau pilih...",
  searchable = true,
  groupable = false,
  max,
  disabled,
  className,
}: TagSelectorProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.group?.toLowerCase().includes(q) ?? false),
        )
      : options;
  }, [options, query]);

  const grouped = useMemo(() => {
    if (!groupable) return null;
    const map = new Map<string, TagOption[]>();
    for (const opt of filtered) {
      const g = opt.group ?? "Lainnya";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    }
    return map;
  }, [filtered, groupable]);

  const toggle = useCallback(
    (val: string) => {
      if (disabled) return;
      if (value.includes(val)) {
        onChange(value.filter((v) => v !== val));
      } else {
        if (max && value.length >= max) return;
        onChange([...value, val]);
      }
    },
    [value, onChange, disabled, max],
  );

  const remove = useCallback(
    (val: string) => onChange(value.filter((v) => v !== val)),
    [value, onChange],
  );

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && focusIndex >= 0) {
      e.preventDefault();
      toggle(filtered[focusIndex]?.value ?? "");
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const renderList = (items: TagOption[], startIdx = 0) =>
    items.map((opt, i) => {
      const sel = value.includes(opt.value);
      const idx = startIdx + i;
      return (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={sel}
          data-focus={focusIndex === idx}
          onMouseEnter={() => setFocusIndex(idx)}
          onClick={() => toggle(opt.value)}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2.5 text-sm text-left rounded-xl transition-colors duration-150",
            "focus-visible:outline-none",
            sel
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-primary/5",
            focusIndex === idx && "bg-primary/8 ring-1 ring-primary/20",
          )}
        >
          <span className="flex items-center gap-2">
            {opt.label}
          </span>
          {sel && <Check className="w-3.5 h-3.5 shrink-0 text-primary" />}
        </button>
      );
    });

  return (
    <div className={cn("space-y-2", className)}>
      {/* Selected tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence mode="popLayout">
            {value.map((val) => {
              const opt = options.find((o) => o.value === val);
              return (
                <motion.span
                  key={val}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg bg-primary/15 border border-primary/25 text-xs font-medium text-primary"
                >
                  {opt?.label ?? val}
                  <button
                    type="button"
                    aria-label={`Hapus ${opt?.label ?? val}`}
                    onClick={() => remove(val)}
                    disabled={disabled}
                    className="rounded-md hover:bg-primary/20 p-0.5 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Input trigger */}
      <div className="relative">
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-surface-1 cursor-text",
            "transition-all duration-200",
            open
              ? "border-primary ring-2 ring-primary/20"
              : "border-border/60 hover:border-primary/30",
            disabled && "opacity-40 cursor-not-allowed",
          )}
          onClick={() => {
            if (!disabled) {
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          {searchable ? (
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : null}
          {searchable ? (
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setFocusIndex(-1);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={handleKey}
              placeholder={max && value.length >= max ? `Maks. ${max} dipilih` : placeholder}
              disabled={disabled || (!!max && value.length >= max)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
          ) : (
            <span className="flex-1 text-sm text-muted-foreground">
              {value.length > 0 ? `${value.length} dipilih` : placeholder}
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </div>

        {/* Dropdown */}
        <AnimatePresence>
          {open && filtered.length > 0 && (
            <motion.div
              ref={listRef}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              role="listbox"
              aria-multiselectable="true"
              className={cn(
                "absolute z-50 top-full left-0 right-0 mt-1.5 max-h-56 overflow-y-auto",
                "rounded-xl border border-border/60 bg-popover shadow-[0_8px_32px_-4px_rgba(0,0,0,0.6)] p-1.5",
              )}
            >
              {grouped
                ? Array.from(grouped.entries()).map(([group, items], gi) => {
                    const startIdx = [...grouped.entries()]
                      .slice(0, gi)
                      .reduce((acc, [, arr]) => acc + arr.length, 0);
                    return (
                      <div key={group}>
                        <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                          {group}
                        </p>
                        {renderList(items, startIdx)}
                      </div>
                    );
                  })
                : renderList(filtered)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {max && (
        <p className="text-[11px] text-muted-foreground">
          {value.length}/{max} dipilih
        </p>
      )}
    </div>
  );
});

TagSelector.displayName = "TagSelector";
